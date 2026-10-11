'use strict';
// Vigencia del tramite de licencia: 6 meses desde su inicio. Modulo compartido (rutas y estadisticas).
const { hoyISO } = require('./fechas');

const MS_DIA = 86400000;
const MESES_VIGENCIA = 6;
const esISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// Fecha ISO + n meses (si el dia no existe en el mes destino, se usa el ultimo dia).
function sumarMeses(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const ult = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const r = new Date(Date.UTC(y, m - 1 + n, Math.min(d, ult)));
  return r.toISOString().slice(0, 10);
}
// Dias entre dos fechas ISO (solo fecha, en UTC puro: sin desfases por zona horaria).
function diasEntre(desde, hasta) {
  const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(hasta) - utc(desde)) / MS_DIA);
}
// Vigencia del tramite: { vence, dias } (dias <= 0 = vencido) o null si no aplica.
function vigenciaTramite(row, hoy = hoyISO()) {
  if (!esISO(row.fecha_inicio_tramite)) return null;
  const vence = sumarMeses(row.fecha_inicio_tramite, MESES_VIGENCIA);
  return { vence, dias: diasEntre(hoy, vence) };
}

module.exports = { sumarMeses, diasEntre, vigenciaTramite, esISO };
