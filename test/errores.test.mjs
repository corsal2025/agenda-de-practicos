import test from 'node:test';
import assert from 'node:assert/strict';
import { reporte } from '../worker/lib/errores.js';
import { hoyISOChile, mananaISOChile } from '../worker/lib/fechas.js';

// D1 falso: la primera consulta es feriados, la segunda la agenda.
const fakeDb = (filas) => ({
  prepare: (sql) => ({
    bind: () => ({ all: async () => ({ results: [] }) }),
    all: async () => ({ results: /FROM feriados/.test(sql) ? [] : filas }),
  }),
});

// Proximo dia habil (lunes a viernes) desde manana, para no caer en DIA_INHABIL.
function diaHabil() {
  let f = mananaISOChile();
  while ([0, 6].includes(new Date(`${f}T12:00:00Z`).getUTCDay())) {
    const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); f = d.toISOString().slice(0, 10);
  }
  return f;
}

const cita = (o) => ({
  id: 1, fecha: diaHabil(), hora: '09:00', examinador_id: 1, examinador: 'DANIEL LAGOS',
  rut: '11.111.111-1', nombre: 'JUAN PEREZ', clase: 'B', contacto: '+56 9 1234 5678',
  correo: 'a@b.cl', bloqueado: 0, ...o,
});
const tipos = async (filas) => (await reporte(fakeDb(filas))).hallazgos.map((h) => h.tipo);

test('cita completa no genera hallazgos', async () => {
  assert.deepEqual(await tipos([cita()]), []);
});

test('audita telefono, correo y clase como el Apps Script', async () => {
  assert.ok((await tipos([cita({ contacto: null })])).includes('FALTA_TELEFONO'));
  assert.ok((await tipos([cita({ correo: null })])).includes('FALTA_CORREO'));
  assert.ok((await tipos([cita({ correo: 'sin-arroba' })])).includes('CORREO_INVALIDO'));
  assert.ok((await tipos([cita({ clase: null })])).includes('FALTA_CLASE'));
});

test('conflicto: cita 13:00 con examinador en D/A5 a las 12:30', async () => {
  const t = await tipos([
    cita({ id: 1, hora: '12:30', clase: 'D' }),
    cita({ id: 2, hora: '13:00', rut: '22.222.222-2', nombre: 'OTRA' }),
  ]);
  assert.deepEqual(t.filter((x) => x === 'CONFLICTO_PESADA').length, 1);
});

test('citas pasadas no se auditan por telefono/correo/clase', async () => {
  const t = await tipos([cita({ fecha: '2020-01-06', contacto: null, clase: null })]);
  assert.ok(!t.includes('FALTA_TELEFONO') && !t.includes('FALTA_CLASE'));
});

test('mananaISOChile es el dia siguiente a hoy', () => {
  const h = new Date(`${hoyISOChile()}T12:00:00Z`); h.setUTCDate(h.getUTCDate() + 1);
  assert.equal(mananaISOChile(), h.toISOString().slice(0, 10));
});
