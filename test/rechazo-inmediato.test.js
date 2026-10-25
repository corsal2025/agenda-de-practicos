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

test('EENVELOPE en RCPT TO fuera de 550-553 es problema del destinatario, no error general', () => {
  for (const codigo of [554, 451, 452, 450, 501, undefined]) {
    assert.equal(correo.esErrorGeneral(envelope('RCPT TO', codigo)), false, String(codigo));
  }
  assert.equal(correo.esErrorGeneral(envelope('RCPT TO', 550)), false);
});

test('EENVELOPE fuera de RCPT TO (MAIL FROM, DATA, sin comando) es error general del canal', () => {
  for (const comando of ['MAIL FROM', 'DATA', undefined]) {
    for (const codigo of [452, 550, 554, undefined]) {
      assert.equal(correo.esErrorGeneral(envelope(comando, codigo)), true, `${comando} ${codigo}`);
    }
  }
});
