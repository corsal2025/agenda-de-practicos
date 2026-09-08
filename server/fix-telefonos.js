'use strict';
// Normaliza todos los telefonos ya guardados al formato +56XXXXXXXXX (una sola vez).
const { db } = require('./db');
const telefono = require('./telefono');

const filas = db.prepare("SELECT id, contacto FROM agenda WHERE contacto IS NOT NULL AND contacto <> ''").all();
const upd = db.prepare('UPDATE agenda SET contacto = ? WHERE id = ?');
let cambiados = 0;
let incompletos = 0;
for (const f of filas) {
  const n = telefono.normalizar(f.contacto);
  if (!n.valido) incompletos += 1;
  if (n.valor !== f.contacto) { upd.run(n.valor, f.id); cambiados += 1; }
}
console.log(`Telefonos: ${filas.length} revisados, ${cambiados} reformateados, ${incompletos} quedan incompletos (aparecen en el reporte de errores).`);
