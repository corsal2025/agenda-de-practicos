'use strict';
// Solo el rechazo del destinatario (RCPT TO con 550-553) es definitivo; el resto se reintenta.
const test = require('node:test');
const assert = require('node:assert/strict');
const correo = require('../server/correo');

const envelope = (command, responseCode) => Object.assign(new Error('fallo'), { code: 'EENVELOPE', command, responseCode });

test('EENVELOPE en MAIL FROM con 550 no es rechazo inmediato (falla del remitente o cuenta)', () => {
  assert.equal(correo.esRechazoInmediato(envelope('MAIL FROM', 550)), false);
});

test('EENVELOPE en RCPT TO con 451 no es rechazo inmediato (transitorio)', () => {
  assert.equal(correo.esRechazoInmediato(envelope('RCPT TO', 451)), false);
});

test('EENVELOPE en RCPT TO con 550 y 553 si es rechazo inmediato', () => {
  assert.equal(correo.esRechazoInmediato(envelope('RCPT TO', 550)), true);
  assert.equal(correo.esRechazoInmediato(envelope('RCPT TO', 553)), true);
});

test('EENVELOPE en DATA o sin responseCode no es rechazo inmediato', () => {
  assert.equal(correo.esRechazoInmediato(envelope('DATA', 552)), false);
  assert.equal(correo.esRechazoInmediato(envelope('RCPT TO', undefined)), false);
  assert.equal(correo.esRechazoInmediato(Object.assign(new Error('x'), { code: 'EENVELOPE' })), false);
});

test('EENVELOPE que no es rechazo del destinatario cuenta como error general', () => {
  assert.equal(correo.esErrorGeneral(envelope('MAIL FROM', 452)), true);
  assert.equal(correo.esErrorGeneral(envelope('RCPT TO', 451)), true);
  assert.equal(correo.esErrorGeneral(envelope('RCPT TO', 550)), false);
});
