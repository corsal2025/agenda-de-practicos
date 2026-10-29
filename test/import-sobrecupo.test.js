'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-sobrecupo-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;

const XLSX = require('xlsx');
const { importar } = require('../server/migrate');
const { db } = require('../server/db');

function limpiarTmp() {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
}
test.after(limpiarTmp);

const CAB_EXCEL_ORIGINAL = [
  'FECHA', 'HORA', 'RUT', 'NOMBRE', 'CLASE', 'CONTACTO', 'CORREO', 'TIPO DE CITA',
  'MOTIVO', 'LISTA', 'INTENTO', 'FUNCIONARIO', 'FECHA TRAMITE', 'CONFIRMO', 'EXAMINADOR', 'RESULTADO', 'COMENTARIOS'
];

function crearXlsx(filas, nombreHoja = 'AGO-DIC') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CAB_EXCEL_ORIGINAL, ...filas]), nombreHoja);
  const p = path.join(os.tmpdir(), `agenda-sobrecupo-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, p);
  return p;
}

test('archivo XLSX real: reconoce doble carga a la misma hora y las guarda como cupo 1 y cupo 2', () => {
  const p = crearXlsx([
    ['2026-09-01', '08:30', '11.111.111-1', 'ANA GOMEZ', 'B', '912345678', 'ana@ejemplo.cl', 'NORMAL', '', '', '', 'CAROLINA CUADRA', '', 'SI', 'DANIEL LAGOS', '', ''],
    ['2026-09-01', '08:30', '22.222.222-2', 'BERNARDO SILVA', 'B', '987654321', 'b@ejemplo.cl', 'NORMAL', '', '', '', 'CAROLINA CUADRA', '', '', 'DANIEL LAGOS', '', ''],
  ]);

  const res = importar(p, { limpiar: true });
  fs.unlinkSync(p);

  assert.equal(res.ocupadas, 2, 'debe importar las 2 personas');

  const filas = db.prepare(`
    SELECT cupo, nombre, rut FROM agenda
    WHERE fecha = '2026-09-01' AND hora = '08:30' AND nombre IS NOT NULL
    ORDER BY cupo ASC
  `).all().map(f => ({ cupo: f.cupo, nombre: f.nombre, rut: f.rut }));

  assert.equal(filas.length, 2);
  assert.equal(filas[0].cupo, 1);
  assert.equal(filas[0].nombre, 'ANA GOMEZ');
  assert.equal(filas[0].rut, '11.111.111-1');

  assert.equal(filas[1].cupo, 2);
  assert.equal(filas[1].nombre, 'BERNARDO SILVA');
  assert.equal(filas[1].rut, '22.222.222-2');
});

test('archivo XLSX con triple carga a la misma hora: genera cupo 1, 2 y 3', () => {
  const p = crearXlsx([
    ['2026-09-02', '10:00', '10.000.000-1', 'CARLOS UNO', 'B', '', '', 'NORMAL', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
    ['2026-09-02', '10:00', '20.000.000-2', 'CARLOS DOS', 'B', '', '', 'NORMAL', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
    ['2026-09-02', '10:00', '30.000.000-3', 'CARLOS TRES', 'B', '', '', 'NORMAL', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
  ]);

  const res = importar(p, { limpiar: true });
  fs.unlinkSync(p);

  assert.equal(res.ocupadas, 3);

  const filas = db.prepare(`
    SELECT cupo, nombre, rut FROM agenda
    WHERE fecha = '2026-09-02' AND hora = '10:00' AND nombre IS NOT NULL
    ORDER BY cupo ASC
  `).all().map(f => ({ cupo: f.cupo, nombre: f.nombre, rut: f.rut }));

  assert.deepEqual(filas, [
    { cupo: 1, nombre: 'CARLOS UNO', rut: '10.000.000-1' },
    { cupo: 2, nombre: 'CARLOS DOS', rut: '20.000.000-2' },
    { cupo: 3, nombre: 'CARLOS TRES', rut: '30.000.000-3' },
  ]);
});

test('bloqueo y persona a la misma hora: la persona ocupa el horario y no genera sobrecupo vacio', () => {
  const p = crearXlsx([
    ['2026-09-03', '09:00', '', 'DIA ADMINISTRATIVO', '', '', '', '', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
    ['2026-09-03', '09:00', '15.555.555-5', 'DIEGO OCUPADO', 'B', '', '', 'NORMAL', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
  ]);

  const res = importar(p, { limpiar: true });
  fs.unlinkSync(p);

  const filas = db.prepare(`
    SELECT cupo, nombre, rut, bloqueado FROM agenda
    WHERE fecha = '2026-09-03' AND hora = '09:00' AND (nombre IS NOT NULL OR bloqueado = 1)
    ORDER BY cupo ASC
  `).all().map(f => ({ cupo: f.cupo, nombre: f.nombre, rut: f.rut, bloqueado: f.bloqueado }));

  assert.equal(filas.length, 1, 'solo debe quedar 1 bloque activo');
  assert.equal(filas[0].cupo, 1);
  assert.equal(filas[0].nombre, 'DIEGO OCUPADO');
  assert.equal(filas[0].bloqueado, 0);
});

test('regla estricta: mismo RUT con dos examinadores DISTINTOS para la misma clase es RECHAZADO con error 400', () => {
  const p = crearXlsx([
    ['2026-09-04', '08:30', '19.999.999-K', 'RODRIGO CONFLICTO', 'B', '', '', 'NORMAL', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
    ['2026-09-04', '09:00', '19.999.999-K', 'RODRIGO CONFLICTO', 'B', '', '', 'NORMAL', '', '', '', '', '', '', 'DOMINGO NAVARRO', '', ''],
  ]);

  assert.throws(() => importar(p, { limpiar: true }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /Conflicto de examinador/);
    assert.match(err.message, /19\.999\.999-K/);
    assert.match(err.message, /DANIEL LAGOS/);
    assert.match(err.message, /DOMINGO NAVARRO/);
    return true;
  });

  fs.unlinkSync(p);
});

test('mismo RUT con examinadores distintos para DISTINTA clase es PERMITIDO', () => {
  const p = crearXlsx([
    ['2026-09-05', '08:30', '18.888.888-8', 'CAMILA DUAL', 'B', '', '', 'NORMAL', '', '', '', '', '', '', 'DANIEL LAGOS', '', ''],
    ['2026-09-05', '09:00', '18.888.888-8', 'CAMILA DUAL', 'C', '', '', 'NORMAL', '', '', '', '', '', '', 'DOMINGO NAVARRO', '', ''],
  ]);

  const res = importar(p, { limpiar: true });
  fs.unlinkSync(p);

  assert.equal(res.ocupadas, 2);
  const filas = db.prepare(`
    SELECT a.fecha, a.hora, a.clase, e.nombre AS examinador
    FROM agenda a
    JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.fecha = '2026-09-05' AND a.rut = '18.888.888-8'
    ORDER BY a.hora ASC
  `).all();

  assert.equal(filas.length, 2);
  assert.equal(filas[0].examinador, 'DANIEL LAGOS');
  assert.equal(filas[0].clase, 'B');
  assert.equal(filas[1].examinador, 'DOMINGO NAVARRO');
  assert.equal(filas[1].clase, 'C');
});
