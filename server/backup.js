'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DB_PATH, RAIZ } = require('./config');

const DIR = path.join(RAIZ, 'data', 'backups');
const CONSERVAR = Number(process.env.AGENDA_BACKUPS || 30);

// Copia el archivo de base de datos a data/backups/ con marca de tiempo.
function backup(etiqueta) {
  if (!fs.existsSync(DB_PATH)) throw new Error('Todavia no existe la base de datos.');
  fs.mkdirSync(DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = path.join(DIR, `agenda-${ts}${etiqueta ? '-' + etiqueta : ''}.db`);
  fs.copyFileSync(DB_PATH, destino);
  podar();
  return destino;
}

// Deja solo los CONSERVAR backups mas recientes.
function podar() {
  if (!fs.existsSync(DIR)) return;
  const archivos = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of archivos.slice(CONSERVAR)) {
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

module.exports = { backup, programar, podar };

if (require.main === module) {
  console.log('Backup creado en:', backup());
}
