'use strict';
// Reporte de errores: reglas de auditoria de la planilla (telefono, correo,
// clase y conflicto D/A5). Usa una base temporal: NUNCA toca data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.AGENDA_DB = path.join(os.tmpdir(), `agenda-errores-${Date.now()}.db`);
const { db } = require('../server/db');
const { reporte } = require('../server/errores');
const { hoyISO, sumarDias, esHabil } = require('../server/fechas');

// Proximo dia habil desde manana (sin feriados) para no caer en DIA_INHABIL.
let dia = sumarDias(hoyISO(), 1);
while (!esHabil(dia, new Set(db.prepare('SELECT fecha FROM feriados').all().map((r) => r.fecha)))) dia = sumarDias(dia, 1);
const exam = db.prepare('SELECT id FROM examinadores ORDER BY id LIMIT 1').get().id;

function cita(hora, o = {}) {
  const c = { rut: '11.111.111-1', nombre: 'JUAN PEREZ', clase: 'B', contacto: '+56912345678', correo: 'a@b.cl', ...o };
  db.prepare(`INSERT OR REPLACE INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, contacto, correo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(dia, hora, exam, c.rut, c.nombre, c.clase, c.contacto, c.correo);
}
const tipos = (hora) => reporte().hallazgos.filter((h) => h.fecha === dia && h.hora === hora).map((h) => h.tipo);

test.beforeEach(() => db.prepare('DELETE FROM agenda').run());

test('cita completa no genera hallazgos', () => {
  cita('09:00');
  assert.deepEqual(tipos('09:00'), []);
});

test('audita telefono, correo y clase', () => {
  cita('08:30', { contacto: null });
  cita('09:00', { correo: null, rut: '22.222.222-2', nombre: 'B' });
  cita('09:30', { correo: 'sin-arroba', rut: '33.333.333-3', nombre: 'C' });
  cita('10:00', { clase: null, rut: '44.444.444-4', nombre: 'D' });
  assert.ok(tipos('08:30').includes('FALTA_TELEFONO'));
  assert.ok(tipos('09:00').includes('FALTA_CORREO'));
  assert.ok(tipos('09:30').includes('CORREO_INVALIDO'));
  assert.ok(tipos('10:00').includes('FALTA_CLASE'));
});

test('conflicto: cita 13:00 con examinador en D/A5 a las 12:30', () => {
  cita('12:30', { clase: 'D' });
  cita('13:00', { rut: '22.222.222-2', nombre: 'OTRA' });
  assert.ok(tipos('13:00').includes('CONFLICTO_PESADA'));
});
