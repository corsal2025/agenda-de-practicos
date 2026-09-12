'use strict';
// Regla de negocio: una clase pesada (D o A5) agendada a las 12:30 requiere
// el examinador completo hasta las 13:30 (examen + regreso). Este modulo
// bloquea/libera automaticamente los bloques horarios siguientes al 12:30
// para el mismo examinador y fecha.
const { db, tx } = require('./db');
const { HORAS, HORA_D_A5, CLASES_PESADAS } = require('./config');

const MOTIVO_AUTO = 'BLOQUEADO - CLASE PESADA 12:30 (D/A5)';

const idxD_A5 = HORAS.indexOf(HORA_D_A5);
const HORAS_A_BLOQUEAR = HORAS.slice(idxD_A5 + 1);

// Una cita puede tener varias clases marcadas ("B,A2"): alcanza con que
// alguna sea D/A5 para que el bloque cuente como pesado.
function esPesadaEnHoraValida(bloque) {
  if (!bloque || bloque.hora !== HORA_D_A5) return false;
  const clases = String(bloque.clase || '').toUpperCase().split(',').map((s) => s.trim());
  return clases.some((cl) => CLASES_PESADAS.includes(cl));
}

// Bloquea los bloques siguientes al 12:30 para el examinador/fecha dados.
// No pisa bloques que ya tengan una cita real ni bloqueos puestos a mano:
// esos casos se devuelven como avisos para que el funcionario decida.
function aplicar(fecha, examinador_id) {
  const avisos = [];
  if (!HORAS_A_BLOQUEAR.length) return avisos;
  const placeholders = HORAS_A_BLOQUEAR.map(() => '?').join(',');
  const filas = db.prepare(
    `SELECT * FROM agenda WHERE fecha = ? AND examinador_id = ? AND hora IN (${placeholders})`
  ).all(fecha, examinador_id, ...HORAS_A_BLOQUEAR);
  tx(() => {
    for (const b of filas) {
      if (b.rut || b.nombre) {
        avisos.push(`No se pudo bloquear ${b.hora} (${fecha}): ya tiene una cita agendada.`);
        continue;
      }
      if (b.bloqueado) continue;
      db.prepare(
        `UPDATE agenda SET bloqueado = 1, bloqueo_motivo = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`
      ).run(MOTIVO_AUTO, b.id);
    }
  });
  return avisos;
}

// Libera solo los bloques que este modulo bloqueo automaticamente
// (bloqueo_motivo = MOTIVO_AUTO). Nunca toca un bloqueo manual.
function liberar(fecha, examinador_id) {
  if (!HORAS_A_BLOQUEAR.length) return;
  const placeholders = HORAS_A_BLOQUEAR.map(() => '?').join(',');
  db.prepare(
    `UPDATE agenda SET bloqueado = 0, bloqueo_motivo = NULL, actualizado_en = datetime('now','localtime')
     WHERE fecha = ? AND examinador_id = ? AND bloqueo_motivo = ? AND hora IN (${placeholders})`
  ).run(fecha, examinador_id, MOTIVO_AUTO, ...HORAS_A_BLOQUEAR);
}

// Bloques dependientes (13:00/13:30) que ya tienen una cita real ese
// examinador/fecha. Se usa para impedir agendar D/A5 a las 12:30 si
// despues no se puede reservar el resto del examen.
function ocupadosDependientes(fecha, examinador_id) {
  if (!HORAS_A_BLOQUEAR.length) return [];
  const placeholders = HORAS_A_BLOQUEAR.map(() => '?').join(',');
  return db.prepare(
    `SELECT hora, rut, nombre FROM agenda
     WHERE fecha = ? AND examinador_id = ? AND hora IN (${placeholders})
       AND (rut IS NOT NULL OR nombre IS NOT NULL)`
  ).all(fecha, examinador_id, ...HORAS_A_BLOQUEAR);
}

// Recorre toda la agenda y aplica la regla a las citas pesadas ya existentes
// (por ejemplo, las que llegaron por una importacion de Excel y nunca
// pasaron por el flujo de agendar/editar de la app).
function sincronizarTodo() {
  // "clase" puede traer varias separadas por coma, asi que se filtra en JS
  // en vez de con un IN exacto en SQL.
  const filas = db.prepare(
    `SELECT DISTINCT fecha, examinador_id, clase FROM agenda
     WHERE hora = ? AND (rut IS NOT NULL OR nombre IS NOT NULL) AND clase IS NOT NULL`
  ).all(HORA_D_A5).filter((f) => esPesadaEnHoraValida({ hora: HORA_D_A5, clase: f.clase }));
  const avisos = [];
  for (const f of filas) avisos.push(...aplicar(f.fecha, f.examinador_id));
  return { procesados: filas.length, avisos };
}

module.exports = {
  MOTIVO_AUTO, esPesadaEnHoraValida, aplicar, liberar, ocupadosDependientes, sincronizarTodo,
};
