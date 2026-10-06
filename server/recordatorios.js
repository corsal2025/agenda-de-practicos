'use strict';
// Recordatorio automático 3 días antes del examen práctico, por correo electrónico.
const crypto = require('node:crypto');
const { db } = require('./db');
const correo = require('./correo');
const { hoyISO, sumarDias } = require('./fechas');

function tresDiasISO() {
  return sumarDias(hoyISO(), 3);
}

// Busca citas en la fecha objetivo (3 días antes) que tengan correo y no se les haya enviado el recordatorio
const SELECT = `
  SELECT a.*, e.nombre AS examinador
  FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.fecha = ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
    AND a.correo IS NOT NULL AND a.correo != '' AND a.correo_recordatorio_enviado = 0
`;

async function enviarPendientes() {
  if (!correo.habilitado) return { enviados: 0, habilitado: false };
  const fechaObjetivo = tresDiasISO();
  const filas = db.prepare(SELECT).all(fechaObjetivo);
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
  return { enviados, habilitado: true, revisados: filas.length, fecha: fechaObjetivo };
}

function programar() {
  setTimeout(() => {
    enviarPendientes().catch((e) => console.error('Fallo recordatorios inicial:', e.message));
  }, 5000);

  // Cada 6 horas revisa si hay pendientes por notificar
  setInterval(() => {
    enviarPendientes().catch((e) => console.error('Fallo recordatorios:', e.message));
  }, 6 * 3600 * 1000);
}

module.exports = { enviarPendientes, programar };
