'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-horario-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
const { db } = require('../server/db');
const { generar } = require('../server/slots');

const cuentaHora = (fecha, hora) =>
  db.prepare('SELECT COUNT(*) n FROM agenda WHERE fecha = ? AND hora = ?').get(fecha, hora).n;

test('antes del 9 de noviembre de 2026 se generan bloques de 08:30', () => {
  generar('2026-11-06', '2026-11-06');
  assert.ok(cuentaHora('2026-11-06', '08:30') > 0);
});

test('desde el 9 de noviembre de 2026 no se generan bloques de 08:30', () => {
  generar('2026-11-10', '2026-11-10');
  assert.equal(cuentaHora('2026-11-10', '08:30'), 0);
  assert.ok(cuentaHora('2026-11-10', '09:00') > 0);
});
