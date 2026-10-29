'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), `agenda-admin-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;

const { db } = require('../server/db');
const papelera = require('../server/papelera');
const app = require('../server/index');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(tmpDb + s); } catch (_) {}
  }
});

function invocarApp(metodo, ruta, { body = {}, query = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let datos = null;
    const resHeaders = {};
    const req = {
      method: metodo.toUpperCase(),
      url: ruta,
      originalUrl: ruta,
      path: ruta,
      body,
      query,
      params: {},
      headers: { host: '127.0.0.1:4900', 'content-type': 'application/json', ...headers },
      get(k) { return this.headers[k.toLowerCase()]; },
      header(k) { return this.headers[k.toLowerCase()]; },
      on() { return this; },
      resume() { return this; },
    };
    const res = {
      statusCode: 200,
      status(c) { statusCode = c; this.statusCode = c; return res; },
      setHeader(k, v) { resHeaders[k.toLowerCase()] = v; return res; },
      getHeader(k) { return resHeaders[k.toLowerCase()]; },
      json(d) { datos = d; resolve({ status: statusCode, body: datos }); },
      send(d) { datos = d; resolve({ status: statusCode, body: datos }); },
      end(d) { if (d && !datos) datos = d; resolve({ status: statusCode, body: datos }); },
      on() { return res; },
      once() { return res; },
      emit() { return true; },
    };
    app.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: statusCode, body: datos });
    });
  });
}

test('GET /api/admin/estado devuelve metricas y rol de administrador', async () => {
  const r = await invocarApp('GET', '/api/admin/estado');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.rol, 'Administrador del Sistema');
  assert.ok(r.body.metricas);
  assert.equal(typeof r.body.metricas.total_citas, 'number');
  assert.equal(typeof r.body.metricas.total_bloques, 'number');
  assert.equal(typeof r.body.metricas.papelera_count, 'number');
  assert.equal(r.body.metricas.bd_integridad, 'ok');
});

test('POST /api/admin/optimizar ejecuta VACUUM y ANALYZE y reporta integridad', async () => {
  const r = await invocarApp('POST', '/api/admin/optimizar');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.mensaje, /optimizada con éxito/i);
  assert.equal(r.body.integridad, 'ok');
});

test('POST /api/admin/limpiar-papelera elimina entradas antiguas', async () => {
  db.prepare("INSERT INTO papelera (agenda_id, datos, motivo, actor, ts) VALUES (991, '{}', 'test', 'admin', datetime('now', '-45 days', 'localtime'))").run();
  db.prepare("INSERT INTO papelera (agenda_id, datos, motivo, actor, ts) VALUES (992, '{}', 'test', 'admin', datetime('now', '-2 days', 'localtime'))").run();

  const r = await invocarApp('POST', '/api/admin/limpiar-papelera', { body: { dias: 30 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.eliminadas >= 1);

  const restantes = db.prepare('SELECT agenda_id FROM papelera WHERE agenda_id IN (991, 992)').all();
  assert.equal(restantes.some((x) => x.agenda_id === 991), false);
  assert.equal(restantes.some((x) => x.agenda_id === 992), true);
});
