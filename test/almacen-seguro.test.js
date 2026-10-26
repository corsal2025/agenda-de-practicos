'use strict';
// Ayudante public/js/almacen-seguro.js: en un iframe de otro dominio el navegador puede bloquear el
// almacenamiento (solo acceder a la propiedad lanza SecurityError). El ayudante nunca debe lanzar y,
// tras el primer fallo, guarda en memoria durante esa carga de pagina.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const CODIGO = fs.readFileSync(path.join(PUBLIC, 'js', 'almacen-seguro.js'), 'utf8');

function cargar(definir) {
  const ctx = {};
  definir(ctx);
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx);
  return ctx.AlmacenSeguro;
}
const bloqueo = () => { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; return e; };
const getterQueLanza = (ctx, nombre) => Object.defineProperty(ctx, nombre, { get() { throw bloqueo(); }, configurable: true });
const almacenSano = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const almacenQueLanza = () => ({
  getItem() { throw bloqueo(); }, setItem() { throw bloqueo(); }, removeItem() { throw bloqueo(); },
});

const CASOS = {
  'el getter lanza SecurityError': (ctx) => { getterQueLanza(ctx, 'localStorage'); getterQueLanza(ctx, 'sessionStorage'); },
  'getItem/setItem/removeItem lanzan': (ctx) => { ctx.localStorage = almacenQueLanza(); ctx.sessionStorage = almacenQueLanza(); },
  'el almacenamiento no esta definido': () => {},
};

for (const [caso, definir] of Object.entries(CASOS)) {
  for (const tipo of ['local', 'sesion']) {
    test(`${tipo}: nunca lanza y conserva en memoria cuando ${caso}`, () => {
      const a = cargar(definir)[tipo];
      assert.equal(a.leer('x'), null);
      assert.doesNotThrow(() => a.guardar('x', 5));
      assert.equal(a.leer('x'), '5');
      assert.doesNotThrow(() => a.quitar('x'));
      assert.equal(a.leer('x'), null);
      assert.doesNotThrow(() => a.quitar('inexistente'));
    });
  }
}

test('tras un fallo, lo guardado en memoria se lee aunque el almacenamiento vuelva a funcionar', () => {
  let roto = true;
  const real = almacenSano();
  const a = cargar((ctx) => {
    Object.defineProperty(ctx, 'sessionStorage', { get() { if (roto) throw bloqueo(); return real; }, configurable: true });
  }).sesion;
  a.guardar('k', 'v');
  roto = false;
  assert.equal(a.leer('k'), 'v');
});

test('con almacenamiento sano persiste de verdad y lee lo que ya estaba', () => {
  const local = almacenSano();
  const sesion = almacenSano();
  local.m.set('previo', 'si');
  const A = cargar((ctx) => { ctx.localStorage = local; ctx.sessionStorage = sesion; });
  assert.equal(A.local.leer('previo'), 'si');
  A.local.guardar('a', 1);
  A.sesion.guardar('b', 'dos');
  assert.equal(local.m.get('a'), '1');
  assert.equal(sesion.m.get('b'), 'dos');
  assert.equal(local.m.has('b'), false, 'local y sesion no se mezclan');
  A.local.quitar('a');
  assert.equal(local.m.has('a'), false);
  assert.equal(A.local.leer('a'), null);
});

// ---- revision estatica ----
const PERMITIDOS = ['js/almacen-seguro.js', 'tamano-letra.js', 'lico-juegos.js', 'lico-asistente.js', 'movil.js'];
function archivosPublic() {
  const out = [];
  (function recorrer(dir) {
    for (const nombre of fs.readdirSync(dir)) {
      const abs = path.join(dir, nombre);
      if (abs === path.join(PUBLIC, 'vendor')) continue;
      if (fs.statSync(abs).isDirectory()) { recorrer(abs); continue; }
      if (/\.(js|html)$/.test(nombre)) out.push(abs);
    }
  }(PUBLIC));
  return out;
}

test('ningun archivo de public/ toca el almacenamiento del navegador salvo los permitidos', () => {
  const infractores = archivosPublic()
    .map((abs) => path.relative(PUBLIC, abs).split(path.sep).join('/'))
    .filter((rel) => !PERMITIDOS.includes(rel))
    .filter((rel) => /localStorage|sessionStorage/.test(fs.readFileSync(path.join(PUBLIC, rel), 'utf8')));
  assert.deepEqual(infractores, []);
});

test('index.html carga el ayudante como primera etiqueta script', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const primera = /<script\b[^>]*>/.exec(html);
  assert.ok(primera, 'hay etiquetas script');
  assert.match(primera[0], /src="js\/almacen-seguro\.js\?v=\d+"/);
});
