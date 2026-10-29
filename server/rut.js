'use strict';

// Utilidades para el RUT chileno (modulo 11).

function limpiar(rut) {
  return String(rut == null ? '' : rut).toUpperCase().replace(/[^0-9K]/g, '');
}

function digitoVerificador(cuerpo) {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

function esValido(rut) {
  const c = limpiar(rut);
  if (c.length < 2) return false;
  const cuerpo = c.slice(0, -1);
  const dv = c.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  if (cuerpo.length < 6 || cuerpo.length > 8) return false;
  return digitoVerificador(cuerpo) === dv;
}

// Normaliza a "12.345.678-9". Si no parece un RUT, devuelve el texto original recortado.
function formatear(rut) {
  const c = limpiar(rut);
  if (c.length < 2 || !/^\d+[0-9K]$/.test(c)) return String(rut == null ? '' : rut).trim();
  const cuerpo = c.slice(0, -1);
  const dv = c.slice(-1);
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${conPuntos}-${dv}`;
}

// Textos que en el Excel o en la base ocupaban la columna RUT o nombre como notas o bloqueos de examinador sin ser un RUT de contribuyente.
const MARCADOR_RE = /VACACION|LICENCIA|ADMINISTRATIVO|FERIADO|BLOQUE|PERMISO|FIESTAS PATRIAS|CAPACITACI|COMET[IÍ]DO|TRASLADO|TERRENO|NO USAR|POSIBLES|HELLION|NO EXISTE|FALTA RUT|LLAMAR|SIN SISTEMA|COMPENSATORIO|SUSPENDID/i;

const NO_RUT = [
  'NO EXISTE EN SISTEMA', 'FALTA RUT', 'LLAMAR', 'TRASLADO', 'SIN SISTEMA', 'NO EXISTE',
  'VACACIONES', 'LICENCIA MEDICA', 'LICENCIA MÉDICA', 'LICENCIA', 'ADMINISTRATIVO',
  'DIA ADMINISTRATIVO', 'FERIADO', 'FERIADO LEGAL', 'BLOQUEADO', 'PERMISO',
  'CAPACITACION', 'CAPACITACIÓN', 'COMETIDO', 'NO USAR', 'POSIBLES', 'HELLION',
  'TERRENO', 'EN TERRENO', 'COMPENSATORIO', 'SUSPENDIDO', 'BLOQUE', 'BLOQUEO'
];

function pareceMarcador(txt) {
  if (txt == null) return false;
  const t = String(txt).trim().toUpperCase();
  if (!t) return false;
  return NO_RUT.some((m) => t.includes(m)) || MARCADOR_RE.test(t);
}

module.exports = { limpiar, digitoVerificador, esValido, formatear, pareceMarcador, MARCADOR_RE };
