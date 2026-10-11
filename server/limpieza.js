'use strict';
// Correccion rapida de datos de contacto (pestaña Reporte de errores).
const { db, tx } = require('./db');
const telefono = require('./telefono');
const rut = require('./rut');

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FILAS = 500;

const correoInvalido = (c) => Boolean(String(c || '').trim()) && !CORREO_RE.test(String(c).trim());
const normNombre = (n) => String(n || '').trim().replace(/\s+/g, ' ').toUpperCase();

// Tipos de problema de una cita: CORREO_INVALIDO, TELEFONO_INCOMPLETO, NOMBRE, RUT_INVALIDO.
function problemas(f) {
  const p = [];
  if (correoInvalido(f.correo)) p.push('CORREO_INVALIDO');
  const tel = telefono.normalizar(f.contacto);
  if (!tel.vacio && !tel.valido) p.push('TELEFONO_INCOMPLETO');
  // Solo espacios dobles o sobrantes: las minusculas no son error (la UI muestra en mayusculas).
  if (f.nombre && String(f.nombre).trim().replace(/\s+/g, ' ') !== f.nombre) p.push('NOMBRE');
  if (f.rut && !rut.pareceMarcador(f.rut) && !rut.esValido(f.rut)) p.push('RUT_INVALIDO');
  return p;
}

function listar() {
  const filas = db.prepare(`
    SELECT a.id, a.fecha, a.hora, a.rut, a.nombre, a.correo, a.contacto, a.actualizado_en, e.nombre AS examinador
    FROM agenda a LEFT JOIN examinadores e ON e.id = a.examinador_id
    WHERE (a.rut IS NOT NULL AND a.rut != '') OR (a.nombre IS NOT NULL AND a.nombre != '')
    ORDER BY a.fecha DESC, a.hora
  `).all()
    .map((f) => ({ ...f, problemas: problemas(f) }))
    .filter((f) => f.problemas.length);
  return { total: filas.length, filas: filas.slice(0, MAX_FILAS) };
}

// Valida y normaliza el cuerpo de PATCH /contacto. Lanza { status, message } si algo no sirve.
function validarContacto(body) {
  const err = (m) => Object.assign(new Error(m), { status: 400 });
  const cambios = {};
  if ('correo' in body) {
    const c = String(body.correo ?? '').trim();
    if (c && !CORREO_RE.test(c)) throw err(`Correo con formato inválido: ${c}`);
    cambios.correo = c ? c.toLowerCase() : null;
  }
  if ('contacto' in body) {
    const tel = telefono.normalizar(body.contacto);
    if (!tel.vacio && !tel.valido) throw err('Teléfono incompleto. Un número chileno tiene 9 dígitos (celular: 9 XXXX XXXX).');
    cambios.contacto = tel.valor;
  }
  if ('nombre' in body) {
    const n = normNombre(body.nombre);
    if (!n) throw err('El nombre no puede quedar vacío.');
    cambios.nombre = n;
  }
  if (!Object.keys(cambios).length) throw err('No hay cambios: envía correo, contacto o nombre.');
  return cambios;
}

function aplicarContacto(id, cambios) {
  const cols = Object.keys(cambios);
  db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, actualizado_en = datetime('now','localtime') WHERE id = @id`)
    .run({ ...cambios, id });
}

// Deja NULL los correos con formato invalido. Devuelve los ids tocados.
function vaciarCorreosInvalidos() {
  const ids = db.prepare(`SELECT id, correo FROM agenda WHERE correo IS NOT NULL AND correo != ''`).all()
    .filter((f) => correoInvalido(f.correo)).map((f) => f.id);
  tx(() => {
    const st = db.prepare(`UPDATE agenda SET correo = NULL, actualizado_en = datetime('now','localtime') WHERE id = ?`);
    for (const id of ids) st.run(id);
  });
  return ids;
}

module.exports = { CORREO_RE, problemas, listar, validarContacto, aplicarContacto, vaciarCorreosInvalidos };
