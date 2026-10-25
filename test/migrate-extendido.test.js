'use strict';
// Import/export extendido: cupo real, columnas nuevas, reset de token/pendientes al cambiar de
// ocupante, y deteccion de dos personas distintas para la misma hora/cupo.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `agenda-migext-${Date.now()}.db`);
process.env.AGENDA_DB = tmpDb;

const { importar } = require('../server/migrate');
const { db } = require('../server/db');

test.after(() => { for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} } });

const CAB_BASE = ['FECHA', 'HORA', 'RUT', 'NOMBRE', 'CLASE', 'CONTACTO', 'CORREO', 'TIPO DE CITA',
  'MOTIVO', 'LISTA', 'INTENTO', 'FUNCIONARIO', 'FECHA TRAMITE', 'CONFIRMO', 'EXAMINADOR', 'RESULTADO', 'COMENTARIOS'];
const CAB_EXT = [...CAB_BASE, 'CUPO', 'ESCUELA CONDUCTORES', 'TIPO REAGENDAMIENTO', 'AVISADO POR', 'PENDIENTE REAGENDAR', 'NOTA PENDIENTE'];

function hojas(cab, filas, nombre = 'AGENDA') {
  return { [nombre]: [cab, ...filas] };
}

function fila(fecha, hora, rut, nombre, examinador, extra = []) {
  return [fecha, hora, rut, nombre, 'B', '', 'p@x.cl', 'NORMAL', '', '', '', '', '', '', examinador, '', '', ...extra];
}

test('cupo: columna ausente o en blanco significa 1', () => {
  importar(hojas(CAB_BASE, [fila('2029-01-02', '08:30', '11.111.111-1', 'SIN CUPO', 'DANIEL LAGOS')]), { limpiar: true });
  const r = db.prepare("SELECT cupo FROM agenda WHERE nombre='SIN CUPO'").get();
  assert.equal(r.cupo, 1);
});

test('cupo: se lee el valor real del archivo (nunca se fuerza a 1)', () => {
  importar(hojas(CAB_EXT, [fila('2029-01-03', '08:30', '22.222.222-2', 'CON CUPO 2', 'DANIEL LAGOS', [2])]), { limpiar: true });
  const r = db.prepare("SELECT cupo FROM agenda WHERE nombre='CON CUPO 2'").get();
  assert.equal(r.cupo, 2);
});

test('al cambiar de ocupante se resetean token/correo/pendiente; al re-importar al mismo, no', () => {
  const fecha = '2029-01-04';
  db.exec('DELETE FROM agenda');
  importar(hojas(CAB_BASE, [fila(fecha, '09:00', '33.333.333-3', 'OCUPANTE UNO', 'DANIEL LAGOS')]), { limpiar: false });
  const id = db.prepare("SELECT id FROM agenda WHERE nombre='OCUPANTE UNO'").get().id;
  db.prepare(`UPDATE agenda SET token_confirmacion='tok', correo_confirmacion_enviado=1, correo_recordatorio_enviado=1,
    pendiente_reagendar=1, pendiente_nota='nota vieja' WHERE id=?`).run(id);

  // Reimportar a la MISMA persona: no debe tocar esos campos.
  importar(hojas(CAB_BASE, [fila(fecha, '09:00', '33.333.333-3', 'OCUPANTE UNO', 'DANIEL LAGOS')]), { limpiar: false });
  let x = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  assert.equal(x.token_confirmacion, 'tok');
  assert.equal(x.correo_confirmacion_enviado, 1);
  assert.equal(x.correo_recordatorio_enviado, 1);
  assert.equal(x.pendiente_reagendar, 1);
  assert.equal(x.pendiente_nota, 'nota vieja');

  // Reimportar a OTRA persona en el mismo slot: se resetean.
  importar(hojas(CAB_BASE, [fila(fecha, '09:00', '44.444.444-4', 'OCUPANTE DOS', 'DANIEL LAGOS')]), { limpiar: false });
  x = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  assert.equal(x.nombre, 'OCUPANTE DOS');
  assert.equal(x.token_confirmacion, null);
  assert.equal(x.correo_confirmacion_enviado, 0);
  assert.equal(x.correo_recordatorio_enviado, 0);
  assert.equal(x.pendiente_reagendar, 0);
  assert.equal(x.pendiente_nota, null);
});

test('columnas extendidas: sin esas columnas, el valor existente se conserva si el ocupante no cambia', () => {
  const fecha = '2029-01-05';
  db.exec('DELETE FROM agenda');
  importar(hojas(CAB_EXT, [fila(fecha, '09:30', '55.555.555-5', 'CON ESCUELA', 'DANIEL LAGOS', [1, 'ESCUELA X', 'SMS', 'correo', 'NO', ''])]), { limpiar: false });
  const id = db.prepare("SELECT id FROM agenda WHERE nombre='CON ESCUELA'").get().id;
  assert.equal(db.prepare('SELECT escuela_conductores FROM agenda WHERE id=?').get(id).escuela_conductores, 'ESCUELA X');

  // Mismo ocupante, archivo SIN las columnas extendidas: se mantiene.
  importar(hojas(CAB_BASE, [fila(fecha, '09:30', '55.555.555-5', 'CON ESCUELA', 'DANIEL LAGOS')]), { limpiar: false });
  const x = db.prepare('SELECT escuela_conductores, tipo_reagendamiento, avisado_por FROM agenda WHERE id=?').get(id);
  assert.equal(x.escuela_conductores, 'ESCUELA X');
  assert.equal(x.tipo_reagendamiento, 'SMS');
  assert.equal(x.avisado_por, 'correo');
});

test('columnas extendidas: sin esas columnas, pasa a NULL si el ocupante SI cambia', () => {
  const fecha = '2029-01-06';
  db.exec('DELETE FROM agenda');
  importar(hojas(CAB_EXT, [fila(fecha, '10:00', '66.666.666-6', 'OCUPANTE A', 'DANIEL LAGOS', [1, 'ESCUELA Y', 'LLAMADO', 'telefono', 'SI', 'llamar de nuevo'])]), { limpiar: false });
  const id = db.prepare("SELECT id FROM agenda WHERE nombre='OCUPANTE A'").get().id;
  importar(hojas(CAB_BASE, [fila(fecha, '10:00', '77.777.777-7', 'OCUPANTE B', 'DANIEL LAGOS')]), { limpiar: false });
  const x = db.prepare('SELECT escuela_conductores, tipo_reagendamiento, avisado_por, pendiente_reagendar, pendiente_nota FROM agenda WHERE id=?').get(id);
  assert.deepEqual({ ...x }, { escuela_conductores: null, tipo_reagendamiento: null, avisado_por: null, pendiente_reagendar: 0, pendiente_nota: null });
});

test('dos personas distintas en la misma hora/cupo: error 400 claro, antes de escribir nada (incluso con limpiar=true)', () => {
  const fecha = '2029-01-07';
  db.exec('DELETE FROM agenda');
  const previo = db.prepare('SELECT COUNT(*) n FROM agenda').get().n;
  const datos = hojas(CAB_BASE, [
    fila(fecha, '11:00', '88.888.888-8', 'PERSONA UNO', 'DANIEL LAGOS'),
    fila(fecha, '11:00', '99.999.999-9', 'PERSONA DOS', 'DANIEL LAGOS'),
  ]);
  assert.throws(() => importar(datos, { limpiar: true }), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /PERSONA UNO/);
    assert.match(e.message, /PERSONA DOS/);
    assert.match(e.message, /fila/i);
    return true;
  });
  // No se borro nada: limpiar=true no se aplico porque el archivo era invalido.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agenda').get().n, previo);
});

test('limpiar ya no borra el historial de movimientos', () => {
  db.prepare("INSERT INTO movimientos (agenda_id, accion, detalle) VALUES (NULL, 'prueba', 'no debe borrarse')").run();
  const marca = db.prepare("SELECT id FROM movimientos WHERE detalle = 'no debe borrarse'").get().id;
  importar(hojas(CAB_BASE, [fila('2029-01-08', '08:30', '10.000.000-5', 'CUALQUIERA', 'DANIEL LAGOS')]), { limpiar: true });
  assert.ok(db.prepare('SELECT id FROM movimientos WHERE id = ?').get(marca), 'el movimiento anterior a limpiar debe seguir existiendo');
});

test('matcher de hojas: reconoce ENE-JUN/JUL-DIC/AGO-DIC con año y AGENDA/CITAS DISPONIBLES', () => {
  const { esHojaMaestra } = require('../server/migrate');
  for (const ok of ['AGENDA', 'AGO-DIC', 'AGO-DIC 2026', 'ENE-JUN 2027', 'JUL-DIC 2027', 'ene-jun 2028']) {
    assert.ok(esHojaMaestra(ok), ok);
  }
  for (const no of ['OTRA HOJA', 'RESUMEN', '']) assert.ok(!esHojaMaestra(no), no);
});
