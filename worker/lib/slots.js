// Reemplaza server/slots.js. El bucle for(...) stmt.run() dentro de tx() pasa a
// juntar los INSERT OR IGNORE en un array y correrlos en lotes con db.batch()
// (mismo patron de TAMANO_LOTE/ejecutarPorLotes que worker/lib/migrate.js: un
// rango largo puede generar miles de statements, y mandarlos todos en un solo
// batch() es fragil -- ver el comentario de migrate.js para el detalle).
import { HORAS } from './config.js';
import { diasHabiles } from './fechas.js';
import * as feriados from './feriados.js';
import { log } from './db.js';

// D1 no soporta una transaccion que abarque varias llamadas a batch(). Si un
// lote falla a mitad de camino, los lotes anteriores ya quedaron guardados; la
// recuperacion es reintentar generar() con el mismo rango -- el INSERT OR
// IGNORE es idempotente, asi que no duplica bloques ya creados.
const TAMANO_LOTE = 50;
async function ejecutarPorLotes(db, statements) {
  const resultados = [];
  const totalLotes = Math.ceil(statements.length / TAMANO_LOTE) || 0;
  for (let i = 0; i < statements.length; i += TAMANO_LOTE) {
    const indiceLote = i / TAMANO_LOTE;
    try {
      const r = await db.batch(statements.slice(i, i + TAMANO_LOTE));
      resultados.push(...r);
    } catch (err) {
      console.error(`generar: fallo el lote ${indiceLote + 1}/${totalLotes} (statements ${i}-${Math.min(i + TAMANO_LOTE, statements.length) - 1}):`, err);
      throw errorUsuario(
        `La generacion de bloques fallo en el lote ${indiceLote + 1} de ${totalLotes}. Los lotes ` +
        `anteriores a este ya quedaron guardados. Es seguro reintentar: el INSERT OR IGNORE es ` +
        `idempotente y no duplica bloques ya creados. Detalle: ${err && err.message}`
      );
    }
  }
  return resultados;
}

// Crea los bloques (fecha, hora, examinador) que falten en el rango dado,
// para todos los examinadores activos. No toca los bloques existentes.
export async function generar(db, desde, hasta) {
  const { results: examinadores } = await db.prepare('SELECT id FROM examinadores WHERE activo = 1').all();
  const feriadosSet = await feriados.set(db);
  const dias = diasHabiles(desde, hasta, feriadosSet);

  const stmts = [];
  for (const dia of dias) {
    for (const hora of HORAS) {
      for (const ex of examinadores) {
        stmts.push(db.prepare('INSERT OR IGNORE INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').bind(dia, hora, ex.id));
      }
    }
  }

  let creados = 0;
  if (stmts.length) {
    const resultados = await ejecutarPorLotes(db, stmts);
    creados = resultados.reduce((acc, r) => acc + Number((r.meta && r.meta.changes) || 0), 0);
  }
  await log(db, null, 'generar', `${desde}..${hasta}: ${creados} bloques nuevos`);
  return { dias: dias.length, creados };
}

// Error con estado HTTP 422: el mensaje (que explica si el lote quedo parcial y como reintentar)
// debe llegar a la UI; los errores sin estado se ocultan tras un texto generico.
function errorUsuario(msg) { const e = new Error(msg); e.status = 422; return e; }
