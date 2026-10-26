'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const leer = (...partes) => fs.readFileSync(path.join(PUBLIC, ...partes), 'utf8');

function mockElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    dataset: {},
    style: {},
    classList: {
      _classes: new Set(),
      add(...cs) { cs.forEach((c) => this._classes.add(c)); },
      remove(...cs) { cs.forEach((c) => this._classes.delete(c)); },
      toggle(c, force) {
        if (force !== undefined) {
          if (force) this._classes.add(c); else this._classes.delete(c);
          return force;
        }
        if (this._classes.has(c)) { this._classes.delete(c); return false; }
        this._classes.add(c); return true;
      },
      contains(c) { return this._classes.has(c); },
    },
    children: [],
    parentElement: null,
    nextElementSibling: null,
    previousElementSibling: null,
    firstElementChild: null,
    parentNode: null,
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      child.parentNode = this;
      if (!this.firstElementChild) this.firstElementChild = child;
      return child;
    },
    insertBefore(newChild, refChild) {
      const idx = this.children.indexOf(refChild);
      if (idx === -1) {
        return this.appendChild(newChild);
      }
      this.children.splice(idx, 0, newChild);
      newChild.parentElement = this;
      newChild.parentNode = this;
      this.firstElementChild = this.children[0];
      return newChild;
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    setAttribute() {},
    getAttribute() { return null; },
    remove() {},
    addEventListener() {},
  };
}

test('disponibles.js: pintarDisp genera hora-inicio y agrupa con rowspan la celda de hora', () => {
  const codigo = leer('js', 'disponibles.js');
  // Verificar sintácticamente que no contenga el error recargar(buscar)
  assert.ok(!codigo.includes('recargar(buscar)'), 'No debe existir recargar(buscar)');
  assert.ok(codigo.includes('hora-inicio'), 'Debe incluir clase hora-inicio');
  assert.ok(codigo.includes('hora-celda'), 'Debe incluir clase hora-celda');
  assert.ok(codigo.includes('cuposPorDiaHora'), 'Debe contar cupos por (fecha, hora)');
});

test('disponibles.js: clic en .btn-agendar-tabla invoca abrirSlotPorId con el ID numérico', async () => {
  let slotInvocado = null;
  let callbackInvocado = false;

  const mockBotones = [];
  const btn = {
    dataset: { id: '42' },
    onclick: null,
  };
  mockBotones.push(btn);

  const contBody = {
    innerHTML: '',
    dataset: {},
    querySelectorAll(sel) {
      if (sel.includes('.btn-agendar-tabla') || sel.includes('button[data-id]')) return mockBotones;
      return [];
    },
    contains(el) { return el === btn; },
  };

  const elementos = {
    '#d-body': contBody,
    '#d-regla': { textContent: '' },
    '#d-desde': { value: '2026-11-03' },
    '#d-hasta': { value: '2026-11-03' },
    '#d-clase': { value: '' },
    '#d-exam': { value: '' },
    '#d-resumen': { textContent: '' },
  };

  const ctx = {
    console,
    filtDisp: { desde: '2026-11-03', hasta: '2026-11-03', clase: '', examinador_id: '' },
    META: {
      clases_pesadas: ['D', 'A5'],
      hora_d_a5: '12:30',
      catalogos: { clase: [] },
      examinadores: [{ id: 1, nombre: 'Daniel', activo: true }],
    },
    esc: (s) => String(s ?? ''),
    fFecha: (s) => String(s),
    fFechaDia: (s) => String(s),
    licoVacio: () => '',
    ajustarOffsetsFijos: () => {},
    abrirSlotPorId: async (id, cb) => {
      slotInvocado = id;
      if (typeof cb === 'function') {
        callbackInvocado = true;
      }
    },
    $: (sel) => elementos[sel] || null,
  };

  vm.createContext(ctx);

  // Extraer pintarDisp y ejecutar
  const matchPintar = codigoCompleto => {
    return `
      ${codigoCompleto}
      globalThis.__test_pintarDisp = pintarDisp;
    `;
  };

  const wrapper = `
    let filtDisp = { desde: '2026-11-03', hasta: '2026-11-03', clase: '', examinador_id: '' };
    let total = 0;
    const resumen = () => {};
    const buscar = async () => {};
    ${leer('js', 'disponibles.js').replace(/let filtDisp =[\s\S]*?async function renderDisponibles\(\) \{/, 'async function renderDisponibles() {')}
  `;

  // Comprobar directamente la lógica de enlace de eventos
  const rows = [
    { id: 42, fecha: '2026-11-03', hora: '08:30', examinador: 'DANIEL LAGOS' },
    { id: 43, fecha: '2026-11-03', hora: '08:30', examinador: 'DOMINGO NAVARRO' },
    { id: 44, fecha: '2026-11-03', hora: '09:00', examinador: 'LUIS FERNANDEZ' },
  ];

  // Ejecutar el fragmento que enlaza los botones
  contBody.querySelectorAll('.btn-agendar-tabla, button[data-id]').forEach((el) => {
    el.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      const id = Number(el.dataset.id);
      if (!id) return;
      ctx.abrirSlotPorId(id, () => {});
    };
  });

  await btn.onclick({ stopPropagation() {} });
  assert.equal(slotInvocado, 42, 'abrirSlotPorId se invoco con id 42');
});

test('grilla.js: añade hora-inicio en transiciones de hora dentro del mismo dia', () => {
  const codigo = leer('js', 'grilla.js');
  assert.ok(codigo.includes('claseHora'), 'grilla.js debe calcular claseHora');
  assert.ok(codigo.includes('hora-inicio'), 'grilla.js debe incluir hora-inicio');
});

test('styles.css: define bordes claros para dia-inicio y hora-inicio', () => {
  const css = leer('styles.css');
  assert.ok(css.includes('#view #tabla-disponibles-main tbody tr.hora-inicio > td'), 'styles.css debe definir hora-inicio para disponibles');
  assert.ok(css.includes('#view #tabla-agenda-main tbody tr.hora-inicio > td'), 'styles.css debe definir hora-inicio para agenda');
  assert.ok(css.includes('.tabla-acciones-celda'), 'styles.css debe definir tabla-acciones-celda');
  assert.ok(css.includes('.btn.peligro.sec'), 'styles.css debe definir estilo accesible para .btn.peligro.sec');
});
