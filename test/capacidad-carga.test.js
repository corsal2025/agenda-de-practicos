'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const est = require('../server/estadisticas');

const b = (fecha, hora, ex, libre = true, bloqueado = 0) => ({ fecha, hora, examinador_id: ex, libre, bloqueado });

test('proyeccionCapacidad: cuenta libres habiles, 12:30 utiles y proyecta llenado', () => {
  const hoy = '2026-10-12'; // lunes
  const bloques = [
    b('2026-10-12', '08:30', 1, false), // ocupado
    b('2026-10-12', '09:00', 1),
    b('2026-10-13', '12:30', 1), b('2026-10-13', '13:00', 1), b('2026-10-13', '13:30', 1), // 12:30 util
    b('2026-10-14', '12:30', 2), b('2026-10-14', '13:00', 2, false), // 12:30 no util
    b('2026-10-15', '09:00', 1, true, 1), // bloqueado
    b('2026-10-17', '09:00', 1), // sabado
    b('2026-10-16', '09:00', 1, true, 0), // feriado simulado
    b('2026-12-30', '09:00', 1), // > 60 dias
  ];
  const r = est.proyeccionCapacidad({
    bloques, hoy, feriados: new Set(['2026-10-16']),
    agendadosPorDia: [{ dia: '2026-10-01', n: 30 }, { dia: '2026-08-01', n: 99 }],
  });
  assert.equal(r.libres_30, 5);
  assert.equal(r.libres_60, 5);
  assert.equal(r.libres_total, 6);
  assert.equal(r.libres_1230_30, 1);
  assert.equal(r.ritmo_diario, 1); // 30 en los ultimos 30 dias
  assert.equal(r.primer_cupo, '2026-10-12');
  assert.equal(r.dias_hasta_primer_cupo, 0);
  assert.equal(r.fecha_lleno, '2026-10-18'); // 6 libres / 1 por dia
  assert.equal(r.por_dia.find((d) => d.fecha === '2026-10-13').libres, 3);
});

test('proyeccionCapacidad: sin ritmo o sin cupos', () => {
  const r = est.proyeccionCapacidad({ bloques: [b('2026-10-20', '09:00', 1)], hoy: '2026-10-12', agendadosPorDia: [], feriados: new Set() });
  assert.equal(r.ritmo_diario, 0);
  assert.equal(r.fecha_lleno, null);
  assert.equal(r.dias_hasta_primer_cupo, 8);
  const v = est.proyeccionCapacidad({ bloques: [], hoy: '2026-10-12', agendadosPorDia: [{ dia: '2026-10-11', n: 3 }], feriados: new Set() });
  assert.equal(v.primer_cupo, null);
  assert.equal(v.dias_hasta_primer_cupo, null);
  assert.equal(v.fecha_lleno, '2026-10-12');
});

test('proyeccionCapacidad: llenado mas alla de 120 dias es null', () => {
  const bloques = Array.from({ length: 200 }, (_, i) => b('2026-10-13', `h${i}`, 1));
  const r = est.proyeccionCapacidad({ bloques, hoy: '2026-10-12', agendadosPorDia: [{ dia: '2026-10-10', n: 30 }], feriados: new Set() });
  assert.equal(r.fecha_lleno, null);
});

test('cargaExaminadores: participacion, citas por dia y desbalance', () => {
  const rows = [
    ...Array(6).fill(0).map((_, i) => ({ examinador: 'ANA', fecha: `2026-10-0${1 + (i % 2)}` })),
    ...Array(3).fill(0).map(() => ({ examinador: 'LUIS', fecha: '2026-10-01' })),
    ...Array(3).fill(0).map(() => ({ examinador: 'EVA', fecha: '2026-10-02' })),
  ];
  const r = est.cargaExaminadores(rows, [{ examinador: 'ANA', n: 4 }, { examinador: 'PEDRO', n: 2 }]);
  const ana = r.filas.find((x) => x.examinador === 'ANA');
  assert.equal(ana.citas, 6);
  assert.equal(ana.participacion, 50);
  assert.equal(ana.dias_trabajados, 2);
  assert.equal(ana.citas_por_dia, 3);
  assert.equal(ana.proximas_30, 4);
  assert.equal(r.promedio, 3); // 12 citas / 4 examinadores
  assert.equal(ana.desviacion, 100);
  assert.equal(ana.desbalance, 'alto');
  const pedro = r.filas.find((x) => x.examinador === 'PEDRO');
  assert.equal(pedro.citas, 0);
  assert.equal(pedro.desbalance, 'bajo');
  assert.equal(r.filas.find((x) => x.examinador === 'LUIS').desbalance, null);
  assert.equal(r.desbalanceados, 2);
  assert.equal(r.filas[0].examinador, 'ANA');
});

test('cargaExaminadores: vacio', () => {
  assert.deepEqual(est.cargaExaminadores([], []), { filas: [], promedio: 0, total: 0, desbalanceados: 0, umbral: 20 });
});
