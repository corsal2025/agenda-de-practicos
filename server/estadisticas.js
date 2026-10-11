'use strict';
// Agregados puros para la pestana Estadisticas: reciben filas y devuelven resumenes (sin BD).
const { vigenciaTramite, sumarMeses, diasEntre } = require('./tramite');
const { hoyISO } = require('./fechas');

const ORDEN_CLASES = ['B', 'C', 'D', 'A1', 'A2', 'A3', 'A4', 'A5', 'E'];
const INASISTE = ['NO ASISTIO', 'REPROBADO INASISTENCIA'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
const SIN_DATO = '(sin dato)';
const pct = (a, b) => (b ? +(a / b * 100).toFixed(1) : 0);
const r1 = (n) => +n.toFixed(1);

function sumarDiasISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Periodo de igual largo inmediatamente anterior a [desde, hasta].
function periodoAnterior(desde, hasta) {
  if (!desde || !hasta) return null;
  const largo = diasEntre(desde, hasta) + 1;
  return [sumarDiasISO(desde, -largo), sumarDiasISO(desde, -1)];
}

function deltas(actual, anterior) {
  const out = {};
  for (const k of Object.keys(actual)) out[k] = r1((actual[k] || 0) - (anterior[k] || 0));
  return out;
}

function acumular(mapa, k, row) {
  const g = mapa.get(k) || { k, citas: 0, con_resultado: 0, aprobados: 0 };
  g.citas += 1;
  if (row.resultado) g.con_resultado += 1;
  if (row.resultado === 'APROBADO') g.aprobados += 1;
  mapa.set(k, g);
}
const conPct = (g) => ({ ...g, aprobacion: pct(g.aprobados, g.con_resultado) });

function aprobacionPorClase(rows) {
  const m = new Map();
  for (const row of rows) {
    const clases = String(row.clase || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    for (const c of new Set(clases.length ? clases : [SIN_DATO])) acumular(m, c, row);
  }
  const idx = (k) => { const i = ORDEN_CLASES.indexOf(k); return i < 0 ? 99 : i; };
  return [...m.values()].sort((a, b) => idx(a.k) - idx(b.k) || a.k.localeCompare(b.k)).map(conPct);
}

function aprobacionPorIntento(rows) {
  const m = new Map();
  for (const row of rows) acumular(m, String(row.intento || '').trim() || SIN_DATO, row);
  return [...m.values()].sort((a, b) => a.k.localeCompare(b.k)).map(conPct);
}

// Dia de semana 0=lunes..4=viernes (null fin de semana).
function diaSemana(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const w = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return w < 5 ? w : null;
}

function inasistenciaDiaHora(rows) {
  const m = new Map();
  for (const row of rows) {
    if (!row.resultado || !row.fecha || !row.hora) continue;
    const dia = diaSemana(row.fecha);
    if (dia == null) continue;
    const k = `${dia}|${row.hora}`;
    const c = m.get(k) || { dia, hora: row.hora, total: 0, inasist: 0 };
    c.total += 1;
    if (INASISTE.includes(row.resultado)) c.inasist += 1;
    m.set(k, c);
  }
  const celdas = [...m.values()].map((c) => ({ ...c, pct: pct(c.inasist, c.total) }))
    .sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora));
  const horas = [...new Set(celdas.map((c) => c.hora))].sort();
  return { dias: DIAS, horas, celdas, max: celdas.reduce((x, c) => Math.max(x, c.pct), 0) };
}

function estadisticosDias(lista) {
  if (!lista.length) return { n: 0, promedio: 0, mediana: 0, p90: 0 };
  const s = [...lista].sort((a, b) => a - b);
  const mitad = Math.floor(s.length / 2);
  const mediana = s.length % 2 ? s[mitad] : (s[mitad - 1] + s[mitad]) / 2;
  const p90 = s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
  return { n: s.length, promedio: r1(s.reduce((a, b) => a + b, 0) / s.length), mediana: r1(mediana), p90 };
}

// Dias entre agendamiento y la cita (se ignoran negativos y datos invalidos).
function tiempoEspera(rows) {
  const porMes = new Map();
  const todos = [];
  for (const row of rows) {
    const ag = String(row.agendado_en || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ag) || !row.fecha) continue;
    const d = diasEntre(ag, row.fecha);
    if (d < 0) continue;
    todos.push(d);
    const mes = row.fecha.slice(0, 7);
    porMes.set(mes, [...(porMes.get(mes) || []), d]);
  }
  const por_mes = [...porMes.keys()].sort().map((mes) => ({ mes, ...estadisticosDias(porMes.get(mes)) }));
  return { ...estadisticosDias(todos), por_mes };
}

// Citas cuyo tramite (6 meses) ya estaba vencido el dia de la cita; y vencidos hoy aun sin resultado.
function tramitesVencidos(rows, hoy = hoyISO()) {
  let enCita = 0; let conRes = 0; let sinResHoy = 0;
  const personas = new Set();
  for (const row of rows) {
    const v = vigenciaTramite(row, hoy);
    if (!v || !row.fecha) continue;
    if (v.vence < row.fecha) {
      enCita += 1;
      if (row.resultado) conRes += 1;
      personas.add(row.rut || row.nombre || `#${enCita}`);
    }
    if (!row.resultado && row.fecha >= hoy && v.dias <= 0) sinResHoy += 1;
  }
  return { vencido_en_cita: enCita, vencido_en_cita_con_resultado: conRes, personas: personas.size, vencidos_sin_resultado_hoy: sinResHoy };
}

module.exports = {
  periodoAnterior, deltas, aprobacionPorClase, aprobacionPorIntento, inasistenciaDiaHora, tiempoEspera, tramitesVencidos, sumarMeses,
};
