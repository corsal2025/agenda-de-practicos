'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DB_PATH, RAIZ } = require('./config');

const DIR = path.join(RAIZ, 'data', 'backups');
const CONSERVAR = Number(process.env.AGENDA_BACKUPS || 30);
// Carpeta externa opcional (disco de red, o una carpeta sincronizada con la nube:
// OneDrive, Google Drive, etc.) para no depender solo del disco del PC servidor.
const OFFSITE_DIR = process.env.AGENDA_BACKUP_OFFSITE || null;

// Copia el archivo de base de datos a data/backups/ (y a AGENDA_BACKUP_OFFSITE si esta
// configurada) con marca de tiempo.
function backup(etiqueta) {
  if (!fs.existsSync(DB_PATH)) throw new Error('Todavia no existe la base de datos.');
  fs.mkdirSync(DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const nombre = `agenda-${ts}${etiqueta ? '-' + etiqueta : ''}.db`;
  const destino = path.join(DIR, nombre);
  fs.copyFileSync(DB_PATH, destino);
  podar(DIR);
  copiarOffsite(destino, nombre);
  return destino;
}

// Best-effort: si la carpeta externa no esta disponible (disco desconectado, sin
// permisos), se avisa por consola pero no se interrumpe el backup local.
function copiarOffsite(destino, nombre) {
  if (!OFFSITE_DIR) return;
  try {
    fs.mkdirSync(OFFSITE_DIR, { recursive: true });
    fs.copyFileSync(destino, path.join(OFFSITE_DIR, nombre));
    podar(OFFSITE_DIR);
  } catch (e) {
    console.error('No se pudo copiar el backup a AGENDA_BACKUP_OFFSITE:', e.message);
  }
}

// Nombre que le damos a nuestros propios backups: agenda-<timestamp>[-etiqueta].db
const NOMBRE_BACKUP = /^agenda-\d{4}-\d{2}-\d{2}T.*\.db$/;

// Deja solo los CONSERVAR backups mas recientes en la carpeta dada. Solo toca archivos
// con el patron de nombre de nuestros backups: en AGENDA_BACKUP_OFFSITE puede haber
// otros .db (una carpeta compartida o sincronizada con la nube) que no hay que borrar.
function podar(dir) {
  if (!fs.existsSync(dir)) return;
  const archivos = fs.readdirSync(dir)
    .filter((f) => NOMBRE_BACKUP.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of archivos.slice(CONSERVAR)) {
    try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ }
  }
}

// Programa un backup diario mientras el servidor este arriba.
// Hace uno al arrancar si el ultimo tiene mas de 20 h.
function programar() {
  const ultimo = () => {
    if (!fs.existsSync(DIR)) return 0;
    const ts = fs.readdirSync(DIR).filter((f) => NOMBRE_BACKUP.test(f))
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

module.exports = { backup, programar, podar };

if (require.main === module) {
  console.log('Backup creado en:', backup());
}
