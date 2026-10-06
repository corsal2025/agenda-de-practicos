// Helpers compartidos entre los routers de worker/routes/*.js. Equivalente a los
// helpers sueltos que estaban al principio de server/index.js (wrap, bad, actorDe,
// logReq, catalogo/enCatalogo, SELECT_BLOQUE/traer, LIMPIAR_SQL, validarBloque,
// logoDisponible). Hono ya captura excepciones sincronas/asincronas de un handler
// y las manda a app.onError(), asi que no hace falta el wrap() de Express.
import { HORA_D_A5, CLASES_PESADAS } from './config.js';
import { ahoraChile } from './fechas.js';
import { log } from './db.js';
import * as auth from './auth.js';
import * as pesada from './pesada.js';
import * as rut from './rut.js';

// Regla principal: no se da hora a una persona sin correo (lo exige la
// confirmacion y el recordatorio automatico).
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function correoValido(correo) {
  return CORREO_RE.test(String(correo || '').trim());
}
export function exigirCorreo(correo) {
  if (!String(correo || '').trim()) {
    throw bad('Falta el correo: no se puede dar hora a una persona sin correo electrónico.');
  }
  if (!correoValido(correo)) throw bad(`Correo con formato inválido: ${String(correo).trim()}`);
  return String(correo).trim().toLowerCase();
}

export function bad(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

export async function actorDe(c) {
  return auth.actor(c);
}

export async function logReq(c, db, id, accion, detalle) {
  return log(db, id, accion, detalle, await actorDe(c), ahoraChile());
}

// ---------- catalogos ----------
export async function catalogo(db, tipo) {
  const { results } = await db.prepare('SELECT valor FROM catalogos WHERE tipo = ? AND activo = 1 ORDER BY orden, valor')
    .bind(tipo).all();
  return results.map((r) => r.valor);
}
export async function enCatalogo(db, tipo, valor) {
  if (valor == null || valor === '') return true;
  return (await catalogo(db, tipo)).includes(valor);
}

// ---------- AGENDA: select comun + traer ----------
export const SELECT_BLOQUE = `
  SELECT a.*, e.nombre AS examinador, f.nombre AS funcionario,
         (a.rut IS NOT NULL OR a.nombre IS NOT NULL) AS ocupada
  FROM agenda a
  JOIN examinadores e ON e.id = a.examinador_id
  LEFT JOIN funcionarios f ON f.id = a.funcionario_id
`;
export async function traer(db, id) {
  return db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).bind(Number(id)).first();
}

// Limpia un bloque a "libre" (usado en liberar / reagendar-origen / bloquear-dia).
// actualizado_en va siempre como ultimo placeholder de este bloque de SETs.
export const LIMPIAR_SQL = `
  rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
  motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
  fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL, comentarios=NULL,
  bloqueado=0, bloqueo_motivo=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
  token_confirmacion=NULL, correo_confirmacion_enviado=0, correo_recordatorio_enviado=0,
  agendado_en=NULL, actualizado_en=?`;

// Variante para bloquear-dia: deja bloqueado=1 con un motivo en vez de liberar.
// Orden de placeholders en el SQL resultante: bloqueo_motivo, actualizado_en.
export const LIMPIAR_SQL_BLOQUEAR = LIMPIAR_SQL.replace('bloqueado=0, bloqueo_motivo=NULL', 'bloqueado=1, bloqueo_motivo=?');

// Variante para el origen de un reagendamiento: deja una nota en comentarios en
// vez de vaciarlos. Orden de placeholders: comentarios, actualizado_en.
export const LIMPIAR_SQL_REAGENDAR_ORIGEN = LIMPIAR_SQL.replace('comentarios=NULL', 'comentarios=?');

export async function validarBloque(db, body, bloque) {
  const avisos = [];
  // Una cita puede tener varias clases marcadas a la vez: "B,A2". Se valida
  // cada una por separado y se guarda como lista normalizada.
  const clases = [...new Set(String(body.clase || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))];
  for (const cl of clases) if (!(await enCatalogo(db, 'clase', cl))) throw bad(`Clase no valida: ${cl}`);
  const clase = clases.length ? clases.join(',') : null;
  const tienePesada = clases.some((cl) => CLASES_PESADAS.includes(cl));
  if (!(await enCatalogo(db, 'tipo_cita', body.tipo_cita))) throw bad(`Tipo de cita no valido: ${body.tipo_cita}`);
  if (!(await enCatalogo(db, 'resultado', body.resultado))) throw bad(`Resultado no valido: ${body.resultado}`);
  if (!(await enCatalogo(db, 'intento', body.intento))) throw bad(`Intento no valido: ${body.intento}`);
  if (!(await enCatalogo(db, 'lista_espera', body.lista_espera))) throw bad(`Lista de espera no valida: ${body.lista_espera}`);

  if (tienePesada && bloque.hora !== HORA_D_A5 && !body.forzar) {
    throw bad(`Las clases D/A5 solo se agendan en el bloque ${HORA_D_A5}. Elige ese horario o marca "forzar".`);
  }
  if (tienePesada && bloque.hora === HORA_D_A5 && !body.forzar) {
    const ocupados = await pesada.ocupadosDependientes(db, bloque.fecha, bloque.examinador_id);
    if (ocupados.length) {
      const detalle = ocupados.map((o) => `${o.hora} (${o.nombre || o.rut})`).join(' y ');
      throw bad(
        `No se puede agendar clase D/A5 a las ${HORA_D_A5}: el examinador ya tiene cita en ${detalle}. `
        + 'Libera esas horas primero o marca "forzar" para agendar igual (esas horas no quedaran bloqueadas).'
      );
    }
  }
  let rutFmt = null;
  if (body.rut && String(body.rut).trim()) {
    rutFmt = rut.formatear(body.rut);
    if (!rut.esValido(body.rut)) avisos.push(`RUT ${rutFmt} tiene digito verificador invalido.`);
  }
  if (body.tipo_cita === 'REAGENDADO' && !body.motivo_reagendamiento) {
    avisos.push('Cita marcada como REAGENDADO sin motivo de reagendamiento.');
  }
  return { avisos, rutFmt, clase };
}

// Busca un archivo de logo puesto por el usuario en public/ (logo.svg, .png, .jpg, .webp),
// probando el binding de assets estaticos de Pages (reemplaza fs.existsSync).
export async function logoDisponible(env, reqUrl) {
  if (!env.ASSETS) return null;
  // Pages hace fallback SPA (200 + index.html) para rutas estaticas que no
  // existen -- por eso NO alcanza con mirar resp.ok, hay que descartar el
  // fallback comparando el content-type (el logo real nunca es text/html).
  for (const nombre of ['logo.svg', 'logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp']) {
    try {
      const url = new URL(reqUrl);
      url.pathname = '/' + nombre;
      url.search = '';
      const resp = await env.ASSETS.fetch(new Request(url));
      const tipo = resp && resp.headers.get('content-type');
      if (resp && resp.ok && tipo && !tipo.startsWith('text/html')) return '/' + nombre;
    } catch { /* ignore */ }
  }
  return null;
}
