'use strict';
const rut = require('./rut');
const telefono = require('./telefono');

// Formatos que exige el sistema (se validan cuando el dato se escribe o cambia).
// RUT: 12.345.678-9 (puntos, guion y digito verificador correcto).
const RUT_FORMATO = /^\d{1,2}\.\d{3}\.\d{3}-[0-9K]$/;
// Telefono celular chileno: 9 digitos que empiezan en 9 (se guarda como +569XXXXXXXX).
const TELEFONO_FORMATO = /^9\d{8}$/;
// Correo: usuario@dominio.extension, sin espacios.
const CORREO_FORMATO = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

const error = (msg) => Object.assign(new Error(msg), { status: 400 });

const vacio = (v) => v == null || String(v).trim() === '';

// Devuelve el RUT en formato 12.345.678-9 o null si viene vacio. Lanza error si no cumple.
function exigirRut(raw) {
  if (vacio(raw)) return null;
  const formateado = rut.formatear(raw);
  if (!RUT_FORMATO.test(formateado) || !rut.esValido(formateado)) {
    throw error(`RUT inválido: "${String(raw).trim()}". Formato 12.345.678-9 con dígito verificador correcto.`);
  }
  return formateado;
}

// Devuelve el telefono como +569XXXXXXXX o null si viene vacio. Lanza error si no cumple.
function exigirTelefono(raw) {
  if (vacio(raw)) return null;
  const digitos = telefono.digitos(raw);
  if (!TELEFONO_FORMATO.test(digitos)) {
    throw error(`Teléfono inválido: "${String(raw).trim()}". Celular chileno: 9 dígitos que empiezan en 9 (ej. +56 9 1234 5678).`);
  }
  return '+56' + digitos;
}

// Devuelve el correo en minusculas o null si viene vacio. Lanza error si no cumple.
function exigirCorreoFormato(raw) {
  if (vacio(raw)) return null;
  const c = String(raw).trim().toLowerCase();
  if (!CORREO_FORMATO.test(c)) {
    throw error(`Correo inválido: "${String(raw).trim()}". Formato usuario@dominio.cl`);
  }
  return c;
}

const correoValidoFormato = (raw) => CORREO_FORMATO.test(String(raw || '').trim().toLowerCase());

module.exports = {
  RUT_FORMATO, TELEFONO_FORMATO, CORREO_FORMATO,
  exigirRut, exigirTelefono, exigirCorreoFormato, correoValidoFormato,
};
