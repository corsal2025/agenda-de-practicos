'use strict';
// Borrado total del historial de movimientos: respaldo previo + confirmacion explicita.
const { db, tx, log } = require('./db');
const backupMod = require('./backup');

const FRASE_CONFIRMACION = 'BORRAR HISTORIAL';

// Respalda la base (etiqueta pre-borrar-historial), borra todas las filas de movimientos
// y deja un unico movimiento nuevo registrando el borrado (actor, fecha, cantidad).
function borrarTodo(actor) {
  const archivo = backupMod.backup('pre-borrar-historial');
  const totalAntes = db.prepare('SELECT COUNT(*) n FROM movimientos').get().n;
  tx(() => {
    db.prepare('DELETE FROM movimientos').run();
    log(null, 'borrar_historial', `Historial de movimientos borrado: ${totalAntes} registro(s)`, actor);
  });
  return { eliminados: totalAntes, backup: archivo };
}

module.exports = { FRASE_CONFIRMACION, borrarTodo };
