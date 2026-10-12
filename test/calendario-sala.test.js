'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-cal-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-cal-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const { db } = require('../server/db');
const app = require('../server/index');
const { estadoSala, iniciales } = require('../server/vistas');

let servidor; let base;
test.before(async () => {
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => {
  servidor.close();
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  fs.rmSync(tmpBackups, { recursive: true, force: true });
});
const get = async (ruta) => { const r = await fetch(base + ruta); return { status: r.status, datos: await r.json() }; };
function slot(fecha, hora, extra = {}) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, 1)').run(fecha, hora);
  const f = db.prepare('SELECT id FROM agenda WHERE fecha=? AND hora=? AND examinador_id=1').get(fecha, hora);
  const cols = Object.keys(extra);
  if (cols.length) db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...extra, id: f.id });
}
const persona = { rut: '11.111.111-1', nombre: 'JUAN ANDRES GONZALEZ PEREZ', clase: 'B', contacto: '+56911111111', correo: 'a@b.cl' };

test('iniciales: primer nombre y primer apellido', () => {
  assert.equal(iniciales('JUAN ANDRES GONZALEZ PEREZ'), 'J. G.');
  assert.equal(iniciales('maria soto'), 'M. S.');
  assert.equal(iniciales('PEDRO'), 'P.');
  assert.equal(iniciales(null), '');
});

test('estadoSala: todas las citas de la proxima hora son siguiente (varios examinadores)', () => {
  const citas = [{ hora: '08:30', resultado: null }, { hora: '08:30', resultado: null }, { hora: '09:00', resultado: null }];
  assert.deepEqual(estadoSala(citas, '08:00'), ['siguiente', 'siguiente', 'pendiente']);
});

test('estadoSala: en curso, siguiente, finalizado, pendiente', () => {
  const citas = [
    { hora: '09:00', resultado: null }, { hora: '10:00', resultado: null },
    { hora: '10:30', resultado: null }, { hora: '11:00', resultado: null }, { hora: '08:00', resultado: 'APROBADO' },
  ];
  assert.deepEqual(estadoSala(citas, '10:10'), ['finalizado', 'en curso', 'siguiente', 'pendiente', 'finalizado']);
});

test('sala: solo datos minimos, sin RUT ni nombre ni contacto', async () => {
  const hoy = require('../server/fechas').hoyISO();
  slot(hoy, '23:58', persona);
  slot(hoy, '23:59', { bloqueado: 1, ...persona, rut: '22.222.222-2' });
  const { status, datos } = await get('/api/sala');
  assert.equal(status, 200);
  assert.equal(datos.citas.length, 1);
  const c = datos.citas[0];
  assert.deepEqual(Object.keys(c).sort(), ['clase', 'estado', 'examinador', 'hora', 'iniciales']);
  assert.equal(c.iniciales, 'J. G.');
  const texto = JSON.stringify(datos);
  for (const k of ['rut', 'nombre', 'contacto', 'correo']) assert.ok(!texto.includes(`"${k}"`), k);
  assert.ok(!texto.includes('11.111.111-1') && !texto.includes('GONZALEZ'));
});
