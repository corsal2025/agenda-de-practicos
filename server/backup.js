'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DB_PATH, RAIZ } = require('./config');

// Copia el archivo de base de datos a data/backups/ con marca de tiempo.
function backup() {
  if (!fs.existsSync(DB_PATH)) throw new Error('Todavia no existe la base de datos.');
  const dir = path.join(RAIZ, 'data', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = path.join(dir, `agenda-${ts}.db`);
  fs.copyFileSync(DB_PATH, destino);
  return destino;
}

module.exports = { backup };

if (require.main === module) {
  console.log('Backup creado en:', backup());
}
