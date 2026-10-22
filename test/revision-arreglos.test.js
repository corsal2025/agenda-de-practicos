'use strict';
// Regresiones de la revision: host loopback, validacion de catalogos, filtro exacto de clase,
// liberar transaccional y nombres no textuales. Base temporal, puerto efimero: NUNCA toca data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-revision-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-revision-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const correo = require('../server/correo');
correo.habilitado = false;

const { db } = require('../server/db');
const { HOST } = require('../server/config');
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

async function http(metodo, ruta, json) {
  const init = { method: metodo, headers: {} };
  if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  const r = await fetch(base + ruta, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}

const exam = () => db.prepare('SELECT id FROM examinadores ORDER BY id LIMIT 1').get().id;

test('el servidor escucha solo en loopback', () => {
  assert.equal(HOST, '127.0.0.1');
  assert.equal(servidor.address().address, '127.0.0.1');
});

test('POST /api/catalogos rechaza un tipo que no existe', async () => {
  const r = await http('POST', '/api/catalogos', { tipo: 'inventado', valor: 'X' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Catálogo no válido/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalogos WHERE tipo = 'inventado'").get().n, 0);
  const ok = await http('POST', '/api/catalogos', { tipo: 'clase', valor: 'c1' });
  assert.equal(ok.status, 200);
});

test('filtro de clase exacto: "A" no trae citas de A1', async () => {
  db.prepare("INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase) VALUES ('2091-03-02', '09:00', ?, '12.345.678-5', 'FILTRO UNO', 'A1')").run(exam());
  const conA = await http('GET', '/api/agenda?fecha=2091-03-02&clase=A');
  assert.equal(conA.body.filter((c) => c.nombre === 'FILTRO UNO').length, 0);
  const conA1 = await http('GET', '/api/agenda?fecha=2091-03-02&clase=A1');
  assert.equal(conA1.body.filter((c) => c.nombre === 'FILTRO UNO').length, 1);
});

test('filtro de clase encuentra la clase dentro de una lista "B,A2"', async () => {
  db.prepare("INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase) VALUES ('2091-03-03', '09:00', ?, '12.345.679-3', 'LISTA DOS', 'B,A2')").run(exam());
  const r = await http('GET', '/api/agenda?fecha=2091-03-03&clase=A2');
  assert.equal(r.body.filter((c) => c.nombre === 'LISTA DOS').length, 1);
});

test('PUT examinador con nombre no textual no responde 500', async () => {
  const id = exam();
  const r = await http('PUT', `/api/examinadores/${id}`, { nombre: 123 });
  assert.equal(r.status, 200);
});

test('liberar: deja la cita libre y la encola en una sola operacion', async () => {
  const id = db.prepare("INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, correo) VALUES ('2091-03-04', '10:00', ?, '12.345.680-7', 'LIBERAR UNO', 'B', 'a@b.cl') RETURNING id").get(exam()).id;
  const r = await http('POST', `/api/agenda/${id}/liberar`, { motivo: 'prueba' });
  assert.equal(r.status, 200);
  assert.equal(r.body.encolado, true);
  const fila = db.prepare('SELECT rut, nombre FROM agenda WHERE id = ?').get(id);
  assert.equal(fila.rut, null);
  assert.equal(fila.nombre, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cola_reagendar WHERE origen_agenda_id = ? AND nombre = 'LIBERAR UNO'").get(id).n, 1);
});
