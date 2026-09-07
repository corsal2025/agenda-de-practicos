'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rut = require('../server/rut');

test('digito verificador conocido', () => {
  assert.equal(rut.digitoVerificador('11111111'), '1');
  assert.equal(rut.digitoVerificador('12345678'), '5');
});

test('esValido acepta RUT correcto en varios formatos', () => {
  assert.ok(rut.esValido('12.345.678-5'));
  assert.ok(rut.esValido('12345678-5'));
  assert.ok(rut.esValido('123456785'));
  assert.ok(rut.esValido('11.111.111-1'));
});

test('esValido rechaza dv incorrecto y basura', () => {
  assert.ok(!rut.esValido('12.345.678-9'));
  assert.ok(!rut.esValido('197772684-9')); // 9 digitos de cuerpo
  assert.ok(!rut.esValido('FALTA RUT'));
  assert.ok(!rut.esValido(''));
});

test('formatear normaliza puntuacion', () => {
  assert.equal(rut.formatear('123456785'), '12.345.678-5');
  assert.equal(rut.formatear('12345678-k'), '12.345.678-K');
});

test('pareceMarcador detecta textos que no son RUT', () => {
  assert.ok(rut.pareceMarcador('NO EXISTE EN SISTEMA'));
  assert.ok(rut.pareceMarcador('  falta rut '));
  assert.ok(!rut.pareceMarcador('12.345.678-5'));
});
