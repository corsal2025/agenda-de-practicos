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

test('isoLocal usa la fecha local, no la UTC', () => {
  assert.equal(F.isoLocal(new Date(2026, 0, 1, 23, 30)), '2026-01-01');
  assert.equal(F.isoLocal(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('ahoraTS entrega la hora local con formato de SQLite', () => {
  const ahora = new Date();
  const ts = F.ahoraTS(ahora);
  assert.match(ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(ts.slice(0, 10), F.isoLocal(ahora));
  assert.equal(Number(ts.slice(11, 13)), ahora.getHours());
  assert.equal(F.ahoraTS(new Date(2026, 5, 7, 23, 59, 58)), '2026-06-07 23:59:58');
});

test('sumarDias cruza meses y años en hora local', () => {
  assert.equal(F.sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(F.sumarDias('2026-03-01', -1), '2026-02-28');
});
