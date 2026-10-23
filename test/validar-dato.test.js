'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// validar-dato.js es un script del navegador: se evalua en un contexto aislado.
// rutEsValido vive en core.js; aqui se simula para probar solo la regla de cada dato.
function cargar(rutEsValido) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'validar-dato.js'), 'utf8');
  const ctx = { rutEsValido };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}

test('telefono: celular chileno de 9 digitos que empieza en 9, con o sin +56', () => {
  const { telefonoEsValido } = cargar(() => true);
  assert.equal(telefonoEsValido('+56 9 1234 5678'), true);
  assert.equal(telefonoEsValido('912345678'), true);
  assert.equal(telefonoEsValido('56912345678'), true);
});

test('telefono: rechaza 10 digitos, 8 digitos o que no empiece con 9', () => {
  const { telefonoEsValido } = cargar(() => true);
  assert.equal(telefonoEsValido('+56 9544220208'), false);
  assert.equal(telefonoEsValido('91234567'), false);
  assert.equal(telefonoEsValido('812345678'), false);
});

test('errorDato: vacio es valido (el campo es opcional)', () => {
  const { errorDato } = cargar(() => false);
  assert.equal(errorDato('contacto', ''), null);
  assert.equal(errorDato('contacto', null), null);
});

test('errorDato: telefono invalido devuelve el mensaje y el valido devuelve null', () => {
  const { errorDato } = cargar(() => true);
  assert.match(errorDato('contacto', '+56 9544220208'), /Teléfono inválido/);
  assert.equal(errorDato('contacto', '+56 9 1234 5678'), null);
});

test('errorDato: RUT se valida con rutEsValido', () => {
  const invalido = cargar(() => false);
  assert.match(invalido.errorDato('rut', '12.345.678-9'), /RUT inválido/);
  const valido = cargar(() => true);
  assert.equal(valido.errorDato('rut', '12.345.678-5'), null);
});

test('errorDato: otros campos no se validan aqui', () => {
  const { errorDato } = cargar(() => false);
  assert.equal(errorDato('correo', 'no es correo'), null);
  assert.equal(errorDato('nombre', '123'), null);
});
