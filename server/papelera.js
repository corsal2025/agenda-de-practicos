'use strict';
const { db } = require('./db');

const CAMPOS = [
  'rut', 'nombre', 'clase', 'contacto', 'correo', 'tipo_cita', 'motivo_reagendamiento',
  'lista_espera', 'intento', 'funcionario_id', 'fecha_inicio_tramite', 'confirmo_asistencia',
  'resultado', 'comentarios', 'bloqueado', 'bloqueo_motivo', 'pendiente_reagendar',
  'pendiente_nota', 'agendado_en',
];

// Guarda el contenido actual de un bloque ocupado/bloqueado antes de borrarlo.
function guardar(bloque, motivo, actor) {
  if (!bloque) return;
  const ocupadoOBloqueado = bloque.rut || bloque.nombre || bloque.bloqueado;
  if (!ocupadoOBloqueado) return;
  const datos = {};
  for (const c of CAMPOS) datos[c] = bloque[c] ?? null;
  datos._fecha = bloque.fecha;
  datos._hora = bloque.hora;
  datos._examinador_id = bloque.examinador_id;
  db.prepare('INSERT INTO papelera (agenda_id, datos, motivo, actor) VALUES (?, ?, ?, ?)')
    .run(bloque.id, JSON.stringify(datos), motivo || null, actor || null);
  // Mantener solo las ultimas 200 entradas.
  db.exec('DELETE FROM papelera WHERE id NOT IN (SELECT id FROM papelera ORDER BY id DESC LIMIT 200)');
}

function listar(limite = 50) {
  return db.prepare('SELECT * FROM papelera ORDER BY id DESC LIMIT ?').all(limite).map((r) => {
    let d = {};
    try { d = JSON.parse(r.datos); } catch (_) { /* ignore */ }
    return {
      id: r.id, agenda_id: r.agenda_id, motivo: r.motivo, actor: r.actor, ts: r.ts,
      fecha: d._fecha, hora: d._hora, rut: d.rut, nombre: d.nombre, bloqueo_motivo: d.bloqueo_motivo,
    };
  });
}

// Restaura una entrada al bloque original SOLO si sigue libre.
function restaurar(id) {
  const row = db.prepare('SELECT * FROM papelera WHERE id = ?').get(id);
  if (!row) throw new Error('Entrada de papelera no encontrada');
  const d = JSON.parse(row.datos);
  const destino = db.prepare('SELECT * FROM agenda WHERE id = ?').get(row.agenda_id);
  if (!destino) throw new Error('El bloque original ya no existe');
  if (destino.rut || destino.nombre || destino.bloqueado) {
    throw new Error('El bloque original ya esta ocupado; no se puede restaurar automaticamente');
  }
  const sets = CAMPOS.map((c) => `${c} = @${c}`).join(', ');
  const params = { id: row.agenda_id };
  for (const c of CAMPOS) params[c] = d[c] ?? null;
  db.prepare(`UPDATE agenda SET ${sets}, actualizado_en = datetime('now','localtime') WHERE id = @id`).run(params);
  db.prepare('DELETE FROM papelera WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(row.agenda_id);
}

module.exports = { guardar, listar, restaurar };
