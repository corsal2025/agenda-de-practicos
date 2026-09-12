'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-auth-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = ''; // login real, no "modo sin login"
process.env.AGENDA_PIN = '1234';
process.env.AGENDA_LOGIN_BLOQUEO_MS = '80'; // bloqueo corto para no alargar el test

const { app } = require('../server/index');

function limpiarTmp() {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
}

let base;
let server;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => new Promise((resolve) => server.close(() => { limpiarTmp(); resolve(); })));

const login = (pin, funcionario = 'PRUEBA') => fetch(`${base}/api/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ pin, funcionario }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('bloquea el login tras varios PIN incorrectos seguidos', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await login('0000');
    assert.equal(r.status, 401);
  }
  const bloqueado = await login('1234'); // el PIN correcto tampoco pasa: esta bloqueado
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.body.error, /Demasiados intentos/);
});

test('un PIN correcto antes del limite deja entrar y resetea los intentos', async () => {
  await new Promise((r) => setTimeout(r, 150)); // esperar a que expire el bloqueo del test anterior
  const r1 = await login('9999');
  assert.equal(r1.status, 401);
  const r2 = await login('1234');
  assert.equal(r2.status, 200);
  assert.equal(r2.body.funcionario, 'PRUEBA');
});
