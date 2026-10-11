'use strict';
// Sugerencias para llenar un cupo liberado y limpieza rapida de datos de contacto.
// Base temporal y puerto efimero: NUNCA tocan data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-sug-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-sug-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const correo = require('../server/correo');
correo.habilitado = true;
correo.confirmacion = async () => true;
correo.recordatorio = async () => true;
correo.solicitudConfirmacion = async () => true;

const { db } = require('../server/db');
const { hoyISO } = require('../server/fechas');
const { rankear, esCompatible } = require('../server/sugerencias');
const limpieza = require('../server/limpieza');
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
let diaN = 200;
const diaNuevo = () => hoyMas(diaN++);
let exN = 10;
// Cada test usa un examinador propio para no mezclar candidatos/colas entre tests.
function examinadorNuevo() {
  const nombre = `EXAM TEST ${exN++}`;
  db.prepare('INSERT INTO examinadores (nombre) VALUES (?)').run(nombre);
  return db.prepare('SELECT id FROM examinadores WHERE nombre = ?').get(nombre).id;
}
function slot(fecha, hora, extra = {}, examinador_id = 1) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(fecha, hora, examinador_id);
  const fila = db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=?').get(fecha, hora, examinador_id);
  const cols = Object.keys(extra);
  if (cols.length) db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...extra, id: fila.id });
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(fila.id);
}
const leer = (id) => db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
// Vacia la cola entre tests de sugerencias (la cola es global).
const vaciarCola = () => db.prepare("UPDATE cola_reagendar SET estado = 'descartado' WHERE estado = 'pendiente'").run();
function encolar(datos, creado_en) {
  db.prepare(`INSERT INTO cola_reagendar (rut, nombre, clase, correo, origen_fecha, origen_hora, motivo, creado_en, fecha_inicio_tramite)
    VALUES (@rut, @nombre, @clase, @correo, @of, '09:00', 'TEST', @creado_en, @fit)`)
    .run({ rut: null, correo: 'x@x.cl', of: hoyISO(), fit: null, ...datos, creado_en });
}

// ---------- reglas puras ----------
test('esCompatible: D/A5 solo en 12:30; clases livianas en cualquier bloque', () => {
  assert.equal(esCompatible({ hora: '12:30' }, { clase: 'D' }), true);
  assert.equal(esCompatible({ hora: '09:00' }, { clase: 'B,A5' }), false);
  assert.equal(esCompatible({ hora: '09:00' }, { clase: 'B' }), true);
  assert.equal(esCompatible({ hora: '12:30' }, { clase: 'B' }), true);
});

test('rankear: cola (mas antigua primero), luego lista de espera con la cita mas lejana, desempate por tramite', () => {
  const r = rankear([
    { origen: 'lista_espera', id: 1, fecha: '2026-12-01', vigencia: { dias: 50 } },
    { origen: 'cola', id: 2, creado_en: '2026-10-05 10:00:00', vigencia: null },
    { origen: 'lista_espera', id: 3, fecha: '2027-01-15', vigencia: { dias: 90 } },
    { origen: 'cola', id: 4, creado_en: '2026-10-01 10:00:00', vigencia: null },
    { origen: 'lista_espera', id: 5, fecha: '2026-12-01', vigencia: { dias: 10 } },
  ]);
  assert.deepEqual(r.map((c) => c.id), [4, 2, 3, 5, 1]);
});

// ---------- GET /api/sugerencias-cupo/:id ----------
test('sugerencias: lista cola y lista de espera compatibles, sin repetir persona del mismo dia', async () => {
  vaciarCola();
  const ex = examinadorNuevo();
  const dia = diaNuevo();
  const libre = slot(dia, '09:00', {}, ex);
  encolar({ nombre: 'COLA VIEJA', clase: 'B' }, '2026-01-01 08:00:00');
  encolar({ nombre: 'COLA NUEVA', clase: 'B' }, '2026-02-01 08:00:00');
  encolar({ nombre: 'COLA PESADA', clase: 'D' }, '2025-01-01 08:00:00'); // incompatible con 09:00
  const lejana = slot(diaNuevo(), '10:00', { rut: '11.111.111-1', nombre: 'LISTA LEJANA', clase: 'B', correo: 'a@a.cl', lista_espera: 'SI' }, ex);
  slot(hoyMas(1), '10:00', { rut: '22.222.222-2', nombre: 'LISTA ANTES', clase: 'B', correo: 'b@b.cl', lista_espera: 'SI' }, ex); // fecha anterior al cupo
  // Misma persona ya tiene cita ese dia: no se sugiere.
  slot(dia, '11:00', { rut: '33.333.333-3', nombre: 'YA TIENE', clase: 'B', correo: 'c@c.cl' }, ex);
  slot(diaNuevo(), '10:00', { rut: '33.333.333-3', nombre: 'YA TIENE', clase: 'B', correo: 'c@c.cl', lista_espera: 'SI' }, ex);

  const r = await api('GET', `/sugerencias-cupo/${libre.id}`);
  assert.equal(r.status, 200, r.texto);
  const nombres = r.datos.candidatos.map((c) => c.nombre);
  assert.deepEqual(nombres, ['COLA VIEJA', 'COLA NUEVA', 'LISTA LEJANA']);
  assert.equal(r.datos.candidatos[2].id, lejana.id);
  assert.equal(r.datos.candidatos[2].origen, 'lista_espera');
});

test('sugerencias: el bloque 12:30 admite clase pesada; otro bloque no', async () => {
  vaciarCola();
  const ex = examinadorNuevo();
  const dia = diaNuevo();
  const pesado = slot(dia, '12:30', {}, ex);
  encolar({ nombre: 'PESADO D', clase: 'D' }, '2026-01-01 08:00:00');
  const r = await api('GET', `/sugerencias-cupo/${pesado.id}`);
  assert.equal(r.status, 200, r.texto);
  assert.ok(r.datos.candidatos.some((c) => c.nombre === 'PESADO D'));
});

test('sugerencias: cupo ocupado o bloqueado responde 400; inexistente 404', async () => {
  const ex = examinadorNuevo();
  const oc = slot(diaNuevo(), '09:00', { nombre: 'X', rut: '11.111.111-1' }, ex);
  const bl = slot(diaNuevo(), '09:00', { bloqueado: 1, bloqueo_motivo: 'TERRENO' }, ex);
  assert.equal((await api('GET', `/sugerencias-cupo/${oc.id}`)).status, 400);
  assert.equal((await api('GET', `/sugerencias-cupo/${bl.id}`)).status, 400);
  assert.equal((await api('GET', '/sugerencias-cupo/99999999')).status, 404);
});

// ---------- PATCH /api/agenda/:id/contacto ----------
test('PATCH contacto: normaliza correo, telefono y nombre y registra movimiento', async () => {
  const b = slot(diaNuevo(), '09:00', { rut: '11.111.111-1', nombre: 'juan  perez', correo: 'caro', contacto: '912' });
  const r = await api('PATCH', `/agenda/${b.id}/contacto`, { correo: ' Juan@X.CL ', contacto: '9 1234 5678', nombre: ' juan   perez ' });
  assert.equal(r.status, 200, r.texto);
  const x = leer(b.id);
  assert.equal(x.correo, 'juan@x.cl');
  assert.equal(x.contacto, '+56912345678');
  assert.equal(x.nombre, 'JUAN PEREZ');
  const mov = db.prepare("SELECT * FROM movimientos WHERE agenda_id = ? AND accion = 'editar'").get(b.id);
  assert.ok(mov, 'debe registrar movimiento');
});

test('PATCH contacto: rechaza correo invalido, telefono incompleto, nombre vacio y cuerpo vacio', async () => {
  const b = slot(diaNuevo(), '09:00', { rut: '11.111.111-1', nombre: 'ANA', correo: 'a@a.cl' });
  assert.equal((await api('PATCH', `/agenda/${b.id}/contacto`, { correo: '💌' })).status, 400);
  assert.equal((await api('PATCH', `/agenda/${b.id}/contacto`, { contacto: '1234' })).status, 400);
  assert.equal((await api('PATCH', `/agenda/${b.id}/contacto`, { nombre: '   ' })).status, 400);
  assert.equal((await api('PATCH', `/agenda/${b.id}/contacto`, {})).status, 400);
  assert.equal(leer(b.id).correo, 'a@a.cl');
});

test('PATCH contacto: correo vacio lo borra; bloque libre o inexistente falla', async () => {
  const b = slot(diaNuevo(), '09:00', { rut: '11.111.111-1', nombre: 'ANA', correo: 'malo' });
  assert.equal((await api('PATCH', `/agenda/${b.id}/contacto`, { correo: '' })).status, 200);
  assert.equal(leer(b.id).correo, null);
  const libre = slot(diaNuevo(), '09:00');
  assert.equal((await api('PATCH', `/agenda/${libre.id}/contacto`, { correo: 'a@a.cl' })).status, 400);
  assert.equal((await api('PATCH', '/agenda/99999999/contacto', { correo: 'a@a.cl' })).status, 404);
});

test('PATCH contacto: bloqueo optimista con visto_en distinto responde 409', async () => {
  const b = slot(diaNuevo(), '09:00', { rut: '11.111.111-1', nombre: 'ANA', correo: 'a@a.cl', actualizado_en: '2026-01-01 10:00:00' });
  const r = await api('PATCH', `/agenda/${b.id}/contacto`, { correo: 'b@b.cl', visto_en: '2020-01-01 00:00:00' });
  assert.equal(r.status, 409);
});

// ---------- limpieza ----------
test('detectar: marca correo invalido, telefono incompleto, nombre mal escrito y RUT invalido', () => {
  const p = limpieza.problemas({ correo: 'susana x tel', contacto: '+56912', nombre: 'ana  perez', rut: '11.111.111-2' });
  assert.deepEqual(p.sort(), ['CORREO_INVALIDO', 'NOMBRE', 'RUT_INVALIDO', 'TELEFONO_INCOMPLETO']);
  assert.deepEqual(limpieza.problemas({ correo: 'a@a.cl', contacto: '+56912345678', nombre: 'ANA PEREZ', rut: '11.111.111-1' }), []);
  assert.deepEqual(limpieza.problemas({ correo: 'a@a.cl', contacto: '+56912345678', nombre: 'Ana Pérez', rut: '11.111.111-1' }), []);
});

test('GET /api/limpieza lista citas con problemas', async () => {
  const b = slot(diaNuevo(), '09:00', { rut: '11.111.111-1', nombre: 'LIMPIA ME', correo: 'caro' });
  const r = await api('GET', '/limpieza');
  assert.equal(r.status, 200, r.texto);
  const fila = r.datos.filas.find((f) => f.id === b.id);
  assert.ok(fila);
  assert.deepEqual(fila.problemas, ['CORREO_INVALIDO']);
});

test('vaciar correos invalidos: exige confirmar, respalda y deja NULL solo los invalidos', async () => {
  const malo = slot(diaNuevo(), '09:00', { rut: '11.111.111-1', nombre: 'MALO', correo: '💌' });
  const bueno = slot(diaNuevo(), '09:00', { rut: '11.111.111-1', nombre: 'BUENO', correo: 'ok@ok.cl' });
  assert.equal((await api('POST', '/limpieza/vaciar-correos-invalidos', {})).status, 400);
  const r = await api('POST', '/limpieza/vaciar-correos-invalidos', { confirmar: true });
  assert.equal(r.status, 200, r.texto);
  assert.ok(r.datos.vaciados >= 1);
  assert.equal(leer(malo.id).correo, null);
  assert.equal(leer(bueno.id).correo, 'ok@ok.cl');
  assert.ok(fs.readdirSync(tmpBackups).some((f) => f.includes('pre-limpieza')), 'debe existir backup pre-limpieza');
});
