'use strict';
// Login real (no "modo sin login"): bloqueo por IP tras varios intentos fallidos.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-auth-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '0';
process.env.AGENDA_PIN = '1234';
process.env.AGENDA_LOGIN_BLOQUEO_MS = '80'; // bloqueo corto para no alargar el test

const app = require('../server/index');

let base;
let server;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => new Promise((resolve) => server.close(() => {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  resolve();
})));

const login = (clave, usuario = 'prueba') => fetch(`${base}/api/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ usuario, clave }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('bloquea el login tras 5 claves incorrectas seguidas', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('0000')).status, 401);
  const bloqueado = await login('1234'); // ni la clave correcta pasa mientras dura el bloqueo
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.body.error, /Demasiados intentos/);
});

test('una clave correcta antes del limite entra y resetea los intentos', async () => {
  await new Promise((r) => setTimeout(r, 150)); // expira el bloqueo anterior
  assert.equal((await login('9999')).status, 401);
  const ok = await login('1234');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.funcionario, 'PRUEBA');
});
