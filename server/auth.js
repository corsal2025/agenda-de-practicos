'use strict';
const crypto = require('node:crypto');
const cookieSession = require('cookie-session');

// PIN compartido. Cambiar con la variable de entorno AGENDA_PIN.
const PIN = String(process.env.AGENDA_PIN || '1234');
// Si AGENDA_SIN_LOGIN=1, la app no pide login (util para un PC de un solo usuario).
const SIN_LOGIN = String(process.env.AGENDA_SIN_LOGIN || '') === '1';

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

function guard(req, res, next) {
  if (SIN_LOGIN) {
    req.session = req.session || {};
    if (!req.session.funcionario) req.session.funcionario = 'MODO SIN LOGIN';
    return next();
  }
  if (!req.path.startsWith('/api/')) return next();
  if (LIBRES.has(req.path)) return next();
  if (req.session && req.session.funcionario) return next();
  res.status(401).json({ error: 'Sesion requerida', login: true });
}

function login(req, res) {
  const { funcionario, pin } = req.body || {};
  if (SIN_LOGIN) { req.session.funcionario = funcionario || 'MODO SIN LOGIN'; return res.json({ ok: true, funcionario: req.session.funcionario }); }
  if (String(pin) !== PIN) { res.status(401).json({ error: 'PIN incorrecto' }); return; }
  if (!funcionario || !String(funcionario).trim()) { res.status(400).json({ error: 'Indica tu nombre' }); return; }
  req.session.funcionario = String(funcionario).trim().toUpperCase();
  res.json({ ok: true, funcionario: req.session.funcionario });
}

function sesion(req, res) {
  res.json({ funcionario: (req.session && req.session.funcionario) || null, sin_login: SIN_LOGIN });
}

function logout(req, res) {
  req.session = null;
  res.json({ ok: true });
}

const actor = (req) => (req && req.session && req.session.funcionario) || null;

module.exports = { middleware, guard, login, sesion, logout, actor, SIN_LOGIN };
