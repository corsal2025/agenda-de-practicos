'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../server/fechas');

test('aISO acepta varios formatos', () => {
  assert.equal(F.aISO('2026-08-03'), '2026-08-03');
  assert.equal(F.aISO('03/08/2026'), '2026-08-03');
  assert.equal(F.aISO('3-8-2026'), '2026-08-03');
  assert.equal(F.aISO(new Date('2026-08-03T00:00:00Z')), '2026-08-03');
  const serial = (Date.UTC(2026, 7, 3) / 86400000) + 25569; // serial excel de esa fecha
  assert.equal(F.aISO(serial), '2026-08-03');
  assert.equal(F.aISO(''), null);
});

test('aHora extrae HH:MM', () => {
  assert.equal(F.aHora('08:30:00'), '08:30');
  assert.equal(F.aHora('Sat Dec 30 1899 12:30:00 GMT-0442'), '12:30');
  assert.equal(F.aHora(0.5), '12:00');
  assert.equal(F.aHora(new Date('2020-01-01T09:00:00')), '09:00');
});

test('esHabil respeta fin de semana y feriado', () => {
  assert.ok(F.esHabil('2026-08-03')); // lunes
  assert.ok(!F.esHabil('2026-08-01')); // sabado
  assert.ok(!F.esHabil('2026-08-02')); // domingo
  assert.ok(!F.esHabil('2026-09-18', new Set(['2026-09-18'])));
});

test('diasHabiles cuenta bien una semana', () => {
  const d = F.diasHabiles('2026-08-03', '2026-08-09'); // lun a dom
  assert.equal(d.length, 5);
});
