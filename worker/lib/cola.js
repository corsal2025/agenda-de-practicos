// Cola de reagendamiento. Cuando se bloquea un bloque que tenia una persona
// agendada (bloqueo puntual o bloqueo de rango), esa persona no se pierde: pasa
// a esta cola y aparece en la pestana Reagendar hasta que se le asigna una
// hora nueva o se descarta.
import { ahoraChile } from './fechas.js';

// Sentencia INSERT sin ejecutar, para mandarla en el mismo db.batch() que el
// UPDATE que bloquea el bloque (asi nunca queda el bloque bloqueado sin que
// la persona quede en la cola, ni al reves).
export function sentenciaEncolar(db, bloque, motivo, actor) {
  return db.prepare(`
    INSERT INTO cola_reagendar (rut, nombre, clase, contacto, correo, intento, lista_espera,
      funcionario_id, fecha_inicio_tramite, comentarios, origen_agenda_id, origen_fecha,
      origen_hora, origen_examinador_id, motivo, creado_por, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    bloque.rut ?? null, bloque.nombre ?? null, bloque.clase ?? null, bloque.contacto ?? null,
    bloque.correo ?? null, bloque.intento ?? null, bloque.lista_espera ?? null,
    bloque.funcionario_id ?? null, bloque.fecha_inicio_tramite ?? null, bloque.comentarios ?? null,
    bloque.id, bloque.fecha, bloque.hora, bloque.examinador_id,
    motivo || 'BLOQUEADO', actor || null, ahoraChile(),
  );
}

export async function listarPendientes(db) {
  const { results } = await db.prepare(`
    SELECT c.*, e.nombre AS origen_examinador
    FROM cola_reagendar c LEFT JOIN examinadores e ON e.id = c.origen_examinador_id
    WHERE c.estado = 'pendiente'
    ORDER BY c.origen_fecha, c.origen_hora, c.id
  `).all();
  return results;
}

export async function traerPendiente(db, id) {
  return db.prepare("SELECT * FROM cola_reagendar WHERE id = ? AND estado = 'pendiente'").bind(Number(id)).first();
}
