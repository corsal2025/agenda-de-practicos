'use strict';
// Backups: copia consistente (WAL) y retencion. Todo en carpetas temporales, nunca en data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-backup-${Date.now()}.db`);
const dirBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = dirBackups;
process.env.AGENDA_BACKUPS = '3';
process.env.AGENDA_SIN_LOGIN = '1';

const { DatabaseSync } = require('node:sqlite');
const { db } = require('../server/db');
const backupMod = require('../server/backup');

// Salvaguarda: estos tests podan y borran archivos. Jamas pueden apuntar a data/backups real.
assert.equal(path.resolve(backupMod.DIR), path.resolve(dirBackups), 'AGENDA_BACKUP_DIR no se aplico: abortando');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  fs.rmSync(dirBackups, { recursive: true, force: true });
});

const archivosBackup = () => fs.readdirSync(dirBackups).filter((f) => f.endsWith('.db'));

test('el backup incluye los cambios que aun estan en el WAL', () => {
  db.prepare("INSERT INTO feriados (fecha, nombre) VALUES ('2099-01-01', 'SOLO EN WAL')").run();
  // sin checkpoint: el cambio vive en el -wal, un copyFileSync del .db no lo veria
  const destino = backupMod.backup('prueba');
  assert.ok(fs.existsSync(destino));
  assert.match(path.basename(destino), /^agenda-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-prueba\.db$/);
  const copia = new DatabaseSync(destino, { readOnly: true });
  try {
    const f = copia.prepare("SELECT nombre FROM feriados WHERE fecha = '2099-01-01'").get();
    assert.equal(f && f.nombre, 'SOLO EN WAL');
    assert.equal(copia.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { copia.close(); }
});

test('dos backups en el mismo segundo no se pisan ni fallan', () => {
  const a = backupMod.backup('mismo');
  const b = backupMod.backup('mismo');
  assert.notEqual(a, b);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});

test('podar: conserva N recientes y los pre-* hasta 10', () => {
  fs.rmSync(dirBackups, { recursive: true, force: true });
  fs.mkdirSync(dirBackups, { recursive: true });
  const crear = (nombre, minutosAtras) => {
    const p = path.join(dirBackups, nombre);
    fs.writeFileSync(p, 'x');
    const t = new Date(Date.now() - minutosAtras * 60000);
    fs.utimesSync(p, t, t);
  };
  for (let i = 0; i < 5; i++) crear(`agenda-auto-${i}.db`, i + 1);          // 5 normales
  for (let i = 0; i < 12; i++) crear(`agenda-x${i}-pre-import.db`, 100 + i); // 12 pre-import, mas viejos
  backupMod.podar();
  const quedan = archivosBackup();
  const normales = quedan.filter((f) => !f.includes('pre-')).sort();
  const pre = quedan.filter((f) => f.includes('pre-')).sort();
  assert.deepEqual(normales, ['agenda-auto-0.db', 'agenda-auto-1.db', 'agenda-auto-2.db']);
  assert.equal(pre.length, 10);
  assert.ok(!pre.includes('agenda-x10-pre-import.db') && !pre.includes('agenda-x11-pre-import.db'), 'se podan los pre-* mas antiguos');
});

test('los pre-* no se podan mientras sean 10 o menos', () => {
  fs.rmSync(dirBackups, { recursive: true, force: true });
  fs.mkdirSync(dirBackups, { recursive: true });
  for (let i = 0; i < 8; i++) {
    const p = path.join(dirBackups, `agenda-n${i}.db`);
    fs.writeFileSync(p, 'x');
    const t = new Date(Date.now() - (i + 1) * 60000);
    fs.utimesSync(p, t, t);
  }
  const vieja = path.join(dirBackups, 'agenda-vieja-pre-fixes.db');
  fs.writeFileSync(vieja, 'x');
  const antes = new Date(Date.now() - 30 * 864e5);
  fs.utimesSync(vieja, antes, antes);
  backupMod.podar();
  assert.ok(fs.existsSync(vieja), 'un pre-fixes viejo sigue ahi');
  assert.equal(archivosBackup().filter((f) => !f.includes('pre-')).length, 3);
});

test('importar con limpiar=true toma un backup pre-import ANTES de borrar', async () => {
  const app = require('../server/index');
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  try {
    db.prepare("INSERT OR IGNORE INTO feriados (fecha, nombre) VALUES ('2099-02-02', 'MARCA')").run();
    const antes = archivosBackup().filter((f) => f.includes('pre-import')).length;
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/api/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limpiar: true, hojas: {} }),
    });
    assert.equal(r.status, 200, await r.text());
    const nuevos = archivosBackup().filter((f) => f.includes('pre-import'));
    assert.equal(nuevos.length, antes + 1);
    // el backup tomado conserva los datos previos al import destructivo
    const ultimo = nuevos.map((f) => path.join(dirBackups, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    const copia = new DatabaseSync(ultimo, { readOnly: true });
    try { assert.ok(copia.prepare("SELECT 1 x FROM feriados WHERE fecha='2099-02-02'").get()); } finally { copia.close(); }
  } finally { servidor.close(); }
});
