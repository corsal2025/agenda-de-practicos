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

// extras: inasistencias que ya no tienen fila con resultado (tabla faltas); cuentan como cita con inasistencia.
function inasistenciaDiaHora(rows, extras = []) {
  const m = new Map();
  for (const row of [...rows, ...extras.map((x) => ({ ...x, resultado: INASISTE[0] }))]) {
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

// ---------- Proyeccion de capacidad (desde hoy, independiente del filtro) ----------
const HORIZONTE_LLENADO = 120;
const VENTANA_RITMO = 30;
const esFinDeSemana = (iso) => diaSemana(iso) == null;

// bloques: [{fecha, hora, examinador_id, libre, bloqueado}] desde hoy. agendadosPorDia: [{dia, n}].
function proyeccionCapacidad({ bloques, hoy, feriados = new Set(), agendadosPorDia = [], horaPesada = '12:30', siguientesPesada = ['13:00', '13:30'] }) {
  const habil = (f) => f >= hoy && !esFinDeSemana(f) && !feriados.has(f);
  const libres = bloques.filter((x) => x.libre && !x.bloqueado && habil(x.fecha));
  const libreKey = new Set(libres.map((x) => `${x.fecha}|${x.examinador_id}|${x.hora}`));
  const lim30 = sumarDiasISO(hoy, 30);
  const lim60 = sumarDiasISO(hoy, 60);
  const porDia = new Map();
  let l30 = 0; let l60 = 0; let p30 = 0; let p60 = 0;
  for (const x of libres) {
    porDia.set(x.fecha, (porDia.get(x.fecha) || 0) + 1);
    const util = x.hora === horaPesada && siguientesPesada.every((h) => libreKey.has(`${x.fecha}|${x.examinador_id}|${h}`));
    if (x.fecha < lim30) { l30 += 1; if (util) p30 += 1; }
    if (x.fecha < lim60) { l60 += 1; if (util) p60 += 1; }
  }
  const desdeRitmo = sumarDiasISO(hoy, -VENTANA_RITMO);
  const agendados = agendadosPorDia.filter((d) => d.dia > desdeRitmo && d.dia <= hoy).reduce((a, d) => a + d.n, 0);
  const ritmo = +(agendados / VENTANA_RITMO).toFixed(2);
  const fechas = [...porDia.keys()].sort();
  const primer = fechas[0] || null;
  const total = libres.length;
  let fechaLleno = null;
  if (ritmo > 0) {
    const dias = Math.ceil(total / ritmo);
    if (dias <= HORIZONTE_LLENADO) fechaLleno = sumarDiasISO(hoy, dias);
  }
  return {
    hoy,
    libres_30: l30, libres_60: l60, libres_total: total,
    libres_1230_30: p30, libres_1230_60: p60,
    ritmo_diario: ritmo, agendados_30: agendados,
    fecha_lleno: fechaLleno,
    primer_cupo: primer,
    dias_hasta_primer_cupo: primer ? diasEntre(hoy, primer) : null,
    por_dia: fechas.filter((f) => f < lim60).map((fecha) => ({ fecha, libres: porDia.get(fecha) })),
  };
}

// ---------- Carga por examinador ----------
const UMBRAL_DESBALANCE = 20;
// rows: [{examinador, fecha}] del periodo; proximas: [{examinador, n}] proximos 30 dias.
function cargaExaminadores(rows, proximas = []) {
  const m = new Map();
  const get = (k) => {
    if (!m.has(k)) m.set(k, { examinador: k, citas: 0, fechas: new Set(), proximas_30: 0 });
    return m.get(k);
  };
  for (const r of rows) { const g = get(r.examinador || SIN_DATO); g.citas += 1; if (r.fecha) g.fechas.add(r.fecha); }
  for (const p of proximas) get(p.examinador || SIN_DATO).proximas_30 += p.n || 0;
  const total = rows.length;
  const n = m.size;
  if (!n) return { filas: [], promedio: 0, total: 0, desbalanceados: 0, umbral: UMBRAL_DESBALANCE };
  const promedio = r1(total / n);
  const filas = [...m.values()].map((g) => {
    const desv = promedio ? r1((g.citas - promedio) / promedio * 100) : 0;
    let desbalance = null;
    if (total && desv > UMBRAL_DESBALANCE) desbalance = 'alto';
    else if (total && desv < -UMBRAL_DESBALANCE) desbalance = 'bajo';
    return {
      examinador: g.examinador, citas: g.citas, participacion: pct(g.citas, total),
      dias_trabajados: g.fechas.size, citas_por_dia: g.fechas.size ? r1(g.citas / g.fechas.size) : 0,
      desviacion: desv, desbalance, proximas_30: g.proximas_30,
    };
  }).sort((a, b) => b.citas - a.citas || a.examinador.localeCompare(b.examinador));
  return { filas, promedio, total, desbalanceados: filas.filter((f) => f.desbalance).length, umbral: UMBRAL_DESBALANCE };
}

module.exports = {
  proyeccionCapacidad, cargaExaminadores,
  periodoAnterior, deltas, aprobacionPorClase, aprobacionPorIntento, inasistenciaDiaHora, tiempoEspera, tramitesVencidos, sumarMeses,
};
