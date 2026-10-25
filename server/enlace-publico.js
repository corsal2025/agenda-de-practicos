'use strict';
// Validacion de los enlaces publicos (confirmar/rechazar/reagendar, sin login).
const crypto = require('node:crypto');
const { db } = require('./db');
const { hoyISO } = require('./fechas');

// Comparacion de tiempo constante: evita que el tiempo de respuesta delate un token valido.
function tokenValido(bloque, token) {
  if (!bloque || !bloque.token_confirmacion || !token) return false;
  const a = Buffer.from(bloque.token_confirmacion);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Evalua si un enlace publico sigue siendo valido para el bloque dado.
// Devuelve { ok: true } o { ok: false, status, mensaje } con el motivo honesto (nunca "ha expirado"):
//  - 404: token equivocado o bloque sin cita/token (link ya usado o invalido).
//  - 410: la fecha del examen ya paso, o la cita ya tiene un resultado registrado.
// En los dos casos 410 tambien se limpia el token_confirmacion (el link ya no debe servir mas).
function evaluarEnlace(bloque, token, hoy = hoyISO()) {
  if (!tokenValido(bloque, token)) {
    return { ok: false, status: 404, mensaje: 'Este link ya fue utilizado o no es válido.' };
  }
  if (bloque.fecha < hoy) {
    db.prepare('UPDATE agenda SET token_confirmacion = NULL WHERE id = ?').run(bloque.id);
    return { ok: false, status: 410, mensaje: 'La fecha de tu examen ya pasó.' };
  }
  if (bloque.resultado) {
    db.prepare('UPDATE agenda SET token_confirmacion = NULL WHERE id = ?').run(bloque.id);
    return { ok: false, status: 410, mensaje: 'Esta cita ya tiene un resultado registrado.' };
  }
  return { ok: true };
}

module.exports = { tokenValido, evaluarEnlace };
