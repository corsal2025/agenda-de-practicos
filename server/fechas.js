'use strict';

// Semilla de feriados de Chile (dias inhabiles). Best-effort 2026-2027.
// En runtime los feriados viven en la tabla `feriados` (editable desde la pestana Datos);
// esta lista solo se usa para poblarla la primera vez. El generador de bloques omite
// sabados, domingos y los feriados vigentes.
const FERIADOS_SEMILLA = [
  // 2026
  '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21',
  '2026-06-20', '2026-06-29', '2026-07-16', '2026-08-15', '2026-09-18',
  '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08',
  '2026-12-25',
  // 2027
  '2027-01-01', '2027-03-26', '2027-03-27', '2027-05-01', '2027-05-21',
  '2027-06-21', '2027-06-28', '2027-07-16', '2027-08-15', '2027-09-18',
  '2027-09-19', '2027-10-11', '2027-10-31', '2027-11-01', '2027-12-08',
  '2027-12-25',
];

function iso(d) {
  return d.toISOString().slice(0, 10);
}

// Convierte varias formas (Date, serial Excel, 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD/MM/YYYY') a 'YYYY-MM-DD'.
function aISO(valor) {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date && !isNaN(valor)) return iso(valor);
  if (typeof valor === 'number') {
    // serial de Excel (dias desde 1899-12-30)
    const ms = Math.round((valor - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d) ? null : iso(d);
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d) ? null : iso(d);
}

// 'HH:MM' desde Date, serial (fraccion de dia), 'HH:MM[:SS]' o texto con hora embebida.
function aHora(valor) {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date && !isNaN(valor)) {
    return `${String(valor.getHours()).padStart(2, '0')}:${String(valor.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof valor === 'number') {
    const frac = valor - Math.floor(valor);
    const totalMin = Math.round(frac * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const mm = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const s = String(valor);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}

function esHabil(isoFecha, feriados) {
  const set = feriados || new Set(FERIADOS_SEMILLA);
  const d = new Date(`${isoFecha}T12:00:00`);
  const dow = d.getDay(); // 0 dom .. 6 sab
  if (dow === 0 || dow === 6) return false;
  if (set.has(isoFecha)) return false;
  return true;
}

// Lista de dias habiles entre dos ISO (inclusive). `feriados` es un Set opcional de ISO.
function diasHabiles(desde, hasta, feriados) {
  const set = feriados || new Set(FERIADOS_SEMILLA);
  const out = [];
  const d = new Date(`${desde}T12:00:00`);
  const fin = new Date(`${hasta}T12:00:00`);
  while (d <= fin) {
    const s = iso(d);
    if (esHabil(s, set)) out.push(s);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { FERIADOS_SEMILLA, aISO, aHora, esHabil, diasHabiles, hoyISO };
