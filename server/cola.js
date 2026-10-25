'use strict';
const { db } = require('./db');
const { ahoraTS } = require('./fechas');

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

module.exports = { encolar, listarPendientes, traerPendiente };
