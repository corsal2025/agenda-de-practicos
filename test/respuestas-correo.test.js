'use strict';
// Procesamiento de respuestas por correo con base temporal y lectura/marcado FALSOS (nunca Outlook real).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-respuestas-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-respuestas-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const correo = require('../server/correo');
const enviados = [];
correo.habilitado = true;
correo.confirmacion = async (b) => { enviados.push(b.id); return true; };
correo.recordatorio = async () => true;
correo.solicitudConfirmacion = async () => true;

const { db } = require('../server/db');
const { hoyISO, sumarDias } = require('../server/fechas');
const rc = require('../server/respuestas-correo');
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

const hoy = hoyISO();
let n = 0;
function cita(extra = {}, dias = 3) {
  const hora = `${String(8 + Math.floor(n / 6)).padStart(2, '0')}:${String((n++ % 6) * 10).padStart(2, '0')}`;
  const fecha = sumarDias(hoy, dias);
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, 1)').run(fecha, hora);
  const f = db.prepare('SELECT id FROM agenda WHERE fecha=? AND hora=? AND examinador_id=1').get(fecha, hora);
  const datos = { rut: '11.111.111-1', nombre: 'JUAN PEREZ', correo: `p${n}@x.cl`, ...extra };
  const cols = Object.keys(datos);
  db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...datos, id: f.id });
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(f.id);
}
const leerCita = (id) => db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
let e = 0;
// Sin remitente explicito: si el asunto trae [Cita id], responde el dueño de esa cita (caso normal).
const remitenteDe = (subject) => {
  const m = /\[Cita (\d+)\]/.exec(subject || '');
  const c = m && db.prepare('SELECT correo FROM agenda WHERE id = ?').get(Number(m[1]));
  return (c && c.correo) || 'nadie@x.cl';
};
const msg = (subject, body, from = remitenteDe(subject)) => ({ entryId: `E${++e}`, from, subject, body, received: '2026-10-11T10:00:00' });
function fakes(mensajes) {
  const marcas = [];
  return { marcas, leer: async () => mensajes, marcar: async (m) => { marcas.push(...m); return true; } };
}

test('confirma por id del asunto, envia confirmacion si falta y marca el correo', async () => {
  const c = cita();
  const f = fakes([msg(`RE: Confirma tu asistencia [Cita ${c.id}]`, 'Sí, confirmo\n> texto citado')]);
  const r = await rc.procesar({ ...f, hoy });
  assert.equal(r.aplicadas, 1);
  assert.equal(leerCita(c.id).confirmo_asistencia, 1);
  assert.ok(enviados.includes(c.id));
  assert.deepEqual(f.marcas.map((x) => x.categoria), ['Agenda-procesado']);
  const mov = db.prepare("SELECT * FROM movimientos WHERE agenda_id = ? AND accion = 'respuesta_correo'").get(c.id);
  assert.equal(mov.actor, 'correo-automatico');
});

test('no reenvía la confirmación si ya se envió', async () => {
  const c = cita({ correo_confirmacion_enviado: 1 });
  const antes = enviados.length;
  await rc.procesar({ ...fakes([msg(`RE: x [Cita ${c.id}]`, 'confirmo')]), hoy });
  assert.equal(leerCita(c.id).confirmo_asistencia, 1);
  assert.equal(enviados.length, antes);
});

test('idempotente por entry_id', async () => {
  const c = cita();
  const m = msg(`RE: x [Cita ${c.id}]`, 'no puedo asistir');
  await rc.procesar({ ...fakes([m]), hoy });
  const f2 = fakes([m]);
  const r = await rc.procesar({ ...f2, hoy });
  assert.equal(r.duplicadas, 1);
  assert.equal(r.aplicadas, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM respuestas_correo WHERE entry_id = ?').get(m.entryId).n, 1);
  assert.equal(f2.marcas.length, 1, 'se vuelve a marcar para que no se relea');
  const c2 = leerCita(c.id);
  assert.equal(c2.confirmo_asistencia, 0);
  assert.ok(c2.rut, 'no se libera automaticamente');
});

test('no sobrescribe una cita con resultado', async () => {
  const c = cita({ resultado: 'APROBADO' });
  const f = fakes([msg(`RE: x [Cita ${c.id}]`, 'no voy')]);
  const r = await rc.procesar({ ...f, hoy });
  assert.equal(r.revisar, 1);
  assert.equal(leerCita(c.id).confirmo_asistencia, null);
  assert.deepEqual(f.marcas.map((x) => x.categoria), ['Agenda-procesado', 'Agenda-revisar']);
});

test('cita pasada -> revisar', async () => {
  const c = cita({}, -2);
  const r = await rc.procesar({ ...fakes([msg(`RE: x [Cita ${c.id}]`, 'confirmo')]), hoy });
  assert.equal(r.revisar, 1);
  assert.equal(leerCita(c.id).confirmo_asistencia, null);
});

test('reagendar marca pendiente con motivo', async () => {
  const c = cita();
  await rc.procesar({ ...fakes([msg(`RE: x [Cita ${c.id}]`, 'necesito otra hora')]), hoy });
  const d = leerCita(c.id);
  assert.equal(d.pendiente_reagendar, 1);
  assert.equal(d.motivo_reagendamiento, 'Solicitado por correo');
});

test('fallback por remitente: única -> aplica; varias -> revisar', async () => {
  const u = cita({ correo: 'unica@x.cl' });
  await rc.procesar({ ...fakes([msg('RE: hola', 'ok', 'UNICA@x.cl')]), hoy });
  assert.equal(leerCita(u.id).confirmo_asistencia, 1);

  const a = cita({ correo: 'doble@x.cl' });
  const b = cita({ correo: 'doble@x.cl' }, 5);
  const r = await rc.procesar({ ...fakes([msg('RE: hola', 'confirmo', 'doble@x.cl')]), hoy });
  assert.equal(r.revisar, 1);
  assert.equal(leerCita(a.id).confirmo_asistencia, null);
  assert.equal(leerCita(b.id).confirmo_asistencia, null);
});

test('API: listar revisar y resolver', async () => {
  const c = cita();
  await rc.procesar({ ...fakes([msg(`RE: x [Cita ${c.id}]`, '¿Dónde queda la oficina?')]), hoy });
  const lista = await (await fetch(`${base}/api/respuestas-correo?estado=revisar`)).json();
  const item = lista.items.find((x) => x.agenda_id === c.id);
  assert.ok(item);
  assert.ok(lista.resumen.revisar >= 1);

  const post = (id, body) => fetch(`${base}/api/respuestas-correo/${id}/resolver`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post(item.id, { accion: 'borrar' })).status, 400);
  const r = await post(item.id, { accion: 'confirma' });
  assert.equal(r.status, 200);
  assert.equal(leerCita(c.id).confirmo_asistencia, 1);
  assert.equal((await post(item.id, { accion: 'ignorar' })).status, 409);

  // ignorar
  await rc.procesar({ ...fakes([msg('RE: hola', 'hola', 'desconocido@x.cl')]), hoy });
  const otro = db.prepare("SELECT id FROM respuestas_correo WHERE remitente = 'desconocido@x.cl'").get();
  assert.equal((await post(otro.id, { accion: 'confirma' })).status, 400, 'sin cita indicada');
  assert.equal((await post(otro.id, { accion: 'ignorar' })).status, 200);
  assert.equal(db.prepare('SELECT estado FROM respuestas_correo WHERE id = ?').get(otro.id).estado, 'ignorada');
});

test('resolver rechaza cita con resultado', async () => {
  const c = cita({ resultado: 'REPROBADO' });
  await rc.procesar({ ...fakes([msg(`RE: x [Cita ${c.id}]`, 'confirmo')]), hoy });
  const fila = db.prepare('SELECT id FROM respuestas_correo WHERE agenda_id = ? ORDER BY id DESC').get(c.id);
  assert.throws(() => rc.resolver(fila.id, { accion: 'confirma' }, 'x', hoy), (err) => err.status === 409);
});

test('asunto de los correos lleva [Cita id]', () => {
  assert.equal(correo.etiqueta({ id: 7 }), ' [Cita 7]');
  assert.equal(correo.etiqueta({}), '');
});

test('seguridad: [Cita id] desde otro remitente no se aplica (queda en revisar)', async () => {
  const c = cita();
  const f = fakes([msg(`RE: Recordatorio [Cita ${c.id}]`, 'No voy a ir', 'tercero@x.cl')]);
  const r = await rc.procesar({ ...f, hoy });
  assert.equal(r.aplicadas || 0, 0);
  assert.equal(leerCita(c.id).confirmo_asistencia, null);
});
