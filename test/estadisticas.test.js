'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const est = require('../server/estadisticas');
const { vigenciaTramite, sumarMeses } = require('../server/tramite');

test('periodoAnterior: mismo largo inmediatamente antes', () => {
  assert.deepEqual(est.periodoAnterior('2026-03-01', '2026-03-31'), ['2026-01-29', '2026-02-28']);
  assert.deepEqual(est.periodoAnterior('2026-03-10', '2026-03-10'), ['2026-03-09', '2026-03-09']);
  assert.equal(est.periodoAnterior(null, '2026-03-10'), null);
});

test('deltas: diferencia por KPI', () => {
  assert.deepEqual(est.deltas({ ocupadas: 10, aprobacion: 50 }, { ocupadas: 8, aprobacion: 55.5 }),
    { ocupadas: 2, aprobacion: -5.5 });
});

test('aprobacionPorClase: separa clases multiples', () => {
  const r = est.aprobacionPorClase([
    { clase: 'B', resultado: 'APROBADO' },
    { clase: 'A2, B', resultado: 'REPROBADO' },
    { clase: 'B', resultado: null },
  ]);
  const b = r.find((x) => x.k === 'B');
  assert.deepEqual(b, { k: 'B', citas: 3, con_resultado: 2, aprobados: 1, aprobacion: 50 });
  assert.equal(r.find((x) => x.k === 'A2').aprobacion, 0);
  assert.equal(r[0].k, 'B'); // orden fijo de clases
});

test('aprobacionPorIntento agrupa por intento', () => {
  const r = est.aprobacionPorIntento([
    { intento: '1° VEZ', resultado: 'APROBADO' }, { intento: '2° VEZ', resultado: 'NO ASISTIO' }, { intento: null, resultado: 'APROBADO' },
  ]);
  assert.equal(r.find((x) => x.k === '1° VEZ').aprobacion, 100);
  assert.equal(r.find((x) => x.k === '(sin dato)').citas, 1);
});

test('inasistenciaDiaHora: % por celda dia x hora', () => {
  const r = est.inasistenciaDiaHora([
    { fecha: '2026-10-05', hora: '08:30', resultado: 'NO ASISTIO' }, // lunes
    { fecha: '2026-10-05', hora: '08:30', resultado: 'APROBADO' },
    { fecha: '2026-10-06', hora: '09:30', resultado: 'REPROBADO INASISTENCIA' },
    { fecha: '2026-10-06', hora: '09:30', resultado: null },
  ]);
  assert.deepEqual(r.dias, ['Lun', 'Mar', 'Mié', 'Jue', 'Vie']);
  const c = r.celdas.find((x) => x.dia === 0 && x.hora === '08:30');
  assert.deepEqual(c, { dia: 0, hora: '08:30', total: 2, inasist: 1, pct: 50 });
  assert.equal(r.celdas.find((x) => x.dia === 1 && x.hora === '09:30').pct, 100);
  assert.equal(r.max, 100);
});

test('tiempoEspera: promedio, mediana, p90 y por mes', () => {
  const rows = [1, 2, 3, 4, 10].map((d, i) => ({ fecha: `2026-03-${String(11 + i).padStart(2, '0')}`, agendado_en: `2026-03-${String(11 + i - d).padStart(2, '0')} 10:00:00` }));
  const r = est.tiempoEspera(rows);
  assert.equal(r.n, 5);
  assert.equal(r.promedio, 4);
  assert.equal(r.mediana, 3);
  assert.equal(r.p90, 10);
  assert.deepEqual(r.por_mes.map((m) => m.mes), ['2026-03']);
  assert.equal(est.tiempoEspera([]).n, 0);
});

test('tramitesVencidos: vencido a la fecha de la cita y vencidos sin resultado', () => {
  const r = est.tramitesVencidos([
    { fecha: '2026-08-01', fecha_inicio_tramite: '2026-01-15', resultado: 'APROBADO', rut: '1' },
    { fecha: '2026-06-01', fecha_inicio_tramite: '2026-01-15', resultado: 'APROBADO', rut: '2' },
    { fecha: '2026-10-20', fecha_inicio_tramite: '2026-03-01', resultado: null, rut: '3' },
    { fecha: '2026-10-20', fecha_inicio_tramite: null, resultado: null, rut: '4' },
  ], '2026-10-10');
  assert.equal(r.vencido_en_cita, 2); // rut 1 y 3
  assert.equal(r.vencido_en_cita_con_resultado, 1);
  assert.equal(r.personas, 2);
  assert.equal(r.vencidos_sin_resultado_hoy, 1);
});

test('tramite: sumarMeses y vigencia', () => {
  assert.equal(sumarMeses('2026-08-31', 6), '2027-02-28');
  assert.deepEqual(vigenciaTramite({ fecha_inicio_tramite: '2026-01-10' }, '2026-07-09'), { vence: '2026-07-10', dias: 1 });
  assert.equal(vigenciaTramite({}), null);
});
