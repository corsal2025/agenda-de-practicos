'use strict';
// Recordatorio automatico un dia antes del examen, por correo.
const crypto = require('node:crypto');
const { db } = require('./db');
const correo = require('./correo');
const { hoyISO } = require('./fechas');

function mañanaISO() {
  const d = new Date(`${hoyISO()}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const SELECT = `
  SELECT a.*, e.nombre AS examinador
  FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.fecha = ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
    AND a.correo IS NOT NULL AND a.correo != '' AND a.correo_recordatorio_enviado = 0
`;

// Manda el recordatorio a todas las citas de mañana con correo pendiente.
// Idempotente: cada fila enviada se marca, asi corra una o diez veces no duplica.
async function enviarPendientes() {
  if (!correo.habilitado) return { enviados: 0, habilitado: false };
  const filas = db.prepare(SELECT).all(mañanaISO());
  let enviados = 0;
  for (const bloque of filas) {
    if (!bloque.token_confirmacion) {
      bloque.token_confirmacion = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?').run(bloque.token_confirmacion, bloque.id);
    }
    const ok = await correo.recordatorio(bloque);
    if (ok) {
      db.prepare('UPDATE agenda SET correo_recordatorio_enviado = 1 WHERE id = ?').run(bloque.id);
      enviados++;
    }
  }
  return { enviados, habilitado: true, revisados: filas.length };
}

// Revisa cada hora mientras el servidor este arriba (y una vez al arrancar).
function programar() {
  enviarPendientes().catch((e) => console.error('Recordatorios: fallo el envio inicial:', e.message));
  setInterval(() => {
    enviarPendientes().catch((e) => console.error('Recordatorios: fallo el envio:', e.message));
  }, 3600 * 1000).unref();
}

module.exports = { enviarPendientes, programar };
