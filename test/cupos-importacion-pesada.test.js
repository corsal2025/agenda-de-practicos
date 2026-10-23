'use strict';
// Cupos extra en la importacion de Citas disponibles y en la regla de clase pesada (D/A5).
// Usa una base temporal: NUNCA toca data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-cupos-imp-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-cupos-imp-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const { db } = require('../server/db');
const { HORA_D_A5 } = require('../server/config');
const { reservarCupoLibre } = require('../server/cupos');
const pesada = require('../server/pesada');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  fs.rmSync(tmpBackups, { recursive: true, force: true });
});

const EXAMINADOR_ID = db.prepare('SELECT id FROM examinadores ORDER BY id LIMIT 1').get().id;

function insertarBloque(fecha, hora, cupo, extra = {}) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, cupo) VALUES (?, ?, ?, ?)').run(fecha, hora, EXAMINADOR_ID, cupo);
  const cols = Object.keys(extra);
  if (cols.length) {
    db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE fecha = @f AND hora = @h AND examinador_id = @e AND cupo = @c`)
      .run({ ...extra, f: fecha, h: hora, e: EXAMINADOR_ID, c: cupo });
  }
  return db.prepare('SELECT * FROM agenda WHERE fecha = ? AND hora = ? AND examinador_id = ? AND cupo = ?')
    .get(fecha, hora, EXAMINADOR_ID, cupo);
}

const datos = (nombre) => ({
  rut: '12.345.678-5', nombre, clase: 'B', contacto: null, correo: null, tipo_cita: 'NORMAL', funcionario_id: null,
});

test('reservarCupoLibre: cada fila de la importacion ocupa un cupo libre distinto', () => {
  const fecha = '2031-04-01';
  insertarBloque(fecha, '09:00', 1);
  insertarBloque(fecha, '09:00', 2);

  assert.equal(reservarCupoLibre(fecha, '09:00', EXAMINADOR_ID, datos('PRIMERA')), 1);
  assert.equal(reservarCupoLibre(fecha, '09:00', EXAMINADOR_ID, datos('SEGUNDA')), 1);
  assert.equal(reservarCupoLibre(fecha, '09:00', EXAMINADOR_ID, datos('TERCERA')), 0, 'sin cupos libres no reserva');

  const filas = db.prepare('SELECT cupo, nombre FROM agenda WHERE fecha = ? AND hora = ? AND examinador_id = ? ORDER BY cupo')
    .all(fecha, '09:00', EXAMINADOR_ID);
  assert.deepEqual(filas.map((f) => f.nombre), ['PRIMERA', 'SEGUNDA']);
});

test('reservarCupoLibre: no toma cupos bloqueados', () => {
  const fecha = '2031-04-02';
  insertarBloque(fecha, '10:00', 1, { bloqueado: 1, bloqueo_motivo: 'TERRENO' });
  insertarBloque(fecha, '10:00', 2);
  assert.equal(reservarCupoLibre(fecha, '10:00', EXAMINADOR_ID, datos('UNICA')), 1);
  const bloqueado = db.prepare('SELECT nombre FROM agenda WHERE fecha = ? AND hora = ? AND cupo = 1').get(fecha, '10:00');
  assert.equal(bloqueado.nombre, null);
});

test('clase pesada: el bloqueo automatico sigue vigente si la clase D/A5 esta en un cupo extra de las 12:30', () => {
  const fecha = '2031-05-05';
  insertarBloque(fecha, HORA_D_A5, 1);
  insertarBloque(fecha, HORA_D_A5, 2, { nombre: 'PERSONA EXTRA', clase: 'D' });
  const dependiente = insertarBloque(fecha, '13:00', 1, {
    bloqueado: 1, bloqueo_motivo: pesada.MOTIVO_AUTO,
  });
  assert.equal(pesada.bloqueoAutoVigente(dependiente), true);
});
