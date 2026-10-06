'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DB_PATH, RAIZ } = require('./config');
const { ahoraTS } = require('./fechas');

// AGENDA_BACKUP_DIR permite redirigir los backups (los tests usan una carpeta temporal).
const DIR = process.env.AGENDA_BACKUP_DIR || path.join(RAIZ, 'data', 'backups');
const CONSERVAR = Number(process.env.AGENDA_BACKUPS || 30);
// Los backups "pre-*" (pre-import, pre-fixes...) son puntos de retorno antes de una operacion
// destructiva: no entran en la rotacion normal; se conservan hasta este maximo.
const CONSERVAR_PRE = 10;

// Copia consistente de la base a data/backups/ con marca de tiempo (hora local).
// Usa VACUUM INTO con la conexion de la app: copiar el archivo .db a mano ignora lo que
// todavia esta en el -wal (modo WAL) y puede dejar un backup sin los ultimos cambios.
function backup(etiqueta) {
  if (!fs.existsSync(DB_PATH)) throw new Error('Todavia no existe la base de datos.');
  const { db } = require('./db'); // perezoso: abre la base solo si se va a respaldar
  fs.mkdirSync(DIR, { recursive: true });
  const ts = ahoraTS().replace(' ', 'T').replace(/:/g, '-');
  const nombre = `agenda-${ts}${etiqueta ? '-' + etiqueta : ''}`;
  // VACUUM INTO falla si el destino existe (dos backups en el mismo segundo).
  let destino = path.join(DIR, `${nombre}.db`);
  for (let n = 2; fs.existsSync(destino); n++) destino = path.join(DIR, `${nombre}-${n}.db`);
  db.prepare('VACUUM INTO ?').run(destino);
  podar();
  return destino;
}

// Deja los CONSERVAR backups normales mas recientes y hasta CONSERVAR_PRE de los "pre-*".
function podar() {
  if (!fs.existsSync(DIR)) return;
  const archivos = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const pre = archivos.filter(({ f }) => f.includes('pre-'));
  const normales = archivos.filter(({ f }) => !f.includes('pre-'));
  for (const { f } of [...normales.slice(CONSERVAR), ...pre.slice(CONSERVAR_PRE)]) {
    try { fs.unlinkSync(path.join(DIR, f)); } catch (_) { /* ignore */ }
  }
}

// Programa un backup diario mientras el servidor este arriba.
// Hace uno al arrancar si el ultimo tiene mas de 20 h.
function programar() {
  const ultimo = () => {
    if (!fs.existsSync(DIR)) return 0;
    const ts = fs.readdirSync(DIR).filter((f) => f.endsWith('.db'))
      .map((f) => fs.statSync(path.join(DIR, f)).mtimeMs);
    return ts.length ? Math.max(...ts) : 0;
  };
  if (Date.now() - ultimo() > 20 * 3600 * 1000) {
    try { backup('auto'); } catch (_) { /* ignore */ }
  }
  setInterval(() => {
    try { backup('auto'); } catch (e) { console.error('Backup automatico fallo:', e.message); }
  }, 24 * 3600 * 1000).unref();
}

module.exports = { backup, programar, podar, DIR };

if (require.main === module) {
  console.log('Backup creado en:', backup());
}
