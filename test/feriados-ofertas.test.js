'use strict';
// Los feriados no deben ofrecerse como cupo disponible: ni en /api/disponibles, ni en el
// listado de reagendamiento publico, ni aceptados por POST .../elegir.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const tmpDb = path.join(os.tmpdir(), `agenda-feriados-of-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-feriados-of-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const correo = require('../server/correo');
correo.habilitado = true;
correo.confirmacion = async () => true;
correo.recordatorio = async () => true;
correo.solicitudConfirmacion = async () => true;

const { db } = require('../server/db');
const { hoyISO } = require('../server/fechas');
const feriados = require('../server/feriados');
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

const hoyMas = (n) => {
  const d = new Date(`${hoyISO()}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Fecha dentro de la ventana de reagendamiento que no sea ya un feriado de la semilla.
// Cada llamada devuelve una fecha distinta para no mezclar bloques entre tests.
let offsetFecha = 5;
function fechaLibreFutura() {
  for (let n = offsetFecha; n < 35; n++) {
    const f = hoyMas(n);
    if (!feriados.set().has(f)) { offsetFecha = n + 1; return f; }
  }
  throw new Error('no se encontro una fecha libre');
}

let exN = 500;
function examinadorNuevo() {
  const nombre = `EX FERIADOS ${exN++}`;
  db.prepare('INSERT INTO examinadores (nombre) VALUES (?)').run(nombre);
  return db.prepare('SELECT id FROM examinadores WHERE nombre = ?').get(nombre).id;
}

async function apiJson(ruta) {
  const r = await fetch(`${base}/api${ruta}`);
  return { status: r.status, datos: await r.json() };
}

test('GET /api/disponibles no devuelve bloques de una fecha marcada feriado', async () => {
  const ex = examinadorNuevo();
  const fecha = fechaLibreFutura();
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(fecha, '09:00', ex);
  feriados.agregar(fecha, 'Feriado de prueba');

  const r = await apiJson(`/disponibles?desde=${fecha}&hasta=${fecha}`);
  assert.equal(r.status, 200);
  assert.equal(r.datos.length, 0);

  feriados.quitar(fecha);
});

test('GET /reagendar/:id/:token no lista un bloque feriado como opcion', async () => {
  const ex = examinadorNuevo();
  const fechaOrigen = hoyMas(1);
  const fechaFeriada = fechaLibreFutura();
  feriados.agregar(fechaFeriada, 'Feriado de prueba');

  const token = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, token_confirmacion)
    VALUES (?, '09:00', ?, '77.777.777-7', 'ORIGEN', 'B', ?)`).run(fechaOrigen, ex, token);
  const origen = db.prepare('SELECT * FROM agenda WHERE rut = ?').get('77.777.777-7');

  const destinoFeriado = db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)')
    .run(fechaFeriada, '10:00', ex);

  const r = await fetch(`${base}/reagendar/${origen.id}/${token}`);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.ok(!html.includes(`value="${destinoFeriado.lastInsertRowid}"`));

  feriados.quitar(fechaFeriada);
});

test('POST /reagendar/:id/:token/elegir a un bloque en feriado responde 400 y no cambia origen ni destino', async () => {
  const ex = examinadorNuevo();
  const fechaOrigen = hoyMas(1);
  const fechaFeriada = fechaLibreFutura();
  feriados.agregar(fechaFeriada, 'Feriado de prueba');

  const token = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, token_confirmacion)
    VALUES (?, '09:00', ?, '88.888.888-8', 'ORIGEN2', 'B', ?)`).run(fechaOrigen, ex, token);
  const origenAntes = db.prepare('SELECT * FROM agenda WHERE rut = ?').get('88.888.888-8');

  const destino = db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)')
    .run(fechaFeriada, '11:00', ex);
  const destinoId = Number(destino.lastInsertRowid);

  const r = await fetch(`${base}/reagendar/${origenAntes.id}/${token}/elegir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `nuevo_slot_id=${destinoId}`,
  });
  assert.equal(r.status, 400);

  const origenDespues = db.prepare('SELECT * FROM agenda WHERE id = ?').get(origenAntes.id);
  const destinoDespues = db.prepare('SELECT * FROM agenda WHERE id = ?').get(destinoId);
  assert.equal(origenDespues.rut, '88.888.888-8');
  assert.equal(destinoDespues.rut, null);
  assert.equal(destinoDespues.nombre, null);

  feriados.quitar(fechaFeriada);
});

test('al quitar el feriado, la fecha vuelve a ofrecerse', async () => {
  const ex = examinadorNuevo();
  const fecha = fechaLibreFutura();
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(fecha, '09:00', ex);
  feriados.agregar(fecha, 'Feriado de prueba');

  let r = await apiJson(`/disponibles?desde=${fecha}&hasta=${fecha}`);
  assert.equal(r.datos.length, 0);

  feriados.quitar(fecha);
  r = await apiJson(`/disponibles?desde=${fecha}&hasta=${fecha}`);
  assert.equal(r.datos.length, 1);
});
