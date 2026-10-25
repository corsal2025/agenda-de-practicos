'use strict';
// Pestaña Datos (public/js/datos.js): una falla del servidor se avisa con un toast de error,
// nunca como promesa rechazada sin atender.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function cargar(api) {
  const toasts = [];
  const ctx = { api, toast: (msg, tipo = 'ok') => toasts.push({ msg, tipo }), META: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'datos.js'), 'utf8'), ctx);
  return { ctx, toasts };
}
const falla = async () => { throw new Error('Error 500'); };

test('backup con error: toast de error y no lanza', async () => {
  const { ctx, toasts } = cargar(falla);
  await assert.doesNotReject(() => ctx.crearBackup());
  assert.deepEqual(toasts, [{ msg: 'Error 500', tipo: 'err' }]);
});

test('generar bloques con error: toast de error y no lanza', async () => {
  const { ctx, toasts } = cargar(falla);
  await assert.doesNotReject(() => ctx.generarBloques('2026-11-01', '2026-11-30'));
  assert.deepEqual(toasts, [{ msg: 'Error 500', tipo: 'err' }]);
});

test('agregar feriado con error: toast de error y no lanza', async () => {
  const { ctx, toasts } = cargar(falla);
  await assert.doesNotReject(() => ctx.agregarFeriado('2026-12-31', 'Fin de año'));
  assert.deepEqual(toasts, [{ msg: 'Error 500', tipo: 'err' }]);
});

test('borrar feriado con error: toast de error y no lanza', async () => {
  const { ctx, toasts } = cargar(falla);
  await assert.doesNotReject(() => ctx.borrarFeriado('2026-12-31'));
  assert.deepEqual(toasts, [{ msg: 'Error 500', tipo: 'err' }]);
});

test('backup correcto avisa el nombre del archivo', async () => {
  const { ctx, toasts } = cargar(async () => ({ archivo: 'C:\\respaldos\\agenda-1.db' }));
  await ctx.crearBackup();
  assert.deepEqual(toasts, [{ msg: 'Backup: agenda-1.db', tipo: 'ok' }]);
});

test('generar bloques correcto informa lo creado y refresca META', async () => {
  const llamadas = [];
  const { ctx, toasts } = cargar(async (ruta, opts) => {
    llamadas.push(ruta);
    return ruta === '/meta' ? { nuevo: true } : { creados: 5, dias: 2 };
  });
  await ctx.generarBloques('2026-11-01', '2026-11-02');
  assert.deepEqual(llamadas, ['/agenda/generar', '/meta']);
  assert.equal(toasts[0].msg, '5 bloques nuevos en 2 dias habiles');
  assert.deepEqual(vm.runInContext('META', ctx), { nuevo: true });
});
