'use strict';
// Papelera: guarda/restaura el contenido de un bloque antes de liberarlo o pisarlo.
process.env.AGENDA_DB = require('node:path').join(require('node:os').tmpdir(), `agenda-papelera-${process.pid}.db`); // nunca tocar data/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { db } = require('../server/db');
const papelera = require('../server/papelera');

test.after(() => {
  for (const s of ['', '-shm', '-wal']) { try { fs.unlinkSync(process.env.AGENDA_DB + s); } catch (_) {} }
});

function examinador(nombre) {
  db.prepare('INSERT INTO examinadores (nombre) VALUES (?)').run(nombre);
  return db.prepare('SELECT id FROM examinadores WHERE nombre = ?').get(nombre).id;
}

function bloqueOcupado(ex, extra = {}) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-06-01', '09:00', ex);
  const fila = db.prepare('SELECT * FROM agenda WHERE examinador_id = ? AND fecha = ? AND hora = ?').get(ex, '2026-06-01', '09:00');
  const datos = { rut: '11.111.111-1', nombre: 'PERSONA', ...extra };
  const cols = Object.keys(datos);
  db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...datos, id: fila.id });
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(fila.id);
}

test('listar() devuelve clase', () => {
  const ex = examinador('EX PAPELERA 1');
  const bloque = bloqueOcupado(ex, { clase: 'B' });
  papelera.guardar(bloque, 'liberar', 'test');
  const entrada = papelera.listar()[0];
  assert.equal(entrada.clase, 'B');
});

test('guardar y restaurar conserva escuela_conductores y tipo_reagendamiento', () => {
  const ex = examinador('EX PAPELERA 2');
  const bloque = bloqueOcupado(ex, { escuela_conductores: 'ESCUELA X', tipo_reagendamiento: 'POR CLIMA' });
  papelera.guardar(bloque, 'liberar', 'test');
  db.prepare('DELETE FROM agenda WHERE id = ?').run(bloque.id);
  db.prepare('INSERT INTO agenda (id, fecha, hora, examinador_id) VALUES (?, ?, ?, ?)').run(bloque.id, bloque.fecha, bloque.hora, ex);
  const entrada = papelera.listar()[0];
  const restaurado = papelera.restaurar(entrada.id);
  assert.equal(restaurado.escuela_conductores, 'ESCUELA X');
  assert.equal(restaurado.tipo_reagendamiento, 'POR CLIMA');
});

test('una entrada en formato antiguo (sin esas claves en el JSON) se restaura sin error y deja esos campos en null', () => {
  const ex = examinador('EX PAPELERA 3');
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run('2026-06-02', '09:00', ex);
  const bloque = db.prepare('SELECT * FROM agenda WHERE examinador_id = ? AND fecha = ? AND hora = ?').get(ex, '2026-06-02', '09:00');
  // Formato de una entrada guardada ANTES de agregar escuela_conductores/tipo_reagendamiento a CAMPOS:
  // trae todos los campos de esa epoca, pero no esos dos.
  const datosViejos = {
    rut: '22.222.222-2', nombre: 'VIEJA', clase: 'B', contacto: null, correo: null, tipo_cita: null,
    motivo_reagendamiento: null, lista_espera: null, intento: null, funcionario_id: null,
    fecha_inicio_tramite: null, confirmo_asistencia: null, resultado: null, comentarios: null,
    bloqueado: 0, bloqueo_motivo: null, pendiente_reagendar: 0, pendiente_nota: null,
    agendado_en: null, avisado_por: null,
    _fecha: bloque.fecha, _hora: bloque.hora, _examinador_id: ex,
  };
  db.prepare('INSERT INTO papelera (agenda_id, datos, motivo, actor) VALUES (?, ?, ?, ?)')
    .run(bloque.id, JSON.stringify(datosViejos), 'liberar', 'test');
  db.prepare('UPDATE agenda SET rut = NULL, nombre = NULL WHERE id = ?').run(bloque.id);
  const entrada = db.prepare('SELECT id FROM papelera WHERE agenda_id = ?').get(bloque.id);
  const restaurado = papelera.restaurar(entrada.id);
  assert.equal(restaurado.escuela_conductores, null);
  assert.equal(restaurado.tipo_reagendamiento, null);
  assert.equal(restaurado.nombre, 'VIEJA');
});
