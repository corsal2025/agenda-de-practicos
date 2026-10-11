'use strict';
// Copia consistente de la base a un archivo destino (uso: node server/snapshot.js <destino.db>).
// Usa VACUUM INTO: copiar agenda.db a mano ignora lo pendiente en el -wal.
const fs = require('node:fs');
const path = require('node:path');
const { DB_PATH } = require('./config');

function snapshot(destino) {
  if (!destino) throw new Error('Falta la ruta de destino.');
  if (!fs.existsSync(DB_PATH)) throw new Error('Todavia no existe la base de datos.');
  const { db } = require('./db');
  const abs = path.resolve(destino);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // VACUUM INTO falla si el destino existe; se reemplaza la copia anterior.
  for (const s of ['', '-wal', '-shm']) fs.rmSync(abs + s, { force: true });
  db.prepare('VACUUM INTO ?').run(abs);
  return abs;
}

module.exports = { snapshot };

if (require.main === module) {
  try {
    console.log('Copia de la base creada en:', snapshot(process.argv[2]));
  } catch (e) {
    console.error('Error copiando la base:', e.message);
    process.exit(1);
  }
}
