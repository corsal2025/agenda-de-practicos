'use strict';
// Export: columnas extendidas en ambos formatos, y hojas por semestre derivadas de los datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-export-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;

const XLSX = require('xlsx');
const { db } = require('../server/db');
const { generarXlsx, generarXlsxOriginal } = require('../server/export');

test.after(() => { for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} } });

const exId = db.prepare('SELECT id FROM examinadores LIMIT 1').get().id;
function cita(fecha, hora, extra = {}) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase) VALUES (?, ?, ?, ?, ?, ?)')
    .run(fecha, hora, exId, extra.rut || '11.111.111-1', extra.nombre || 'PRUEBA', 'B');
  const cols = Object.keys(extra);
  if (cols.length) {
    db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE fecha=@f AND hora=@h AND examinador_id=@e`)
      .run({ ...extra, f: fecha, h: hora, e: exId });
  }
}

function hoja(buf, nombre) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
}

test('generarXlsx (dashboard): agrega las columnas extendidas al final con sus valores', () => {
  db.exec('DELETE FROM agenda');
  cita('2030-02-10', '09:00', { cupo: 2, escuela_conductores: 'ESCUELA Z', tipo_reagendamiento: 'SMS', avisado_por: 'correo', pendiente_reagendar: 1, pendiente_nota: 'llamar' });
  const filas = hoja(generarXlsx(), 'AGENDA');
  const cab = filas[0];
  for (const col of ['CUPO', 'ESCUELA CONDUCTORES', 'TIPO REAGENDAMIENTO', 'AVISADO POR', 'PENDIENTE REAGENDAR', 'NOTA PENDIENTE']) {
    assert.ok(cab.includes(col), col);
  }
  const fila = filas[1];
  assert.equal(fila[cab.indexOf('CUPO')], 2);
  assert.equal(fila[cab.indexOf('ESCUELA CONDUCTORES')], 'ESCUELA Z');
  assert.equal(fila[cab.indexOf('TIPO REAGENDAMIENTO')], 'SMS');
  assert.equal(fila[cab.indexOf('AVISADO POR')], 'correo');
  assert.equal(fila[cab.indexOf('PENDIENTE REAGENDAR')], 'SI');
  assert.equal(fila[cab.indexOf('NOTA PENDIENTE')], 'llamar');
});

test('generarXlsxOriginal: agrega las mismas columnas extendidas (cabeceras con tilde)', () => {
  db.exec('DELETE FROM agenda');
  cita('2030-02-11', '09:00', { cupo: 3 });
  const nombreHoja = 'ENE-JUN 2030';
  const filas = hoja(generarXlsxOriginal(), nombreHoja);
  assert.ok(filas[0].includes('CUPO'));
  assert.equal(filas[1][filas[0].indexOf('CUPO')], 3);
});

test('generarXlsxOriginal: deriva el/los año(s) de las fechas reales, no un año fijo', () => {
  db.exec('DELETE FROM agenda');
  cita('2028-03-01', '09:00'); // ENE-JUN 2028
  cita('2028-09-01', '09:30'); // JUL-DIC 2028
  cita('2031-01-15', '10:00'); // ENE-JUN 2031
  const wb = XLSX.read(generarXlsxOriginal(), { type: 'buffer' });
  const nombres = wb.SheetNames.filter((n) => n !== 'REPORTE DE ERRORES');
  assert.deepEqual(nombres, ['ENE-JUN 2028', 'JUL-DIC 2028', 'ENE-JUN 2031']);
});
