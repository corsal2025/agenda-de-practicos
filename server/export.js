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
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  }
  ws['!cols'] = CABECERAS.map((c) => ({ wch: Math.max(c.length + 3, 12) }));
  XLSX.utils.book_append_sheet(wb, ws, 'AGENDA');
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
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
    }
    ws['!cols'] = CABECERAS_ORIG.map((c) => ({ wch: Math.max(c.length + 3, 12) }));
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  }
  XLSX.utils.book_append_sheet(wb, hojaErrores(), 'REPORTE DE ERRORES');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Exportar el 100% de las columnas de la tabla agenda en un solo archivo Excel plano y completo.
function generarXlsxCompleto() {
  const wb = XLSX.utils.book_new();
  const filasCompletas = db.prepare(`
    SELECT a.id,
           a.fecha,
           a.hora,
           e.nombre AS examinador,
           a.rut,
           CASE WHEN a.bloqueado = 1 THEN '[BLOQUEADO] ' || COALESCE(a.bloqueo_motivo, '') ELSE a.nombre END AS nombre,
           a.clase,
           a.contacto AS telefono,
           a.correo,
           a.tipo_cita,
           a.motivo_reagendamiento,
           a.lista_espera,
           a.intento,
           f.nombre AS funcionario,
           a.fecha_inicio_tramite,
           CASE WHEN a.confirmo_asistencia = 1 THEN 'SI' WHEN a.confirmo_asistencia = 0 THEN 'NO' ELSE '' END AS confirmo_asistencia,
           a.resultado,
           a.comentarios,
           CASE WHEN a.bloqueado = 1 THEN 'SI' ELSE 'NO' END AS bloqueado,
           a.bloqueo_motivo,
           CASE WHEN a.pendiente_reagendar = 1 THEN 'SI' ELSE 'NO' END AS pendiente_reagendar,
           a.pendiente_nota,
           a.escuela_conductores,
           a.tipo_reagendamiento,
           a.avisado_por,
           a.cupo,
           a.correo_confirmacion_enviado,
           a.correo_recordatorio_enviado,
           a.agendado_en,
           a.creado_en,
           a.actualizado_en
    FROM agenda a
    LEFT JOIN examinadores e ON e.id = a.examinador_id
    LEFT JOIN funcionarios f ON f.id = a.funcionario_id
    ORDER BY a.fecha ASC, a.hora ASC, a.id ASC
  `).all();

  const ws = XLSX.utils.json_to_sheet(filasCompletas);
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  }
  if (filasCompletas.length > 0) {
    const keys = Object.keys(filasCompletas[0]);
    ws['!cols'] = keys.map((k) => {
      let maxLen = k.length;
      for (let i = 0; i < Math.min(filasCompletas.length, 100); i++) {
        const val = filasCompletas[i][k];
        if (val != null) {
          const strLen = String(val).length;
          if (strLen > maxLen) maxLen = strLen;
        }
      }
      return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
    });
  }
  XLSX.utils.book_append_sheet(wb, ws, 'AGENDA COMPLETA');
  XLSX.utils.book_append_sheet(wb, hojaErrores(), 'REPORTE DE ERRORES');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generarXlsx, generarXlsxOriginal, generarXlsxCompleto };
