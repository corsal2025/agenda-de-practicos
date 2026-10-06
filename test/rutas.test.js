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

// ---------- 7) no reenviar correos de confirmacion ya enviados ----------
test('enviar-correos-pendientes solo envia a quienes no recibieron la confirmacion', async () => {
  const dia = diaNuevo();
  const yaEnviado = ocupado(dia, '09:00', { token_confirmacion: null, correo_confirmacion_enviado: 1, correo_recordatorio_enviado: 0 });
  const pendiente = ocupado(dia, '09:30', { rut: '33.333.333-3', nombre: 'ANA', token_confirmacion: null, correo_confirmacion_enviado: 0, correo_recordatorio_enviado: 0 });
  enviados.length = 0;
  const r = await api('POST', '/agenda/enviar-correos-pendientes', {});
  assert.equal(r.status, 200, r.texto);
  assert.ok(!enviados.includes(yaEnviado.id), 'no debe reenviar al que ya recibio la confirmacion');
  assert.ok(enviados.includes(pendiente.id), 'debe enviar al pendiente');
  // aun asi se generan tokens para ambos
  assert.ok(leer(yaEnviado.id).token_confirmacion);
  assert.ok(leer(pendiente.id).token_confirmacion);
});

test('confirmar manualmente no reenvia el correo si ya se envio', async () => {
  const dia = diaNuevo();
  const enviado = ocupado(dia, '09:00', { correo_confirmacion_enviado: 1 });
  const nuevo = ocupado(dia, '09:30', { rut: '33.333.333-3', nombre: 'ANA', correo_confirmacion_enviado: 0 });
  enviados.length = 0;
  const r1 = await api('POST', `/agenda/${enviado.id}/confirmar`, { valor: 1 });
  assert.equal(r1.status, 200);
  assert.equal(r1.datos.correo_enviado, false);
  const r2 = await api('POST', `/agenda/${nuevo.id}/confirmar`, { valor: 1 });
  assert.equal(r2.datos.correo_enviado, true);
  assert.deepEqual(enviados, [nuevo.id]);
});

// ---------- 5) confirmar/rechazar: GET no muta, POST ejecuta ----------
test('GET /confirmar muestra una pagina con boton POST y no cambia nada', async () => {
  const b = ocupado(diaNuevo(), '09:00', { token_confirmacion: 'tk1', confirmo_asistencia: null });
  const r = await http('GET', `/confirmar/${b.id}/tk1`);
  assert.equal(r.status, 200);
  assert.match(r.texto, new RegExp(`<form method="POST" action="/confirmar/${b.id}/tk1"`));
  const x = leer(b.id);
  assert.equal(x.confirmo_asistencia, null);
  assert.equal(x.token_confirmacion, 'tk1');
});

test('POST /confirmar confirma y consume el token', async () => {
  const b = ocupado(diaNuevo(), '09:00', { token_confirmacion: 'tk2', confirmo_asistencia: null });
  const r = await http('POST', `/confirmar/${b.id}/tk2`);
  assert.equal(r.status, 200);
  const x = leer(b.id);
  assert.equal(x.confirmo_asistencia, 1);
  assert.equal(x.token_confirmacion, null);
});

test('GET /rechazar no muta; POST /rechazar marca pendiente de reagendar', async () => {
  const b = ocupado(diaNuevo(), '09:00', { token_confirmacion: 'tk3', confirmo_asistencia: null });
  const g = await http('GET', `/rechazar/${b.id}/tk3`);
  assert.equal(g.status, 200);
  assert.match(g.texto, /<form method="POST"/);
  assert.equal(leer(b.id).pendiente_reagendar, 0);
  assert.equal(leer(b.id).token_confirmacion, 'tk3');
  const p = await http('POST', `/rechazar/${b.id}/tk3`);
  assert.equal(p.status, 200);
  const x = leer(b.id);
  assert.equal(x.pendiente_reagendar, 1);
  assert.equal(x.confirmo_asistencia, 0);
  assert.equal(x.token_confirmacion, null);
});

test('confirmar/rechazar con token invalido responde 404 (GET y POST)', async () => {
  const b = ocupado(diaNuevo(), '09:00', { token_confirmacion: 'tk4' });
  assert.equal((await http('GET', `/confirmar/${b.id}/malo`)).status, 404);
  assert.equal((await http('POST', `/confirmar/${b.id}/malo`)).status, 404);
  assert.equal((await http('POST', `/rechazar/${b.id}/malo`)).status, 404);
  assert.equal(leer(b.id).token_confirmacion, 'tk4');
});

// ---------- 9) reagendar publico: regla D/A5, transaccion y pesada ----------
const MOTIVO_AUTO = require('../server/pesada').MOTIVO_AUTO;

test('reagendar publico: una clase D solo ve bloques de 12:30', async () => {
  const dia = hoyMas(7);
  const origen = ocupado(hoyMas(40), '12:30', { clase: 'D', token_confirmacion: 'tkd' });
  const libre0900 = slot(dia, '09:00');
  const libre1230 = slot(dia, '12:30');
  const r = await http('GET', `/reagendar/${origen.id}/tkd`);
  assert.equal(r.status, 200);
  assert.ok(r.texto.includes(`value="${libre1230.id}"`), 'debe ofrecer el 12:30');
  assert.ok(!r.texto.includes(`value="${libre0900.id}"`), 'no debe ofrecer 09:00 a una clase D');
});

test('reagendar publico: elegir 09:00 con clase D se rechaza sin cambios', async () => {
  const origen = ocupado(hoyMas(41), '12:30', { clase: 'D', token_confirmacion: 'tkd2' });
  const destino = slot(hoyMas(3), '09:30');
  const r = await http('POST', `/reagendar/${origen.id}/tkd2/elegir`, { form: { nuevo_slot_id: destino.id } });
  assert.equal(r.status, 400);
  assert.equal(leer(destino.id).rut, null);
  assert.equal(leer(origen.id).rut, '11.111.111-1');
  assert.equal(leer(origen.id).token_confirmacion, 'tkd2');
});

test('reagendar publico: no admite fechas fuera de la ventana ofrecida', async () => {
  const origen = ocupado(hoyMas(42), '09:00', { token_confirmacion: 'tkv' });
  const lejano = slot(hoyMas(90), '09:00');
  const r = await http('POST', `/reagendar/${origen.id}/tkv/elegir`, { form: { nuevo_slot_id: lejano.id } });
  assert.equal(r.status, 400);
  assert.equal(leer(lejano.id).rut, null);
});

test('reagendar publico: libera y aplica bloqueos automaticos de clase pesada', async () => {
  const diaO = hoyMas(43);
  const diaD = hoyMas(4);
  const origen = ocupado(diaO, '12:30', { clase: 'D', token_confirmacion: 'tkp' });
  const o1300 = slot(diaO, '13:00', { bloqueado: 1, bloqueo_motivo: MOTIVO_AUTO });
  const o1330 = slot(diaO, '13:30', { bloqueado: 1, bloqueo_motivo: MOTIVO_AUTO });
  const destino = slot(diaD, '12:30');
  const d1300 = slot(diaD, '13:00');
  const d1330 = slot(diaD, '13:30');
  const r = await http('POST', `/reagendar/${origen.id}/tkp/elegir`, { form: { nuevo_slot_id: destino.id } });
  assert.equal(r.status, 200, r.texto);
  assert.equal(leer(o1300.id).bloqueado, 0);
  assert.equal(leer(o1330.id).bloqueado, 0);
  assert.equal(leer(d1300.id).bloqueado, 1);
  assert.equal(leer(d1330.id).bloqueado, 1);
  assert.equal(leer(destino.id).rut, '11.111.111-1');
});

test('reagendar publico: horario ya ocupado se rechaza y la cita original queda intacta', async () => {
  const origen = ocupado(hoyMas(44), '09:00', { token_confirmacion: 'tko' });
  const tomado = ocupado(hoyMas(5), '09:00', { rut: '44.444.444-4', nombre: 'OTRO', token_confirmacion: null });
  const r = await http('POST', `/reagendar/${origen.id}/tko/elegir`, { form: { nuevo_slot_id: tomado.id } });
  assert.equal(r.status, 400);
  assert.equal(leer(origen.id).rut, '11.111.111-1');
  assert.equal(leer(tomado.id).nombre, 'OTRO');
});

test('reagendar publico: escapa el nombre del examinador y no filtra errores internos', async () => {
  const exId = Number(db.prepare("INSERT INTO examinadores (nombre) VALUES ('<i>EXAM</i>')").run().lastInsertRowid);
  const origen = ocupado(hoyMas(45), '09:00', { token_confirmacion: 'tke' });
  const destino = slot(hoyMas(6), '09:00', {}, exId);
  const lista = await http('GET', `/reagendar/${origen.id}/tke`);
  assert.ok(!lista.texto.includes('<i>EXAM</i>'));
  const r = await http('POST', `/reagendar/${origen.id}/tke/elegir`, { form: { nuevo_slot_id: destino.id } });
  assert.equal(r.status, 200, r.texto);
  assert.ok(!r.texto.includes('<i>EXAM</i>'));
  assert.ok(r.texto.includes('&lt;i&gt;EXAM&lt;/i&gt;'));
});

// ---------- 10) correo: escapar HTML ----------
test('la plantilla de correo escapa los datos del postulante', () => {
  const { plantilla } = require('../server/correo');
  const mal = '<img src=x onerror=alert(1)>';
  const { html, text } = plantilla({
    titulo: 'T', intro: 'I',
    bloque: { nombre: mal, rut: '"><b>', fecha: '2026-01-02', hora: '<u>', examinador: "O'Brien & Co", clase: '<C>' },
    links: { confirmar: 'http://x/c?a=1&b=2', reagendar: 'http://x/r' },
  });
  assert.ok(!html.includes(mal));
  assert.ok(!html.includes('<u>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('O&#39;Brien &amp; Co'));
  assert.ok(html.includes('href="http://x/c?a=1&amp;b=2"'));
  assert.ok(text.includes(mal), 'la version texto plano no se escapa');
});

// ---------- 12) manejador de errores ----------
test('un error inesperado responde 500 generico sin filtrar el detalle interno', async () => {
  // Renombrar un examinador a un nombre ya existente viola UNIQUE (error de SQLite, sin status).
  const r = await api('PUT', '/examinadores/1', { nombre: 'DOMINGO NAVARRO' });
  assert.equal(r.status, 500);
  assert.equal(r.datos.error, 'Error interno del servidor');
});

test('los errores previstos (bad) conservan su estado y mensaje', async () => {
  const r = await api('GET', '/agenda/99999999');
  assert.equal(r.status, 404);
  assert.equal(r.datos.error, 'Bloque no encontrado');
  const r2 = await api('POST', '/papelera/99999999/restaurar', {});
  assert.equal(r2.status, 404);
  assert.match(r2.datos.error, /papelera no encontrada/i);
});

test('restaurar desde papelera sobre un bloque ocupado responde 409 con mensaje util', async () => {
  const b = ocupado(diaNuevo(), '09:00');
  await api('POST', `/agenda/${b.id}/liberar`, {});
  const entrada = db.prepare('SELECT id FROM papelera WHERE agenda_id = ? ORDER BY id DESC').get(b.id);
  await api('PUT', `/agenda/${b.id}`, { rut: '22.222.222-2', nombre: 'Maria', clase: 'B' });
  const r = await api('POST', `/papelera/${entrada.id}/restaurar`, {});
  assert.equal(r.status, 409);
  assert.match(r.datos.error, /ya esta ocupado/);
});

test('importar con un archivo/fuente invalido responde 400 con el motivo', async () => {
  const r = await api('POST', '/import', { hojas: 'no-es-un-objeto' });
  assert.equal(r.status, 400);
});

// ---------- 7b) desbloquear-dia no libera los bloqueos automaticos de una clase pesada vigente ----------
test('desbloquear-dia respeta los bloqueos automaticos si el 12:30 sigue con clase D/A5', async () => {
  const dia = diaNuevo();
  const manual = slot(dia, '09:00', { bloqueado: 1, bloqueo_motivo: 'TERRENO' });
  ocupado(dia, '12:30', { clase: 'D' });
  const a1300 = slot(dia, '13:00', { bloqueado: 1, bloqueo_motivo: MOTIVO_AUTO });
  const a1330 = slot(dia, '13:30', { bloqueado: 1, bloqueo_motivo: MOTIVO_AUTO });
  const sim = await api('POST', '/desbloquear-dia', { desde: dia, hasta: dia, examinador_id: 1, simular: true });
  assert.equal(sim.datos.desbloqueables, 1);
  const r = await api('POST', '/desbloquear-dia', { desde: dia, hasta: dia, examinador_id: 1 });
  assert.equal(r.datos.desbloqueados, 1);
  assert.equal(leer(manual.id).bloqueado, 0);
  assert.equal(leer(a1300.id).bloqueado, 1);
  assert.equal(leer(a1330.id).bloqueado, 1);
});

test('desbloquear-dia si libera los bloqueos automaticos huerfanos (12:30 ya sin clase pesada)', async () => {
  const dia = diaNuevo();
  slot(dia, '12:30');
  const a1300 = slot(dia, '13:00', { bloqueado: 1, bloqueo_motivo: MOTIVO_AUTO });
  const r = await api('POST', '/desbloquear-dia', { desde: dia, hasta: dia, examinador_id: 1 });
  assert.equal(r.datos.desbloqueados, 1);
  assert.equal(leer(a1300.id).bloqueado, 0);
});
