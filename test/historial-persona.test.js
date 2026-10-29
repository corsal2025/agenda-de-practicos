'use strict';
// Historial por persona: cambios de hora, faltas, examenes, rutas, Excel y estadisticas.
// Usa una base temporal y un puerto efimero: NUNCA toca data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

// Variables de entorno ANTES de requerir los modulos del servidor.
const tmpDb = path.join(os.tmpdir(), `agenda-histpers-${Date.now()}.db`);
const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-histpers-bk-'));
process.env.AGENDA_DB = tmpDb;
process.env.AGENDA_BACKUP_DIR = tmpBackups;

const { db } = require('../server/db');
const { hoyISO } = require('../server/fechas');
const cola = require('../server/cola');
const faltas = require('../server/faltas');
const historial = require('../server/historial-persona');
const analitica = require('../server/analitica');
const { generarXlsxCompleto } = require('../server/export');
const { importar } = require('../server/migrate');
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

function slot(fecha, hora, extra = {}, examinador_id = 1) {
  db.prepare('INSERT INTO agenda (fecha, hora, examinador_id) VALUES (?, ?, ?)').run(fecha, hora, examinador_id);
  const fila = db.prepare('SELECT * FROM agenda WHERE fecha=? AND hora=? AND examinador_id=?').get(fecha, hora, examinador_id);
  const cols = Object.keys(extra);
  if (cols.length) {
    db.prepare(`UPDATE agenda SET ${cols.map((c) => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...extra, id: fila.id });
  }
  return db.prepare('SELECT * FROM agenda WHERE id = ?').get(fila.id);
}
const persona = (rut, nombre) => ({ rut, nombre, clase: 'B', correo: 'p@x.cl', contacto: '+56911111111' });
const cambiosDe = (k) => db.prepare('SELECT * FROM cambios_hora WHERE rut_limpio = ?').all(k);

test('reagendar con destino registra un cambio de hora; sin destino no', async () => {
  const origen = slot(hoyMas(20), '09:00', persona('11.111.111-1', 'JUAN PEREZ'));
  const destino = slot(hoyMas(21), '10:00');

  const sinDestino = await api('POST', `/agenda/${origen.id}/reagendar`, { motivo: 'solo marcar' });
  assert.equal(sinDestino.status, 200, sinDestino.texto);
  assert.equal(cambiosDe('111111111').length, 0);

  const r = await api('POST', `/agenda/${origen.id}/reagendar`, { destino_id: destino.id, motivo: 'por viaje' });
  assert.equal(r.status, 200, r.texto);
  const c = cambiosDe('111111111');
  assert.equal(c.length, 1);
  assert.equal(c[0].fecha_origen, origen.fecha);
  assert.equal(c[0].hora_origen, '09:00');
  assert.equal(c[0].fecha_destino, destino.fecha);
  assert.equal(c[0].hora_destino, '10:00');
  assert.equal(c[0].examinador_origen_id, 1);
  assert.equal(c[0].examinador_destino_id, 1);
  assert.equal(c[0].motivo, 'por viaje');
  assert.equal(c[0].origen_flujo, 'reagendar');
  assert.equal(c[0].nombre, 'JUAN PEREZ');
});

test('asignar desde la cola registra un cambio de hora con origen de la cola', async () => {
  const origen = slot(hoyMas(22), '09:00', persona('12.222.222-2', 'ANA SOTO'));
  cola.encolar(origen, 'Examinador no disponible', 'tester');
  const item = db.prepare(`SELECT * FROM cola_reagendar WHERE rut = ? AND estado = 'pendiente'`).get('12.222.222-2');
  const destino = slot(hoyMas(23), '11:00');

  const r = await api('POST', `/cola-reagendar/${item.id}/asignar`, { destino_id: destino.id });
  assert.equal(r.status, 200, r.texto);
  const c = cambiosDe('122222222');
  assert.equal(c.length, 1);
  assert.equal(c[0].origen_flujo, 'cola');
  assert.equal(c[0].fecha_origen, origen.fecha);
  assert.equal(c[0].hora_origen, '09:00');
  assert.equal(c[0].fecha_destino, destino.fecha);
  assert.equal(c[0].hora_destino, '11:00');
});

// Persona con 2 faltas, 1 cambio de hora, 1 aprobado y 1 reprobado.
function sembrarPersonaCompleta() {
  const rut = '13.333.333-3';
  const k = '133333333';
  const f1 = slot(hoyMas(-30), '09:00', persona(rut, 'MARIA LOPEZ'));
  const f2 = slot(hoyMas(-20), '09:30', persona(rut, 'MARIA LOPEZ'));
  faltas.registrar(f1, 'tester');
  faltas.registrar(f2, 'tester');
  slot(hoyMas(-10), '10:00', { ...persona(rut, 'MARIA LOPEZ'), resultado: 'APROBADO', intento: '1' });
  slot(hoyMas(-9), '10:30', { ...persona(rut, 'MARIA LOPEZ'), resultado: 'REPROBADO', intento: '2' });
  historial.registrarCambio({
    persona: { rut, nombre: 'MARIA LOPEZ', clase: 'B' },
    origen: { fecha: hoyMas(-40), hora: '09:00', examinador_id: 1 },
    destino: { fecha: hoyMas(-30), hora: '09:00', examinador_id: 1 },
    motivo: 'prueba', flujo: 'lista_espera', actor: 'tester',
  });
  slot(hoyMas(15), '12:00', persona(rut, 'MARIA LOPEZ'));
  return k;
}

test('listar y ficha devuelven conteos y linea de tiempo correctos', () => {
  const k = sembrarPersonaCompleta();
  const lista = historial.listar();
  const p = lista.find((x) => x.clave === k);
  assert.ok(p);
  assert.equal(p.faltas, 2);
  assert.equal(p.cambios_hora, 1);
  assert.equal(p.examenes, 2);
  assert.equal(p.aprobados, 1);
  assert.equal(p.reprobados, 1);
  assert.equal(p.ultima_falta, hoyMas(-20));
  assert.equal(p.ultimo_cambio, hoyISO());
  assert.equal(p.rut, '13.333.333-3');
  assert.equal(p.nombre, 'MARIA LOPEZ');
  // Orden: mas faltas primero.
  assert.equal(lista[0].clave, k);
  for (let i = 1; i < lista.length; i++) assert.ok(lista[i - 1].faltas >= lista[i].faltas);

  const f = historial.ficha(k);
  assert.deepEqual(f.resumen, { faltas: 2, cambios_hora: 1, examenes: 2, aprobados: 1, reprobados: 1, reprobados_inasistencia: 0 });
  assert.equal(f.persona.nombre, 'MARIA LOPEZ');
  assert.equal(f.persona.correo, 'p@x.cl');
  assert.equal(f.faltas.length, 2);
  assert.equal(f.faltas[0].fecha, hoyMas(-20));
  assert.equal(f.faltas[0].examinador !== null, true);
  assert.equal(f.cambios_hora.length, 1);
  assert.equal(f.cambios_hora[0].origen_flujo, 'lista_espera');
  assert.equal(f.examenes.length, 2);
  assert.equal(f.examenes[0].resultado, 'REPROBADO');
  assert.equal(f.cita_actual.fecha, hoyMas(15));
  assert.equal(f.cita_actual.hora, '12:00');
  assert.equal(f.en_lista_espera, null);
  assert.equal(f.linea_tiempo.length, 5);
  const fechas = f.linea_tiempo.map((e) => e.fecha);
  assert.deepEqual(fechas, [...fechas].sort().reverse());
  assert.deepEqual(new Set(f.linea_tiempo.map((e) => e.tipo)), new Set(['falta', 'cambio_hora', 'examen']));
  // Tambien se resuelve con el RUT formateado.
  assert.equal(historial.ficha('13.333.333-3').resumen.faltas, 2);
});

test('busqueda por q: nombre sin tildes/case, RUT con formato, sin coincidencias', () => {
  assert.ok(historial.listar({ q: 'maría lopez' }).some((p) => p.clave === '133333333'));
  assert.ok(historial.listar({ q: 'MARIA' }).some((p) => p.clave === '133333333'));
  assert.ok(historial.listar({ q: '13.333.333' }).some((p) => p.clave === '133333333'));
  assert.equal(historial.listar({ q: 'zzzinexistente' }).length, 0);
});

test('rutas GET /personas-historial: lista, ficha y 404', async () => {
  const l = await api('GET', '/personas-historial?q=lopez');
  assert.equal(l.status, 200, l.texto);
  assert.ok(Array.isArray(l.datos.personas));
  assert.equal(l.datos.personas[0].clave, '133333333');

  const f = await api('GET', `/personas-historial/${encodeURIComponent('133333333')}`);
  assert.equal(f.status, 200, f.texto);
  assert.equal(f.datos.resumen.faltas, 2);

  const sinRut = slot(hoyMas(-5), '15:00', { nombre: 'SIN RUT PERSONA', clase: 'B' });
  faltas.registrar(sinRut, 'tester');
  const n = await api('GET', `/personas-historial/${encodeURIComponent('SIN RUT PERSONA')}`);
  assert.equal(n.status, 200, n.texto);
  assert.equal(n.datos.persona.rut, null);
  assert.equal(n.datos.resumen.faltas, 1);

  const x = await api('GET', '/personas-historial/99999999X');
  assert.equal(x.status, 404);
});

test('export completo trae HISTORIAL PERSONAS, FALTAS y CAMBIOS DE HORA y se re-importa sin conflictos', () => {
  const buf = generarXlsxCompleto();
  const wb = XLSX.read(buf, { type: 'buffer' });
  for (const h of ['HISTORIAL PERSONAS', 'FALTAS', 'CAMBIOS DE HORA']) assert.ok(wb.SheetNames.includes(h), h);
  const hist = XLSX.utils.sheet_to_json(wb.Sheets['HISTORIAL PERSONAS'], { header: 1, defval: null });
  assert.deepEqual(hist[0], ['RUT', 'NOMBRE', 'FALTAS', 'CAMBIOS DE HORA', 'EXAMENES', 'APROBADOS', 'REPROBADOS', 'ULTIMA FALTA', 'ULTIMO CAMBIO']);
  const maria = hist.find((r) => r[0] === '13.333.333-3');
  assert.deepEqual(maria.slice(1, 7), ['MARIA LOPEZ', 2, 1, 2, 1, 1]);
  const fal = XLSX.utils.sheet_to_json(wb.Sheets.FALTAS, { header: 1, defval: null });
  assert.deepEqual(fal[0], ['RUT', 'NOMBRE', 'CLASE', 'FECHA', 'HORA', 'EXAMINADOR', 'REGISTRADA POR', 'REGISTRADA EN']);
  assert.equal(fal.length - 1, db.prepare('SELECT COUNT(*) n FROM faltas').get().n);
  const cam = XLSX.utils.sheet_to_json(wb.Sheets['CAMBIOS DE HORA'], { header: 1, defval: null });
  assert.equal(cam.length - 1, db.prepare('SELECT COUNT(*) n FROM cambios_hora').get().n);

  const archivo = path.join(tmpBackups, 'export-completo.xlsx');
  fs.writeFileSync(archivo, buf);
  const ocupadas = () => db.prepare('SELECT COUNT(*) n FROM agenda WHERE rut IS NOT NULL OR nombre IS NOT NULL').get().n;
  const antes = ocupadas();
  const res = importar(archivo);
  assert.deepEqual(res.conflictos || [], []);
  assert.equal(ocupadas(), antes);
});

test('estadisticas: las faltas nuevas suman a las inasistencias sin doble conteo', () => {
  const desde = '2041-03-01';
  const hasta = '2041-03-31';
  const kp = () => analitica.resumen(desde, hasta);
  slot('2041-03-04', '09:00', { ...persona('21.111.111-1', 'APROBADO UNO'), resultado: 'APROBADO' }, 2);
  const legado = slot('2041-03-04', '09:30', { ...persona('22.222.222-2', 'LEGADO NO ASISTIO'), resultado: 'NO ASISTIO' }, 2);

  const antes = kp();
  assert.equal(antes.kpis.con_resultado, 2);
  assert.equal(antes.kpis.inasistencia, 50);
  const exAntes = antes.por_examinador_resultado.find((r) => r.no_asistio === 1);
  assert.ok(exAntes);

  // Una falta que apunta a la fila legado (aun con NO ASISTIO) no se suma otra vez.
  faltas.registrar({ ...legado, fecha: '2041-03-04' }, 'tester');
  const igual = kp();
  assert.equal(igual.kpis.con_resultado, 2);
  assert.equal(igual.kpis.inasistencia, 50);
  assert.deepEqual(igual.por_examinador_resultado, antes.por_examinador_resultado);

  // Falta nueva con la fila ya liberada: suma una inasistencia al total y al examinador.
  const liberada = slot('2041-03-05', '10:00', { ...persona('23.333.333-3', 'NUEVA FALTA') }, 2);
  faltas.registrar(liberada, 'tester');
  db.prepare('UPDATE agenda SET rut = NULL, nombre = NULL, clase = NULL WHERE id = ?').run(liberada.id);
  const despues = kp();
  assert.equal(despues.kpis.con_resultado, 3);
  assert.equal(despues.kpis.inasistencia, 66.7);
  const ex = despues.por_examinador_resultado.find((r) => r.no_asistio === 2);
  assert.ok(ex);
  assert.equal(ex.con_resultado, 3);
  const celdas = despues.inasistencia_dia_hora.celdas.filter((c) => c.inasist > 0);
  assert.equal(celdas.reduce((a, c) => a + c.inasist, 0), 2);

  // Sin faltas en el rango, los numeros son los de siempre.
  const vacio = analitica.resumen('2042-03-01', '2042-03-31');
  assert.equal(vacio.kpis.con_resultado, 0);
  assert.equal(vacio.kpis.inasistencia, 0);
});
