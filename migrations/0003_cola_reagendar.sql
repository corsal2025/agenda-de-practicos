-- Cola de reagendamiento: personas que quedaron sin hora porque su bloque se
-- bloqueo (licencia, dia administrativo, terreno...). Se asignan a un cupo
-- libre desde la pestana Reagendar.
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
  motivo               TEXT,             -- motivo del bloqueo que la desplazo
  estado               TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | reagendado | descartado
  destino_agenda_id    INTEGER,
  creado_por           TEXT,
  creado_en            TEXT NOT NULL,
  resuelto_en          TEXT
);
CREATE INDEX IF NOT EXISTS idx_cola_reagendar_estado ON cola_reagendar(estado);
