// Reemplaza server/papelera.js. El UPDATE dinamico con @campo (named params de
// node:sqlite) pasa a placeholders posicionales `?` (D1 solo soporta esos via bind()).
import { ahoraChile } from './fechas.js';

const CAMPOS = [
  'rut', 'nombre', 'clase', 'contacto', 'correo', 'tipo_cita', 'motivo_reagendamiento',
  'lista_espera', 'intento', 'funcionario_id', 'fecha_inicio_tramite', 'confirmo_asistencia',
  'resultado', 'comentarios', 'bloqueado', 'bloqueo_motivo', 'pendiente_reagendar',
  'pendiente_nota', 'agendado_en',
];

// Guarda el contenido actual de un bloque ocupado/bloqueado antes de borrarlo.
export async function guardar(db, bloque, motivo, actor) {
  if (!bloque) return;
  const ocupadoOBloqueado = bloque.rut || bloque.nombre || bloque.bloqueado;
  if (!ocupadoOBloqueado) return;
  const datos = {};
  for (const c of CAMPOS) datos[c] = bloque[c] ?? null;
  datos._fecha = bloque.fecha;
  datos._hora = bloque.hora;
  datos._examinador_id = bloque.examinador_id;
  await db.prepare('INSERT INTO papelera (agenda_id, datos, motivo, actor, ts) VALUES (?, ?, ?, ?, ?)')
    .bind(bloque.id, JSON.stringify(datos), motivo || null, actor || null, ahoraChile())
    .run();
  // Mantener solo las ultimas 200 entradas.
  await db.prepare('DELETE FROM papelera WHERE id NOT IN (SELECT id FROM papelera ORDER BY id DESC LIMIT 200)').run();
}

export async function listar(db, limite = 50) {
  const { results } = await db.prepare('SELECT * FROM papelera ORDER BY id DESC LIMIT ?').bind(limite).all();
  return results.map((r) => {
    let d = {};
    try { d = JSON.parse(r.datos); } catch (_) { /* ignore */ }
    return {
      id: r.id, agenda_id: r.agenda_id, motivo: r.motivo, actor: r.actor, ts: r.ts,
      fecha: d._fecha, hora: d._hora, rut: d.rut, nombre: d.nombre, bloqueo_motivo: d.bloqueo_motivo,
    };
  });
}

// Restaura una entrada al bloque original SOLO si sigue libre.
export async function restaurar(db, id) {
  const row = await db.prepare('SELECT * FROM papelera WHERE id = ?').bind(id).first();
  if (!row) throw new Error('Entrada de papelera no encontrada');
  const d = JSON.parse(row.datos);
  const destino = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(row.agenda_id).first();
  if (!destino) throw new Error('El bloque original ya no existe');
  if (destino.rut || destino.nombre || destino.bloqueado) {
    throw new Error('El bloque original ya esta ocupado; no se puede restaurar automaticamente');
  }
  const sets = CAMPOS.map((c) => `${c} = ?`).join(', ');
  const valores = CAMPOS.map((c) => d[c] ?? null);
  await db.prepare(`UPDATE agenda SET ${sets}, actualizado_en = ? WHERE id = ?`)
    .bind(...valores, ahoraChile(), row.agenda_id)
    .run();
  await db.prepare('DELETE FROM papelera WHERE id = ?').bind(id).run();
  return db.prepare('SELECT * FROM agenda WHERE id = ?').bind(row.agenda_id).first();
}

// Borra una entrada puntual (no se puede deshacer).
export async function eliminar(db, id) {
  const r = await db.prepare('DELETE FROM papelera WHERE id = ?').bind(id).run();
  if (!r.meta.changes) throw new Error('Entrada de papelera no encontrada');
}

// Vacia toda la papelera (no se puede deshacer).
export async function vaciar(db) {
  const r = await db.prepare('DELETE FROM papelera').run();
  return Number(r.meta.changes);
}
