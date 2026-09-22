// Capa de acceso a datos sobre Cloudflare D1. Reemplaza server/db.js.
//
// Diferencias con la version node:sqlite:
// - D1 es 100% asincrono: toda funcion de aqui (y de quien la llame) es async.
// - No hay conexion "singleton" de modulo: cada handler recibe el binding D1
//   (`c.env.DB`) por request y lo pasa explicitamente a estas funciones.
// - No hay tx()/BEGIN-COMMIT manual: D1 expone `db.batch([...statements])`,
//   que ejecuta un array de Statements ya bindeados de forma atomica. El
//   helper `tx()` de aca abajo es un wrapper delgado sobre eso.
// - El schema (incluidas las columnas que antes se agregaban en runtime via
//   asegurarColumna) y el seed de examinadores/funcionarios/catalogos/feriados
//   viven en migrations/0001_init.sql, no en este archivo.
import { ahoraChile } from './fechas.js';

export async function examinadorId(db, nombre) {
  const row = await db.prepare('SELECT id FROM examinadores WHERE nombre = ?').bind(nombre).first();
  return row ? row.id : null;
}

export async function funcionarioId(db, nombre) {
  if (!nombre) return null;
  const row = await db.prepare('SELECT id FROM funcionarios WHERE nombre = ?').bind(nombre).first();
  return row ? row.id : null;
}

export async function upsertFuncionario(db, nombre) {
  if (!nombre) return null;
  await db.prepare('INSERT OR IGNORE INTO funcionarios (nombre) VALUES (?)').bind(nombre).run();
  return funcionarioId(db, nombre);
}

export async function upsertExaminador(db, nombre) {
  if (!nombre) return null;
  await db.prepare('INSERT OR IGNORE INTO examinadores (nombre) VALUES (?)').bind(nombre).run();
  return examinadorId(db, nombre);
}

// Ejecuta un array de D1PreparedStatement ya bindeados como una sola
// transaccion atomica (equivalente al tx(() => { ...stmt.run()... }) de
// node:sqlite, que no existe como tal en D1).
export async function tx(db, statements) {
  if (!statements.length) return [];
  return db.batch(statements);
}

export async function log(db, agendaId, accion, detalle, actor, ts) {
  await db.prepare('INSERT INTO movimientos (agenda_id, accion, detalle, actor, ts) VALUES (?, ?, ?, ?, ?)')
    .bind(agendaId ?? null, accion, detalle ? String(detalle) : null, actor || null, ts || ahoraChile())
    .run();
}
