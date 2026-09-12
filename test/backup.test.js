'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-backup-test-${Date.now()}.db`);
const offsiteDir = path.join(os.tmpdir(), `agenda-backup-offsite-${Date.now()}`);
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_SIN_LOGIN = '1';
process.env.AGENDA_BACKUP_OFFSITE = offsiteDir;

process.env.AGENDA_BACKUPS = '1';

require('../server/db'); // crea el archivo de base de datos
const { backup } = require('../server/backup');
const { RAIZ } = require('../server/config');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  fs.rmSync(offsiteDir, { recursive: true, force: true });
  fs.rmSync(path.join(RAIZ, 'data', 'backups'), { recursive: true, force: true });
});

test('el backup tambien se copia a AGENDA_BACKUP_OFFSITE', () => {
  const destino = backup('prueba');
  assert.ok(fs.existsSync(destino));
  const nombre = path.basename(destino);
  assert.ok(fs.existsSync(path.join(offsiteDir, nombre)), 'debe existir la copia en la carpeta externa');
});

test('podar() no borra archivos .db ajenos a la carpeta externa compartida', () => {
  fs.mkdirSync(offsiteDir, { recursive: true });
  const ajeno = path.join(offsiteDir, 'otra-app.db');
  fs.writeFileSync(ajeno, 'no es un backup de la agenda');

  // AGENDA_BACKUPS=1: con dos backups nuestros de por medio, si podar() no filtrara
  // por nombre borraria el archivo ajeno por ser el ".db" mas viejo del directorio.
  backup('uno');
  backup('dos');

  assert.ok(fs.existsSync(ajeno), 'un .db que no es nuestro backup no deberia borrarse');
});
