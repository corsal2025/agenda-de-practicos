'use strict';
const { db } = require('./db');

// Reserva el primer cupo libre (sin cita y no bloqueado) de una hora y examinador.
// Devuelve 1 si lo reservo y 0 si la hora ya no tiene cupos libres.
function reservarCupoLibre(fecha, hora, examinador_id, datos) {
  const r = db.prepare(`
    UPDATE agenda SET rut=@rut, nombre=@nombre, clase=@clase, contacto=@contacto, correo=@correo,
      tipo_cita=@tipo_cita, funcionario_id=@funcionario_id, agendado_en=COALESCE(agendado_en, @fecha),
      actualizado_en=datetime('now','localtime')
    WHERE id = (
      SELECT id FROM agenda
      WHERE fecha=@fecha AND hora=@hora AND examinador_id=@examinador_id
        AND rut IS NULL AND nombre IS NULL AND bloqueado = 0
      ORDER BY cupo LIMIT 1
    )`).run({ ...datos, fecha, hora, examinador_id });
  return Number(r.changes);
}

module.exports = { reservarCupoLibre };
