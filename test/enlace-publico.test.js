'use strict';
// Evaluacion de los enlaces publicos (confirmar/rechazar/reagendar): token, fecha pasada y resultado.
process.env.AGENDA_DB = require('node:path').join(require('node:os').tmpdir(), `agenda-enlace-${process.pid}.db`); // nunca tocar data/
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../server/db');
const { evaluarEnlace } = require('../server/enlace-publico');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) { try { require('node:fs').unlinkSync(process.env.AGENDA_DB + s); } catch (_) {} }
});

function bloqueBase(extra = {}) {
  return { id: 1, token_confirmacion: 'tok123', fecha: '2026-06-01', resultado: null, ...extra };
}

test('rechaza si el bloque no existe', () => {
  const ev = evaluarEnlace(null, 'tok123', '2026-01-01');
  assert.equal(ev.ok, false);
  assert.equal(ev.status, 404);
});

test('rechaza si el token no coincide', () => {
  const ev = evaluarEnlace(bloqueBase(), 'otro', '2026-01-01');
  assert.equal(ev.ok, false);
  assert.equal(ev.status, 404);
  assert.match(ev.mensaje, /ya fue utilizado o no es válido/);
});

test('rechaza si el token esta vacio', () => {
  const ev = evaluarEnlace(bloqueBase(), '', '2026-01-01');
  assert.equal(ev.ok, false);
  assert.equal(ev.status, 404);
});

test('acepta un token valido con fecha futura y sin resultado', () => {
  const ev = evaluarEnlace(bloqueBase(), 'tok123', '2026-01-01');
  assert.equal(ev.ok, true);
});

test('rechaza con 410 si la fecha ya paso y limpia el token', () => {
  db.exec('DELETE FROM agenda');
  db.prepare("INSERT INTO agenda (id, fecha, hora, examinador_id, token_confirmacion) VALUES (1, '2026-06-01', '09:00', 1, 'tok123')").run();
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = 1').get();
  const ev = evaluarEnlace(bloque, 'tok123', '2026-06-02');
  assert.equal(ev.ok, false);
  assert.equal(ev.status, 410);
  assert.match(ev.mensaje, /ya pas/);
  assert.equal(db.prepare('SELECT token_confirmacion FROM agenda WHERE id = 1').get().token_confirmacion, null);
});

test('rechaza con 410 si ya tiene resultado y limpia el token', () => {
  db.exec('DELETE FROM agenda');
  db.prepare("INSERT INTO agenda (id, fecha, hora, examinador_id, token_confirmacion, resultado) VALUES (1, '2026-06-01', '09:00', 1, 'tok123', 'APROBADO')").run();
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = 1').get();
  const ev = evaluarEnlace(bloque, 'tok123', '2026-01-01');
  assert.equal(ev.ok, false);
  assert.equal(ev.status, 410);
  assert.match(ev.mensaje, /resultado/);
  assert.equal(db.prepare('SELECT token_confirmacion FROM agenda WHERE id = 1').get().token_confirmacion, null);
});

test('nunca usa la frase "ha expirado"', () => {
  for (const ev of [
    evaluarEnlace(null, 'x', '2026-01-01'),
    evaluarEnlace(bloqueBase(), 'malo', '2026-01-01'),
    evaluarEnlace(bloqueBase({ fecha: '2020-01-01' }), 'tok123', '2026-01-01'),
    evaluarEnlace(bloqueBase({ resultado: 'APROBADO' }), 'tok123', '2026-01-01'),
  ]) {
    assert.ok(!/ha expirado/i.test(ev.mensaje));
  }
});
