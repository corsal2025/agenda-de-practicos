'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Simulamos entorno de navegador mínimo para verificar que editor-cita.js no lance TypeErrors
test('abrirFormularioCita se ejecuta sin lanzar TypeError con META null o incompleto', () => {
  let modalLlamado = false;
  let modalTitulo = '';
  let modalCuerpo = '';

  // Mock global window y DOM
  global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  global.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  global.$ = (sel) => ({
    addEventListener: () => {},
    querySelectorAll: () => [],
    value: '',
  });
  global.h = (html) => ({ querySelector: () => ({ addEventListener: () => {}, onclick: () => {} }), appendChild: () => {}, remove: () => {} });
  global.modal = (titulo, cuerpo, pie, cls) => {
    modalLlamado = true;
    modalTitulo = titulo;
    modalCuerpo = cuerpo;
  };
  global.fFecha = (v) => v || '';
  global.esc = (v) => v || '';
  global.nom = (v) => v || '';
  global.fTel = (v) => v || '';
  global.hoy = () => '2026-10-27';
  global.api = async () => [];
  global.toast = () => {};
  global.cerrarModal = () => {};

  // Cargamos core.js y editor-cita.js
  const coreCode = fs.readFileSync(path.join(__dirname, '../public/js/core.js'), 'utf8');
  eval(coreCode);
  const editorCode = fs.readFileSync(path.join(__dirname, '../public/js/editor-cita.js'), 'utf8');
  eval(editorCode);

  // 1. Probar con META = null
  global.META = null;
  const slotVacio = { id: 123, fecha: '2026-11-01', hora: '10:00', examinador: 'DANIEL LAGOS' };

  assert.doesNotThrow(() => {
    window.abrirFormularioCita(slotVacio);
  });
  assert.ok(modalLlamado, 'El modal debió haberse abierto');
  assert.match(modalTitulo, /Agendar nueva cita/);
  assert.match(modalCuerpo, /Licencias/);

  // 2. Probar con slot que tiene clase pesada fuera de horario y META vacío
  modalLlamado = false;
  const slotPesado = { id: 124, fecha: '2026-11-01', hora: '10:00', examinador: 'DANIEL LAGOS', clase: 'D' };
  assert.doesNotThrow(() => {
    window.abrirFormularioCita(slotPesado);
  });
  assert.ok(modalLlamado, 'El modal debió haberse abierto para clase D');

  // 3. Probar con slot bloqueado
  modalLlamado = false;
  const slotBloqueado = { id: 125, fecha: '2026-11-01', hora: '10:00', examinador: 'DANIEL LAGOS', bloqueado: 1, bloqueo_motivo: 'VACACIONES' };
  assert.doesNotThrow(() => {
    window.editorSlot(slotBloqueado);
  });
  assert.ok(modalLlamado, 'El modal de desbloqueo debió abrirse');
  assert.match(modalTitulo, /Bloque inhabilitado/);
});
