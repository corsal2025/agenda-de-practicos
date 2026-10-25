'use strict';
// Efectos compartidos sobre la asistencia de una cita: los usan la API (POST /api/agenda/:id/confirmar)
// y el procesamiento automatico de respuestas por correo (server/respuestas-correo.js).
const { db, log } = require('./db');
const correo = require('./correo');
const { hoyISO } = require('./fechas');

const SELECT_BLOQUE = `
  SELECT a.*, e.nombre AS examinador, f.nombre AS funcionario,
         (a.rut IS NOT NULL OR a.nombre IS NOT NULL) AS ocupada
  FROM agenda a
  JOIN examinadores e ON e.id = a.examinador_id
  LEFT JOIN funcionarios f ON f.id = a.funcionario_id
`;
const traer = (id) => db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).get(Number(id));

// Marca la confirmacion como enviada solo si el bloque sigue con el mismo ocupante/token al
// que se le envio (el SMTP puede tardar y el bloque pudo reasignarse mientras tanto).
function marcarConfirmacionEnviada(b) {
  return db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ? AND token_confirmacion IS ? AND rut IS ?')
    .run(b.id, b.token_confirmacion ?? null, b.rut ?? null);
}

// confirmo: 1 | 0 | null. Devuelve false si el bloque no tiene una cita (o esta bloqueado).
function registrarAsistencia(id, confirmo, actor, sufijo = '') {
  const bloque = traer(id);
  if (!bloque) return false;
  const r = db.prepare(`UPDATE agenda SET confirmo_asistencia = ?, token_confirmacion = NULL, actualizado_en = datetime('now','localtime')
    WHERE id = ? AND (rut IS NOT NULL OR nombre IS NOT NULL) AND bloqueado = 0`).run(confirmo, id);
  if (!r.changes) return false;
  const txt = confirmo === 1 ? 'CONFIRMA' : confirmo === 0 ? 'NO ASISTE' : 'SIN CONFIRMAR';
  log(id, 'confirmar_asistencia', `${bloque.fecha} ${bloque.hora} ${txt}${sufijo}`, actor);
  return true;
}

// Envia el correo de confirmacion solo si la cita esta confirmada y aun no se le envio.
async function enviarConfirmacionSiFalta(id) {
  const b = traer(id);
  if (!b || Number(b.confirmo_asistencia) !== 1 || !b.correo || b.correo_confirmacion_enviado) return false;
  try {
    const ok = await correo.confirmacion(b);
    if (ok) marcarConfirmacionEnviada(b);
    return Boolean(ok);
  } catch (e) {
    console.error('Error enviando correo de confirmacion:', e.message);
    return false;
  }
}

// Regla: quien confirmo asistencia no se reagenda hasta que pase el dia del examen
// (si no se presenta se marca No asistio). La usan tanto el reagendar interno como el publico.
function confirmadaBloqueaReagendar(cita, hoy = hoyISO()) {
  return Number(cita.confirmo_asistencia) === 1 && cita.fecha >= hoy;
}

// Deriva la cita a "pendiente de reagendar" (sin destino).
function marcarPendienteReagendar(id, motivo, actor) {
  const mot = String(motivo || 'POSTULANTE SOLICITA CAMBIO').trim();
  const r = db.prepare(`UPDATE agenda SET pendiente_reagendar = 1, pendiente_nota = ?, motivo_reagendamiento = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`)
    .run(mot, mot, id);
  if (r.changes) log(id, 'editar', `pendiente reagendar: ${mot}`, actor);
  return r.changes > 0;
}

module.exports = {
  SELECT_BLOQUE, traer, marcarConfirmacionEnviada, registrarAsistencia, enviarConfirmacionSiFalta,
  marcarPendienteReagendar, confirmadaBloqueaReagendar,
};
