// Hash de contrasena. Reemplaza server/usuarios.js (que usaba scrypt de node:crypto).
// scrypt no existe en Web Crypto (la API disponible en Cloudflare Workers), asi que
// se usa PBKDF2-SHA256 via crypto.subtle, que si esta soportado nativamente.
//
// Como la base D1 arranca limpia (no hay hashes viejos que migrar), no hace falta
// compatibilidad con el formato scrypt anterior.
//
// OJO / TODO antes de ir a produccion con cuentas reales: 100.000 iteraciones (la
// recomendacion OWASP para PBKDF2-SHA256) es probable que exceda el limite de 10ms de
// CPU por request del plan gratis de Cloudflare Workers, asi que se baja a 50.000 como
// punto de partida mas seguro -- pero sigue siendo una estimacion, no una medicion.
// Hay que medir cuanto tarda deriveBits() con este iterCount en un Worker real
// (wrangler dev o produccion) y bajar el numero si se acerca al limite -- especialmente
// porque login/cambio de clave son las rutas mas sensibles a este costo. No se asume un
// valor "seguro" sin medirlo.
const ITERACIONES = 50_000;

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function derivar(clave, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(clave)), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERACIONES, hash: 'SHA-256' },
    keyMaterial,
    512, // 64 bytes, igual largo que el scrypt anterior
  );
  return new Uint8Array(bits);
}

export async function hashClave(clave) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(clave, salt);
  return `${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

export async function verificarClave(clave, guardado) {
  if (!guardado || !guardado.includes(':')) return false;
  const [saltHex, hashHex] = guardado.split(':');
  if (!saltHex || !hashHex) return false;
  const intento = await derivar(clave, hexToBytes(saltHex));
  const esperado = hexToBytes(hashHex);
  if (intento.length !== esperado.length) return false;
  // Comparacion en tiempo constante (equivalente a crypto.timingSafeEqual de Node).
  let dif = 0;
  for (let i = 0; i < intento.length; i++) dif |= intento[i] ^ esperado[i];
  return dif === 0;
}

// Busqueda de login case-insensitive.
export async function porUsuario(db, usuario) {
  if (!usuario) return null;
  return db.prepare('SELECT * FROM funcionarios WHERE UPPER(usuario) = UPPER(?) AND activo = 1')
    .bind(String(usuario).trim()).first();
}

// El usuario debe ser unico (ademas del nombre, que ya es UNIQUE en la tabla).
export async function usuarioDisponible(db, usuario, exceptoId) {
  const row = await db.prepare('SELECT id FROM funcionarios WHERE UPPER(usuario) = UPPER(?)')
    .bind(String(usuario).trim()).first();
  return !row || row.id === exceptoId;
}
