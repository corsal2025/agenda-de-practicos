-- Esquema de la agenda de practicos. Se aplica al iniciar el servidor (idempotente).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS examinadores (
  id     INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS funcionarios (
  id     INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);

-- Valores de listas desplegables, editables desde la pestana Datos.
CREATE TABLE IF NOT EXISTS catalogos (
  tipo   TEXT NOT NULL,   -- clase | tipo_cita | resultado | intento | lista_espera
  valor  TEXT NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tipo, valor)
);

-- Una fila por bloque de la agenda: (fecha, hora, examinador).
-- El bloque esta OCUPADO cuando tiene rut o nombre.
CREATE TABLE IF NOT EXISTS agenda (
  id                    INTEGER PRIMARY KEY,
  fecha                 TEXT NOT NULL,             -- YYYY-MM-DD
  hora                  TEXT NOT NULL,             -- HH:MM
  examinador_id         INTEGER NOT NULL REFERENCES examinadores(id),
  rut                   TEXT,
  nombre                TEXT,
  clase                 TEXT,
  contacto              TEXT,
  correo                TEXT,
  tipo_cita             TEXT,
  motivo_reagendamiento TEXT,
  lista_espera          TEXT,
  intento               TEXT,
  funcionario_id        INTEGER REFERENCES funcionarios(id),
  fecha_inicio_tramite  TEXT,
  confirmo_asistencia   INTEGER,                   -- 0 | 1 | NULL
  resultado             TEXT,
  comentarios           TEXT,
  bloqueado             INTEGER NOT NULL DEFAULT 0, -- 1 = bloque no disponible (terreno, feriado, dia admin...)
  bloqueo_motivo        TEXT,
  agendado_en           TEXT,                      -- timestamp de la primera vez que se ocupo
  creado_en             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizado_en        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (fecha, hora, examinador_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_fecha ON agenda(fecha);
CREATE INDEX IF NOT EXISTS idx_agenda_rut   ON agenda(rut);
CREATE INDEX IF NOT EXISTS idx_agenda_exam  ON agenda(examinador_id);

-- Bitacora de cambios operativos.
CREATE TABLE IF NOT EXISTS movimientos (
  id        INTEGER PRIMARY KEY,
  agenda_id INTEGER,
  accion    TEXT NOT NULL,   -- agendar | editar | reagendar | liberar | generar | importar
  detalle   TEXT,
  ts        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
