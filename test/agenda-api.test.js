'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Base de datos temporal ANTES de requerir los modulos del servidor.
const tmpDb = path.join(os.tmpdir(), `agenda-api-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '1';

const { app } = require('../server/index');
const { generar } = require('../server/slots');
const { db } = require('../server/db');

function limpiarTmp() {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
}

let base;
let server;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => new Promise((resolve) => server.close(() => { limpiarTmp(); resolve(); })));

const api = (metodo, ruta, body) => fetch(base + ruta, {
  method: metodo,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const DIA = '2026-08-03'; // lunes habil, mismo que usa migrate.test.js

test('genera la grilla del dia y respeta la regla D/A5', async () => {
  generar(DIA, DIA);
  const { status, body: libres } = await api('GET', `/api/agenda?fecha=${DIA}&estado=libre`);
  assert.equal(status, 200);
  assert.ok(libres.length > 0);

  const bloque830 = libres.find((b) => b.hora === '08:30');
  const bloque1230 = libres.find((b) => b.hora === '12:30');
  assert.ok(bloque830 && bloque1230);

  // Clase D fuera de las 12:30: la app debe rechazarlo.
  const rechazo = await api('PUT', `/api/agenda/${bloque830.id}`, {
    nombre: 'JUAN PEREZ', clase: 'D', tipo_cita: 'NORMAL',
  });
  assert.equal(rechazo.status, 400);
  assert.match(rechazo.body.error, /12:30/);

  // La misma clase en el bloque de las 12:30 se acepta.
  const ok = await api('PUT', `/api/agenda/${bloque1230.id}`, {
    nombre: 'JUAN PEREZ', clase: 'D', tipo_cita: 'NORMAL',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.bloque.clase, 'D');
});

test('bloquear un bloque ocupado lo manda a la papelera y lo deja libre', async () => {
  const { body: libres } = await api('GET', `/api/agenda?fecha=${DIA}&estado=libre`);
  const bloque = libres[0];
  await api('PUT', `/api/agenda/${bloque.id}`, { nombre: 'MARIA SOTO', clase: 'B', tipo_cita: 'NORMAL' });

  const bloqueo = await api('PUT', `/api/agenda/${bloque.id}`, { bloqueado: true, bloqueo_motivo: 'terreno' });
  assert.equal(bloqueo.status, 200);
  assert.equal(bloqueo.body.bloque.bloqueado, 1);
  assert.equal(bloqueo.body.bloque.bloqueo_motivo, 'TERRENO');
  assert.equal(bloqueo.body.bloque.nombre, null);

  const { body: papelera } = await api('GET', '/api/papelera');
  assert.ok(papelera.some((p) => p.nombre === 'MARIA SOTO'));
});

test('bloqueo optimista: rechaza si otro edito el bloque mientras tanto', async () => {
  const { body: libres } = await api('GET', `/api/agenda?fecha=${DIA}&estado=libre`);
  const bloque = libres[0];
  const primero = await api('PUT', `/api/agenda/${bloque.id}`, { nombre: 'PEDRO ROJAS', clase: 'B', tipo_cita: 'NORMAL' });
  assert.equal(primero.status, 200);
  const vistoEn = primero.body.bloque.actualizado_en; // lo que "vio" el primer usuario

  // Simula que otro usuario edito el mismo bloque un segundo despues (sin depender
  // de la resolucion de reloj real, que puede coincidir dentro del mismo test).
  db.prepare("UPDATE agenda SET actualizado_en = datetime(actualizado_en, '+1 second') WHERE id = ?").run(bloque.id);

  // El primer usuario intenta guardar con el timestamp viejo: debe rechazarse.
  const segundo = await api('PUT', `/api/agenda/${bloque.id}`, {
    nombre: 'OTRO NOMBRE', clase: 'B', tipo_cita: 'NORMAL', visto_en: vistoEn,
  });
  assert.equal(segundo.status, 409);
  assert.ok(segundo.body.bloque, 'debe devolver el bloque actualizado para recargar');
});

test('bloquear-dia mueve las citas ocupadas a la papelera y bloquea el resto', async () => {
  const otroDia = '2026-08-04';
  generar(otroDia, otroDia);
  const { body: libres } = await api('GET', `/api/agenda?fecha=${otroDia}&estado=libre`);
  await api('PUT', `/api/agenda/${libres[0].id}`, { nombre: 'CON CITA', clase: 'B', tipo_cita: 'NORMAL' });

  const r = await api('POST', '/api/bloquear-dia', { fecha: otroDia, motivo: 'dia administrativo', incluir_ocupados: true });
  assert.equal(r.status, 200);
  assert.ok(r.body.bloqueados > 0);

  const { body: agenda } = await api('GET', `/api/agenda?fecha=${otroDia}`);
  assert.ok(agenda.every((b) => b.bloqueado === 1));
});

test('/api/meta expone la regla de horario para clases pesadas', async () => {
  const { status, body } = await api('GET', '/api/meta');
  assert.equal(status, 200);
  assert.deepEqual(body.horas_pesadas, ['12:30']);
  assert.deepEqual(body.clases_pesadas.sort(), ['A5', 'D']);
});

test('el bloque D/A5 es configurable via catalogos (como los feriados)', async () => {
  const invalido = await api('POST', '/api/catalogos', { tipo: 'hora_pesada', valor: '10:15' });
  assert.equal(invalido.status, 400, 'no deberia aceptar un horario que no es un bloque real');

  const agregar = await api('POST', '/api/catalogos', { tipo: 'hora_pesada', valor: '08:30' });
  assert.equal(agregar.status, 200);

  const meta = await api('GET', '/api/meta');
  assert.deepEqual(meta.body.horas_pesadas.sort(), ['08:30', '12:30']);

  // Ahora la clase D tambien se puede agendar a las 08:30 sin forzar (dia nuevo, sin usar).
  const diaNuevo = '2026-08-05';
  generar(diaNuevo, diaNuevo);
  const { body: libres } = await api('GET', `/api/agenda?fecha=${diaNuevo}&estado=libre`);
  const bloque830 = libres.find((b) => b.hora === '08:30');
  const ok = await api('PUT', `/api/agenda/${bloque830.id}`, { nombre: 'ANA DIAZ', clase: 'D', tipo_cita: 'NORMAL' });
  assert.equal(ok.status, 200);

  await api('DELETE', '/api/catalogos?tipo=hora_pesada&valor=08%3A30');
});
