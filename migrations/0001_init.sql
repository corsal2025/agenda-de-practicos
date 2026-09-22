-- Esquema D1 de la agenda de practicos.
-- Reemplaza server/schema.sql + la migracion en runtime de server/db.js (asegurarColumna)
-- + el seed() de examinadores/funcionarios/catalogos (server/config.js) y los feriados
-- semilla (server/fechas.js FERIADOS_SEMILLA). Sin PRAGMA journal_mode/foreign_keys:
-- no aplican a D1. Los DEFAULT datetime('now') quedan solo como red de seguridad; la
-- app siempre manda el valor explicito calculado con ahoraChile() (worker/lib/fechas.js).

CREATE TABLE IF NOT EXISTS examinadores (
  id     INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS funcionarios (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  activo      INTEGER NOT NULL DEFAULT 1,
  usuario     TEXT,
  clave_hash  TEXT,
  rol         TEXT NOT NULL DEFAULT 'staff'
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
  id                          INTEGER PRIMARY KEY,
  fecha                       TEXT NOT NULL,             -- YYYY-MM-DD
  hora                        TEXT NOT NULL,             -- HH:MM
  examinador_id               INTEGER NOT NULL REFERENCES examinadores(id),
  rut                         TEXT,
  nombre                      TEXT,
  clase                       TEXT,
  contacto                    TEXT,
  correo                      TEXT,
  tipo_cita                   TEXT,
  motivo_reagendamiento       TEXT,
  lista_espera                TEXT,
  intento                     TEXT,
  funcionario_id              INTEGER REFERENCES funcionarios(id),
  fecha_inicio_tramite        TEXT,
  confirmo_asistencia         INTEGER,                   -- 0 | 1 | NULL
  resultado                   TEXT,
  comentarios                 TEXT,
  bloqueado                   INTEGER NOT NULL DEFAULT 0, -- 1 = bloque no disponible (terreno, feriado, dia admin...)
  bloqueo_motivo              TEXT,
  pendiente_reagendar         INTEGER NOT NULL DEFAULT 0, -- 1 = cita marcada para reagendar
  pendiente_nota               TEXT,
  correo_confirmacion_enviado INTEGER NOT NULL DEFAULT 0,
  correo_recordatorio_enviado INTEGER NOT NULL DEFAULT 0,
  token_confirmacion          TEXT,
  agendado_en                 TEXT,                      -- timestamp de la primera vez que se ocupo
  creado_en                   TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fecha, hora, examinador_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_fecha ON agenda(fecha);
CREATE INDEX IF NOT EXISTS idx_agenda_rut   ON agenda(rut);
CREATE INDEX IF NOT EXISTS idx_agenda_exam  ON agenda(examinador_id);
CREATE INDEX IF NOT EXISTS idx_agenda_agend ON agenda(agendado_en);

-- Bitacora de cambios operativos.
CREATE TABLE IF NOT EXISTS movimientos (
  id        INTEGER PRIMARY KEY,
  agenda_id INTEGER,
  accion    TEXT NOT NULL,   -- agendar | editar | reagendar | liberar | generar | importar
  detalle   TEXT,
  actor     TEXT,            -- funcionario/a que hizo el cambio (de la sesion)
  ts        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Feriados / dias inhabiles. Editables desde la pestana Datos.
CREATE TABLE IF NOT EXISTS feriados (
  fecha  TEXT PRIMARY KEY,  -- YYYY-MM-DD
  nombre TEXT
);

-- Papelera: guarda el contenido de un bloque justo antes de liberarlo o pisarlo.
CREATE TABLE IF NOT EXISTS papelera (
  id         INTEGER PRIMARY KEY,
  agenda_id  INTEGER NOT NULL,
  datos      TEXT NOT NULL,   -- JSON con los campos de la cita
  motivo     TEXT,            -- liberar | reagendar | sobrescribir | bloquear | bloquear-dia
  actor      TEXT,
  ts         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Semillas ----------
-- Examinadores (server/config.js EXAMINADORES)
INSERT OR IGNORE INTO examinadores (nombre) VALUES
  ('DANIEL LAGOS'), ('DOMINGO NAVARRO'), ('LUIS FERNANDEZ');

-- Funcionarios (server/config.js FUNCIONARIOS)
INSERT OR IGNORE INTO funcionarios (nombre) VALUES
  ('CAROLINA CUADRA'), ('JARED LOPEZ'), ('SUSANA CAMPANA'), ('MATIAS BOZZO');

-- Catalogos (server/config.js CATALOGOS)
INSERT OR IGNORE INTO catalogos (tipo, valor, orden) VALUES
  ('clase', 'B', 0), ('clase', 'C', 1), ('clase', 'D', 2), ('clase', 'A1', 3),
  ('clase', 'A2', 4), ('clase', 'A3', 5), ('clase', 'A4', 6), ('clase', 'A5', 7), ('clase', 'E', 8),
  ('tipo_cita', 'NORMAL', 0), ('tipo_cita', 'REAGENDADO', 1), ('tipo_cita', 'TRASLADO EN TERRENO', 2),
  ('resultado', 'APROBADO', 0), ('resultado', 'REPROBADO', 1),
  ('resultado', 'REPROBADO INASISTENCIA', 2), ('resultado', 'NO ASISTIO', 3),
  ('intento', '1° VEZ', 0), ('intento', '2° VEZ', 1),
  ('lista_espera', 'SI', 0), ('lista_espera', 'NO', 1);

-- Feriados semilla (server/fechas.js FERIADOS_SEMILLA, 2026-2027)
INSERT OR IGNORE INTO feriados (fecha, nombre) VALUES
  ('2026-01-01', 'Feriado'), ('2026-04-03', 'Feriado'), ('2026-04-04', 'Feriado'),
  ('2026-05-01', 'Feriado'), ('2026-05-21', 'Feriado'), ('2026-06-20', 'Feriado'),
  ('2026-06-29', 'Feriado'), ('2026-07-16', 'Feriado'), ('2026-08-15', 'Feriado'),
  ('2026-09-18', 'Feriado'), ('2026-09-19', 'Feriado'), ('2026-10-12', 'Feriado'),
  ('2026-10-31', 'Feriado'), ('2026-11-01', 'Feriado'), ('2026-12-08', 'Feriado'),
  ('2026-12-25', 'Feriado'),
  ('2027-01-01', 'Feriado'), ('2027-03-26', 'Feriado'), ('2027-03-27', 'Feriado'),
  ('2027-05-01', 'Feriado'), ('2027-05-21', 'Feriado'), ('2027-06-21', 'Feriado'),
  ('2027-06-28', 'Feriado'), ('2027-07-16', 'Feriado'), ('2027-08-15', 'Feriado'),
  ('2027-09-18', 'Feriado'), ('2027-09-19', 'Feriado'), ('2027-10-11', 'Feriado'),
  ('2027-10-31', 'Feriado'), ('2027-11-01', 'Feriado'), ('2027-12-08', 'Feriado'),
  ('2027-12-25', 'Feriado');
