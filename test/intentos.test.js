'use strict';
// Sugerencias para llenar un cupo liberado y limpieza rapida de datos de contacto.
// Base temporal y puerto efimero: NUNCA tocan data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-int-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-int-bk-'));
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



const RUT = '11.111.111-1';
let histN = 0;
function historial(resultados, clase = 'B') {
  resultados.forEach((r, i) => slot(hoyMas(-10 - i - 5 * (histN++)), '09:00', { rut: '11111111-1', nombre: 'REPITE', clase, correo: 'a@a.cl', resultado: r }));
}
const cuerpo = (extra = {}) => ({ rut: RUT, nombre: 'REPITE', clase: 'B', correo: 'a@a.cl', ...extra });

test('intentos: bloquea agendar 3er intento (409 TERCER_INTENTO), REPROBADO INASISTENCIA cuenta', async () => {
  limpiarTodo();
  historial(['REPROBADO', 'REPROBADO INASISTENCIA']);
  const s = slot(hoyMas(4), '10:00');
  const r = await api('PUT', `/agenda/${s.id}`, cuerpo());
  assert.equal(r.status, 409, r.texto);
  assert.equal(r.datos.codigo, 'TERCER_INTENTO');
  assert.equal(r.datos.clase, 'B');
  assert.equal(r.datos.reprobados, 2);
  assert.match(r.datos.error, /^Tercer intento bloqueado: .*reprobó 2 veces la clase B\. Requiere autorización con motivo\.$/);
  assert.equal(db.prepare('SELECT rut FROM agenda WHERE id=?').get(s.id).rut, null);
});

test('intentos: clase multiple bloquea si alguna clase tiene 2 reprobados', async () => {
  limpiarTodo();
  historial(['REPROBADO', 'REPROBADO'], 'C');
  const s = slot(hoyMas(4), '10:00');
  const r = await api('PUT', `/agenda/${s.id}`, cuerpo({ clase: 'B,C' }));
  assert.equal(r.status, 409, r.texto);
  assert.equal(r.datos.clase, 'C');
});

test('intentos: NO ASISTIO no cuenta y otra clase no se bloquea', async () => {
  limpiarTodo();
  historial(['REPROBADO', 'NO ASISTIO']);
  historial(['REPROBADO', 'REPROBADO'], 'C');
  const s = slot(hoyMas(4), '10:00');
  const r = await api('PUT', `/agenda/${s.id}`, cuerpo());
  assert.equal(r.status, 200, r.texto);
});

test('intentos: autorizar con motivo guarda, registra movimiento y comentario; motivo corto 400', async () => {
  limpiarTodo();
  historial(['REPROBADO', 'REPROBADO']);
  const s = slot(hoyMas(4), '10:00');
  let r = await api('PUT', `/agenda/${s.id}`, cuerpo({ autorizar_tercer_intento: { motivo: 'corto' } }));
  assert.equal(r.status, 400, r.texto);
  r = await api('PUT', `/agenda/${s.id}`, cuerpo({ comentarios: 'previo', autorizar_tercer_intento: { motivo: 'Jefatura autoriza por oficio 123' } }));
  assert.equal(r.status, 200, r.texto);
  const fila = db.prepare('SELECT rut, comentarios FROM agenda WHERE id=?').get(s.id);
  assert.ok(fila.rut);
  assert.match(fila.comentarios, /previo/);
  assert.match(fila.comentarios, /Autorizado 3er intento: Jefatura autoriza por oficio 123/);
  const mov = db.prepare("SELECT * FROM movimientos WHERE agenda_id=? AND accion='autorizar_tercer_intento'").get(s.id);
  assert.ok(mov);
  assert.match(mov.detalle, /oficio 123/);
});

test('intentos: editar otros campos de una cita existente de 3er intento no se bloquea', async () => {
  limpiarTodo();
  historial(['REPROBADO', 'REPROBADO']);
  const s = slot(hoyMas(4), '10:00', { rut: RUT, nombre: 'REPITE', clase: 'B', correo: 'a@a.cl' });
  const r = await api('PUT', `/agenda/${s.id}`, cuerpo({ comentarios: 'llamar antes' }));
  assert.equal(r.status, 200, r.texto);
});

test('intentos: reagendar (mover) con destino no se bloquea', async () => {
  limpiarTodo();
  historial(['REPROBADO', 'REPROBADO']);
  const o = slot(hoyMas(4), '10:00', { rut: RUT, nombre: 'REPITE', clase: 'B', correo: 'a@a.cl' });
  const d = slot(hoyMas(6), '11:00');
  const r = await api('POST', `/agenda/${o.id}/reagendar`, { destino_id: d.id });
  assert.equal(r.status, 200, r.texto);
});
