'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDb = path.join(os.tmpdir(), `agenda-0830-da5-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;

const correo = require('../server/correo');
correo.habilitado = false;

const { db } = require('../server/db');
const app = require('../server/index');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(tmpDb + s); } catch (_) {}
  }
});

const ejecutarRuta = (metodo, ruta, params = {}, body = {}, query = {}) => new Promise((resolve, reject) => {
  const capa = app.router.stack.find((r) => r.route && r.route.path === ruta && r.route.methods[metodo.toLowerCase()]);
  if (!capa) return reject(new Error(`Ruta ${metodo} ${ruta} no encontrada`));
  const req = { params, body, query, headers: {} };
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode || 200, datos: data }); },
    send(buf) { resolve({ status: this.statusCode || 200, buffer: buf }); },
    setHeader() {},
  };
  capa.route.stack[0].handle(req, res, (err) => {
    if (err) resolve({ status: err.status || 500, error: err });
    else resolve({ status: res.statusCode || 200, datos: null });
  });
});

test('GET /api/agenda nunca devuelve horas 08:30 desde 2026-11-09', async () => {
  const ex = db.prepare('SELECT id FROM examinadores LIMIT 1').get();
  // Insertar un bloque 08:30 antes y uno despues
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-11-06', '08:30', ex.id);
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-11-10', '08:30', ex.id);
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-11-10', '09:00', ex.id);

  const resAntes = await ejecutarRuta('GET', '/api/agenda', {}, {}, { fecha: '2026-11-06' });
  assert.equal(resAntes.status, 200);
  assert.ok(resAntes.datos.some((b) => b.hora === '08:30'), 'Debe incluir 08:30 antes del 9 de nov');

  const resDespues = await ejecutarRuta('GET', '/api/agenda', {}, {}, { fecha: '2026-11-10' });
  assert.equal(resDespues.status, 200);
  assert.equal(resDespues.datos.some((b) => b.hora === '08:30'), false, 'NO debe incluir 08:30 desde el 9 de nov');
  assert.ok(resDespues.datos.some((b) => b.hora === '09:00'), 'Debe incluir 09:00');
});

test('GET /api/disponibles nunca devuelve horas 08:30 desde 2026-11-09', async () => {
  const res = await ejecutarRuta('GET', '/api/disponibles', {}, {}, { desde: '2026-11-09', hasta: '2026-11-15' });
  if (res.status !== 200) console.error('ERROR EN TEST PUT:', res.error || res.datos);
  assert.equal(res.status, 200);
  assert.equal(res.datos.some((b) => b.hora === '08:30'), false, 'Citas disponibles no debe tener 08:30');
});

test('GET /api/disponibles?clase=D admite bloques de las 12:30 en adelante (12:30, 13:00, 13:30)', async () => {
  const ex = db.prepare('SELECT id FROM examinadores LIMIT 1').get();
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-11-12', '12:30', ex.id);
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-11-12', '13:00', ex.id);
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-11-12', '10:00', ex.id);

  const res = await ejecutarRuta('GET', '/api/disponibles', {}, {}, { fecha: '2026-11-12', clase: 'D' });
  if (res.status !== 200) console.error('ERROR EN TEST PUT:', res.error || res.datos);
  assert.equal(res.status, 200);
  assert.ok(res.datos.some((b) => b.hora === '12:30'));
  assert.ok(res.datos.some((b) => b.hora === '13:00'));
  assert.equal(res.datos.some((b) => b.hora === '10:00'), false, 'No debe listar 10:00 para clase D');
});

test('PUT /api/agenda/:id permite clase D en bloques de las 12:30 en adelante', async () => {
  const ex = db.prepare('SELECT id FROM examinadores LIMIT 1').get();
  const { lastInsertRowid: id1300 } = db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)')
    .run('2029-02-15', '13:00', ex.id);

  const res = await ejecutarRuta('PUT', '/api/agenda/:id', { id: String(id1300) }, {
    rut: '12.345.678-5',
    nombre: 'CONDUCTOR PROFESIONAL',
    clase: 'D',
    contacto: '+56 9 9999 8888',
    correo: 'profesional@test.cl',
  });
  if (res.status !== 200) console.error('ERROR EN TEST PUT:', res.error || res.datos);
  assert.equal(res.status, 200);
  assert.equal(res.datos.ok, true);
  const guardado = db.prepare('SELECT clase FROM agenda WHERE id = ?').get(id1300);
  assert.equal(guardado.clase, 'D');
});

test('editor-cita.js y disponibles.js: contienen restricciones visuales y de texto para D/A5', () => {
  const editorJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'editor-cita.js'), 'utf8');
  assert.ok(editorJs.includes('Solo disponible en bloques de las 12:30 en adelante'));
  assert.ok(editorJs.includes('Solo desde 12:30'));

  const dispJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'disponibles.js'), 'utf8');
  assert.ok(dispJs.includes('solo bloques de las'));
  assert.ok(dispJs.includes('en adelante'));
  assert.ok(dispJs.includes("r.fecha >= '2026-11-09' && r.hora === '08:30'"));
});

test('styles.css: columna de fecha sticky en Citas Disponibles y scrollbar track bajo thead', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  
  // 1. Sticky date column in Disponibles
  assert.ok(css.includes('#view #tabla-disponibles-main tbody td.fecha-celda'));
  assert.ok(css.includes('vertical-align: top !important;'));
  assert.ok(css.includes('#view #tabla-disponibles-main tbody td.fecha-celda .fecha-slot-tabla'));
  assert.ok(css.includes('position: sticky;'));
  
  // 2. Vertical scrollbar starting below thead and no rogue scrollbar-color
  assert.ok(css.includes('.tabla-agenda-scroll::-webkit-scrollbar-track:vertical'));
  assert.ok(css.includes('margin-top: var(--thead-h, var(--cab-alto, 45px)) !important;'));
  assert.ok(!css.includes('scrollbar-color:'));
});
