'use strict';
// "No vino": falta por RUT, liberacion del cupo, cola marcada y orden de la lista de espera.
// Usa una base temporal y un puerto efimero: NUNCA toca data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Variables de entorno ANTES de requerir los modulos del servidor.
const tmpDb = path.join(os.tmpdir(), `agenda-novino-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-novino-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const { db } = require('../server/db');
const { hoyISO } = require('../server/fechas');
const { sumarMeses } = require('../server/tramite');
const cola = require('../server/cola');
const faltas = require('../server/faltas');
const { rankear } = require('../server/sugerencias');
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
  try { datos = JSON.parse(texto); } catch (_) { /* html */ }
  return { status: r.status, texto, datos };
}

const hoyMas = (n) => {
  const d = new Date(`${hoyISO()}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Cada test usa un dia pasado propio para no pisarse con los demas.
let diaPasado = 3;
const diaNuevo = () => hoyMas(-(diaPasado++));

const leer = (id) => db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
function slot(fecha, hora, extra = {}, examinador_id = 1) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(fecha, hora, examinador_id);
  const fila = db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=?').get(fecha, hora, examinador_id);
  const cols = Object.keys(extra);
  if (cols.length) {
    db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...extra, id: fila.id });
  }
  return leer(fila.id);
}
const persona = (rut, nombre) => ({ rut, nombre, clase: 'B', correo: 'p@x.cl', contacto: '+56911111111' });
const filasHora = (b) => db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=?').all(b.fecha, b.hora, b.examinador_id);

test('no-vino con cupo 1: queda una sola fila libre, falta anotada y cola con tipo no_vino', async () => {
  const b = slot(diaNuevo(), '09:00', persona('11.111.111-1', 'JUAN PEREZ'));
  const r = await api('POST', `/agenda/${b.id}/no-vino`, {});
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.datos, { ok: true, faltas: 1 });
  const filas = filasHora(b);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].rut, null);
  assert.equal(filas[0].nombre, null);
  assert.equal(faltas.contarPorRut('11.111.111-1'), 1);
  assert.equal(faltas.contarPorRut('111111111'), 1);
  const f = db.prepare('SELECT * FROM faltas WHERE rut_limpio = ?').get('111111111');
  assert.equal(f.fecha, b.fecha);
  assert.equal(f.agenda_id, b.id);
  const c = db.prepare(`SELECT * FROM cola_reagendar WHERE rut = ? AND estado = 'pendiente'`).all('11.111.111-1');
  assert.equal(c.length, 1);
  assert.equal(c[0].tipo, 'no_vino');
  assert.equal(c[0].motivo, 'NO VINO A SU EXAMEN');
  const mov = db.prepare(`SELECT COUNT(*) AS n FROM movimientos WHERE agenda_id = ? AND accion = 'no_vino'`).get(b.id).n;
  assert.equal(mov, 1);
});

test('no-vino con cupo > 1: no deja la hora duplicada y renumera a cupo 1', async () => {
  const uno = slot(diaNuevo(), '09:30', persona('12.222.222-2', 'ANA SOTO'));
  const ext = await api('POST', `/agenda/${uno.id}/persona`, {});
  assert.equal(ext.status, 200, ext.texto);
  const extra = db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=? AND cupo > 1')
    .get(uno.fecha, uno.hora, uno.examinador_id);
  db.prepare('UPDATE agenda SET rut=?, nombre=?, clase=? WHERE id=?').run('13.333.333-3', 'LUIS DIAZ', 'B', extra.id);
  assert.equal(filasHora(uno).length, 2);

  const r = await api('POST', `/agenda/${extra.id}/no-vino`, {});
  assert.equal(r.status, 200, r.texto);
  const filas = filasHora(uno);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].cupo, 1);
  assert.equal(filas[0].rut, '12.222.222-2');

  // Marcar tambien al cupo 1: la hora queda con una sola fila libre.
  const r2 = await api('POST', `/agenda/${uno.id}/no-vino`, {});
  assert.equal(r2.status, 200, r2.texto);
  const finales = filasHora(uno);
  assert.equal(finales.length, 1);
  assert.equal(finales[0].rut, null);
});

test('no-vino repetido suma faltas y no duplica la entrada pendiente de la cola', async () => {
  const rut = '14.444.444-4';
  const a = slot(diaNuevo(), '10:00', persona(rut, 'PEDRO RIOS'));
  const b = slot(diaNuevo(), '10:00', persona(rut, 'PEDRO RIOS'));
  assert.equal((await api('POST', `/agenda/${a.id}/no-vino`, {})).datos.faltas, 1);
  const r = await api('POST', `/agenda/${b.id}/no-vino`, {});
  assert.equal(r.datos.faltas, 2);
  const c = db.prepare(`SELECT * FROM cola_reagendar WHERE rut = ? AND estado = 'pendiente'`).all(rut);
  assert.equal(c.length, 1);
});

test('no-vino rechaza cita futura, bloque vacio y bloque inexistente', async () => {
  const futura = slot(hoyMas(40), '09:00', persona('15.555.555-5', 'FUTURO UNO'));
  const r1 = await api('POST', `/agenda/${futura.id}/no-vino`, {});
  assert.equal(r1.status, 400);
  assert.match(r1.datos.error, /hoy o anteriores/);
  assert.equal(leer(futura.id).rut, '15.555.555-5');
  assert.equal(faltas.contarPorRut('15.555.555-5'), 0);

  const vacio = slot(diaNuevo(), '11:00');
  const r2 = await api('POST', `/agenda/${vacio.id}/no-vino`, {});
  assert.equal(r2.status, 400);
  assert.match(r2.datos.error, /no tiene una cita/);

  assert.equal((await api('POST', '/agenda/99999999/no-vino', {})).status, 404);
});

test('sin RUT la falta se cuenta por nombre normalizado', async () => {
  const b = slot(diaNuevo(), '11:30', { nombre: 'sin  rut   persona', clase: 'B' });
  const r = await api('POST', `/agenda/${b.id}/no-vino`, {});
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.datos.faltas, 1);
  assert.equal(faltas.contarPorRut('SIN RUT PERSONA'), 1);
  assert.equal(faltas.mapaConteos().get('SIN RUT PERSONA'), 1);
});

// ---------- ranking ----------
test('rankear: vence pronto > cola urgente > cambio (incluye cola no_vino/reprobo) > lista; menos faltas primero', () => {
  const r = rankear([
    { origen: 'cola', id: 1, creado_en: '2026-01-01 08:00:00', faltas: 2, vigencia: null },
    { origen: 'cola', id: 2, creado_en: '2026-03-01 08:00:00', faltas: 0, vigencia: null },
    { origen: 'cola', id: 3, creado_en: '2026-02-01 08:00:00', faltas: 3, vigencia: { dias: 10 } },
    { origen: 'cola', id: 4, creado_en: '2026-04-01 08:00:00', faltas: 1, tipo: 'no_vino', vigencia: null },
    { origen: 'cola', id: 5, creado_en: '2026-05-01 08:00:00', faltas: 1, vigencia: null },
    { origen: 'lista_espera', id: 6, fecha: '2026-12-01', faltas: 0, vigencia: null },
  ]);
  // 4 (cola no_vino) compite en el grupo de cambio: ya no va en el grupo urgente.
  assert.deepEqual(r.map((c) => c.id), [3, 2, 5, 1, 4, 6]);
});

test('rankear: cola no_vino/reprobo y cambio se desempatan por la fecha mas cercana (fecha u origen_fecha) y luego creado_en', () => {
  const r = rankear([
    { origen: 'cola', id: 1, tipo: 'no_vino', origen_fecha: '2026-11-10', creado_en: '2026-11-10 09:00:00', faltas: 1, vigencia: null },
    { origen: 'cambio', id: 2, fecha: '2026-11-20', faltas: 1, vigencia: null },
    { origen: 'cola', id: 3, tipo: 'reprobo', origen_fecha: '2026-11-05', creado_en: '2026-11-05 09:00:00', faltas: 1, vigencia: null },
    { origen: 'cambio', id: 4, fecha: '2026-11-10', creado_en: '2026-11-01 08:00:00', faltas: 1, vigencia: null },
    { origen: 'cola', id: 5, tipo: 'reprobo', origen_fecha: '2026-12-01', creado_en: '2026-12-01 09:00:00', faltas: 0, vigencia: null },
    { origen: 'cola', id: 6, creado_en: '2026-12-02 09:00:00', faltas: 5, vigencia: null },
  ]);
  // 6 urgente primero; luego menos faltas (5); luego fecha: 3 (11-05), 4 (11-10, creado antes que 1), 1, 2.
  assert.deepEqual(r.map((c) => c.id), [6, 5, 3, 4, 1, 2]);
});

// ---------- /resultado: REPROBADO y NO ASISTIO ----------
const colaDe = (rut) => db.prepare(`SELECT * FROM cola_reagendar WHERE rut = ?`).all(rut);

test('resultado REPROBADO: la fila queda ocupada con el resultado y la persona pasa a la cola con tipo reprobo, sin falta', async () => {
  const b = slot(diaNuevo(), '12:00', persona('31.000.000-1', 'REPRUEBA UNO'));
  const r = await api('POST', `/agenda/${b.id}/resultado`, { resultado: 'REPROBADO' });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.datos, { ok: true, lista_espera: true });
  assert.equal(leer(b.id).resultado, 'REPROBADO');
  assert.equal(leer(b.id).rut, '31.000.000-1');
  const c = colaDe('31.000.000-1');
  assert.equal(c.length, 1);
  assert.equal(c[0].tipo, 'reprobo');
  assert.equal(c[0].estado, 'pendiente');
  assert.equal(c[0].motivo, 'REPROBO SU EXAMEN - VUELVE A RENDIR');
  assert.equal(c[0].origen_agenda_id, b.id);
  assert.equal(faltas.contarPorRut('31.000.000-1'), 0);

  // Repetir el click no duplica la entrada pendiente.
  await api('POST', `/agenda/${b.id}/resultado`, { resultado: 'REPROBADO' });
  assert.equal(colaDe('31.000.000-1').length, 1);

  // Corregir el click: retira la entrada que creo esta cita.
  const r2 = await api('POST', `/agenda/${b.id}/resultado`, { resultado: 'APROBADO' });
  assert.deepEqual(r2.datos, { ok: true });
  const c2 = colaDe('31.000.000-1');
  assert.equal(c2.length, 1);
  assert.equal(c2[0].estado, 'descartado');
  assert.equal(leer(b.id).resultado, 'APROBADO');
});

test('resultado REPROBADO no duplica si la persona ya esperaba y cambiar el resultado no retira entradas ajenas', async () => {
  const rut = '31.000.000-2';
  cola.encolar({ id: 999999, fecha: hoyMas(-1), hora: '09:00', examinador_id: 1, rut, nombre: 'YA ESPERA', clase: 'B' }, 'otro', 'test');
  const b = slot(diaNuevo(), '12:30', persona(rut, 'YA ESPERA'));
  await api('POST', `/agenda/${b.id}/resultado`, { resultado: 'REPROBADO' });
  assert.equal(colaDe(rut).length, 1);
  await api('POST', `/agenda/${b.id}/resultado`, { resultado: null });
  assert.equal(colaDe(rut)[0].estado, 'pendiente');
});

test('resultado NO ASISTIO con cita de hoy o pasada: mismo flujo que no-vino (falta, cupo liberado, cola no_vino)', async () => {
  const b = slot(diaNuevo(), '13:00', persona('32.000.000-1', 'NO ASISTE UNO'));
  const r = await api('POST', `/agenda/${b.id}/resultado`, { resultado: 'NO ASISTIO' });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.datos, { ok: true, faltas: 1, liberada: true });
  assert.equal(leer(b.id).rut, null);
  assert.equal(faltas.contarPorRut('32.000.000-1'), 1);
  const c = colaDe('32.000.000-1');
  assert.equal(c.length, 1);
  assert.equal(c[0].tipo, 'no_vino');
});

test('resultado NO ASISTIO con cita futura: solo guarda el resultado (comportamiento anterior)', async () => {
  const b = slot(hoyMas(45), '13:00', persona('32.000.000-2', 'NO ASISTE FUTURO'));
  const r = await api('POST', `/agenda/${b.id}/resultado`, { resultado: 'NO ASISTIO' });
  assert.deepEqual(r.datos, { ok: true });
  assert.equal(leer(b.id).resultado, 'NO ASISTIO');
  assert.equal(leer(b.id).rut, '32.000.000-2');
  assert.equal(faltas.contarPorRut('32.000.000-2'), 0);
  assert.equal(colaDe('32.000.000-2').length, 0);
});

test('asignar manual: entradas no_vino/reprobo con faltas se pueden asignar a un cupo libre', async () => {
  for (const [tipo, rut] of [['no_vino', '33.000.000-1'], ['reprobo', '33.000.000-2']]) {
    faltas.registrar({ rut, nombre: 'PENALIZADO', fecha: hoyMas(-2), hora: '09:00', examinador_id: 1 }, 'test');
    cola.encolar({ id: 1, fecha: hoyMas(-1), hora: '09:00', examinador_id: 1, rut, nombre: 'PENALIZADO', clase: 'B', correo: 'p@x.cl' }, 'prueba', 'test', tipo);
    const item = db.prepare(`SELECT * FROM cola_reagendar WHERE rut = ? AND estado = 'pendiente'`).get(rut);
    const destino = slot(hoyMas(20), tipo === 'reprobo' ? '14:00' : '14:30');
    const a = await api('POST', `/cola-reagendar/${item.id}/asignar`, { destino_id: destino.id, correo: 'p@x.cl' });
    assert.equal(a.status, 200, a.texto);
    assert.equal(leer(destino.id).rut, rut);
    assert.equal(db.prepare('SELECT estado FROM cola_reagendar WHERE id = ?').get(item.id).estado, 'reagendado');
  }
});

test('GET /lista-espera y sugerencias-cupo exponen faltas y tipo y ordenan por faltas', async () => {
  db.exec('DELETE FROM cola_reagendar');
  db.exec('DELETE FROM faltas');
  const mk = (rut, nombre, tipo, creado, inicioTramite) => {
    const b = { id: 1, fecha: hoyMas(-1), hora: '09:00', examinador_id: 1, rut, nombre, clase: 'B', fecha_inicio_tramite: inicioTramite || null };
    cola.encolar(b, 'prueba', 'test', tipo);
    db.prepare('UPDATE cola_reagendar SET creado_en = ? WHERE id = (SELECT MAX(id) FROM cola_reagendar)').run(creado);
  };
  const faltasDe = (rut, n) => {
    for (let i = 0; i < n; i++) faltas.registrar({ rut, nombre: 'X', fecha: hoyMas(-2), hora: '09:00', examinador_id: 1 }, 'test');
  };
  mk('21.000.000-1', 'DOS FALTAS', 'no_vino', '2026-01-01 08:00:00');
  faltasDe('21.000.000-1', 2);
  mk('22.000.000-2', 'SIN FALTAS', null, '2026-03-01 08:00:00');
  mk('23.000.000-3', 'UNA FALTA', 'no_vino', '2026-02-01 08:00:00');
  faltasDe('23.000.000-3', 1);
  mk('24.000.000-4', 'VENCE PRONTO', 'no_vino', '2026-04-01 08:00:00', sumarMeses(hoyMas(5), -6));
  faltasDe('24.000.000-4', 3);

  const r = await api('GET', '/lista-espera');
  assert.equal(r.status, 200, r.texto);
  const p = r.datos.personas;
  assert.deepEqual(p.map((x) => x.nombre), ['VENCE PRONTO', 'SIN FALTAS', 'UNA FALTA', 'DOS FALTAS']);
  assert.deepEqual(p.map((x) => x.faltas), [3, 0, 1, 2]);
  assert.deepEqual(p.map((x) => x.tipo), ['no_vino', null, 'no_vino', 'no_vino']);
  assert.equal(p[0].origen, 'reagendar');

  const libre = slot(hoyMas(3), '09:00');
  const s = await api('GET', `/sugerencias-cupo/${libre.id}`);
  assert.equal(s.status, 200, s.texto);
  const c = s.datos.candidatos;
  assert.deepEqual(c.map((x) => x.nombre), ['VENCE PRONTO', 'SIN FALTAS', 'UNA FALTA', 'DOS FALTAS']);
  assert.deepEqual(c.map((x) => x.faltas), [3, 0, 1, 2]);
  assert.equal(c[2].tipo, 'no_vino');
});

// ---------- duplicados ----------
test('errores: tras no-vino y darle otra hora a la misma persona no hay DUPLICADO_*', async () => {
  db.exec('DELETE FROM cola_reagendar');
  const rut = '16.666.666-K';
  const hoy = slot(hoyISO(), '15:00', persona(rut, 'MARIA LOPEZ'));
  assert.equal((await api('POST', `/agenda/${hoy.id}/no-vino`, {})).status, 200);
  const item = db.prepare(`SELECT * FROM cola_reagendar WHERE rut = ? AND estado = 'pendiente'`).get(rut);
  const destino = slot(hoyMas(7), '15:00');
  const a = await api('POST', `/cola-reagendar/${item.id}/asignar`, { destino_id: destino.id, correo: 'maria@x.cl' });
  assert.equal(a.status, 200, a.texto);
  const e = await api('GET', '/errores');
  assert.deepEqual(e.datos.hallazgos.filter((h) => /^DUPLICADO_/.test(h.tipo) && h.rut === rut), []);
});

test('errores: filas con resultado de inasistencia no cuentan como duplicado futuro ni del mismo dia', async () => {
  const rut = '17.777.777-3';
  const dia = hoyMas(9);
  slot(dia, '09:00', { ...persona(rut, 'ROSA GIL'), resultado: 'NO ASISTIO' });
  slot(dia, '10:00', { ...persona(rut, 'ROSA GIL'), resultado: 'REPROBADO INASISTENCIA' });
  slot(hoyMas(10), '09:00', persona(rut, 'ROSA GIL'));
  const e = await api('GET', '/errores');
  assert.deepEqual(e.datos.hallazgos.filter((h) => /^DUPLICADO_/.test(h.tipo) && h.rut === rut), []);

  // Control: sin la marca de inasistencia si es duplicado.
  const otro = '18.888.888-7';
  slot(hoyMas(11), '09:00', persona(otro, 'OTRO GIL'));
  slot(hoyMas(12), '09:00', persona(otro, 'OTRO GIL'));
  const e2 = await api('GET', '/errores');
  assert.ok(e2.datos.hallazgos.some((h) => h.tipo === 'DUPLICADO_FUTURO' && h.rut === otro));
});

test('la tabla faltas y la columna cola_reagendar.tipo existen tras arrancar', () => {
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='faltas'`).get());
  assert.ok(db.prepare('PRAGMA table_info(cola_reagendar)').all().some((c) => c.name === 'tipo'));
});
