'use strict';

// Telefono chileno. Guardamos siempre en formato +56 seguido de 9 digitos.

function digitos(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.startsWith('56') && d.length > 9) d = d.slice(2); // sacar codigo de pais si venia
  return d;
}

// Devuelve { valor, valido, vacio }.
// valor: '+56XXXXXXXXX' (o los digitos que haya, con +56 adelante) | null si vacio.
function normalizar(raw) {
  const d = digitos(raw);
  if (!d) return { valor: null, valido: true, vacio: true };
  return { valor: '+56' + d, valido: d.length === 9, vacio: false };
}

// '+56 9 1234 5678' para mostrar.
function formatear(valor) {
  const d = digitos(valor);
  if (!d) return '';
  if (d.length === 9) return `+56 ${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
  return '+56 ' + d;
}

module.exports = { digitos, normalizar, formatear };
