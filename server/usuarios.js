'use strict';
// Hash de contrasena con scrypt (nativo de Node, sin dependencias externas).
const crypto = require('node:crypto');
const { db } = require('./db');

function hashClave(clave) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(clave), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verificarClave(clave, guardado) {
  if (!guardado || !guardado.includes(':')) return false;
  const [salt, hash] = guardado.split(':');
  const intento = crypto.scryptSync(String(clave), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(intento, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Busqueda de login case-insensitive.
function porUsuario(usuario) {
  if (!usuario) return null;
  return db.prepare('SELECT * FROM funcionarios WHERE UPPER(usuario) = UPPER(?) AND activo = 1').get(String(usuario).trim());
}

// El usuario debe ser unico (ademas del nombre, que ya es UNIQUE en la tabla).
function usuarioDisponible(usuario, exceptoId) {
  const row = db.prepare('SELECT id FROM funcionarios WHERE UPPER(usuario) = UPPER(?)').get(String(usuario).trim());
  return !row || row.id === exceptoId;
}

module.exports = { hashClave, verificarClave, porUsuario, usuarioDisponible };
