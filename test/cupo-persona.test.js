'use strict';
// Varias personas en la misma hora: POST /api/agenda/:id/persona crea filas con cupo 2, 3...
// Usa una base temporal y un puerto efimero: NUNCA toca data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-cupo-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-cupo-bk-'));
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

async function post(ruta) {
  const r = await fetch(base + ruta, { method: 'POST' });
  return { status: r.status, datos: await r.json().catch(() => null) };
}

const EXAMINADOR_ID = db.prepare('SELECT id FROM examinadores ORDER BY id LIMIT 1').get().id;
const FECHA = '2031-03-10';

// Bloque original (cupo 1) con datos de cita o bloqueado, segun el caso.
function bloque(hora, extra = {}) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(FECHA, hora, EXAMINADOR_ID);
  const fila = db.prepare('SELECT * FROM agenda WHERE fecha = ? AND hora = ? AND examinador_id = ? AND cupo = 1')
    .get(FECHA, hora, EXAMINADOR_ID);
  const cols = Object.keys(extra);
  if (cols.length) {
    db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
      .run({ ...extra, id: fila.id });
  }
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(fila.id);
}

const filasDeLaHora = (hora) => db.prepare(
  'SELECT * FROM agenda WHERE fecha = ? AND hora = ? AND examinador_id = ? ORDER BY cupo'
).all(FECHA, hora, EXAMINADOR_ID);

test('POST persona crea cupo 2 con mismo fecha/hora/examinador, libre y sin datos de cita', async () => {
  const origen = bloque('07:10', { rut: '11.111.111-1', nombre: 'JUAN PEREZ', clase: 'B' });

  const r = await post(`/api/agenda/${origen.id}/persona`);

  assert.equal(r.status, 200);
  const nueva = r.datos.bloque;
  assert.equal(nueva.cupo, 2);
  assert.notEqual(nueva.id, origen.id);
  assert.equal(nueva.fecha, FECHA);
  assert.equal(nueva.hora, '07:10');
  assert.equal(nueva.examinador_id, EXAMINADOR_ID);
  assert.equal(nueva.rut, null);
  assert.equal(nueva.nombre, null);
  assert.equal(nueva.clase, null);
  assert.equal(nueva.bloqueado, 0);
  const original = db.prepare('SELECT * FROM agenda WHERE id = ?').get(origen.id);
  assert.equal(original.nombre, 'JUAN PEREZ', 'la cita original no se toca');
  assert.equal(original.cupo, 1);
  assert.equal(filasDeLaHora('07:10').length, 2);
});

test('un tercer POST sobre el mismo bloque crea cupo 3', async () => {
  const origen = bloque('07:20', { rut: '22.222.222-2', nombre: 'ANA SOTO' });
  const primera = await post(`/api/agenda/${origen.id}/persona`);
  assert.equal(primera.datos.bloque.cupo, 2);

  const segunda = await post(`/api/agenda/${origen.id}/persona`);

  assert.equal(segunda.status, 200);
  assert.equal(segunda.datos.bloque.cupo, 3);
  assert.deepEqual(filasDeLaHora('07:20').map((f) => f.cupo), [1, 2, 3]);
});

test('POST persona sobre un bloque bloqueado responde 409 y no crea filas', async () => {
  const origen = bloque('07:30', { bloqueado: 1, bloqueo_motivo: 'FERIADO' });

  const r = await post(`/api/agenda/${origen.id}/persona`);

  assert.equal(r.status, 409);
  assert.equal(filasDeLaHora('07:30').length, 1);
});

test('POST persona deja huella en movimientos con el id del cupo nuevo', async () => {
  const origen = bloque('07:40', { rut: '33.333.333-3', nombre: 'PEDRO MUNOZ' });

  const r = await post(`/api/agenda/${origen.id}/persona`);

  const mov = db.prepare("SELECT * FROM movimientos WHERE agenda_id = ? AND accion = 'generar'")
    .get(r.datos.bloque.id);
  assert.ok(mov, 'se registro un movimiento para el cupo nuevo');
  assert.match(mov.detalle, /cupo 2/);
});

test('POST persona sobre un id inexistente responde 404', async () => {
  const r = await post('/api/agenda/999999999/persona');
  assert.equal(r.status, 404);
});
