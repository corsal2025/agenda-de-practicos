'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-pdf-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '1';

const { app } = require('../server/index');
const { generar } = require('../server/slots');

function limpiarTmp() {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
}

let base;
let server;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => new Promise((resolve) => server.close(() => { limpiarTmp(); resolve(); })));

const DIA = '2026-08-03';

test('/api/dia/pdf devuelve un PDF valido con contenido', async () => {
  generar(DIA, DIA);
  const libres = await fetch(`${base}/api/agenda?fecha=${DIA}&estado=libre`).then((r) => r.json());
  await fetch(`${base}/api/agenda/${libres[0].id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nombre: 'ROSA IBANEZ', clase: 'B', tipo_cita: 'NORMAL' }),
  });

  const r = await fetch(`${base}/api/dia/pdf?fecha=${DIA}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.match(buf.subarray(0, 5).toString('latin1'), /^%PDF-/);
  assert.ok(buf.length > 500, 'el PDF no deberia estar vacio');
});

test('/api/dia/pdf sin bloques igual devuelve un PDF (pagina en blanco con aviso)', async () => {
  const r = await fetch(`${base}/api/dia/pdf?fecha=2099-01-01`);
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.match(buf.subarray(0, 5).toString('latin1'), /^%PDF-/);
});
