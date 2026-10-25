'use strict';
const XLSX = require('xlsx');
const { db } = require('./db');
const { reporte } = require('./errores');
const { hoyISO } = require('./fechas');

const CABECERAS = [
  'FECHA', 'HORA', 'RUT', 'NOMBRE', 'CLASE', 'NUMERO DE CONTACTO', 'CORREO',
  'TIPO DE CITA', 'MOTIVO REAGENDAMIENTO', 'LISTA DE ESPERA', 'INTENTO',
  'FUNCIONARIO/A QUE LO AGENDO', 'FECHA INICIO TRAMITE', 'CONFIRMO ASISTENCIA',
  'EXAMINADOR', 'RESULTADO', 'COMENTARIOS',
  'CUPO', 'ESCUELA CONDUCTORES', 'TIPO REAGENDAMIENTO', 'AVISADO POR', 'PENDIENTE REAGENDAR', 'NOTA PENDIENTE',
];
// Cabeceras con tildes, como el Excel original. Las columnas extendidas (al final) se exportan
// con el mismo nombre exacto que reconoce el importador (ver COLUMNAS_EXACTAS en migrate.js).
const CABECERAS_ORIG = [
  'FECHA', 'HORA', 'RUT', 'NOMBRE', 'CLASE', 'NÚMERO DE CONTACTO', 'CORREO',
  'TIPO DE CITA', 'MOTIVO REAGENDAMIENTO', 'LISTA DE ESPERA', 'INTENTO ',
  'FUNCIONARIO/A QUE LO AGENDÓ', 'FECHA INICIO TRÁMITE', 'CONFIRMÓ ASISTENCIA',
  'EXAMINADOR', 'RESULTADO', 'COMENTARIOS',
  'CUPO', 'ESCUELA CONDUCTORES', 'TIPO REAGENDAMIENTO', 'AVISADO POR', 'PENDIENTE REAGENDAR', 'NOTA PENDIENTE',
];

function filas() {
  return db.prepare(`
    SELECT a.fecha, a.hora, a.rut,
           CASE WHEN a.bloqueado = 1 THEN '[BLOQUEADO] ' || COALESCE(a.bloqueo_motivo, '') ELSE a.nombre END AS nombre,
           a.clase, a.contacto, a.correo, a.tipo_cita,
           a.motivo_reagendamiento, a.lista_espera, a.intento, f.nombre AS funcionario,
           a.fecha_inicio_tramite, a.confirmo_asistencia, e.nombre AS examinador,
           a.resultado, a.comentarios, a.cupo, a.escuela_conductores, a.tipo_reagendamiento,
           a.avisado_por, a.pendiente_reagendar, a.pendiente_nota
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
    r.cupo || 1, r.escuela_conductores || '', r.tipo_reagendamiento || '', r.avisado_por || '',
    r.pendiente_reagendar ? 'SI' : 'NO', r.pendiente_nota || '',
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

// Semestre ("ENE-JUN <año>" o "JUL-DIC <año>") al que pertenece una fecha ISO.
function nombreHojaOriginal(fechaISO) {
  const anio = fechaISO.slice(0, 4);
  const mes = Number(fechaISO.slice(5, 7));
  return `${mes <= 6 ? 'ENE-JUN' : 'JUL-DIC'} ${anio}`;
}
const ORDEN_SEMESTRE = { 'ENE-JUN': 0, 'JUL-DIC': 1 };
function compararNombresHoja(a, b) {
  const [sa, ya] = a.split(' ');
  const [sb, yb] = b.split(' ');
  return Number(ya) - Number(yb) || ORDEN_SEMESTRE[sa] - ORDEN_SEMESTRE[sb];
}

// Formato parecido al Excel original: una hoja por semestre (ENE-JUN <año> / JUL-DIC <año>),
// derivado de las fechas que realmente hay en la base (no de un año fijo).
function generarXlsxOriginal() {
  const wb = XLSX.utils.book_new();
  const todo = filas();
  const grupos = new Map();
  for (const r of todo) {
    const nombre = nombreHojaOriginal(r.fecha);
    (grupos.get(nombre) || grupos.set(nombre, []).get(nombre)).push(r);
  }
  const nombres = grupos.size ? [...grupos.keys()].sort(compararNombresHoja) : [nombreHojaOriginal(hoyISO())];
  for (const nombre of nombres) {
    const aoa = [CABECERAS_ORIG, ...(grupos.get(nombre) || []).map(aFila)];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombre);
  }
  XLSX.utils.book_append_sheet(wb, hojaErrores(), 'REPORTE DE ERRORES');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generarXlsx, generarXlsxOriginal };
