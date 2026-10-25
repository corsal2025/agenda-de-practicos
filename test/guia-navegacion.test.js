'use strict';
// Guia interactiva (public/js/guia.js): si la pestaña cambia por fuera de la guia, se cierra sola.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'public', 'js');

// Navegador minimo: hash, hashchange y un overlay que se puede quitar.
function entorno() {
  const escuchas = [];
  const estado = { overlay: { remove() { estado.overlay = null; } }, irACalls: [] };
  const ctx = {
    location: { hash: '#agenda' },
    document: { getElementById: (id) => (id === 'tour-overlay' ? estado.overlay : null), querySelector: () => null },
    window: {
      addEventListener: (tipo, fn) => escuchas.push({ tipo, fn }),
      removeEventListener: (tipo, fn) => { const i = escuchas.findIndex((e) => e.tipo === tipo && e.fn === fn); if (i >= 0) escuchas.splice(i, 1); },
    },
  };
  // irA real de core.js: cambia el hash (que en el navegador dispara hashchange).
  ctx.irA = (tab) => { estado.irACalls.push(tab); ctx.location.hash = `#${tab}`; ctx.dispararHash(); };
  ctx.dispararHash = () => escuchas.filter((e) => e.tipo === 'hashchange').slice().forEach((e) => e.fn());
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'guia-pasos.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'guia.js'), 'utf8'), ctx);
  return { ctx, estado, escuchas };
}
const cambiarPorFuera = (ctx, tab) => { ctx.location.hash = `#${tab}`; ctx.dispararHash(); };

test('navegacion externa (Atras del navegador / URL editada) cierra la guia sin volver a la pestaña de origen', () => {
  const { ctx, estado, escuchas } = entorno();
  vm.runInContext("tourTabOrigen = 'agenda'; tourVigilarPestana();", ctx);
  ctx.tourNavegar('espera');           // paso de la guia
  cambiarPorFuera(ctx, 'datos');       // el usuario cambia por su cuenta
  assert.equal(estado.overlay, null, 'la guia se cerró');
  assert.deepEqual(estado.irACalls, ['espera'], 'no se devolvio al usuario a la pestaña de origen');
  assert.equal(ctx.location.hash, '#datos');
  assert.equal(escuchas.filter((e) => e.tipo === 'hashchange').length, 0, 'deja de escuchar');
});

test('Siguiente/Anterior dentro de la guia (tourNavegar) no la cierran', () => {
  const { ctx, estado } = entorno();
  vm.runInContext('tourVigilarPestana();', ctx);
  for (const tab of ['espera', 'porconfirmar', 'espera', 'agenda']) ctx.tourNavegar(tab);
  assert.ok(estado.overlay, 'la guia sigue abierta');
  assert.equal(ctx.location.hash, '#agenda');
});

test('un paso sin pestaña propia no cierra la guia', () => {
  const { ctx, estado } = entorno();
  vm.runInContext('tourVigilarPestana();', ctx);
  ctx.tourNavegar('espera');
  ctx.dispararHash();                  // hashchange sin cambio de pestaña
  assert.ok(estado.overlay);
});

test('cerrar la guia por el boton tambien deja de escuchar', () => {
  const { ctx, escuchas } = entorno();
  vm.runInContext('tourVigilarPestana();', ctx);
  assert.equal(escuchas.filter((e) => e.tipo === 'hashchange').length, 1);
  ctx.cerrarGuiaInteractiva(false);
  assert.equal(escuchas.filter((e) => e.tipo === 'hashchange').length, 0);
});

test('renderPasoTour navega con tourNavegar y no con irA directo', () => {
  const src = fs.readFileSync(path.join(JS, 'guia.js'), 'utf8');
  assert.ok(src.includes('tourNavegar(paso.tab)'));
  assert.ok(!src.includes('irA(paso.tab)'));
  assert.ok(src.includes('tourVigilarPestana()'), 'iniciarGuiaInteractiva activa la vigilancia');
});
