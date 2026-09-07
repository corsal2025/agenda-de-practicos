'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Base de datos temporal ANTES de requerir los modulos del servidor.
const tmpDb = path.join(os.tmpdir(), `agenda-test-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '1';

const XLSX = require('xlsx');
const { importar } = require('../server/migrate');
const { db } = require('../server/db');
const { reporte } = require('../server/errores');

function limpiarTmp() {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
}
test.after(limpiarTmp);

const CAB = ['FECHA', 'HORA', 'RUT', 'NOMBRE', 'CLASE', 'CONTACTO', 'CORREO', 'TIPO DE CITA',
  'MOTIVO', 'LISTA', 'INTENTO', 'FUNCIONARIO', 'FECHA TRAMITE', 'CONFIRMO', 'EXAMINADOR', 'RESULTADO', 'COMENTARIOS'];

function libro(filas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CAB, ...filas]), 'AGO-DIC');
  const p = path.join(os.tmpdir(), `agenda-test-${Date.now()}-${Math.random()}.xlsx`);
  XLSX.writeFile(wb, p);
  return p;
}

test('importa citas, bloqueos y normaliza', () => {
  const xlsx = libro([
    ['2026-08-03', '08:30', '12.345.678-5', 'JUAN PEREZ', 'B', '900000000', 'j@x.cl', 'NORMAL', '', 'NO', '1° VEZ', 'CAROLINA CUADRO', '', 'SI', 'DANIEL LAGOS', 'APROBADO', ''],
    ['2026-08-03', '09:00', '', 'DIA ADMINISTRATIVO', '', '', '', '', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
    ['2026-08-03', '12:30', '11.111.111-1', 'PEDRO SOTO', 'D EMPRESA', '', '', 'REAGENDADO', 'no vino', '', '', 'MATÍAS', '', '', 'DOMINGO NAVARRO', 'luces', ''],
  ]);
  const r = importar(xlsx, { limpiar: true });
  fs.unlinkSync(xlsx);

  assert.equal(r.ocupadas, 2);
  const juan = db.prepare("SELECT * FROM agenda WHERE nombre = 'JUAN PEREZ'").get();
  assert.equal(juan.rut, '12.345.678-5');
  const func = db.prepare('SELECT nombre FROM funcionarios WHERE id = ?').get(juan.funcionario_id);
  assert.equal(func.nombre, 'CAROLINA CUADRA'); // typo corregido

  const bloq = db.prepare("SELECT * FROM agenda WHERE fecha='2026-08-03' AND hora='09:00'").get();
  assert.equal(bloq.bloqueado, 1);
  assert.equal(bloq.bloqueo_motivo, 'DIA ADMINISTRATIVO');
  assert.equal(bloq.nombre, null);

  const pedro = db.prepare("SELECT * FROM agenda WHERE nombre = 'PEDRO SOTO'").get();
  assert.equal(pedro.clase, 'D'); // "D EMPRESA" -> D
  assert.equal(pedro.resultado, null); // "luces" no es resultado valido
  assert.match(pedro.comentarios, /luces/);
});

test('el reporte de errores detecta clase pesada fuera de bloque y RUT invalido', () => {
  const xlsx = libro([
    ['2026-08-04', '08:30', '5.000.000-2', 'MARIA D', 'D', '', '', 'NORMAL', '', '', '', '', '', '', 'LUIS FERNANDEZ', '', ''],
  ]);
  importar(xlsx, { limpiar: true });
  fs.unlinkSync(xlsx);
  const rep = reporte();
  const tipos = new Set(rep.hallazgos.map((h) => h.tipo));
  assert.ok(tipos.has('CLASE_BLOQUE'), 'debe marcar clase D fuera de 12:30');
  assert.ok(tipos.has('RUT_INVALIDO'), 'debe marcar RUT con dv invalido');
});
