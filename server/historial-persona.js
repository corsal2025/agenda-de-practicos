'use strict';
// Historial por persona (por RUT o, sin RUT, por nombre): faltas, cambios de hora y examenes.
// Solo lectura salvo registrarCambio, que se llama dentro del tx de las rutas que mueven a la persona.
const { db } = require('./db');
const rut = require('./rut');
const faltas = require('./faltas');
const { hoyISO } = require('./fechas');

const LIMITE = 500;
const FLUJOS = ['reagendar', 'cola', 'lista_espera'];

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fechaDe = (ts) => String(ts || '').slice(0, 10);

// origen/destino: { fecha, hora, examinador_id }. persona: { rut, nombre, clase }.
function registrarCambio({ persona, origen, destino, motivo, flujo, actor }) {
  const k = faltas.clave(persona);
  if (!k) return null;
  if (!FLUJOS.includes(flujo)) throw new Error(`Flujo de cambio de hora invalido: ${flujo}`);
  db.prepare(`
    INSERT INTO cambios_hora (rut_limpio, rut, nombre, clase, fecha_origen, hora_origen, examinador_origen_id,
      fecha_destino, hora_destino, examinador_destino_id, motivo, origen_flujo, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(k, persona.rut || null, persona.nombre || null, persona.clase || null,
    origen.fecha || null, origen.hora || null, origen.examinador_id ?? null,
    destino.fecha || null, destino.hora || null, destino.examinador_id ?? null,
    motivo || null, flujo, actor || null);
  return k;
}

function filasFaltas() {
  return db.prepare(`
    SELECT f.rut_limpio, f.rut, f.nombre, f.clase, f.fecha, f.hora, e.nombre AS examinador,
           f.actor, f.creado_en AS registrada_en
    FROM faltas f LEFT JOIN examinadores e ON e.id = f.examinador_id
    ORDER BY f.fecha DESC, f.hora DESC, f.id DESC
  `).all();
}

function filasCambios() {
  return db.prepare(`
    SELECT c.rut_limpio, c.rut, c.nombre, c.clase, c.fecha_origen, c.hora_origen, eo.nombre AS examinador_origen,
           c.fecha_destino, c.hora_destino, ed.nombre AS examinador_destino, c.motivo, c.origen_flujo,
           c.actor, c.creado_en
    FROM cambios_hora c
    LEFT JOIN examinadores eo ON eo.id = c.examinador_origen_id
    LEFT JOIN examinadores ed ON ed.id = c.examinador_destino_id
    ORDER BY c.creado_en DESC, c.id DESC
  `).all();
}

// Citas ocupadas (solo las que tienen resultado si soloConResultado), con la clave de persona.
function filasAgenda(soloConResultado) {
  return db.prepare(`
    SELECT a.id, a.fecha, a.hora, a.rut, a.nombre, a.clase, a.contacto, a.correo, a.resultado, a.intento,
           e.nombre AS examinador
    FROM agenda a LEFT JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      ${soloConResultado ? 'AND a.resultado IS NOT NULL' : ''}
    ORDER BY a.fecha, a.hora, a.id
  `).all().map((r) => ({ ...r, clave: faltas.clave(r) })).filter((r) => r.clave);
}

function listar({ q } = {}) {
  const personas = new Map();
  const obtener = (clave, r) => {
    let p = personas.get(clave);
    if (!p) {
      p = { clave, rut: null, nombre: null, faltas: 0, cambios_hora: 0, examenes: 0, aprobados: 0, reprobados: 0,
        ultima_falta: null, ultimo_cambio: null };
      personas.set(clave, p);
    }
    if (!p.rut && r.rut) p.rut = r.rut;
    if (!p.nombre && r.nombre) p.nombre = r.nombre;
    return p;
  };
  for (const f of filasFaltas()) {
    const p = obtener(f.rut_limpio, f);
    p.faltas += 1;
    if (!p.ultima_falta || f.fecha > p.ultima_falta) p.ultima_falta = f.fecha;
  }
  for (const c of filasCambios()) {
    const p = obtener(c.rut_limpio, c);
    p.cambios_hora += 1;
    const dia = fechaDe(c.creado_en);
    if (!p.ultimo_cambio || dia > p.ultimo_cambio) p.ultimo_cambio = dia;
  }
  for (const a of filasAgenda(true).reverse()) {
    const p = obtener(a.clave, a);
    p.examenes += 1;
    if (a.resultado === 'APROBADO') p.aprobados += 1;
    if (a.resultado === 'REPROBADO') p.reprobados += 1;
  }

  let lista = [...personas.values()];
  const texto = sinTildes(q).trim();
  if (texto) {
    // Solo busca por RUT si el texto parece un RUT (evita que "kevin" coincida con la K de un RUT).
    const porRut = /^[0-9.\-kK\s]+$/.test(texto) ? rut.limpiar(texto) : '';
    lista = lista.filter((p) => sinTildes(p.nombre).includes(texto) || (porRut && p.clave.includes(porRut)));
  }
  lista.sort((a, b) => b.faltas - a.faltas || b.cambios_hora - a.cambios_hora
    || String(a.nombre || a.clave).localeCompare(String(b.nombre || b.clave)));
  return lista.slice(0, LIMITE);
}

// Devuelve null si no hay ningun dato de esa persona.
function ficha(claveEntrada) {
  const texto = String(claveEntrada || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!texto) return null;
  const k = /^[0-9.\-K\s]+$/.test(texto) && rut.limpiar(texto) ? rut.limpiar(texto) : texto;

  const misFaltas = filasFaltas().filter((f) => f.rut_limpio === k);
  const misCambios = filasCambios().filter((c) => c.rut_limpio === k);
  const citas = filasAgenda(false).filter((a) => a.clave === k);
  const enCola = db.prepare(`SELECT * FROM cola_reagendar WHERE estado = 'pendiente' ORDER BY creado_en, id`).all()
    .filter((c) => faltas.clave(c) === k);
  if (!misFaltas.length && !misCambios.length && !citas.length && !enCola.length) return null;

  const examenes = citas.filter((a) => a.resultado);
  const hoy = hoyISO();
  const proxima = citas.find((a) => a.fecha >= hoy && !a.resultado);
  // Datos de contacto: la cita mas reciente primero, luego faltas, cambios y cola.
  const fuentes = [...citas.slice().reverse(), ...misFaltas, ...misCambios, ...enCola];
  const dato = (campo) => { const f = fuentes.find((x) => x[campo]); return f ? f[campo] : null; };

  const resumen = {
    faltas: misFaltas.length,
    cambios_hora: misCambios.length,
    examenes: examenes.length,
    aprobados: examenes.filter((a) => a.resultado === 'APROBADO').length,
    reprobados: examenes.filter((a) => a.resultado === 'REPROBADO').length,
    reprobados_inasistencia: examenes.filter((a) => a.resultado === 'REPROBADO INASISTENCIA').length,
  };

  const linea = [
    ...misFaltas.map((f) => ({
      fecha: f.fecha, tipo: 'falta',
      detalle: `No vino a su examen de las ${f.hora || '-'}${f.examinador ? ` con ${f.examinador}` : ''}`,
    })),
    ...misCambios.map((c) => ({
      fecha: fechaDe(c.creado_en), tipo: 'cambio_hora',
      detalle: `Cambio de hora: ${c.fecha_origen || '-'} ${c.hora_origen || '-'} -> ${c.fecha_destino || '-'} ${c.hora_destino || '-'}`,
    })),
    ...examenes.map((a) => ({
      fecha: a.fecha, tipo: 'examen',
      detalle: `${a.resultado} a las ${a.hora}${a.examinador ? ` con ${a.examinador}` : ''}`,
    })),
  ].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  return {
    persona: { rut: dato('rut'), nombre: dato('nombre'), clase: dato('clase'), contacto: dato('contacto'), correo: dato('correo') },
    resumen,
    faltas: misFaltas.map((f) => ({
      fecha: f.fecha, hora: f.hora, examinador: f.examinador, actor: f.actor, registrada_en: f.registrada_en,
    })),
    cambios_hora: misCambios.map(({ rut_limpio, ...c }) => c),
    examenes: examenes.slice().reverse().map((a) => ({
      fecha: a.fecha, hora: a.hora, examinador: a.examinador, clase: a.clase, resultado: a.resultado, intento: a.intento,
    })),
    cita_actual: proxima ? { fecha: proxima.fecha, hora: proxima.hora, examinador: proxima.examinador } : null,
    en_lista_espera: enCola.length ? { tipo: enCola[0].tipo || 'reagendar', desde: enCola[0].creado_en } : null,
    linea_tiempo: linea,
  };
}

module.exports = { registrarCambio, listar, ficha, filasFaltas, filasCambios };
