'use strict';
const { db } = require('./db');

// Valores activos de una lista editable desde la pestana Datos (clase, tipo_cita, ...
// y hora_pesada: los bloques horarios donde se permiten clases D/A5).
function obtener(tipo) {
  return db.prepare('SELECT valor FROM catalogos WHERE tipo = ? AND activo = 1 ORDER BY orden, valor')
    .all(tipo).map((r) => r.valor);
}

function horasPesadas() {
  return obtener('hora_pesada');
}

module.exports = { obtener, horasPesadas };
