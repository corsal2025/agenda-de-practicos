'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-correo-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '1';
delete process.env.AGENDA_SMTP_HOST;
delete process.env.AGENDA_SMTP_USER;
delete process.env.AGENDA_REPORTE_DESTINATARIOS;

const { app } = require('../server/index');
const { formatear } = require('../server/reporte-correo');

function limpiarTmp() {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
}

let base;
let server;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => new Promise((resolve) => server.close(() => { limpiarTmp(); resolve(); })));

test('formatear() arma asunto, texto y html a partir del reporte', () => {
  const rep = { total: 1, resumen: { RUT_INVALIDO: 1 }, hallazgos: [
    { severidad: 'warning', tipo: 'RUT_INVALIDO', fecha: '2026-08-03', hora: '08:30', examinador: 'DANIEL LAGOS', nombre: 'JUAN PEREZ', mensaje: 'RUT invalido' },
  ] };
  const { asunto, texto, html } = formatear(rep);
  assert.match(asunto, /Reporte de errores/);
  assert.match(texto, /JUAN PEREZ/);
  assert.match(html, /<table/);
  assert.match(html, /RUT invalido/);
});

test('sin SMTP configurado, /api/errores/enviar responde con error claro (no se cuelga)', async () => {
  const r = await fetch(`${base}/api/errores/enviar`, { method: 'POST' });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /SMTP no configurado/);
});
