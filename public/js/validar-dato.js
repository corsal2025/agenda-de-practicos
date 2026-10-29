// Formato exigido a los datos de contacto en la agenda. Mismas reglas que el servidor (server/validar.js).
// rutEsValido viene de core.js.

// Celular chileno: 9 digitos que empiezan en 9, con o sin prefijo +56.
function telefonoEsValido(v) {
  let digitos = String(v ?? '').replace(/\D/g, '');
  if (digitos.startsWith('56') && digitos.length === 11) digitos = digitos.slice(2);
  return /^9\d{8}$/.test(digitos);
}

// Mensaje de error del dato, o null si esta bien. Vacio es valido: el campo es opcional aqui.
function errorDato(campo, valor) {
  const v = String(valor ?? '').trim();
  if (!v) return null;
  if (campo === 'rut') {
    if (typeof pareceMarcador === 'function' && pareceMarcador(v)) return null;
    return rutEsValido(v) ? null : 'RUT inválido: revisa el dígito verificador (12.345.678-9)';
  }
  if (campo === 'contacto') return telefonoEsValido(v) ? null : 'Teléfono inválido: debe ser un celular de 9 dígitos que empiece con 9';
  return null;
}
