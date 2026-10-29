'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const XLSX = require('xlsx');

const tmpDb = path.join(os.tmpdir(), `agenda-reglas-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;

const { db } = require('../server/db');
const { generarXlsxCompleto } = require('../server/export');
const app = require('../server/index');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(tmpDb + s); } catch (_) {}
  }
});

test('index.html: pestaña Confirmaciones y versionador de estilos y scripts actualizado', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('Confirmaciones'));
  assert.ok(/styles\.css\?v=21[3-9]/.test(html));
  assert.ok(html.includes('js/porconfirmar.js?v=92'));
  assert.ok(/js\/analitica\.js\?v=9[1-9]/.test(html));
  assert.ok(/js\/datos\.js\?v=7[89]/.test(html));
});

test('porconfirmar.js: botones y colas cambiaron WhatsApp a SMS', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'porconfirmar.js'), 'utf8');
  assert.ok(js.includes('SMS a seleccionados'));
  assert.ok(js.includes('SMS a todos'));
  assert.ok(js.includes('Cola de SMS'));
  assert.ok(js.includes('Abrir SMS'));
  assert.ok(js.includes('sms:+'));
});

test('analitica.js: tabla tramites por vencer incluye boton Eliminar / liberar cupo', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analitica.js'), 'utf8');
  assert.ok(js.includes('data-eliminar'));
  assert.ok(js.includes('/liberar'));
});

test('datos.js: seccion Importar / Exportar incluye Descargar Excel completo', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'datos.js'), 'utf8');
  assert.ok(js.includes('Descargar Excel completo'));
  assert.ok(js.includes('/api/export?formato=completo'));
  assert.ok(js.includes('btn-eliminar-item'));
});

test('styles.css: barra de scroll no esta oculta con scrollbar-width: none y nav-badge es visible y amplio', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.ok(!css.includes('.tabla-agenda-scroll {\n  width: 100%;\n  overflow-x: auto;\n  -webkit-overflow-scrolling: touch;\n  max-height: calc(var(--tabla-alto, 80vh) - 16px);\n  position: relative;\n  scrollbar-width: none;'));
  assert.ok(css.includes('min-width: 24px;'));
  assert.ok(css.includes('height: 22px;'));
});

test('export.js: generarXlsxCompleto exporta todas las columnas y filas de agenda', () => {
  const ex = db.prepare('SELECT id, nombre FROM examinadores LIMIT 1').get();
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, contacto, correo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('2029-01-10', '12:30', ex.id, '19.999.999-9', 'JUAN PEREZ', 'D', '912345678', 'juan@test.cl');

  const buf = generarXlsxCompleto();
  const wb = XLSX.read(buf, { type: 'buffer' });
  assert.ok(wb.SheetNames.includes('AGENDA COMPLETA'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['AGENDA COMPLETA']);
  assert.ok(rows.length >= 1);
  const found = rows.find((r) => r.rut === '19.999.999-9');
  assert.ok(found);
  assert.equal(found.nombre, 'JUAN PEREZ');
  assert.equal(found.clase, 'D');
  assert.equal(found.examinador, ex.nombre);
});

const ejecutarRuta = (metodo, ruta, params = {}, body = {}) => new Promise((resolve, reject) => {
  const capa = app.router.stack.find((r) => r.route && r.route.path === ruta && r.route.methods[metodo.toLowerCase()]);
  if (!capa) return reject(new Error(`Ruta ${metodo} ${ruta} no encontrada`));
  const req = { params, body, headers: {} };
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

test('DELETE /api/examinadores/:id elimina si no tiene citas con personas', async () => {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO examinadores (nombre, activo) VALUES (?, 1)').run('EXAMINADOR_TEST_BORRAR');
  const res = await ejecutarRuta('DELETE', '/api/examinadores/:id', { id: String(id) });
  assert.equal(res.status, 200);
  assert.equal(res.datos.ok, true);
  assert.equal(res.datos.eliminado, true);
  const row = db.prepare('SELECT * FROM examinadores WHERE id = ?').get(id);
  assert.equal(row, undefined);
});

test('DELETE /api/examinadores/:id desactiva y marca eliminado si tiene citas con personas', async () => {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO examinadores (nombre, activo) VALUES (?, 1)').run('EXAMINADOR_CON_CITAS');
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase) VALUES (?, ?, ?, ?, ?, ?)')
    .run('2029-01-11', '09:00', id, '18.888.888-8', 'POSTULANTE', 'B');
    
  const res = await ejecutarRuta('DELETE', '/api/examinadores/:id', { id: String(id) });
  assert.equal(res.status, 200);
  assert.equal(res.datos.ok, true);
  assert.equal(res.datos.eliminado, true);
  assert.equal(res.datos.desactivado, true);
  const row = db.prepare('SELECT * FROM examinadores WHERE id = ?').get(id);
  assert.ok(row);
  assert.equal(row.activo, 0);
  assert.equal(row.eliminado, 1);
});

test('PUT /api/agenda/:id: rechaza clase D antes de las 12:30 con error 400', async () => {
  const ex = db.prepare('SELECT id FROM examinadores LIMIT 1').get();
  const { lastInsertRowid: bId } = db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)')
    .run('2029-01-12', '10:00', ex.id);

  const res = await ejecutarRuta('PUT', '/api/agenda/:id', { id: String(bId) }, {
    rut: '12.345.678-5',
    nombre: 'MARIO HUERTA',
    clase: 'D',
    contacto: '+56 9 1234 5678',
    correo: 'mario@test.cl',
    forzar: true,
  });
  assert.equal(res.status, 400);
  assert.ok(res.error);
  assert.match(res.error.message, /Las licencias Clase D y A5 solo pueden ser agendadas en bloques de las 12:30 en adelante/);
});
