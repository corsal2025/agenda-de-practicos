'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-recordatorios-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '1';

const { app } = require('../server/index');
const { generar } = require('../server/slots');
const { db } = require('../server/db');
const recordatorios = require('../server/recordatorios');
const { hoyISO, sumarDias, esHabil } = require('../server/fechas');

function limpiarTmp() {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
}

let base;
let server;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => new Promise((resolve) => server.close(() => { limpiarTmp(); recordatorios.registrarProveedor(null); resolve(); })));

const api = (metodo, ruta, body) => fetch(base + ruta, {
  method: metodo,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// El siguiente dia habil (no necesariamente "manana": puede ser fin de semana),
// expresado como offset de dias para pasarselo a /api/recordatorios?dias=N.
let dias = 1;
while (!esHabil(sumarDias(hoyISO(), dias))) dias += 1;
const OBJETIVO = sumarDias(hoyISO(), dias);

test('sin proveedor: informa pendientes pero no marca nada como enviado', async () => {
  generar(OBJETIVO, OBJETIVO);
  const { body: libres } = await api('GET', `/api/agenda?fecha=${OBJETIVO}&estado=libre`);
  await api('PUT', `/api/agenda/${libres[0].id}`, { nombre: 'LUCIA MORA', clase: 'B', tipo_cita: 'NORMAL', contacto: '912345678' });

  const { body: r1 } = await api('GET', `/api/recordatorios?dias=${dias}`);
  assert.equal(r1.citas.length, 1);
  assert.match(r1.mensaje_ejemplo, /LUCIA/);

  const { body: proc } = await api('POST', '/api/recordatorios/procesar', { dias });
  assert.equal(proc.enviados, 0);
  assert.equal(proc.pendientes, 1);
  assert.match(proc.motivo, /Sin proveedor/);

  // Como no se envio nada, la cita sigue apareciendo como pendiente.
  const { body: r2 } = await api('GET', `/api/recordatorios?dias=${dias}`);
  assert.equal(r2.citas.length, 1);
});

test('con un proveedor registrado, procesar() envia y marca la cita', async () => {
  const enviados = [];
  recordatorios.registrarProveedor(async (tel, texto) => { enviados.push({ tel, texto }); });

  const { body: proc } = await api('POST', '/api/recordatorios/procesar', { dias });
  assert.equal(proc.enviados, 1);
  assert.equal(proc.pendientes, 0);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].texto, /examen práctico/);

  const { body: r } = await api('GET', `/api/recordatorios?dias=${dias}`);
  assert.equal(r.citas.length, 0, 'ya no debe pedir recordatorio de nuevo');
});
