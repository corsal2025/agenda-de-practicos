'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tmpDb = path.join(os.tmpdir(), `agenda-tc-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-tc-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const { CATALOGOS } = require('../server/config');
const { db } = require('../server/db');
const app = require('../server/index');

let servidor;
let base;
test.before(async () => {
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => {
  servidor.close();
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
  fs.rmSync(tmpBackups, { recursive: true, force: true });
});

const ejecutarRuta = (metodo, ruta, body = {}, query = {}) => new Promise((resolve, reject) => {
  // Manejo de parámetros de ruta como /api/agenda/:id/tipo-cita
  const rutaNorm = ruta.replace(/\/\d+(\/|$)/, '/:id$1');
  const idMatch = ruta.match(/\/(\d+)(\/|$)/);
  const params = idMatch ? { id: idMatch[1] } : {};
  const capa = app.router.stack.find((r) => r.route && r.route.path === rutaNorm && r.route.methods[metodo.toLowerCase()]);
  if (!capa) return reject(new Error(`Ruta ${metodo} ${rutaNorm} no encontrada`));
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

async function api(metodo, ruta, json) {
  try {
    const init = { method: metodo, headers: {} };
    if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
    const r = await fetch(base + '/api' + ruta, init);
    const texto = await r.text();
    let datos = null;
    try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
    return { status: r.status, datos, texto };
  } catch (err) {
    if (err.cause && err.cause.code === 'EACCES') {
      return ejecutarRuta(metodo, '/api' + ruta, json);
    }
    throw err;
  }
}

test('CATALOGOS.tipo_cita contiene las 5 opciones exactas', () => {
  assert.deepEqual(CATALOGOS.tipo_cita, [
    'NORMAL',
    'REAGENDAMIENTO PRESENCIAL',
    'REAGENDAMIENTO LLAMADA',
    'REAGENDAMIENTO CORREO',
    'REAGENDAMIENTO POR NOSOTROS',
  ]);
});

test('tabla catalogos sincronizada con las 5 opciones activas', async () => {
  const res = await api('GET', '/meta');
  assert.equal(res.status, 200);
  assert.deepEqual(res.datos.catalogos.tipo_cita, [
    'NORMAL',
    'REAGENDAMIENTO PRESENCIAL',
    'REAGENDAMIENTO LLAMADA',
    'REAGENDAMIENTO CORREO',
    'REAGENDAMIENTO POR NOSOTROS',
  ]);
});

test('normalizarTipoCita mapea correctamente abreviaciones antiguas', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'grilla.js'), 'utf8');
  const ctx = {
    window: {},
    document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
  };
  vm.createContext(ctx);
  // Extraer o ejecutar la función normalizarTipoCita
  const fnMatch = src.match(/function normalizarTipoCita[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'normalizarTipoCita debe estar definida');
  vm.runInContext(fnMatch[0], ctx);
  const fn = ctx.normalizarTipoCita;

  assert.equal(fn('NORMAL'), 'NORMAL');
  assert.equal(fn(''), 'NORMAL');
  assert.equal(fn(null), 'NORMAL');
  assert.equal(fn('REAG. X NOSOTROS'), 'REAGENDAMIENTO POR NOSOTROS');
  assert.equal(fn('REAGENDAMIENTO POR NOSOTROS'), 'REAGENDAMIENTO POR NOSOTROS');
  assert.equal(fn('REAG. LLAMADA'), 'REAGENDAMIENTO LLAMADA');
  assert.equal(fn('REAG. CORREO'), 'REAGENDAMIENTO CORREO');
  assert.equal(fn('REAG. PRESENCIAL'), 'REAGENDAMIENTO PRESENCIAL');
  assert.equal(fn('REAGENDADO'), 'REAGENDAMIENTO PRESENCIAL');
});

test('POST y PATCH /api/agenda/:id/tipo-cita actualiza tipo_cita atómicamente', async () => {
  const ex = db.prepare('SELECT id FROM examinadores LIMIT 1').get().id;
  const ins = db.prepare(`
    INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, tipo_cita)
    VALUES ('2026-11-20', '09:00', ?, '11.111.111-1', 'JUAN PRUEBA', 'B', 'NORMAL')
  `).run(ex);
  const id = Number(ins.lastInsertRowid);

  // POST válido
  const r1 = await api('POST', `/agenda/${id}/tipo-cita`, { tipo_cita: 'REAGENDAMIENTO POR NOSOTROS' });
  assert.equal(r1.status, 200);
  assert.equal(r1.datos.ok, true);
  assert.equal(r1.datos.tipo_cita, 'REAGENDAMIENTO POR NOSOTROS');

  const fila1 = db.prepare('SELECT tipo_cita FROM agenda WHERE id = ?').get(id);
  assert.equal(fila1.tipo_cita, 'REAGENDAMIENTO POR NOSOTROS');

  // PATCH válido
  const r2 = await api('PATCH', `/agenda/${id}/tipo-cita`, { tipo_cita: 'REAGENDAMIENTO LLAMADA' });
  assert.equal(r2.status, 200);
  assert.equal(r2.datos.ok, true);
  assert.equal(r2.datos.tipo_cita, 'REAGENDAMIENTO LLAMADA');

  const fila2 = db.prepare('SELECT tipo_cita FROM agenda WHERE id = ?').get(id);
  assert.equal(fila2.tipo_cita, 'REAGENDAMIENTO LLAMADA');

  // Rechazar tipo_cita inválido
  const rInv = await api('POST', `/agenda/${id}/tipo-cita`, { tipo_cita: 'INVENTADO' });
  assert.equal(rInv.status, 400);

  // 404 si el ID no existe o no tiene cita
  const r404 = await api('POST', '/agenda/99999999/tipo-cita', { tipo_cita: 'NORMAL' });
  assert.equal(r404.status, 404);
});
