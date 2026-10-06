'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-repcorreo-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '1';
delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
delete process.env.AGENDA_REPORTE_DESTINATARIOS;

const app = require('../server/index');
const { formatear, destinatarios } = require('../server/reporte-correo');

let base; let server;
test.before(() => new Promise((ok) => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }); }));
test.after(() => new Promise((ok) => server.close(() => {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  ok();
})));

test('formatear() arma asunto, texto y html, y escapa los datos del postulante', () => {
  const rep = { total: 1, resumen: { RUT_INVALIDO: 1 }, hallazgos: [
    { severidad: 'warning', tipo: 'RUT_INVALIDO', fecha: '2026-08-03', hora: '08:30', examinador: 'DANIEL LAGOS', nombre: '<b>JUAN</b>', mensaje: 'RUT invalido' },
  ] };
  const { asunto, texto, html } = formatear(rep);
  assert.match(asunto, /Reporte de errores/);
  assert.match(texto, /JUAN/);
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /<b>JUAN<\/b>/);
  assert.match(html, /&lt;b&gt;JUAN/);
});

test('destinatarios() separa por coma y descarta vacios', () => {
  process.env.AGENDA_REPORTE_DESTINATARIOS = ' a@x.cl, ,b@x.cl ';
  try { assert.deepEqual(destinatarios(), ['a@x.cl', 'b@x.cl']); }
  finally { delete process.env.AGENDA_REPORTE_DESTINATARIOS; }
});

test('sin SMTP, POST /api/errores/enviar responde 400 claro', async () => {
  const r = await fetch(`${base}/api/errores/enviar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /SMTP no configurado/);
});

test('GET /api/dia/pdf devuelve un PDF y rechaza fechas invalidas', async () => {
  const ok = await fetch(`${base}/api/dia/pdf?fecha=2026-08-03`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await ok.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const mal = await fetch(`${base}/api/dia/pdf?fecha=hoy`);
  assert.equal(mal.status, 400);
});
