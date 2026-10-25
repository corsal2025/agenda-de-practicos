'use strict';
// Recordatorio automático por correo para examenes de los proximos 3 dias (desde mañana).
// Usa una ventana y no un dia exacto: si el PC estuvo apagado ese dia, el recordatorio se envia al encender.
const crypto = require('node:crypto');
const { db } = require('./db');
const correo = require('./correo');
const { hoyISO, sumarDias } = require('./fechas');
const validar = require('./validar');

function tresDiasISO() {
  return sumarDias(hoyISO(), 3);
}

// Busca citas en la fecha objetivo (3 días antes) que tengan correo y no se les haya enviado el recordatorio
const SELECT = `
  SELECT a.*, e.nombre AS examinador
  FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.fecha > ? AND a.fecha <= ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
    AND a.correo IS NOT NULL AND a.correo != '' AND a.correo_recordatorio_enviado = 0
`;

// Solo si el bloque sigue con el mismo ocupante/token (el SMTP pudo tardar y reasignarse).
// valor: 1 = enviado, 2 = rechazado por el servidor (no se reintenta).
function marcar(bloque, valor) {
  db.prepare('UPDATE agenda SET correo_recordatorio_enviado = ? WHERE id = ? AND token_confirmacion IS ? AND rut IS ?')
    .run(valor, bloque.id, bloque.token_confirmacion ?? null, bloque.rut ?? null);
}

async function enviarPendientes() {
  if (!correo.habilitado) return { enviados: 0, habilitado: false };
  const fechaObjetivo = tresDiasISO();
  const filas = db.prepare(SELECT).all(hoyISO(), fechaObjetivo);
  let enviados = 0;
  for (const bloque of filas) {
    // Un correo con formato invalido no se intenta (no gasta el intento): aparece en Correccion rapida.
    if (!validar.CORREO_FORMATO.test(String(bloque.correo).trim())) continue;
    // Quien ya confirmo no necesita (ni debe recibir) links de confirmar/reagendar en este
    // recordatorio: se le envia una copia sin token, sin tocar el token real del bloque.
    const yaConfirmo = Number(bloque.confirmo_asistencia) === 1;
    let envioBloque = bloque;
    if (yaConfirmo) {
      envioBloque = { ...bloque, token_confirmacion: null };
    } else if (!bloque.token_confirmacion) {
      bloque.token_confirmacion = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?').run(bloque.token_confirmacion, bloque.id);
    }
    correo.ultimoError = null;
    let ok = false;
    let err = null;
    try { ok = Boolean(await correo.recordatorio(envioBloque)); } catch (e) { err = e; }
    if (ok) {
      marcar(bloque, 1);
      enviados++;
      continue;
    }
    err = err || correo.ultimoError;
    // El servidor rechazo este destinatario: reintentar no sirve, se marca como fallido.
    if (correo.esRechazoInmediato(err)) { marcar(bloque, 2); continue; }
    // Falla del canal completo (o sin canal): no se marca la cita; se corta la tanda y
    // se reintenta en el ciclo siguiente.
    if (!err || correo.esErrorGeneral(err)) break;
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
