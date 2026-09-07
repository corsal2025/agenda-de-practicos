'use strict';
const XLSX = require('xlsx');
const { db } = require('./db');
const { reporte } = require('./errores');

const CABECERAS = [
  'FECHA', 'HORA', 'RUT', 'NOMBRE', 'CLASE', 'NUMERO DE CONTACTO', 'CORREO',
  'TIPO DE CITA', 'MOTIVO REAGENDAMIENTO', 'LISTA DE ESPERA', 'INTENTO',
  'FUNCIONARIO/A QUE LO AGENDO', 'FECHA INICIO TRAMITE', 'CONFIRMO ASISTENCIA',
  'EXAMINADOR', 'RESULTADO', 'COMENTARIOS',
];
// Cabeceras con tildes, como el Excel original.
const CABECERAS_ORIG = [
  'FECHA', 'HORA', 'RUT', 'NOMBRE', 'CLASE', 'NÚMERO DE CONTACTO', 'CORREO',
  'TIPO DE CITA', 'MOTIVO REAGENDAMIENTO', 'LISTA DE ESPERA', 'INTENTO ',
  'FUNCIONARIO/A QUE LO AGENDÓ', 'FECHA INICIO TRÁMITE', 'CONFIRMÓ ASISTENCIA',
  'EXAMINADOR', 'RESULTADO', 'COMENTARIOS',
];

function filas() {
  return db.prepare(`
    SELECT a.fecha, a.hora, a.rut,
           CASE WHEN a.bloqueado = 1 THEN '[BLOQUEADO] ' || COALESCE(a.bloqueo_motivo, '') ELSE a.nombre END AS nombre,
           a.clase, a.contacto, a.correo, a.tipo_cita,
           a.motivo_reagendamiento, a.lista_espera, a.intento, f.nombre AS funcionario,
           a.fecha_inicio_tramite, a.confirmo_asistencia, e.nombre AS examinador,
           a.resultado, a.comentarios
    FROM agenda a
    JOIN examinadores e ON e.id = a.examinador_id
    LEFT JOIN funcionarios f ON f.id = a.funcionario_id
    ORDER BY a.fecha, a.hora, e.nombre
  `).all();
}

function aFila(r) {
  return [
    r.fecha, r.hora, r.rut || '', r.nombre || '', r.clase || '', r.contacto || '', r.correo || '',
    r.tipo_cita || '', r.motivo_reagendamiento || '', r.lista_espera || '', r.intento || '',
    r.funcionario || '', r.fecha_inicio_tramite || '',
    r.confirmo_asistencia == null ? '' : (r.confirmo_asistencia ? 'SI' : 'NO'),
    r.examinador || '', r.resultado || '', r.comentarios || '',
  ];
}

function hojaErrores() {
  const rep = reporte();
  const aoa = [['SEVERIDAD', 'TIPO', 'FECHA', 'HORA', 'EXAMINADOR', 'RUT', 'NOMBRE', 'MENSAJE']];
  for (const h of rep.hallazgos) {
    aoa.push([h.severidad, h.tipo, h.fecha || '', h.hora || '', h.examinador || '', h.rut || '', h.nombre || '', h.mensaje]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

// Formato propio del dashboard: una hoja AGENDA + reporte.
function generarXlsx() {
  const wb = XLSX.utils.book_new();
  const aoa = [CABECERAS, ...filas().map(aFila)];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'AGENDA');
  XLSX.utils.book_append_sheet(wb, hojaErrores(), 'REPORTE DE ERRORES');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Formato parecido al Excel original: hojas AGO-DIC (2026) y ENE-JUN 2027.
function generarXlsxOriginal() {
  const wb = XLSX.utils.book_new();
  const todo = filas();
  const agoDic = todo.filter((r) => r.fecha < '2027-01-01');
  const eneJun = todo.filter((r) => r.fecha >= '2027-01-01');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CABECERAS_ORIG, ...agoDic.map(aFila)]), 'AGO-DIC');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CABECERAS_ORIG, ...eneJun.map(aFila)]), 'ENE-JUN 2027');
  XLSX.utils.book_append_sheet(wb, hojaErrores(), 'REPORTE DE ERRORES');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generarXlsx, generarXlsxOriginal };
