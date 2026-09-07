'use strict';
const { db, tx, log } = require('./db');
const { HORAS } = require('./config');
const { diasHabiles } = require('./fechas');
const feriados = require('./feriados');

// Crea los bloques (fecha, hora, examinador) que falten en el rango dado,
// para todos los examinadores activos. No toca los bloques existentes.
function generar(desde, hasta) {
  const examinadores = db.prepare('SELECT id FROM examinadores WHERE activo = 1').all();
  const dias = diasHabiles(desde, hasta, feriados.set());
  const ins = db.prepare(
    `INSERT OR IGNORE INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)`
  );
  let creados = 0;
  tx(() => {
    for (const dia of dias) {
      for (const hora of HORAS) {
        for (const ex of examinadores) {
          const r = ins.run(dia, hora, ex.id);
          creados += Number(r.changes);
        }
      }
    }
  });
  log(null, 'generar', `${desde}..${hasta}: ${creados} bloques nuevos`);
  return { dias: dias.length, creados };
}

module.exports = { generar };
