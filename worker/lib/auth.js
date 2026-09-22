// Autenticacion por cookie firmada (HMAC-SHA256). Reemplaza server/auth.js (que
// usaba cookie-session + node:crypto). La firma/verificacion HMAC ahora corre
// sobre hono/cookie (setSignedCookie/getSignedCookie), que hace exactamente lo
// mismo que el HMAC-SHA256 hecho a mano de antes (ver node_modules/hono/dist/
// utils/cookie.js) sin duplicar codigo de firma propio.
//
// Decision confirmada con el usuario: se elimina el modo AGENDA_SIN_LOGIN — la
// web publica siempre exige login (hay datos reales de RUT/contacto en juego).
//
// PIN maestro: entra solo mientras una cuenta individual no tenga clave
// configurada todavia (arranque inicial / respaldo). Cambiar con AGENDA_PIN.
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import * as usuarios from './usuarios.js';

const NOMBRE_COOKIE = 'agenda';
const MAX_EDAD_MS = 12 * 60 * 60 * 1000; // 12 h, igual que hoy

// Rutas que no requieren sesion. '/api/logout' se incluye aca como defensa en
// profundidad (hoy ya es alcanzable sin sesion por el orden de registro de
// rutas en app.js; esto evita que un futuro reordenamiento lo bloquee sin querer).
const LIBRES = new Set(['/api/login', '/api/sesion', '/api/logout']);

// Mismo fallback que la version Node: sin AGENDA_SECRET configurado, se deriva
// una clave estable a partir del PIN (sha256 hex de 'agenda-practicos::<PIN>').
async function obtenerSecreto(env) {
  if (env.AGENDA_SECRET) return env.AGENDA_SECRET;
  const pin = String(env.AGENDA_PIN || '1234');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agenda-practicos::${pin}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// getSignedCookie(c, secret, name) devuelve: undefined (sin cookie), false (firma
// invalida) o el valor en texto plano (firma valida) -- ver hono/dist/utils/cookie.js
// parseSigned(). El payload viaja como JSON string dentro del valor firmado.
async function verificar(c) {
  const secreto = await obtenerSecreto(c.env);
  const valor = await getSignedCookie(c, secreto, NOMBRE_COOKIE);
  if (typeof valor !== 'string') return null; // undefined (sin cookie) o false (firma invalida)
  try {
    const data = JSON.parse(valor);
    if (data.exp && Date.now() > data.exp) return null; // cookie vencida (>12h)
    return data;
  } catch { return null; }
}

// Sesion cacheada en el contexto de Hono para no re-verificar el HMAC varias
// veces dentro del mismo request (guard() + soloAdmin() + actor(), etc).
export async function obtenerSesion(c) {
  const cacheada = c.get('sesion');
  if (cacheada !== undefined) return cacheada;
  const sesion = await verificar(c);
  c.set('sesion', sesion);
  return sesion;
}

async function establecerSesion(c, datos) {
  const payload = { ...datos, exp: Date.now() + MAX_EDAD_MS };
  const secreto = await obtenerSecreto(c.env);
  // secure:true es seguro acá (a diferencia del server/ viejo, que corría en LAN
  // por HTTP) porque Cloudflare Pages sirve siempre por HTTPS.
  await setSignedCookie(c, NOMBRE_COOKIE, JSON.stringify(payload), secreto, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: Math.floor(MAX_EDAD_MS / 1000),
  });
  c.set('sesion', payload);
}

function limpiarSesion(c) {
  deleteCookie(c, NOMBRE_COOKIE, { path: '/' });
  c.set('sesion', null);
}

// Middleware: exige sesion valida en toda ruta /api/* salvo /api/login y /api/sesion.
// Contrato con el frontend (no negociable): 401 + {error, login:true}.
export async function guard(c, next) {
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith('/api/')) return next();
  if (LIBRES.has(path)) return next();
  const sesion = await obtenerSesion(c);
  if (sesion && sesion.funcionario) return next();
  return c.json({ error: 'Sesion requerida', login: true }, 401);
}

// Bloquea acciones de configuracion (funcionarios, examinadores, catalogos,
// feriados, importar Excel, generar bloques) a quien no sea administrador.
export async function soloAdmin(c, next) {
  const sesion = await obtenerSesion(c);
  if (sesion && sesion.rol === 'admin') return next();
  return c.json({ error: 'Esta accion es solo para administradores.' }, 403);
}

export async function login(c) {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { usuario, clave } = body || {};
  if (!usuario || !String(usuario).trim()) return c.json({ error: 'Indica tu usuario' }, 400);
  if (!clave) return c.json({ error: 'Indica tu contraseña' }, 400);

  const u = await usuarios.porUsuario(db, usuario);
  if (u && u.clave_hash && await usuarios.verificarClave(clave, u.clave_hash)) {
    await establecerSesion(c, { funcionario: u.nombre, funcionario_id: u.id, rol: u.rol || 'staff' });
    return c.json({ ok: true, funcionario: u.nombre, rol: u.rol || 'staff' });
  }
  // Respaldo: mientras esta persona no tenga clave propia configurada, el PIN
  // maestro deja entrar como administrador (arranque inicial / sin cuentas aun).
  if (!u || !u.clave_hash) {
    const PIN = String(c.env.AGENDA_PIN || '1234');
    if (String(clave) === PIN) {
      const funcionario = String(usuario).trim().toUpperCase();
      await establecerSesion(c, { funcionario, rol: 'admin' });
      return c.json({ ok: true, funcionario, rol: 'admin' });
    }
  }
  return c.json({ error: 'Usuario o contraseña incorrectos' }, 401);
}

export function logout(c) {
  limpiarSesion(c);
  return c.json({ ok: true });
}

export async function actor(c) {
  const s = await obtenerSesion(c);
  return (s && s.funcionario) || null;
}

export async function esAdmin(c) {
  const s = await obtenerSesion(c);
  return Boolean(s && s.rol === 'admin');
}
