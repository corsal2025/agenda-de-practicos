'use strict';
const { db } = require('./db');
const { FERIADOS_SEMILLA } = require('./fechas');

// Siembra la tabla la primera vez.
const hay = db.prepare('SELECT COUNT(*) n FROM feriados').get().n;
if (!hay) {
  const ins = db.prepare('INSERT OR IGNORE INTO feriados (fecha, nombre) VALUES (?, ?)');
  for (const f of FERIADOS_SEMILLA) ins.run(f, 'Feriado');
}

let cache = null;
function set() {
  if (!cache) cache = new Set(db.prepare('SELECT fecha FROM feriados').all().map((r) => r.fecha));
  return cache;
}
function refrescar() { cache = null; }

function listar() {
  return db.prepare('SELECT fecha, nombre FROM feriados ORDER BY fecha').all();
}
function agregar(fecha, nombre) {
  db.prepare('INSERT OR REPLACE INTO feriados (fecha, nombre) VALUES (?, ?)').run(fecha, nombre || 'Feriado');
  refrescar();
}
function quitar(fecha) {
  db.prepare('DELETE FROM feriados WHERE fecha = ?').run(fecha);
  refrescar();
}

// ---------- Sincronizacion con API publica de feriados de Chile ----------
const FUENTES = [
  (anio) => `https://apis.digital.gob.cl/fl/feriados/${anio}`,
  (anio) => `https://api.boostr.cl/holidays/${anio}.json`,
];
const TIMEOUT_MS = 8000;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Acepta [{fecha,nombre}] (digital.gob.cl) o {data:[{date,title}]} (boostr). Descarta lo invalido.
function parsear(json, anio) {
  const lista = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : []);
  const out = [];
  for (const it of lista) {
    if (!it || typeof it !== 'object') continue;
    const fecha = String(it.fecha || it.date || '').slice(0, 10);
    if (!RE_FECHA.test(fecha) || (anio && !fecha.startsWith(`${anio}-`))) continue;
    const nombre = String(it.nombre || it.title || 'Feriado').trim().slice(0, 120) || 'Feriado';
    out.push({ fecha, nombre });
  }
  return out;
}

async function bajarJson(url, fetcher) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetcher(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'agenda-practicos' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Inserta los feriados que falten (nunca borra los manuales). Lanza si ninguna fuente responde.
async function sincronizar(anio, fetcher = globalThis.fetch) {
  const a = Number(anio) || new Date().getFullYear();
  let ultimoError = null;
  for (const fuente of FUENTES) {
    const url = fuente(a);
    try {
      const lista = parsear(await bajarJson(url, fetcher), a);
      if (!lista.length) { ultimoError = new Error('respuesta vacia'); continue; }
      const ins = db.prepare('INSERT OR IGNORE INTO feriados (fecha, nombre) VALUES (?, ?)');
      let agregados = 0;
      for (const f of lista) agregados += ins.run(f.fecha, f.nombre).changes;
      refrescar();
      return { agregados, total: lista.length, fuente: new URL(url).host };
    } catch (e) { ultimoError = e; }
  }
  const err = new Error(`Sin conexion: carga manual disponible (${ultimoError ? ultimoError.message : 'sin fuentes'})`);
  err.status = 502;
  throw err;
}

function cantidadAnio(anio) {
  return db.prepare('SELECT COUNT(*) n FROM feriados WHERE fecha LIKE ?').get(`${anio}-%`).n;
}

module.exports = { set, refrescar, listar, agregar, quitar, sincronizar, parsear, cantidadAnio };
