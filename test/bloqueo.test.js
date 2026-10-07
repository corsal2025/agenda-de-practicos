'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MOTIVOS_BLOQUEO, leerRangoBloqueo, filtroBloqueo } = require('../server/bloqueo');

test('motivos de bloqueo incluyen los administrativos pedidos', () => {
  for (const m of ['PERMISO ADMINISTRATIVO', 'LICENCIA MEDICA', 'FERIADO LEGAL', 'COMPENSATORIO']) {
    assert.ok(MOTIVOS_BLOQUEO.includes(m), m);
  }
});

test('leerRangoBloqueo acepta un rango y normaliza el motivo', () => {
  assert.deepEqual(
    leerRangoBloqueo({ desde: '2026-09-01', hasta: '2026-09-15', examinador_id: '3', motivo: ' licencia medica ' }),
    { desde: '2026-09-01', hasta: '2026-09-15', examinador_id: 3, motivo: 'LICENCIA MEDICA' },
  );
});

test('leerRangoBloqueo mantiene compatibilidad con un solo dia (fecha)', () => {
  assert.deepEqual(
    leerRangoBloqueo({ fecha: '2026-09-23' }),
    { desde: '2026-09-23', hasta: '2026-09-23', examinador_id: null, motivo: 'BLOQUEADO' },
  );
  // sin "hasta" => un solo dia
  assert.equal(leerRangoBloqueo({ desde: '2026-09-23' }).hasta, '2026-09-23');
});

test('leerRangoBloqueo rechaza rangos invalidos con status 400', () => {
  const falla = (body, texto) => assert.throws(() => leerRangoBloqueo(body), (e) => e.status === 400 && texto.test(e.message));
  falla({}, /fecha/i);
  falla({ desde: '23/09/2026' }, /fecha/i);
  falla({ desde: '2026-09-10', hasta: '2026-09-01' }, /anterior/i);
  falla({ desde: '2026-01-01', hasta: '2027-02-01' }, /366/);
});

test('filtroBloqueo arma condiciones por rango, examinador y ocupados', () => {
  assert.deepEqual(
    filtroBloqueo({ desde: '2026-09-01', hasta: '2026-09-05', examinador_id: 2 }, { bloqueado: 0, incluirOcupados: false }),
    {
      where: "fecha BETWEEN ? AND ? AND bloqueado = ? AND examinador_id = ? AND (rut IS NULL OR rut = '') AND (nombre IS NULL OR nombre = '')",
      params: ['2026-09-01', '2026-09-05', 0, 2],
    },
  );
  assert.deepEqual(
    filtroBloqueo({ desde: '2026-09-01', hasta: '2026-09-01', examinador_id: null }, { bloqueado: 1, incluirOcupados: true }),
    { where: 'fecha BETWEEN ? AND ? AND bloqueado = ?', params: ['2026-09-01', '2026-09-01', 1] },
  );
});

test('leerRangoBloqueo acepta horas especificas', () => {
  assert.deepEqual(
    leerRangoBloqueo({ fecha: '2026-10-05', horas: ['09:00', '09:30'], motivo: 'terreno' }),
    { desde: '2026-10-05', hasta: '2026-10-05', examinador_id: null, motivo: 'TERRENO', horas: ['09:00', '09:30'] },
  );
});

test('filtroBloqueo incluye horas si estan presentes', () => {
  assert.deepEqual(
    filtroBloqueo({ desde: '2026-10-05', hasta: '2026-10-05', examinador_id: 1, horas: ['09:00', '09:30'] }, { bloqueado: 0, incluirOcupados: true }),
    {
      where: 'fecha BETWEEN ? AND ? AND bloqueado = ? AND examinador_id = ? AND hora IN (?,?)',
      params: ['2026-10-05', '2026-10-05', 0, 1, '09:00', '09:30'],
    },
  );
});
