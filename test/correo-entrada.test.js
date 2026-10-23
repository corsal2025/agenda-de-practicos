'use strict';
process.env.AGENDA_DB = require('node:path').join(require('node:os').tmpdir(), `agenda-aislada-${process.pid}.db`); // nunca tocar data/
// Logica pura de lectura de respuestas por correo. No invoca PowerShell ni Outlook.
const test = require('node:test');
const assert = require('node:assert/strict');
const ce = require('../server/correo-entrada');

test('extraerId lee [Cita 123] del asunto (también en RE:/RV:)', () => {
  assert.equal(ce.extraerId('RE: Confirma tu asistencia - Examen 12-10-2026 09:00 [Cita 123]'), 123);
  assert.equal(ce.extraerId('rv: algo [cita  45]'), 45);
  assert.equal(ce.extraerId('Sin etiqueta'), null);
  assert.equal(ce.extraerId(null), null);
});

test('limpiarRespuesta quita historial citado y firma', () => {
  const body = 'Sí, confirmo.\r\nSaludos\r\nJuan Pérez\r\n\r\nEl lun, 12 oct 2026 a las 10:00, Agenda <a@b.cl> escribió:\r\n> Confirma tu asistencia';
  assert.equal(ce.limpiarRespuesta(body), 'Sí, confirmo.');
  assert.equal(ce.limpiarRespuesta('No puedo ir\n-----Original Message-----\nConfirmo'), 'No puedo ir');
  assert.equal(ce.limpiarRespuesta('ok\n________________\nDe: Agenda\nEnviado: hoy'), 'ok');
  assert.equal(ce.limpiarRespuesta('> citado\nde acuerdo'), 'de acuerdo');
  assert.equal(ce.limpiarRespuesta('Confirmo\nFrom: x@y.cl\nSent: ...'), 'Confirmo');
  assert.equal(ce.limpiarRespuesta('Confirmo\n--\nFirma'), 'Confirmo');
  assert.equal(ce.limpiarRespuesta('Confirmo\nEnviado desde mi iPhone'), 'Confirmo');
  assert.equal(ce.limpiarRespuesta(''), '');
});

test('clasificar: confirma', () => {
  for (const t of ['Sí', 'si', 'Confirmo', 'CONFIRMADO', 'Asistiré', 'voy a ir', 'Ahí estaré', 'ok', 'De acuerdo, gracias']) {
    assert.equal(ce.clasificar(t), 'confirma', t);
  }
});

test('clasificar: no_asiste con negación', () => {
  for (const t of ['No puedo asistir', 'no podré ir', 'No asistiré', 'no voy', 'Lamentablemente no podre']) {
    assert.equal(ce.clasificar(t), 'no_asiste', t);
  }
});

test('clasificar: reagendar', () => {
  for (const t of ['Quisiera cambiar la fecha', 'Necesito otra hora', 'otro día por favor', 'Quiero reagendar', 'cambio de hora']) {
    assert.equal(ce.clasificar(t), 'reagendar', t);
  }
  // "no puedo, quiero otro día" prioriza reagendar (pide nueva hora).
  assert.equal(ce.clasificar('No puedo ese día, ¿me dan otro día'), 'revisar');
  assert.equal(ce.clasificar('No puedo ese día, necesito otro día'), 'reagendar');
});

test('clasificar: revisar ante vacío, pregunta o señales en conflicto', () => {
  assert.equal(ce.clasificar(''), 'revisar');
  assert.equal(ce.clasificar('¿Dónde queda la oficina?'), 'revisar');
  assert.equal(ce.clasificar('Sí confirmo pero no puedo'), 'revisar');
  assert.equal(ce.clasificar('Hola buenas tardes'), 'revisar');
  // "si" dentro de otra palabra no cuenta
  assert.equal(ce.clasificar('siempre'), 'revisar');
});

test('elegirCitaPorRemitente: única próxima o null', () => {
  const hoy = '2026-10-11';
  assert.equal(ce.elegirCitaPorRemitente([{ id: 1, fecha: '2026-10-12' }], hoy).id, 1);
  assert.equal(ce.elegirCitaPorRemitente([{ id: 1, fecha: '2026-10-12' }, { id: 2, fecha: '2026-10-20' }], hoy), null);
  assert.equal(ce.elegirCitaPorRemitente([{ id: 1, fecha: '2026-10-01' }], hoy), null);
  assert.equal(ce.elegirCitaPorRemitente([], hoy), null);
});

test('lectura de Outlook deshabilitada bajo node --test', async () => {
  assert.equal(ce.soportado(), false);
  assert.deepEqual(await ce.leer(), []);
  assert.equal(await ce.marcar([{ entryId: 'x', categoria: 'Agenda-procesado' }]), false);
});

test('argsLeer/argsMarcar solo pasan rutas, nunca datos', () => {
  const a = ce.argsLeer('C:\\tmp\\p.json');
  assert.ok(a.includes('-Payload') && a.includes('C:\\tmp\\p.json'));
  const m = ce.argsMarcar('C:\\tmp\\m.json');
  assert.ok(m.includes('-Marcar') && m.includes('C:\\tmp\\m.json'));
});

test('Lico: consejo de respuestas por correo por revisar', () => {
  const L = require('../public/lico-asistente');
  const tip = L.consejosDesde({ respuestasRevisar: 2 }).find((t) => t.id === 'respuestas');
  assert.equal(tip.texto, 'Hay 2 respuestas por correo por revisar.');
});
