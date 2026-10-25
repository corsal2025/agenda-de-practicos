'use strict';
process.env.AGENDA_DB = require('node:path').join(require('node:os').tmpdir(), `agenda-asist-${process.pid}.db`); // nunca tocar data/
const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmadaBloqueaReagendar } = require('../server/asistencia');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) { try { require('node:fs').unlinkSync(process.env.AGENDA_DB + s); } catch (_) {} }
});

test('confirmadaBloqueaReagendar: bloquea si confirmo y la fecha es hoy o futura', () => {
  assert.equal(confirmadaBloqueaReagendar({ confirmo_asistencia: 1, fecha: '2026-06-10' }, '2026-06-01'), true);
  assert.equal(confirmadaBloqueaReagendar({ confirmo_asistencia: 1, fecha: '2026-06-01' }, '2026-06-01'), true);
});

test('confirmadaBloqueaReagendar: no bloquea si la fecha ya paso', () => {
  assert.equal(confirmadaBloqueaReagendar({ confirmo_asistencia: 1, fecha: '2026-05-01' }, '2026-06-01'), false);
});

test('confirmadaBloqueaReagendar: no bloquea si no confirmo (null o 0)', () => {
  assert.equal(confirmadaBloqueaReagendar({ confirmo_asistencia: null, fecha: '2026-06-10' }, '2026-06-01'), false);
  assert.equal(confirmadaBloqueaReagendar({ confirmo_asistencia: 0, fecha: '2026-06-10' }, '2026-06-01'), false);
});
