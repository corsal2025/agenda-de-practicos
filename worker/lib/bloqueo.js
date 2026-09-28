// Bloqueo de bloques por rango de fechas (permisos, licencias, vacaciones...).
// Logica pura (sin DB) para poder testearla con node --test: valida el cuerpo
// del request y arma el WHERE que usan /bloquear-dia y /desbloquear-dia.

export const MOTIVOS_BLOQUEO = [
  'PERMISO ADMINISTRATIVO',
  'LICENCIA MEDICA',
  'FERIADO LEGAL',
  'COMPENSATORIO',
  'CAPACITACION',
  'TERRENO',
];

// Tope para que un error de tipeo en el año no bloquee media agenda.
const MAX_DIAS = 366;

function error400(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const esISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// Acepta { desde, hasta } o, por compatibilidad, { fecha } (un solo dia).
export function leerRangoBloqueo(body = {}) {
  const desde = body.desde || body.fecha;
  const hasta = body.hasta || desde;
  if (!esISO(desde) || !esISO(hasta)) throw error400('Indica una fecha valida (desde / hasta)');
  if (hasta < desde) throw error400('La fecha "hasta" es anterior a "desde"');
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 864e5 + 1;
  if (dias > MAX_DIAS) throw error400(`El rango no puede superar ${MAX_DIAS} dias`);
  const examinador_id = body.examinador_id ? Number(body.examinador_id) : null;
  const motivo = String(body.motivo || '').trim().toUpperCase() || 'BLOQUEADO';
  return { desde, hasta, examinador_id, motivo };
}

// WHERE + parametros para seleccionar los bloques del rango.
// bloqueado: 0 para bloquear (solo los que estan libres de bloqueo), 1 para desbloquear.
// incluirOcupados=false deja fuera los bloques que ya tienen una cita.
export function filtroBloqueo({ desde, hasta, examinador_id }, { bloqueado, incluirOcupados }) {
  const cond = ['fecha BETWEEN ? AND ?', 'bloqueado = ?'];
  const params = [desde, hasta, bloqueado];
  if (examinador_id) { cond.push('examinador_id = ?'); params.push(examinador_id); }
  if (!incluirOcupados) cond.push('rut IS NULL AND nombre IS NULL');
  return { where: cond.join(' AND '), params };
}
