-- Intentos fallidos de login por IP: limita la fuerza bruta de claves/PIN. Un Worker no
-- comparte memoria entre isolates, asi que el contador vive en D1.
CREATE TABLE IF NOT EXISTS login_intentos (
  ip              TEXT PRIMARY KEY,
  fallos          INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta INTEGER NOT NULL DEFAULT 0   -- epoch en milisegundos
);
