'use strict';
// Recordatorios: ventana de los proximos 3 dias (no un dia exacto) y texto segun lo que falta.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `agenda-rec-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-rec-bk-'));

const { db } = require('../server/db');
const correo = require('../server/correo');
const { hoyISO, sumarDias } = require('../server/fechas');
const { enviarPendientes } = require('../server/recordatorios');

test.after(() => { for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} } });

const exId = db.prepare('SELECT id FROM examinadores LIMIT 1').get().id;
const cita = (fecha, hora) => db.prepare(`INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, correo, clase)
  VALUES (?, ?, ?, '11.111.111-1', 'PRUEBA', 'p@x.cl', 'B')`).run(fecha, hora, exId).lastInsertRowid;

test('cuandoFalta: mañana / en N dias', () => {
  const hoy = '2026-10-12';
  assert.equal(correo.cuandoFalta('2026-10-13', hoy).corto, 'mañana');
  assert.equal(correo.cuandoFalta('2026-10-14', hoy).corto, 'en 2 días');
  assert.equal(correo.cuandoFalta('2026-10-15', hoy).asunto, 'Faltan 3 días');
});

test('enviarPendientes: incluye citas atrasadas de mañana y pasado, no hoy ni a 4 dias', async () => {
  const hoy = hoyISO();
  const ids = {
    hoy: cita(hoy, '08:30'), d1: cita(sumarDias(hoy, 1), '09:00'), d2: cita(sumarDias(hoy, 2), '09:30'),
    d3: cita(sumarDias(hoy, 3), '10:00'), d4: cita(sumarDias(hoy, 4), '10:30'),
  };
  const enviados = [];
  const orig = correo.recordatorio;
  correo.habilitado = true;
  correo.recordatorio = async (b) => { enviados.push(b.id); return true; };
  try {
    await enviarPendientes();
  } finally {
    correo.recordatorio = orig;
    correo.habilitado = null;
  }
  assert.deepEqual(enviados.sort((a, b) => a - b), [ids.d1, ids.d2, ids.d3].sort((a, b) => a - b));
  const marcado = (id) => db.prepare('SELECT correo_recordatorio_enviado v FROM agenda WHERE id = ?').get(id).v;
  assert.equal(marcado(ids.d1), 1);
  assert.equal(marcado(ids.d4), 0);
});
