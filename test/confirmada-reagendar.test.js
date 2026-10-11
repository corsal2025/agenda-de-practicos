'use strict';
// Sugerencias para llenar un cupo liberado y limpieza rapida de datos de contacto.
// Base temporal y puerto efimero: NUNCA tocan data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-conf-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-conf-bk-'));
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


const ddmm = (iso) => iso.split('-').reverse().join('/');

test('reagendar: rechaza 409 si confirmó asistencia y la fecha es hoy o futura (con y sin destino)', async () => {
  limpiarTodo();
  for (const f of [hoyISO(), hoyMas(2)]) {
    const c = slot(f, '10:00', { rut: '11.111.111-1', nombre: 'CONF', clase: 'B', correo: 'a@a.cl', confirmo_asistencia: 1 });
    const d = slot(hoyMas(5), '11:00');
    let r = await api('POST', `/agenda/${c.id}/reagendar`, {});
    assert.equal(r.status, 409, r.texto);
    assert.match(r.datos.error, new RegExp(`confirmó asistencia para el ${ddmm(f)}`));
    r = await api('POST', `/agenda/${c.id}/reagendar`, { destino_id: d.id });
    assert.equal(r.status, 409, r.texto);
    assert.equal(db.prepare('SELECT pendiente_reagendar p FROM agenda WHERE id=?').get(c.id).p, 0);
    assert.equal(db.prepare('SELECT rut FROM agenda WHERE id=?').get(d.id).rut, null);
    limpiarTodo();
  }
});

test('reagendar: permite si la fecha ya pasó, con forzar_confirmada o si no está confirmada', async () => {
  limpiarTodo();
  const pasada = slot(hoyMas(-1), '10:00', { rut: '1-9', nombre: 'P', clase: 'B', correo: 'a@a.cl', confirmo_asistencia: 1 });
  assert.equal((await api('POST', `/agenda/${pasada.id}/reagendar`, {})).status, 200);
  const forz = slot(hoyMas(2), '10:00', { rut: '2-7', nombre: 'F', clase: 'B', correo: 'a@a.cl', confirmo_asistencia: 1 });
  const r = await api('POST', `/agenda/${forz.id}/reagendar`, { forzar_confirmada: true });
  assert.equal(r.status, 200, r.texto);
  for (const v of [null, 0]) {
    const s = slot(hoyMas(3), v === null ? '10:00' : '11:00', { rut: '3-5', nombre: 'N', clase: 'B', correo: 'a@a.cl', confirmo_asistencia: v });
    assert.equal((await api('POST', `/agenda/${s.id}/reagendar`, {})).status, 200);
  }
});

test('lista-espera: excluye citas confirmadas futuras (lista_espera y cambio)', async () => {
  limpiarTodo();
  slot(hoyMas(2), '09:00');
  slot(hoyMas(20), '10:00', { rut: '4-3', nombre: 'LE CONF', clase: 'B', correo: 'a@a.cl', lista_espera: 'SI', confirmo_asistencia: 1 });
  slot(hoyMas(21), '10:00', { rut: '5-1', nombre: 'CAMBIO CONF', clase: 'B', correo: 'a@a.cl', pendiente_reagendar: 1, confirmo_asistencia: 1 });
  slot(hoyMas(22), '10:00', { rut: '6-K', nombre: 'LE OK', clase: 'B', correo: 'a@a.cl', lista_espera: 'SI' });
  const r = await api('GET', '/lista-espera');
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.datos.personas.map((p) => p.nombre), ['LE OK']);
  const cupo = db.prepare('SELECT id FROM agenda WHERE fecha=? AND hora=?').get(hoyMas(2), '09:00');
  const s = await api('GET', `/sugerencias-cupo/${cupo.id}`);
  assert.equal(s.status, 200, s.texto);
  assert.ok(!JSON.stringify(s.datos).includes('LE CONF'));
});
