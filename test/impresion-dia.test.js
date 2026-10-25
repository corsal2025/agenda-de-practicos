'use strict';
// Impresion del dia (public/js/dia.js): hoja unica con varias personas por hora y hora "Generado" local.
// dia.js es un script del navegador: se evalua en un contexto aislado con lo minimo del DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Debe fijarse antes de crear cualquier Date: la hora "local" del PC es la de Chile.
process.env.TZ = 'America/Santiago';

function cargarDia() {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ctx = {
    esc, nom: (v) => String(v ?? '').toUpperCase(), clasesTagsHtml: (c) => c,
    MARCA: { logo: null, organismo: 'Org', unidad: 'Uni' },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dia.js'), 'utf8'), ctx);
  return ctx;
}

const fila = (id, cupo, extra = {}) => ({ id, hora: '09:00', cupo, bloqueado: 0, rut: null, nombre: null, clase: null, ...extra });
const ocupada = (id, cupo, nombre) => fila(id, cupo, { nombre, rut: `${id}.111.111-1`, clase: 'B' });

test('hoja unica: tres personas a las 09:00 del mismo examinador aparecen las tres, apiladas', () => {
  const { hojaUnicaDia } = cargarDia();
  const data = { examinadores: { 'EX UNO': [ocupada(3, 3, 'Carla'), ocupada(1, 1, 'Ana'), ocupada(2, 2, 'Beto')] } };
  const html = hojaUnicaDia(data, ['EX UNO'], 'lunes', '25/10/2026 23:30');
  for (const n of ['ANA', 'BETO', 'CARLA']) assert.ok(html.includes(n), `falta ${n}`);
  assert.ok(html.indexOf('ANA') < html.indexOf('BETO') && html.indexOf('BETO') < html.indexOf('CARLA'), 'orden por cupo');
  assert.equal((html.match(/class="hu-fila/g) || []).length, 3, 'una fila por persona, con separador');
});

test('hoja unica: una fila libre extra se muestra como Disponible sin tapar a las demas', () => {
  const { hojaUnicaDia } = cargarDia();
  const data = { examinadores: { 'EX UNO': [ocupada(1, 1, 'Ana'), ocupada(2, 2, 'Beto'), fila(3, 3)] } };
  const html = hojaUnicaDia(data, ['EX UNO'], 'lunes', 'g');
  assert.ok(html.includes('ANA') && html.includes('BETO'));
  assert.ok(html.includes('Disponible'));
});

test('hoja unica: una sola fila libre sigue siendo la celda Disponible de siempre', () => {
  const { hojaUnicaDia } = cargarDia();
  const html = hojaUnicaDia({ examinadores: { 'EX UNO': [fila(1, 1)] } }, ['EX UNO'], 'lunes', 'g');
  assert.ok(html.includes('<td class="hu-libre">Disponible</td>'));
});

test('hoja unica: el conteo de citas incluye a todas las personas', () => {
  const { hojaUnicaDia } = cargarDia();
  const data = { examinadores: { 'EX UNO': [ocupada(1, 1, 'Ana'), ocupada(2, 2, 'Beto')] } };
  assert.match(hojaUnicaDia(data, ['EX UNO'], 'lunes', 'g'), /\(2 citas\)/);
});

test('Generado usa la hora local del PC (Chile), no UTC', () => {
  const { generadoLocal } = cargarDia();
  // 2026-10-25 23:30 en Santiago (UTC-3 por horario de verano) son las 02:30 UTC del dia siguiente.
  const d = new Date('2026-10-26T02:30:00Z');
  assert.equal(generadoLocal(d), '25/10/2026 23:30');
});

test('imprimirAgendaDia pasa generadoLocal() a las hojas', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dia.js'), 'utf8');
  assert.ok(src.includes('const generado = generadoLocal();'));
  assert.ok(!src.includes('new Date().toISOString()'));
});
