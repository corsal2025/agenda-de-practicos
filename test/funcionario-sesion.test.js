'use strict';
// Selector temporal de funcionario/a (sesionStorage del navegador). Se prueban las funciones
// puras (actual/elegir/olvidar); el picker en pantalla depende del DOM real y no se prueba aqui.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function cargarModulo(meta) {
  const store = new Map();
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = { META: meta, sessionStorage, window: {}, h: () => {}, esc: (s) => s, document: {} };
  sandbox.window = sandbox;
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'funcionario-sesion.js'), 'utf8');
  vm.runInNewContext(codigo, sandbox);
  return sandbox.FuncionarioSesion;
}

const META = { funcionarios: [{ id: 1, nombre: 'ACTIVA', activo: 1 }, { id: 2, nombre: 'INACTIVA', activo: 0 }] };

test('actual(): null si no hay nada guardado', () => {
  const mod = cargarModulo(META);
  assert.equal(mod.actual(), null);
});

test('elegir()/actual(): devuelve el funcionario activo elegido', () => {
  const mod = cargarModulo(META);
  mod.elegir(1);
  assert.equal(mod.actual().nombre, 'ACTIVA');
});

test('actual(): null si el guardado ya no es un funcionario activo (nunca cae al primero activo)', () => {
  const mod = cargarModulo(META);
  mod.elegir(2); // inactivo
  assert.equal(mod.actual(), null);
  const mod2 = cargarModulo(META);
  mod2.elegir(999); // no existe
  assert.equal(mod2.actual(), null);
});

test('olvidar(): borra la eleccion', () => {
  const mod = cargarModulo(META);
  mod.elegir(1);
  assert.ok(mod.actual());
  mod.olvidar();
  assert.equal(mod.actual(), null);
});
