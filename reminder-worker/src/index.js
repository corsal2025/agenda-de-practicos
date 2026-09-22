// Worker satelite: reemplaza el setInterval horario de server/recordatorios.js
// con un Cron Trigger de Cloudflare (ver reminder-worker/wrangler.toml). No
// expone rutas HTTP publicas, solo el handler scheduled(). Comparte la misma
// base D1 que la app principal (mismo binding DB, mismo database_id).
//
// Importa directo de worker/lib/ (no se duplica logica): wrangler empaqueta
// cada Worker por separado, asi que este import relativo se resuelve y
// empaqueta bien en el build de este Worker satelite.
import { habilitado, recordatorio } from '../../worker/lib/correo.js';
import { hoyISOChile } from '../../worker/lib/fechas.js';

// 'mañana' en fecha de Chile (no en UTC): mismo cuidado que el resto de la app
// con el hallazgo #3 del plan (datetime/fecha "local" se rompe en silencio bajo D1).
function mananaISOChile() {
  const [y, m, d] = hoyISOChile().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

const SELECT = `
  SELECT a.*, e.nombre AS examinador
  FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.fecha = ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
    AND a.correo IS NOT NULL AND a.correo != '' AND a.correo_recordatorio_enviado = 0
`;

function tokenAleatorio() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Manda el recordatorio a todas las citas de mañana con correo pendiente.
// Idempotente: cada fila enviada se marca, asi corra una o diez veces no duplica.
export async function enviarPendientes(env) {
  const db = env.DB;
  if (!habilitado(env)) {
    // Sin RESEND_API_KEY configurado en ESTE Worker (los secrets no se comparten
    // con el Pages principal, ver wrangler.toml), el cron corre pero no manda
    // nada. Se deja visible en `wrangler tail`/el dashboard en vez de fallar en
    // silencio total con solo "enviados: 0" que se puede confundir con "no hay
    // citas mañana".
    console.warn('Recordatorios: RESEND_API_KEY no configurado en este Worker -- recordatorios no se envian.');
    return { enviados: 0, habilitado: false };
  }
  const { results: filas } = await db.prepare(SELECT).bind(mananaISOChile()).all();
  let enviados = 0;
  for (const bloque of filas) {
    if (!bloque.token_confirmacion) {
      bloque.token_confirmacion = tokenAleatorio();
      await db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?')
        .bind(bloque.token_confirmacion, bloque.id).run();
    }
    const ok = await recordatorio(env, db, bloque);
    if (ok) {
      await db.prepare('UPDATE agenda SET correo_recordatorio_enviado = 1 WHERE id = ?').bind(bloque.id).run();
      enviados++;
    }
  }
  return { enviados, habilitado: true, revisados: filas.length };
}

export default {
  async scheduled(event, env, ctx) {
    // Si falta el binding DB (D1 mal configurado o database_id que no coincide
    // con el wrangler.toml de la raiz, ver el comentario en reminder-worker/
    // wrangler.toml), fallar fuerte y visible en vez de dejar que el resto del
    // handler intente usar env.DB y explote con un error críptico mas abajo, o
    // -- peor -- que alguna rama silenciosa devuelva 0 sin dejar rastro.
    if (!env.DB) {
      throw new Error('Recordatorios: falta el binding DB (D1) en este Worker -- revisa reminder-worker/wrangler.toml y que su database_id sea el mismo que el del wrangler.toml de la raiz.');
    }
    ctx.waitUntil(
      enviarPendientes(env).catch((e) => console.error('Recordatorios: fallo el envio:', e.message))
    );
  },
};
