'use strict';
const crypto = require('node:crypto');
const cookieSession = require('cookie-session');
const usuarios = require('./usuarios');

// PIN maestro: entra solo mientras una cuenta individual no tenga clave
// configurada todavia (arranque inicial / respaldo). Cambiar con AGENDA_PIN.
const PIN = String(process.env.AGENDA_PIN || '1234');
// Si AGENDA_SIN_LOGIN=1, la app no pide login (util para un PC de un solo usuario).
// Modo embebido: sin barrera de login porque la aplicacion padre ya tiene autenticacion
const SIN_LOGIN = String(process.env.AGENDA_SIN_LOGIN || '1') !== '0';

const secreto = process.env.AGENDA_SECRET
  || crypto.createHash('sha256').update(`agenda-practicos::${PIN}`).digest('hex');

const middleware = cookieSession({
  name: 'agenda',
  keys: [secreto],
  maxAge: 12 * 60 * 60 * 1000, // 12 h
  sameSite: 'lax',
  httpOnly: true,
});

// Rutas que no requieren sesion.
const LIBRES = new Set(['/api/login', '/api/sesion']);

// Limite de intentos fallidos por IP: evita probar claves/PIN por fuerza bruta.
const MAX_INTENTOS = 5;
const bloqueoMs = () => Number(process.env.AGENDA_LOGIN_BLOQUEO_MS) || 60 * 1000;
const intentos = new Map(); // ip -> { fallos, bloqueadoHasta }

function guard(req, res, next) {
  if (SIN_LOGIN) {
    req.session = req.session || {};
    if (!req.session.funcionario) { req.session.funcionario = 'MODO SIN LOGIN'; req.session.rol = 'admin'; }
    return next();
  }
  if (!req.path.startsWith('/api/')) return next();
  if (LIBRES.has(req.path)) return next();
  if (req.session && req.session.funcionario) return next();
  res.status(401).json({ error: 'Sesion requerida', login: true });
}

// Bloquea acciones de configuracion (funcionarios, examinadores, catalogos,
// feriados, importar Excel, generar bloques) a quien no sea administrador.
function soloAdmin(req, res, next) {
  if (SIN_LOGIN || (req.session && req.session.rol === 'admin')) return next();
  res.status(403).json({ error: 'Esta accion es solo para administradores.' });
}

function login(req, res) {
  const { usuario, clave } = req.body || {};
  if (SIN_LOGIN) { req.session.funcionario = usuario || 'MODO SIN LOGIN'; req.session.rol = 'admin'; return res.json({ ok: true, funcionario: req.session.funcionario, rol: 'admin' }); }
  if (!usuario || !String(usuario).trim()) { res.status(400).json({ error: 'Indica tu usuario' }); return; }
  if (!clave) { res.status(400).json({ error: 'Indica tu contraseña' }); return; }

  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida';
  const estado = intentos.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
  if (estado.bloqueadoHasta > Date.now()) {
    const restante = Math.ceil((estado.bloqueadoHasta - Date.now()) / 1000);
    res.status(429).json({ error: `Demasiados intentos. Espera ${restante} s antes de volver a probar.` });
    return;
  }

  const u = usuarios.porUsuario(usuario);
  if (u && u.clave_hash && usuarios.verificarClave(clave, u.clave_hash)) {
    intentos.delete(ip);
    req.session.funcionario = u.nombre;
    req.session.funcionario_id = u.id;
    req.session.rol = u.rol || 'staff';
    return res.json({ ok: true, funcionario: u.nombre, rol: req.session.rol });
  }
  // Respaldo: mientras esta persona no tenga clave propia configurada, el PIN
  // maestro deja entrar como administrador (arranque inicial / sin cuentas aun).
  if (!u || !u.clave_hash) {
    if (String(clave) === PIN) {
      intentos.delete(ip);
      req.session.funcionario = String(usuario).trim().toUpperCase();
      req.session.rol = 'admin';
      return res.json({ ok: true, funcionario: req.session.funcionario, rol: 'admin' });
    }
  }
  estado.fallos += 1;
  if (estado.fallos >= MAX_INTENTOS) { estado.bloqueadoHasta = Date.now() + bloqueoMs(); estado.fallos = 0; }
  intentos.set(ip, estado);
  res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
}

function sesion(req, res) {
  res.json({
    funcionario: (req.session && req.session.funcionario) || null,
    rol: (req.session && req.session.rol) || null,
    sin_login: SIN_LOGIN,
  });
}

function logout(req, res) {
  req.session = null;
  res.json({ ok: true });
}

const actor = (req) => (req && req.session && req.session.funcionario) || null;
const esAdmin = (req) => Boolean(SIN_LOGIN || (req && req.session && req.session.rol === 'admin'));

module.exports = { middleware, guard, soloAdmin, login, sesion, logout, actor, esAdmin, SIN_LOGIN };
