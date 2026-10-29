'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH, EXAMINADORES, FUNCIONARIOS, CATALOGOS } = require('./config');
const { DIR: DIR_BACKUPS } = require('./backup');
const { ahoraTS } = require('./fechas');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
db.exec(`
CREATE TABLE IF NOT EXISTS cola_reagendar (
  id                   INTEGER PRIMARY KEY,
  rut                  TEXT,
  nombre               TEXT,
  clase                TEXT,
  contacto             TEXT,
  correo               TEXT,
  intento              TEXT,
  lista_espera         TEXT,
  funcionario_id       INTEGER,
  fecha_inicio_tramite TEXT,
  comentarios          TEXT,
  origen_agenda_id     INTEGER,
  origen_fecha         TEXT,
  origen_hora          TEXT,
  origen_examinador_id INTEGER,
  motivo               TEXT,
  estado               TEXT NOT NULL DEFAULT 'pendiente',
  destino_agenda_id    INTEGER,
  creado_por           TEXT,
  creado_en            TEXT NOT NULL,
  resuelto_en          TEXT
);
CREATE INDEX IF NOT EXISTS idx_cola_reagendar_estado ON cola_reagendar(estado);
`);

// Migracion ligera para bases creadas antes de agregar columnas.
function asegurarColumna(tabla, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${ddl}`);
}
asegurarColumna('agenda', 'bloqueado', 'bloqueado INTEGER NOT NULL DEFAULT 0');
asegurarColumna('agenda', 'bloqueo_motivo', 'bloqueo_motivo TEXT');
asegurarColumna('agenda', 'pendiente_reagendar', 'pendiente_reagendar INTEGER NOT NULL DEFAULT 0');
asegurarColumna('agenda', 'pendiente_nota', 'pendiente_nota TEXT');
asegurarColumna('agenda', 'correo_confirmacion_enviado', 'correo_confirmacion_enviado INTEGER NOT NULL DEFAULT 0');
asegurarColumna('agenda', 'correo_recordatorio_enviado', 'correo_recordatorio_enviado INTEGER NOT NULL DEFAULT 0');
asegurarColumna('agenda', 'token_confirmacion', 'token_confirmacion TEXT');
asegurarColumna('agenda', 'escuela_conductores', 'escuela_conductores TEXT');
// Medios por los que se aviso al postulante: lista separada por comas (telefono, whatsapp, correo).
asegurarColumna('agenda', 'avisado_por', 'avisado_por TEXT');
// Columna creada con un typo en una version anterior: copiar sus datos una sola vez.
if (db.prepare('PRAGMA table_info(agenda)').all().some((c) => c.name === 'escuela_condutores')) {
  db.exec('UPDATE agenda SET escuela_conductores = escuela_condutores WHERE escuela_conductores IS NULL AND escuela_condutores IS NOT NULL');
}
asegurarColumna('agenda', 'tipo_reagendamiento', 'tipo_reagendamiento TEXT');
asegurarColumna('examinadores', 'eliminado', 'eliminado INTEGER NOT NULL DEFAULT 0');
// Si habia examinadores previamente desactivados (como el duplicado ANGELO IBANI con activo = 0), marcarlos eliminado = 1
db.exec("UPDATE examinadores SET eliminado = 1 WHERE activo = 0 AND (eliminado = 0 OR eliminado IS NULL)");
asegurarColumna('movimientos', 'actor', 'actor TEXT');
asegurarColumna('funcionarios', 'usuario', 'usuario TEXT');
asegurarColumna('funcionarios', 'clave_hash', 'clave_hash TEXT');
asegurarColumna('funcionarios', 'rol', "rol TEXT NOT NULL DEFAULT 'staff'");

// --- Migracion: cupo (varias personas en la misma hora) ---
// Bases anteriores tienen UNIQUE (fecha, hora, examinador_id) y no tienen cupo. Se reconstruye
// la tabla con el UNIQUE nuevo y cupo = 1 para todas las filas existentes. Idempotente: si ya
// existe cupo no hace nada. Las columnas se copian desde la base vieja, sin listarlas a mano.
const INDICES_AGENDA = [
  'CREATE INDEX IF NOT EXISTS idx_agenda_fecha ON agenda(fecha)',
  'CREATE INDEX IF NOT EXISTS idx_agenda_rut   ON agenda(rut)',
  'CREATE INDEX IF NOT EXISTS idx_agenda_exam  ON agenda(examinador_id)',
  'CREATE INDEX IF NOT EXISTS idx_agenda_agend ON agenda(agendado_en)',
];

// DDL de agenda_nueva: mismas columnas que la tabla vieja + cupo y el UNIQUE nuevo.
function ddlAgendaNueva(columnas, fks) {
  const defs = columnas.map((c) => {
    const partes = [c.name, c.type];
    if (c.pk) partes.push('PRIMARY KEY');
    if (c.notnull) partes.push('NOT NULL');
    // PRAGMA devuelve la expresion sin parentesis (datetime(...)): SQLite los exige en DEFAULT.
    if (c.dflt_value !== null) partes.push(`DEFAULT (${c.dflt_value})`);
    const fk = fks.find((f) => f.from === c.name);
    if (fk) partes.push(`REFERENCES ${fk.table}${fk.to ? `(${fk.to})` : ''}`);
    return partes.filter(Boolean).join(' ');
  });
  defs.push('cupo INTEGER NOT NULL DEFAULT 1');
  defs.push('UNIQUE (fecha, hora, examinador_id, cupo)');
  return `CREATE TABLE agenda_nueva (\n  ${defs.join(',\n  ')}\n)`;
}

function copiaPreCupo() {
  fs.mkdirSync(DIR_BACKUPS, { recursive: true });
  // En WAL, copiar solo el .db puede dejar fuera cambios que siguen en el -wal: se vuelcan antes.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const base = `agenda-${ahoraTS().replace(' ', 'T').replace(/:/g, '-')}-pre-cupo`;
  let destino = path.join(DIR_BACKUPS, `${base}.db`);
  for (let n = 2; fs.existsSync(destino); n++) destino = path.join(DIR_BACKUPS, `${base}-${n}.db`);
  fs.copyFileSync(DB_PATH, destino);
  return destino;
}

function migrarCupoAgenda() {
  const columnas = db.prepare('PRAGMA table_info(agenda)').all();
  if (columnas.some((c) => c.name === 'cupo')) return;

  copiaPreCupo();
  const fks = db.prepare('PRAGMA foreign_key_list(agenda)').all();
  const lista = columnas.map((c) => c.name).join(', ');

  // foreign_keys no se puede cambiar dentro de una transaccion: se apaga antes y se restaura al final.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    try {
      db.exec('DROP TABLE IF EXISTS agenda_nueva');
      db.exec(ddlAgendaNueva(columnas, fks));
      db.exec(`INSERT INTO agenda_nueva (${lista}, cupo) SELECT ${lista}, 1 FROM agenda`);
      db.exec('DROP TABLE agenda');
      db.exec('ALTER TABLE agenda_nueva RENAME TO agenda');
      for (const sql of INDICES_AGENDA) db.exec(sql);
      const huerfanas = db.prepare('PRAGMA foreign_key_check').all();
      if (huerfanas.length) throw new Error(`Migracion de agenda: ${huerfanas.length} clave(s) foranea(s) invalida(s)`);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrarCupoAgenda();

// Purga automatica de bloques vacios de 08:30 desde el 9 de noviembre de 2026
function purgarHoras0830Inactivas() {
  try {
    db.exec(`
      DELETE FROM agenda 
      WHERE fecha >= '2026-11-09' 
        AND hora = '08:30' 
        AND (rut IS NULL OR trim(rut) = '') 
        AND (nombre IS NULL OR trim(nombre) = '') 
        AND (bloqueado = 0 OR bloqueado IS NULL)
    `);
  } catch (_) {}
}
purgarHoras0830Inactivas();

// --- Semillas (solo si faltan) ---
function seed() {
  const insExam = db.prepare('INSERT OR IGNORE INTO examinadores (nombre) VALUES (?)');
  EXAMINADORES.forEach((n) => insExam.run(n));

  const insFun = db.prepare('INSERT OR IGNORE INTO funcionarios (nombre) VALUES (?)');
  FUNCIONARIOS.forEach((n) => insFun.run(n));

  const insCat = db.prepare('INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES (?, ?, ?)');
  const upsertCat = db.prepare(`
    INSERT INTO catalogos (tipo, valor, orden, activo) VALUES (?, ?, ?, 1)
    ON CONFLICT(tipo, valor) DO UPDATE SET orden = excluded.orden, activo = 1
  `);
  for (const [tipo, valores] of Object.entries(CATALOGOS)) {
    valores.forEach((v, i) => {
      if (tipo === 'tipo_cita') {
        upsertCat.run(tipo, v, i);
      } else {
        insCat.run(tipo, v, i);
      }
    });
  }
  if (CATALOGOS.tipo_cita && CATALOGOS.tipo_cita.length) {
    const placeholders = CATALOGOS.tipo_cita.map(() => '?').join(',');
    db.prepare(`UPDATE catalogos SET activo = 0 WHERE tipo = 'tipo_cita' AND valor NOT IN (${placeholders})`).run(...CATALOGOS.tipo_cita);
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
// Reentrante: un tx() llamado desde dentro de otro tx() (por ejemplo migrate.js llamando a
// generar(), que tiene su propio tx) no abre una segunda transaccion (SQLite no permite anidarlas
// en la misma conexion): se ejecuta dentro de la que ya esta abierta y la cierra quien la abrio.
let txAnidado = 0;
function tx(fn) {
  if (txAnidado > 0) return fn();
  db.exec('BEGIN');
  txAnidado++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    txAnidado--;
  }
}

// --- Migracion: Bloqueos y notas administrativas guardadas como texto en RUT/nombre ---
function migrarBloqueosTexto() {
  const rows = db.prepare(`
    SELECT id, rut, nombre, bloqueo_motivo
    FROM agenda
    WHERE (bloqueado = 0 OR bloqueado IS NULL)
      AND (
        rut LIKE '%VACACION%' OR nombre LIKE '%VACACION%'
        OR rut LIKE '%LICENCIA%' OR nombre LIKE '%LICENCIA%'
        OR rut LIKE '%ADMINISTRATIVO%' OR nombre LIKE '%ADMINISTRATIVO%'
        OR rut LIKE '%FERIADO%' OR nombre LIKE '%FERIADO%'
        OR rut LIKE '%BLOQUE%' OR nombre LIKE '%BLOQUE%'
        OR rut LIKE '%PERMISO%' OR nombre LIKE '%PERMISO%'
        OR rut LIKE '%TERRENO%' OR nombre LIKE '%TERRENO%'
        OR rut LIKE '%TRASLADO%' OR nombre LIKE '%TRASLADO%'
        OR rut LIKE '%CAPACITA%' OR nombre LIKE '%CAPACITA%'
        OR rut LIKE '%COMETIDO%' OR nombre LIKE '%COMETIDO%'
        OR rut LIKE '%SUSPENDID%' OR nombre LIKE '%SUSPENDID%'
        OR rut LIKE '%COMPENSATORIO%' OR nombre LIKE '%COMPENSATORIO%'
      )
  `).all();
  if (rows.length) {
    const upd = db.prepare(`
      UPDATE agenda
      SET bloqueado = 1,
          bloqueo_motivo = ?,
          rut = NULL,
          nombre = NULL,
          actualizado_en = datetime('now', 'localtime')
      WHERE id = ?
    `);

    tx(() => {
      for (const r of rows) {
        let motivo = r.bloqueo_motivo;
        const texto = `${r.rut || ''} ${r.nombre || ''}`.toUpperCase();
        if (!motivo) {
          if (texto.includes('VACACION')) motivo = 'VACACIONES';
          else if (texto.includes('LICENCIA')) motivo = 'LICENCIA MEDICA';
          else if (texto.includes('ADMINISTRATIVO')) motivo = 'PERMISO ADMINISTRATIVO';
          else if (texto.includes('FERIADO')) motivo = 'FERIADO LEGAL';
          else if (texto.includes('TRASLADO') || texto.includes('TERRENO')) motivo = 'TERRENO';
          else if (texto.includes('PERMISO')) motivo = 'PERMISO';
          else if (texto.includes('CAPACITA')) motivo = 'CAPACITACION';
          else if (texto.includes('COMETIDO')) motivo = 'COMETIDO';
          else if (texto.includes('COMPENSATORIO')) motivo = 'COMPENSATORIO';
          else if (texto.includes('SUSPENDID')) motivo = 'SUSPENDIDO';
          else motivo = 'BLOQUEADO';
        }
        upd.run(motivo, r.id);
      }
    });
  }

  // Garantizar que ningún bloque inhabilitado mantenga residuos de RUT o nombre
  db.prepare(`
    UPDATE agenda
    SET rut = NULL,
        nombre = NULL
    WHERE bloqueado = 1
      AND (rut IS NOT NULL OR nombre IS NOT NULL)
  `).run();
}
migrarBloqueosTexto();

function log(agendaId, accion, detalle, actor) {
  db.prepare('INSERT INTO movimientos (agenda_id, accion, detalle, actor) VALUES (?, ?, ?, ?)')
    .run(agendaId ?? null, accion, detalle ? String(detalle) : null, actor || null);
}

module.exports = { db, tx, examinadorId, funcionarioId, upsertFuncionario, upsertExaminador, log };
