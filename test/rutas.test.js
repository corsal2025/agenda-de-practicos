'use strict';
// Tests de rutas HTTP. Usan una base temporal y un puerto efimero: NUNCA tocan data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Variables de entorno ANTES de requerir los modulos del servidor.
const tmpDb = path.join(os.tmpdir(), `agenda-rutas-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-rutas-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;
process.env.AGENDA_SIN_LOGIN = '1';

// Correo falso: nunca se envia nada real (el .env local podria traer SMTP).
const correo = require('../server/correo');
const enviados = [];
correo.habilitado = true;
correo.confirmacion = async (b) => { enviados.push(b.id); return true; };
correo.recordatorio = async () => true;

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

// ---------- helpers ----------
async function http(metodo, ruta, { json, form } = {}) {
  const init = { method: metodo, headers: {} };
  if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  if (form !== undefined) { init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
  const r = await fetch(base + ruta, init);
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch (_) { /* html */ }
  return { status: r.status, texto, datos };
}
const api = (m, ruta, json) => http(m, '/api' + ruta, { json });

const hoyMas = (n) => {
  const d = new Date(`${hoyISO()}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Cada test usa un dia propio para no pisarse con los demas.
let diaN = 100;
const diaNuevo = () => hoyMas(diaN++);

function slot(fecha, hora, extra = {}, examinador_id = 1) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(fecha, hora, examinador_id);
  const fila = db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=?').get(fecha, hora, examinador_id);
  const cols = Object.keys(extra);
  if (cols.length) {
    db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...extra, id: fila.id });
  }
  return leer(fila.id);
}
const leer = (id) => db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
// Slot ocupado con token y banderas de correo ya "usadas".
const ocupado = (fecha, hora, extra = {}, examinador_id = 1) => slot(fecha, hora, {
  rut: '11.111.111-1', nombre: 'JUAN PEREZ', clase: 'B', correo: 'juan@x.cl',
  token_confirmacion: 'tokenviejo', correo_confirmacion_enviado: 1, correo_recordatorio_enviado: 1,
  ...extra,
}, examinador_id);
const sinTokens = (b) => {
  assert.equal(b.token_confirmacion, null, 'token_confirmacion debe quedar NULL');
  assert.equal(b.correo_confirmacion_enviado, 0, 'correo_confirmacion_enviado debe quedar 0');
  assert.equal(b.correo_recordatorio_enviado, 0, 'correo_recordatorio_enviado debe quedar 0');
};

test('la app se puede importar sin escuchar en el puerto 4900', async () => {
  const r = await api('GET', '/meta');
  assert.equal(r.status, 200);
});

// ---------- 1) reagendar publico: columna inexistente ----------
test('reagendar publico: elegir un horario libre mueve la cita (sin columna nacionalidad)', async () => {
  const dia = diaNuevo();
  const origen = ocupado(dia, '09:00');
  const destino = slot(hoyMas(1), '10:00');
  const r = await http('POST', `/reagendar/${origen.id}/tokenviejo/elegir`, { form: { nuevo_slot_id: destino.id } });
  assert.equal(r.status, 200, r.texto);
  const d = leer(destino.id);
  assert.equal(d.rut, '11.111.111-1');
  assert.equal(d.tipo_cita, 'REAGENDADO');
  assert.ok(d.token_confirmacion && d.token_confirmacion !== 'tokenviejo');
  const o = leer(origen.id);
  assert.equal(o.rut, null);
  sinTokens(o);
});

// ---------- 2) wrap debe capturar rechazos de handlers async ----------
test('handler async que lanza responde con su estado en vez de colgarse', async () => {
  const r = await api('POST', '/agenda/99999999/confirmar', { valor: 1 });
  assert.equal(r.status, 404);
  assert.match(r.datos.error, /no encontrado/i);
});

// ---------- 3) tokens/banderas de correo al liberar, ocupar o mover ----------
test('liberar deja token y banderas de correo en cero', async () => {
  const b = ocupado(diaNuevo(), '09:00');
  const r = await api('POST', `/agenda/${b.id}/liberar`, {});
  assert.equal(r.status, 200);
  sinTokens(leer(b.id));
});

test('bloquear-dia limpia token y banderas de las citas bloqueadas', async () => {
  const dia = diaNuevo();
  const b = ocupado(dia, '09:00');
  const r = await api('POST', '/bloquear-dia', { desde: dia, hasta: dia, motivo: 'TERRENO', incluir_ocupados: true });
  assert.equal(r.status, 200);
  const x = leer(b.id);
  assert.equal(x.bloqueado, 1);
  sinTokens(x);
});

test('PUT con bloqueado=true limpia token y banderas', async () => {
  const b = ocupado(diaNuevo(), '09:00');
  const r = await api('PUT', `/agenda/${b.id}`, { bloqueado: true, bloqueo_motivo: 'terreno' });
  assert.equal(r.status, 200);
  sinTokens(leer(b.id));
});

test('PUT que cambia a otra persona resetea token y banderas', async () => {
  const b = ocupado(diaNuevo(), '09:00');
  const r = await api('PUT', `/agenda/${b.id}`, { rut: '22.222.222-2', nombre: 'Otra Persona', clase: 'B' });
  assert.equal(r.status, 200, r.texto);
  const x = leer(b.id);
  assert.equal(x.nombre, 'OTRA PERSONA');
  sinTokens(x);
});

test('PUT sobre un bloque libre con token residual lo resetea', async () => {
  const b = slot(diaNuevo(), '09:00', { token_confirmacion: 'residual', correo_confirmacion_enviado: 1 });
  const r = await api('PUT', `/agenda/${b.id}`, { rut: '22.222.222-2', nombre: 'Maria', clase: 'B' });
  assert.equal(r.status, 200, r.texto);
  sinTokens(leer(b.id));
});

test('PUT de la misma persona en el mismo bloque NO resetea token ni banderas', async () => {
  const b = ocupado(diaNuevo(), '09:00');
  const r = await api('PUT', `/agenda/${b.id}`, { rut: '11.111.111-1', nombre: 'JUAN PEREZ', clase: 'B', comentarios: 'nota' });
  assert.equal(r.status, 200, r.texto);
  const x = leer(b.id);
  assert.equal(x.token_confirmacion, 'tokenviejo');
  assert.equal(x.correo_confirmacion_enviado, 1);
  assert.equal(x.correo_recordatorio_enviado, 1);
});

test('reagendar interno: origen queda limpio y destino sin banderas heredadas', async () => {
  const dia = diaNuevo();
  const origen = ocupado(dia, '09:00');
  const destino = slot(dia, '10:00', { token_confirmacion: 'residual', correo_recordatorio_enviado: 1 });
  const r = await api('POST', `/agenda/${origen.id}/reagendar`, { destino_id: destino.id, motivo: 'prueba' });
  assert.equal(r.status, 200, r.texto);
  sinTokens(leer(origen.id));
  const d = leer(destino.id);
  assert.equal(d.rut, '11.111.111-1');
  assert.notEqual(d.token_confirmacion, 'residual');
  assert.equal(d.correo_recordatorio_enviado, 0);
});

test('cola-reagendar asignar: destino ocupado nuevo parte sin banderas heredadas', async () => {
  const dia = diaNuevo();
  const origen = ocupado(dia, '09:00');
  await api('POST', `/agenda/${origen.id}/liberar`, {});
  const item = db.prepare("SELECT * FROM cola_reagendar WHERE origen_agenda_id = ? AND estado='pendiente'").get(origen.id);
  const destino = slot(dia, '10:00', { token_confirmacion: 'residual', correo_confirmacion_enviado: 1, correo_recordatorio_enviado: 1 });
  const r = await api('POST', `/cola-reagendar/${item.id}/asignar`, { destino_id: destino.id });
  assert.equal(r.status, 200, r.texto);
  sinTokens(leer(destino.id));
  assert.equal(leer(destino.id).rut, '11.111.111-1');
});

// ---------- 8) no agendar sobre un bloque bloqueado ----------
test('PUT que ocuparia un bloque bloqueado responde 409 y no lo desbloquea', async () => {
  const b = slot(diaNuevo(), '09:00', { bloqueado: 1, bloqueo_motivo: 'LICENCIA MEDICA' });
  const r = await api('PUT', `/agenda/${b.id}`, { rut: '22.222.222-2', nombre: 'Maria', clase: 'B' });
  assert.equal(r.status, 409);
  assert.match(r.datos.error, /bloqueado: LICENCIA MEDICA\. Desbloquealo primero\./);
  const x = leer(b.id);
  assert.equal(x.bloqueado, 1);
  assert.equal(x.rut, null);
});

test('el desbloqueo explicito (liberar) sigue funcionando y luego se puede agendar', async () => {
  const b = slot(diaNuevo(), '09:00', { bloqueado: 1, bloqueo_motivo: 'TERRENO' });
  assert.equal((await api('POST', `/agenda/${b.id}/liberar`, { motivo: 'Desbloqueo manual' })).status, 200);
  assert.equal(leer(b.id).bloqueado, 0);
  const r = await api('PUT', `/agenda/${b.id}`, { rut: '22.222.222-2', nombre: 'Maria', clase: 'B' });
  assert.equal(r.status, 200, r.texto);
});
