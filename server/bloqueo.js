'use strict';

const MOTIVOS_BLOQUEO = [
  'PERMISO ADMINISTRATIVO',
  'LICENCIA MEDICA',
  'FERIADO LEGAL',
  'COMPENSATORIO',
  'CAPACITACION',
  'TERRENO',
];

const MAX_DIAS = 366;

function error400(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const esISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function leerRangoBloqueo(body = {}) {
  const desde = body.desde || body.fecha;
  const hasta = body.hasta || desde;
  if (!esISO(desde) || !esISO(hasta)) throw error400('Indica una fecha valida (desde / hasta)');
  if (hasta < desde) throw error400('La fecha "hasta" es anterior a "desde"');
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 864e5 + 1;
  if (dias > MAX_DIAS) throw error400(`El rango no puede superar ${MAX_DIAS} dias`);
  const examinador_id = body.examinador_id ? Number(body.examinador_id) : null;
  const motivo = String(body.motivo || '').trim().toUpperCase() || 'BLOQUEADO';

  const res = { desde, hasta, examinador_id, motivo };

  if (Array.isArray(body.horas) && body.horas.length > 0) {
    const horas = body.horas.map(String).map((h) => h.trim()).filter((h) => /^\d{2}:\d{2}$/.test(h));
    if (!horas.length) throw error400('Selecciona al menos una hora valida');
    res.horas = horas;
  } else if (body.hora_desde || body.hora_hasta) {
    const hd = body.hora_desde || '08:30';
    const hh = body.hora_hasta || '13:30';
    if (!/^\d{2}:\d{2}$/.test(hd) || !/^\d{2}:\d{2}$/.test(hh)) {
      throw error400('Formato de hora no valido (debe ser HH:MM)');
    }
    if (hh < hd) throw error400('La hora "hasta" no puede ser anterior a "desde"');
    res.hora_desde = hd;
    res.hora_hasta = hh;
  }

  return res;
}

function filtroBloqueo({ desde, hasta, examinador_id, horas, hora_desde, hora_hasta }, { bloqueado, incluirOcupados }) {
  const cond = ['fecha BETWEEN ? AND ?', 'bloqueado = ?'];
  const params = [desde, hasta, bloqueado];
  if (examinador_id) { cond.push('examinador_id = ?'); params.push(examinador_id); }
  if (horas && horas.length) {
    const ph = horas.map(() => '?').join(',');
    cond.push(`hora IN (${ph})`);
    params.push(...horas);
  } else if (hora_desde && hora_hasta) {
    cond.push('hora BETWEEN ? AND ?');
    params.push(hora_desde, hora_hasta);
  }
  if (!incluirOcupados) cond.push('(rut IS NULL OR rut = \'\') AND (nombre IS NULL OR nombre = \'\')');
  return { where: cond.join(' AND '), params };
}

module.exports = { MOTIVOS_BLOQUEO, leerRangoBloqueo, filtroBloqueo };
