'use strict';
// "Por vencer" -> prioridad en Lista de espera: filas con pendiente_reagendar/confirmo_asistencia,
// POST /api/agenda/:id/pendiente marca la cola de cambio, y la funcion pura que decide el boton.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tmpDb = path.join(os.tmpdir(), `agenda-porvencer-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-porvencer-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const correo = require('../server/correo');
correo.habilitado = true;
correo.confirmacion = async () => true;
correo.recordatorio = async () => true;
correo.solicitudConfirmacion = async () => true;

const { db } = require('../server/db');
const { hoyISO } = require('../server/fechas');
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

async function api(metodo, ruta, json) {
  const init = { method: metodo, headers: {} };
  if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  const r = await fetch(`${base}/api${ruta}`, init);
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

const hoyMas = (n) => {
  const d = new Date(`${hoyISO()}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let exN = 900;
function examinadorNuevo() {
  const nombre = `EX VENCER ${exN++}`;
  db.prepare('INSERT INTO examinadores (nombre) VALUES (?)').run(nombre);
  return db.prepare('SELECT id FROM examinadores WHERE nombre = ?').get(nombre).id;
}

test('GET /api/tramites-por-vencer trae pendiente_reagendar y confirmo_asistencia', async () => {
  const ex = examinadorNuevo();
  db.prepare(`INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, fecha_inicio_tramite)
    VALUES (?, '09:00', ?, '10.000.000-1', 'VENCE', 'D', ?)`).run(hoyMas(3), ex, hoyISO());

  const r = await api('GET', '/tramites-por-vencer?filtro=todos');
  assert.equal(r.status, 200, r.texto);
  const fila = r.datos.find((x) => x.rut === '10.000.000-1');
  assert.ok(fila, 'la fila deberia estar en la respuesta');
  assert.ok('pendiente_reagendar' in fila);
  assert.ok('confirmo_asistencia' in fila);
});

test('POST /api/agenda/:id/pendiente {valor:true} hace aparecer a la persona en /api/lista-espera con origen "cambio"', async () => {
  const ex = examinadorNuevo();
  db.prepare(`INSERT INTO agenda (fecha, hora, examinador_id, rut, nombre, clase, fecha_inicio_tramite)
    VALUES (?, '09:00', ?, '10.000.000-2', 'PRIORIDAD', 'D', ?)`).run(hoyMas(5), ex, hoyISO());
  const bloque = db.prepare('SELECT * FROM agenda WHERE rut = ?').get('10.000.000-2');

  const rp = await api('POST', `/agenda/${bloque.id}/pendiente`, { valor: true, nota: 'Prioridad: trámite vence el 01/01/2027 (Por vencer)' });
  assert.equal(rp.status, 200, rp.texto);

  const r = await api('GET', '/lista-espera');
  assert.equal(r.status, 200, r.texto);
  const persona = r.datos.personas.find((p) => p.rut === '10.000.000-2');
  assert.ok(persona, 'la persona deberia aparecer en lista de espera');
  assert.equal(persona.origen, 'cambio');
});

function cargarAnalitica() {
  const sandbox = {};
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analitica.js'), 'utf8');
  vm.runInNewContext(codigo, sandbox);
  return sandbox;
}

// Comparacion campo a campo: el objeto devuelto viene de un vm.runInNewContext (otro "realm"),
// y assert.deepStrictEqual rechaza objetos de distinto realm aunque tengan la misma forma.
function asertarEstado(r, esperado) {
  assert.equal(r.habilitado, esperado.habilitado);
  assert.equal(r.texto, esperado.texto);
}

test('estadoPrioridadVencer: ya en lista de espera', () => {
  const { estadoPrioridadVencer } = cargarAnalitica();
  const r = estadoPrioridadVencer({ pendiente_reagendar: 1, fecha: '2026-01-01', confirmo_asistencia: null, dias_restantes_tramite: 10 }, '2025-01-01');
  asertarEstado(r, { habilitado: false, texto: 'Ya en lista de espera' });
});

test('estadoPrioridadVencer: cita pasada', () => {
  const { estadoPrioridadVencer } = cargarAnalitica();
  const r = estadoPrioridadVencer({ pendiente_reagendar: 0, fecha: '2025-01-01', confirmo_asistencia: null, dias_restantes_tramite: 10 }, '2025-06-01');
  asertarEstado(r, { habilitado: false, texto: 'Cita pasada' });
});

test('estadoPrioridadVencer: confirmo asistencia', () => {
  const { estadoPrioridadVencer } = cargarAnalitica();
  const r = estadoPrioridadVencer({ pendiente_reagendar: 0, fecha: '2026-01-01', confirmo_asistencia: 1, dias_restantes_tramite: 10 }, '2025-06-01');
  asertarEstado(r, { habilitado: false, texto: 'Confirmó asistencia' });
});

test('estadoPrioridadVencer: tramite vencido', () => {
  const { estadoPrioridadVencer } = cargarAnalitica();
  const r = estadoPrioridadVencer({ pendiente_reagendar: 0, fecha: '2026-01-01', confirmo_asistencia: null, dias_restantes_tramite: 0 }, '2025-06-01');
  asertarEstado(r, { habilitado: false, texto: 'Trámite vencido' });
});

test('estadoPrioridadVencer: habilitado', () => {
  const { estadoPrioridadVencer } = cargarAnalitica();
  const r = estadoPrioridadVencer({ pendiente_reagendar: 0, fecha: '2026-01-01', confirmo_asistencia: null, dias_restantes_tramite: 5 }, '2025-06-01');
  asertarEstado(r, { habilitado: true, texto: 'Dar prioridad en lista de espera' });
});

test('renderVencimientos ya no contiene la cadena "abrirSlotPorId"', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analitica.js'), 'utf8');
  assert.ok(!codigo.includes('abrirSlotPorId'));
});

test('renderVencimientos contiene boton data-eliminar y llamada a liberar cupo', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analitica.js'), 'utf8');
  assert.ok(codigo.includes('data-eliminar'));
  assert.ok(codigo.includes('/liberar'));
});
