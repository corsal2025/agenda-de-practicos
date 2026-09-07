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

module.exports = { set, refrescar, listar, agregar, quitar };
