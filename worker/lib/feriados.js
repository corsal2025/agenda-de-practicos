// Reemplaza server/feriados.js. El seed de la primera vez ya no vive aca:
// migrations/0001_init.sql siembra la tabla `feriados` con FERIADOS_SEMILLA una
// sola vez al crear el schema.
//
// SIN CACHE (a proposito): la version Node original cacheaba el Set en memoria a
// nivel de modulo y solo lo invalidaba con refrescar() en escrituras locales. Eso
// no es seguro en un Worker: Cloudflare puede tener varios isolates del mismo
// Worker corriendo en paralelo (distintos datacenters, o el mismo escalando bajo
// carga), y un cache de modulo solo se invalida DENTRO del isolate que hizo la
// escritura -- los demas isolates quedarian sirviendo feriados desactualizados
// indefinidamente, sin ningun aviso. La tabla `feriados` es chica (~30-40 filas),
// asi que pegarle a D1 en cada llamada es barato comparado con ese riesgo.
export async function set(db) {
  const { results } = await db.prepare('SELECT fecha FROM feriados').all();
  return new Set(results.map((r) => r.fecha));
}

export async function listar(db) {
  const { results } = await db.prepare('SELECT fecha, nombre FROM feriados ORDER BY fecha').all();
  return results;
}

export async function agregar(db, fecha, nombre) {
  await db.prepare('INSERT OR REPLACE INTO feriados (fecha, nombre) VALUES (?, ?)')
    .bind(fecha, nombre || 'Feriado').run();
}

export async function quitar(db, fecha) {
  await db.prepare('DELETE FROM feriados WHERE fecha = ?').bind(fecha).run();
}
