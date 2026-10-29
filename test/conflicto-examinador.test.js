'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-conflicto-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-conf-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const { db } = require('../server/db');
const app = require('../server/index');

let servidor;
let base;
test.before(async () => {
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => {
  servidor.close();
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  fs.rmSync(tmpBackups, { recursive: true, force: true });
});

async function put(ruta, body) {
  const r = await fetch(base + ruta, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
}

async function post(ruta, body) {
  const r = await fetch(base + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
}

const FECHA = '2031-04-15';
const examinadores = db.prepare('SELECT id, nombre FROM examinadores ORDER BY id LIMIT 2').all();
const EXAM_1 = examinadores[0].id;
const EXAM_2 = examinadores[1].id;

function crearBloque(hora, examinador_id, extra = {}) {
  const r = db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)')
    .run(FECHA, hora, examinador_id);
  const id = Number(r.lastInsertRowid);
  const cols = Object.keys(extra);
  if (cols.length) {
    db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
      .run({ ...extra, id });
  }
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
}

test('PUT agenda: rechaza agendar un RUT con dos examinadores distintos el mismo dia para la misma clase', async () => {
  // Cita con examinador 1 a las 09:00
  crearBloque('09:00', EXAM_1, {
    rut: '12.345.678-5',
    nombre: 'JUAN CONFLICTO',
    clase: 'B',
  });

  // Intentar agendar con examinador 2 a las 10:00 para la misma clase B
  const b2 = crearBloque('10:00', EXAM_2);

  const res = await put(`/api/agenda/${b2.id}`, {
    rut: '12.345.678-5',
    nombre: 'JUAN CONFLICTO',
    clase: 'B',
    correo: 'j@ejemplo.cl',
    tipo_cita: 'NORMAL',
  });

  assert.equal(res.status, 409);
  assert.match(res.datos.error, /Conflicto de examinador/);
  assert.match(res.datos.error, /No se permite la misma persona con dos examinadores distintos/);
});

test('PUT agenda: permite al mismo RUT tener cita con examinador distinto si es para DIFERENTE clase', async () => {
  // b2 con examinador 2 a las 10:30 para clase C
  const b3 = crearBloque('10:30', EXAM_2);

  const res = await put(`/api/agenda/${b3.id}`, {
    rut: '12.345.678-5',
    nombre: 'JUAN CONFLICTO',
    clase: 'C',
    correo: 'j@ejemplo.cl',
    tipo_cita: 'NORMAL',
  });

  assert.equal(res.status, 200);
  assert.equal(res.datos.ok, true);
});

test('POST reagendar: rechaza reagendar hacia otro examinador en un dia donde el RUT ya tiene cita para esa clase', async () => {
  // Cita de origen en otra fecha con examinador 2
  const r = db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, correo) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('2031-04-20', '09:00', EXAM_2, '12.345.678-5', 'JUAN CONFLICTO', 'B', 'j@ejemplo.cl');
  const origenId = Number(r.lastInsertRowid);

  // Destino en la fecha FECHA donde ya tiene cita de clase B con EXAM_1, pero destino es EXAM_2
  const destinoLibre = crearBloque('11:00', EXAM_2);

  const res = await post(`/api/agenda/${origenId}/reagendar`, {
    destino_id: destinoLibre.id,
    correo: 'j@ejemplo.cl',
  });

  assert.equal(res.status, 409);
  assert.match(res.datos.error, /Conflicto de examinador/);
});
