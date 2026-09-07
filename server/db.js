'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH, EXAMINADORES, FUNCIONARIOS, CATALOGOS } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Migracion ligera para bases creadas antes de agregar columnas.
function asegurarColumna(tabla, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${ddl}`);
}
asegurarColumna('agenda', 'bloqueado', 'bloqueado INTEGER NOT NULL DEFAULT 0');
asegurarColumna('agenda', 'bloqueo_motivo', 'bloqueo_motivo TEXT');
asegurarColumna('agenda', 'pendiente_reagendar', 'pendiente_reagendar INTEGER NOT NULL DEFAULT 0');
asegurarColumna('agenda', 'pendiente_nota', 'pendiente_nota TEXT');
asegurarColumna('movimientos', 'actor', 'actor TEXT');

// --- Semillas (solo si faltan) ---
function seed() {
  const insExam = db.prepare('INSERT OR IGNORE INTO examinadores (nombre) VALUES (?)');
  EXAMINADORES.forEach((n) => insExam.run(n));

  const insFun = db.prepare('INSERT OR IGNORE INTO funcionarios (nombre) VALUES (?)');
  FUNCIONARIOS.forEach((n) => insFun.run(n));

  const insCat = db.prepare('INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES (?, ?, ?)');
  for (const [tipo, valores] of Object.entries(CATALOGOS)) {
    valores.forEach((v, i) => insCat.run(tipo, v, i));
  }
}
seed();

// Helpers de acceso rapido a catalogos por nombre.
function examinadorId(nombre) {
  const row = db.prepare('SELECT id FROM examinadores WHERE nombre = ?').get(nombre);
  return row ? row.id : null;
}
function funcionarioId(nombre) {
  if (!nombre) return null;
  const row = db.prepare('SELECT id FROM funcionarios WHERE nombre = ?').get(nombre);
  return row ? row.id : null;
}
function upsertFuncionario(nombre) {
  if (!nombre) return null;
  db.prepare('INSERT OR IGNORE INTO funcionarios (nombre) VALUES (?)').run(nombre);
  return funcionarioId(nombre);
}
function upsertExaminador(nombre) {
  if (!nombre) return null;
  db.prepare('INSERT OR IGNORE INTO examinadores (nombre) VALUES (?)').run(nombre);
  return examinadorId(nombre);
}

// node:sqlite no trae helper de transacciones: lo implementamos a mano.
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

function log(agendaId, accion, detalle, actor) {
  db.prepare('INSERT INTO movimientos (agenda_id, accion, detalle, actor) VALUES (?, ?, ?, ?)')
    .run(agendaId ?? null, accion, detalle ? String(detalle) : null, actor || null);
}

module.exports = { db, tx, examinadorId, funcionarioId, upsertFuncionario, upsertExaminador, log };
