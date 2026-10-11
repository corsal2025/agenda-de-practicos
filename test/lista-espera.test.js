'use strict';
// Sugerencias para llenar un cupo liberado y limpieza rapida de datos de contacto.
// Base temporal y puerto efimero: NUNCA tocan data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-le-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-le-bk-'));
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
  const r = await fetch(base + '/api' + ruta, init);
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
let diaN = 3;
const diaNuevo = () => hoyMas(diaN++);
let exN = 10;
// Cada test usa un examinador propio para no mezclar candidatos/colas entre tests.
function examinadorNuevo() {
  const nombre = `EXAM TEST ${exN++}`;
  db.prepare('INSERT INTO examinadores (nombre) VALUES (?)').run(nombre);
}
function slot(fecha, hora, extra = {}, examinador_id = 1) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(fecha, hora, examinador_id);
  const fila = db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=?').get(fecha, hora, examinador_id);
  const cols = Object.keys(extra);
  if (cols.length) db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...extra, id: fila.id });
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(fila.id);
}
const limpiarTodo = () => {
  db.prepare("UPDATE cola_reagendar SET estado = 'descartado' WHERE estado = 'pendiente'").run();
  db.prepare('DELETE FROM agenda').run();
};
function encolar(datos, creado_en) {
  db.prepare(`INSERT INTO cola_reagendar (rut, nombre, clase, correo, origen_fecha, origen_hora, motivo, creado_en, fecha_inicio_tramite)
    VALUES (@rut, @nombre, @clase, @correo, @of, '09:00', 'TEST', @creado_en, @fit)`)
    .run({ rut: null, correo: 'x@x.cl', of: hoyISO(), fit: null, ...datos, creado_en });
  return db.prepare('SELECT id FROM cola_reagendar ORDER BY id DESC LIMIT 1').get().id;
}

test('GET /lista-espera: cola + lista de espera futura, en orden de ranking, con datos y cupos compatibles', async () => {
  limpiarTodo();
  const ex = examinadorNuevo();
  const d1 = hoyMas(2); const d2 = hoyMas(3); const lejos = hoyMas(20);
  slot(d1, '09:00', {}, ex);
  slot(d1, '12:30', {}, ex);
  slot(d2, '09:00', {}, ex);
  slot(hoyMas(40), '09:00', {}, ex); // fuera de 30 dias
  slot(d2, '10:00', { bloqueado: 1 }, ex); // bloqueado no cuenta
  encolar({ nombre: 'COLA B', clase: 'B', rut: '11.111.111-1' }, '2026-01-01 08:00:00');
  encolar({ nombre: 'COLA D', clase: 'D' }, '2026-02-01 08:00:00');
  slot(lejos, '10:00', { rut: '22.222.222-2', nombre: 'ADELANTA', clase: 'B', correo: 'a@a.cl', lista_espera: 'SI', fecha_inicio_tramite: hoyISO() }, ex);
  slot(hoyMas(-5), '10:00', { rut: '33.333.333-3', nombre: 'PASADA', clase: 'B', lista_espera: 'SI' }, ex); // pasada: no
  // COLA B ya tiene cita el d1: no puede tomar cupos de ese dia.
  slot(d1, '11:00', { rut: '11.111.111-1', nombre: 'COLA B', clase: 'B', correo: 'x@x.cl' }, ex);

  const r = await api('GET', '/lista-espera');
  assert.equal(r.status, 200, r.texto);
  const p = r.datos.personas;
  assert.deepEqual(p.map((x) => x.nombre), ['COLA B', 'COLA D', 'ADELANTA']);
  assert.equal(p[0].origen, 'reagendar');
  assert.equal(p[0].motivo, 'TEST');
  assert.equal(p[0].cupos_compatibles, 1); // solo d2 09:00
  assert.equal(p[1].cupos_compatibles, 1); // solo 12:30
  assert.equal(p[2].origen, 'lista_espera');
  assert.equal(p[2].fecha, lejos);
  assert.equal(p[2].cupos_compatibles, 3);
  assert.ok(p[2].dias_restantes_tramite > 150);
  assert.equal(typeof p[0].dias_esperando, 'number');
});

test('GET /lista-espera/:origen/:id/cupos: devuelve cupos compatibles; valida origen e id', async () => {
  limpiarTodo();
  const ex = examinadorNuevo();
  const a = slot(hoyMas(2), '09:00', {}, ex);
  const b = slot(hoyMas(4), '12:30', {}, ex);
  slot(hoyMas(12), '09:00', {}, ex); // posterior a la cita actual: no adelanta
  const colaId = encolar({ nombre: 'PESADO', clase: 'A5' }, '2026-01-01 08:00:00');
  const cita = slot(hoyMas(10), '10:00', { rut: '44.444.444-4', nombre: 'ADEL', clase: 'B', correo: 'a@a.cl', lista_espera: 'SI' }, ex);

  let r = await api('GET', `/lista-espera/reagendar/${colaId}/cupos`);
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.datos.cupos.map((c) => c.id), [b.id]);
  assert.ok(r.datos.cupos[0].examinador);

  r = await api('GET', `/lista-espera/lista_espera/${cita.id}/cupos`);
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.datos.cupos.map((c) => c.id), [a.id, b.id]);

  assert.equal((await api('GET', `/lista-espera/otro/${cita.id}/cupos`)).status, 400);
  assert.equal((await api('GET', '/lista-espera/reagendar/999999/cupos')).status, 404);
});

test('cambio: citas pendiente_reagendar=1 entran como origen "cambio", entre cola y lista, sin duplicar', async () => {
  limpiarTodo();
  const ex = examinadorNuevo();
  const libre = slot(hoyMas(2), '09:00', {}, ex);
  encolar({ nombre: 'COLA X', clase: 'B' }, '2026-01-01 08:00:00');
  const camb = slot(hoyMas(8), '10:00', { rut: '55.555.555-5', nombre: 'CAMBIA', clase: 'B', correo: 'c@c.cl',
    pendiente_reagendar: 1, lista_espera: 'SI' }, ex);
  slot(hoyMas(15), '10:00', { rut: '66.666.666-6', nombre: 'ADELANTA2', clase: 'B', correo: 'd@d.cl', lista_espera: 'SI' }, ex);

  let r = await api('GET', '/lista-espera');
  assert.equal(r.status, 200, r.texto);
  const p = r.datos.personas;
  assert.deepEqual(p.map((x) => x.nombre), ['COLA X', 'CAMBIA', 'ADELANTA2']);
  assert.equal(p[1].origen, 'cambio');
  assert.equal(p[1].fecha, camb.fecha);
  assert.equal(p[1].hora, '10:00');
  assert.ok(p[1].cupos_compatibles >= 1);

  r = await api('GET', `/sugerencias-cupo/${libre.id}`);
  assert.equal(r.status, 200, r.texto);
  const c = r.datos.candidatos.map((x) => `${x.origen}:${x.nombre}`);
  assert.deepEqual(c, ['cola:COLA X', 'cambio:CAMBIA', 'lista_espera:ADELANTA2']);

  r = await api('GET', `/lista-espera/cambio/${camb.id}/cupos`);
  assert.equal(r.status, 200, r.texto);
  assert.ok(r.datos.cupos.some((x) => x.id === libre.id));

  // Asignar: mueve la cita y limpia pendiente_reagendar; deja de figurar como cambio.
  r = await api('POST', `/agenda/${camb.id}/reagendar`, { destino_id: libre.id });
  assert.equal(r.status, 200, r.texto);
  assert.equal(db.prepare('SELECT pendiente_reagendar FROM agenda WHERE id=?').get(libre.id).pendiente_reagendar, 0);
  assert.equal((await api('GET', `/lista-espera/cambio/${camb.id}/cupos`)).status, 404);
});
