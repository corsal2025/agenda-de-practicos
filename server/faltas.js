'use strict';
// Inasistencias ("No vino") por persona. Viven en su propia tabla porque liberar el cupo
// borra el resultado de la cita. La lista de espera usa el conteo para ordenar.
const { db } = require('./db');
const rut = require('./rut');

// Clave de persona: RUT normalizado o, sin RUT, el nombre en mayusculas (igual que sugerencias).
const clave = (p) => rut.limpiar(p.rut) || String(p.nombre || '').toUpperCase().replace(/\s+/g, ' ').trim();

function registrar(bloque, actor) {
  const k = clave(bloque);
  if (!k) return null;
  db.prepare(`
    INSERT INTO faltas (rut_limpio, rut, nombre, clase, fecha, hora, examinador_id, agenda_id, resultado, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(k, bloque.rut || null, bloque.nombre || null, bloque.clase || null, bloque.fecha,
    bloque.hora || null, bloque.examinador_id ?? null, bloque.id ?? null, bloque.resultado || null, actor || null);
  return k;
}

// Acepta un RUT (con o sin formato) o una clave ya normalizada (nombre en mayusculas).
function contarPorRut(valor) {
  const texto = String(valor || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!texto) return 0;
  return db.prepare('SELECT COUNT(*) AS n FROM faltas WHERE rut_limpio IN (?, ?)').get(rut.limpiar(texto), texto).n;
}

// Map clave -> cantidad de faltas, para ordenar la lista de espera sin una consulta por persona.
function mapaConteos() {
  const mapa = new Map();
  for (const f of db.prepare('SELECT rut_limpio, COUNT(*) AS n FROM faltas GROUP BY rut_limpio').all()) {
    mapa.set(f.rut_limpio, f.n);
  }
  return mapa;
}

module.exports = { clave, registrar, contarPorRut, mapaConteos };
