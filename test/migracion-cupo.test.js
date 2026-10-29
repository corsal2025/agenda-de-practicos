'use strict';
// Migracion de bases anteriores a la columna cupo: agenda con UNIQUE (fecha, hora, examinador_id).
// Se arma una base con el esquema viejo, se carga db.js (que migra al abrir) y se verifica.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const DB_JS = path.join(RAIZ, 'server', 'db.js');
const tmpDb = path.join(os.tmpdir(), `agenda-migra-cupo-${Date.now()}.db`);
const tmpDbRota = path.join(os.tmpdir(), `agenda-migra-rota-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-migra-bk-'));
process.env.AGENDA_BACKUP_DIR = tmpBackups;
process.env.AGENDA_DB = tmpDb;

// Esquema anterior a cupo (solo lo necesario; db.js agrega las columnas que falten).
const ESQUEMA_VIEJO = `
PRAGMA foreign_keys = ON;
CREATE TABLE examinadores (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE funcionarios (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE agenda (
  id                    INTEGER PRIMARY KEY,
  fecha                 TEXT NOT NULL,
  hora                  TEXT NOT NULL,
  examinador_id         INTEGER NOT NULL REFERENCES examinadores(id),
  rut                   TEXT,
  nombre                TEXT,
  clase                 TEXT,
  funcionario_id        INTEGER REFERENCES funcionarios(id),
  confirmo_asistencia   INTEGER,
  resultado             TEXT,
  bloqueado             INTEGER NOT NULL DEFAULT 0,
  bloqueo_motivo        TEXT,
  agendado_en           TEXT,
  creado_en             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizado_en        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (fecha, hora, examinador_id)
);
CREATE INDEX idx_agenda_fecha ON agenda(fecha);
CREATE INDEX idx_agenda_rut   ON agenda(rut);
CREATE INDEX idx_agenda_exam  ON agenda(examinador_id);
CREATE INDEX idx_agenda_agend ON agenda(agendado_en);
CREATE TABLE movimientos (
  id INTEGER PRIMARY KEY, agenda_id INTEGER, accion TEXT NOT NULL, detalle TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

function crearBaseVieja(ruta, filasExtra = '') {
  const previa = new DatabaseSync(ruta);
  previa.exec(ESQUEMA_VIEJO);
  previa.exec(`
    INSERT INTO examinadores (id, nombre) VALUES (1, 'EXAMINADOR UNO');
    INSERT INTO funcionarios (id, nombre) VALUES (1, 'FUNCIONARIA UNO');
    INSERT INTO agenda (id, fecha, hora, examinador_id, rut, nombre, clase, funcionario_id, bloqueado, bloqueo_motivo) VALUES
      (1, '2030-05-06', '08:30', 1, '11.111.111-1', 'JUAN PEREZ', 'B', 1, 0, NULL),
      (2, '2030-05-06', '09:00', 1, NULL, NULL, NULL, NULL, 1, 'FERIADO'),
      (3, '2030-05-06', '09:30', 1, NULL, NULL, NULL, NULL, 0, NULL);
    INSERT INTO movimientos (agenda_id, accion, detalle) VALUES (1, 'agendar', 'prueba previa');
    ${filasExtra}
  `);
  previa.close();
}

// Ejecuta db.js en un proceso aparte (la migracion corre al cargar el modulo).
function cargarDbEnProceso(ruta) {
  return execFileSync(process.execPath, ['--no-warnings', '-e', `require(${JSON.stringify(DB_JS)})`], {
    env: { ...process.env, AGENDA_DB: ruta, AGENDA_BACKUP_DIR: tmpBackups },
    stdio: 'pipe',
  });
}

function limpiar(ruta) {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(ruta + s); } catch (_) {} }
}

crearBaseVieja(tmpDb);
// Carga en este proceso: aqui corre la migracion.
const { db } = require('../server/db');

const backupsPre = () => fs.readdirSync(tmpBackups).filter((f) => f.includes('pre-cupo'));

test.after(() => {
  db.close?.();
  limpiar(tmpDb);
  limpiar(tmpDbRota);
  fs.rmSync(tmpBackups, { recursive: true, force: true });
});

test('la migracion agrega cupo y deja todas las filas con cupo 1 y sus datos', () => {
  const columnas = db.prepare('PRAGMA table_info(agenda)').all().map((c) => c.name);
  assert.ok(columnas.includes('cupo'), 'agenda tiene la columna cupo');

  const filas = db.prepare('SELECT id, cupo, rut, nombre, bloqueado, funcionario_id FROM agenda ORDER BY id').all();
  assert.equal(filas.length, 3);
  assert.deepEqual(filas.map((f) => f.cupo), [1, 1, 1]);
  assert.equal(filas[0].rut, '11.111.111-1');
  assert.equal(filas[0].nombre, 'JUAN PEREZ');
  assert.equal(filas[0].funcionario_id, 1);
  assert.equal(filas[1].bloqueado, 1);
});

test('el UNIQUE nuevo permite cupo 2 en la misma hora y sigue rechazando cupo duplicado', () => {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, cupo, nombre) VALUES (?, ?, ?, ?, ?)')
    .run('2030-05-06', '08:30', 1, 2, 'SOBRECUPO');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agenda WHERE fecha = ? AND hora = ?').get('2030-05-06', '08:30').n, 2);

  assert.throws(() => db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, cupo) VALUES (?, ?, ?, ?)')
    .run('2030-05-06', '08:30', 1, 1));
});

test('las claves foraneas siguen validas y los indices quedan recreados', () => {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agenda'")
    .all().map((i) => i.name);
  for (const nombre of ['idx_agenda_fecha', 'idx_agenda_rut', 'idx_agenda_exam', 'idx_agenda_agend']) {
    assert.ok(indices.includes(nombre), `existe ${nombre}`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM movimientos').get().n, 1, 'la bitacora no se pierde');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign_keys vuelve a ON');
});

test('antes de migrar se guarda una copia con el esquema anterior en la carpeta de backups', () => {
  const copias = backupsPre();
  assert.equal(copias.length, 1);
  const copia = new DatabaseSync(path.join(tmpBackups, copias[0]));
  try {
    const columnas = copia.prepare('PRAGMA table_info(agenda)').all().map((c) => c.name);
    assert.ok(!columnas.includes('cupo'), 'la copia es del esquema anterior');
    assert.equal(copia.prepare('SELECT COUNT(*) n FROM agenda').get().n, 3);
  } finally {
    copia.close();
  }
});

test('volver a cargar db.js no migra de nuevo ni crea otra copia', () => {
  cargarDbEnProceso(tmpDb);

  assert.equal(backupsPre().length, 1);
  const lectura = new DatabaseSync(tmpDb);
  try {
    const cupos = lectura.prepare('SELECT cupo FROM agenda ORDER BY id').all().map((f) => f.cupo);
    assert.deepEqual(cupos, [1, 1, 1, 2]);
  } finally {
    lectura.close();
  }
});

test('si la migracion falla, se revierte y la base queda con el esquema anterior', () => {
  // Una fila con examinador inexistente: la verificacion de claves foraneas debe fallar.
  crearBaseVieja(tmpDbRota, "PRAGMA foreign_keys = OFF; INSERT INTO agenda (fecha, hora, examinador_id) VALUES ('2030-06-01', '08:30', 99);");

  assert.throws(() => cargarDbEnProceso(tmpDbRota));

  const r = new DatabaseSync(tmpDbRota);
  try {
    const columnas = r.prepare('PRAGMA table_info(agenda)').all().map((c) => c.name);
    assert.ok(!columnas.includes('cupo'), 'no quedo cupo a medias');
    const tablas = r.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    assert.ok(!tablas.includes('agenda_nueva'), 'no quedo la tabla temporal');
    assert.equal(r.prepare('SELECT COUNT(*) n FROM agenda').get().n, 4);
  } finally {
    r.close();
  }
});
