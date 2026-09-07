'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../server/normalizar');

test('funcionario corrige typos conocidos', () => {
  assert.equal(N.funcionario('CAROLINA CUADRO'), 'CAROLINA CUADRA');
  assert.equal(N.funcionario('JARED LOPEZ '), 'JARED LOPEZ');
  assert.equal(N.funcionario('MATÍAS'), 'MATIAS BOZZO');
  assert.equal(N.funcionario('SUSANA CAMPAÑA'), 'SUSANA CAMPANA');
});

test('clase extrae la clase canonica', () => {
  assert.deepEqual(N.clase('B'), { valor: 'B', nota: null });
  assert.equal(N.clase('D EMPRESA').valor, 'D');
  assert.equal(N.clase('(A5)').valor, 'A5');
  assert.equal(N.clase('C.').valor, 'C');
  assert.equal(N.clase('xxx').valor, null);
});

test('resultado canoniza y manda texto libre a nota', () => {
  assert.equal(N.resultado('APROBADO').valor, 'APROBADO');
  assert.equal(N.resultado('REPROBADO ').valor, 'REPROBADO');
  assert.equal(N.resultado('NO ASISTIÓ').valor, 'NO ASISTIO');
  const libre = N.resultado('luces');
  assert.equal(libre.valor, null);
  assert.match(libre.nota, /luces/);
});

test('tipoCita normaliza', () => {
  assert.equal(N.tipoCita('normal'), 'NORMAL');
  assert.equal(N.tipoCita('REAGENDADO '), 'REAGENDADO');
  assert.equal(N.tipoCita('traslado en terreno'), 'TRASLADO EN TERRENO');
});

test('bloqueo detecta etiquetas administrativas', () => {
  assert.equal(N.bloqueo('DIA ADMINISTRATIVO'), 'DIA ADMINISTRATIVO');
  assert.equal(N.bloqueo('BLOQUEADO - EXAMEN EN TERRENO'), 'BLOQUEADO - EXAMEN EN TERRENO');
  assert.equal(N.bloqueo('[BLOQUEADO] FIESTAS PATRIAS'), 'FIESTAS PATRIAS');
  assert.equal(N.bloqueo('JUAN PEREZ'), null);
});

test('siNoBool y listaEspera', () => {
  assert.equal(N.siNoBool('SI'), 1);
  assert.equal(N.siNoBool(false), 0);
  assert.equal(N.siNoBool('cualquier cosa'), null);
  assert.equal(N.listaEspera('sí'), 'SI');
  assert.equal(N.listaEspera('x'), null);
});
