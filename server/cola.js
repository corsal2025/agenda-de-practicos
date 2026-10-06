'use strict';
const { db } = require('./db');
const { hoyISO, ahoraTS } = require('./fechas');
const { CLASES_PESADAS, HORA_D_A5 } = require('./config');

function encolar(bloque, motivo, actor) {
  const ts = ahoraTS();
  return db.prepare(`
    INSERT INTO cola_reagendar (rut, nombre, clase, contacto, correo, intento, lista_espera,
      funcionario_id, fecha_inicio_tramite, comentarios, origen_agenda_id, origen_fecha,
      origen_hora, origen_examinador_id, motivo, creado_por, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bloque.rut || null, bloque.nombre || null, bloque.clase || null, bloque.contacto || null,
    bloque.correo || null, bloque.intento || null, bloque.lista_espera || null,
    bloque.funcionario_id || null, bloque.fecha_inicio_tramite || null, bloque.comentarios || null,
    bloque.id, bloque.fecha, bloque.hora, bloque.examinador_id,
    motivo || 'Examinador no disponible', actor || null, ts
  );
}

function listarPendientes() {
  return db.prepare(`
    SELECT c.*, e.nombre AS origen_examinador
    FROM cola_reagendar c LEFT JOIN examinadores e ON e.id = c.origen_examinador_id
    WHERE c.estado = 'pendiente'
    ORDER BY c.origen_fecha, c.origen_hora, c.id
  `).all();
}

function traerPendiente(id) {
  return db.prepare(`
    SELECT c.*, e.nombre AS origen_examinador
    FROM cola_reagendar c LEFT JOIN examinadores e ON e.id = c.origen_examinador_id
    WHERE c.id = ? AND c.estado = 'pendiente'
  `).get(Number(id));
}

function sugerencias(id) {
  const item = traerPendiente(id);
  if (!item) return { mismo_examinador: [], otros_examinadores: [], origen_examinador: null };

  const hoy = hoyISO();
  const tienePesada = String(item.clase || '').toUpperCase().split(',').map((s) => s.trim())
    .some((cl) => CLASES_PESADAS.includes(cl));

  const pesadaCond = tienePesada ? `AND a.hora = '${HORA_D_A5}'` : '';

  let mismo = [];
  if (item.origen_examinador_id) {
    mismo = db.prepare(`
      SELECT a.id, a.fecha, a.hora, a.examinador_id, e.nombre AS examinador
      FROM agenda a
      JOIN examinadores e ON e.id = a.examinador_id
      WHERE a.examinador_id = ?
        AND a.fecha >= ?
        AND (a.rut IS NULL OR a.rut = '')
        AND (a.nombre IS NULL OR a.nombre = '')
        AND a.bloqueado = 0
        ${pesadaCond}
      ORDER BY a.fecha ASC, a.hora ASC
      LIMIT 4
    `).all(item.origen_examinador_id, hoy);
  }

  const otros = db.prepare(`
    SELECT a.id, a.fecha, a.hora, a.examinador_id, e.nombre AS examinador
    FROM agenda a
    JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.examinador_id != ?
      AND a.fecha >= ?
      AND (a.rut IS NULL OR a.rut = '')
      AND (a.nombre IS NULL OR a.nombre = '')
      AND a.bloqueado = 0
      ${pesadaCond}
    ORDER BY a.fecha ASC, a.hora ASC
    LIMIT 6
  `).all(item.origen_examinador_id || 0, hoy);

  return {
    mismo_examinador: mismo,
    otros_examinadores: otros,
    origen_examinador: item.origen_examinador,
    tiene_pesada: tienePesada,
  };
}

module.exports = { encolar, listarPendientes, traerPendiente, sugerencias };
