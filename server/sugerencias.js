'use strict';
// Lista de espera automatica: cuando un cupo queda libre, sugiere a quien darselo.
// Candidatos: personas pendientes en la cola de reagendamiento y citas marcadas
// lista_espera='SI' con fecha posterior al cupo. Solo sugiere; la asignacion usa
// las rutas existentes (cola-reagendar/:id/asignar y agenda/:id/reagendar).
const { db } = require('./db');
const { HORA_D_A5, CLASES_PESADAS } = require('./config');
const { vigenciaTramite, diasEntre } = require('./tramite');
const { hoyISO, sumarDias } = require('./fechas');
const pesada = require('./pesada');
const rut = require('./rut');
const faltas = require('./faltas');

const MAX_CANDIDATOS = 15;

const tienePesada = (clase) => String(clase || '').toUpperCase().split(',')
  .map((s) => s.trim()).some((cl) => CLASES_PESADAS.includes(cl));

// Regla D/A5: las clases pesadas solo van en el bloque HORA_D_A5.
function esCompatible(cupo, candidato) {
  return !tienePesada(candidato.clase) || cupo.hora === HORA_D_A5;
}

// Orden: (1) tramite por vencer (<= DIAS_POR_VENCER, mismo umbral que la pestana) primero;
// (2) grupo: cola urgente (bloqueo municipal, sin tipo) > cambio (solicita cambio y cola 'no_vino'/'reprobo')
// > lista de espera (cita mas lejana primero); (3) menos faltas ("No vino") primero; (4) desempate del
// grupo (cambio: fecha de la cita o del origen mas cercana, luego la mas antigua) y, al final, tramite
// mas cerca de vencer.
const PRIORIDAD = { cola: 0, cambio: 1, lista_espera: 2 };
const DIAS_POR_VENCER = 15;
const grupo = (c) => (c.origen === 'cola' && (c.tipo === 'no_vino' || c.tipo === 'reprobo') ? PRIORIDAD.cambio : PRIORIDAD[c.origen] ?? 2);
const fechaCita = (c) => String(c.fecha || c.origen_fecha || '');
function rankear(candidatos) {
  const dias = (c) => (c.vigencia ? c.vigencia.dias : Infinity);
  const porVencer = (c) => (dias(c) <= DIAS_POR_VENCER ? 0 : 1);
  return [...candidatos].sort((a, b) => {
    if (porVencer(a) !== porVencer(b)) return porVencer(a) - porVencer(b);
    const pa = grupo(a);
    const pb = grupo(b);
    if (pa !== pb) return pa - pb;
    const fa = a.faltas || 0;
    const fb = b.faltas || 0;
    if (fa !== fb) return fa - fb;
    if (pa === 0 && a.creado_en !== b.creado_en) return String(a.creado_en).localeCompare(String(b.creado_en));
    if (pa === 1) {
      if (fechaCita(a) !== fechaCita(b)) return fechaCita(a).localeCompare(fechaCita(b));
      if (a.creado_en !== b.creado_en) return String(a.creado_en || '').localeCompare(String(b.creado_en || ''));
    }
    if (pa === 2 && a.fecha !== b.fecha) return String(b.fecha).localeCompare(String(a.fecha));
    return dias(a) - dias(b);
  });
}

// Agrega faltas y tipo a cada persona (tipo 'no_vino' / 'reprobo' solo viene de la cola).
const conFaltas = (personas) => {
  const conteos = faltas.mapaConteos();
  return personas.map((p) => ({ ...p, tipo: p.tipo || null, faltas: conteos.get(clavePersona(p)) || 0 }));
};

// Clave de persona: RUT normalizado o, sin RUT, el nombre en mayusculas.
const clavePersona = (p) => rut.limpiar(p.rut) || String(p.nombre || '').toUpperCase().replace(/\s+/g, ' ').trim();

function sugerir(cupo) {
  const ocupadosDia = new Set(db.prepare(
    `SELECT rut, nombre FROM agenda WHERE fecha = ? AND (rut IS NOT NULL OR nombre IS NOT NULL)
      AND COALESCE(resultado, '') NOT IN ('NO ASISTIO', 'REPROBADO INASISTENCIA')`
  ).all(cupo.fecha).map(clavePersona).filter(Boolean));

  const cola = db.prepare(`SELECT * FROM cola_reagendar WHERE estado = 'pendiente'`).all()
    .map((c) => ({
      origen: 'cola', id: c.id, rut: c.rut, nombre: c.nombre, clase: c.clase, correo: c.correo,
      contacto: c.contacto, creado_en: c.creado_en, motivo: c.motivo,
      origen_fecha: c.origen_fecha, origen_hora: c.origen_hora, fecha_inicio_tramite: c.fecha_inicio_tramite,
      tipo: c.tipo,
    }));
  const lista = db.prepare(`
    SELECT a.*, e.nombre AS examinador FROM agenda a LEFT JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.lista_espera = 'SI' AND a.fecha > ? AND a.bloqueado = 0 AND COALESCE(a.pendiente_reagendar, 0) = 0 AND COALESCE(a.confirmo_asistencia, 0) != 1
      AND ((a.rut IS NOT NULL AND a.rut != '') OR (a.nombre IS NOT NULL AND a.nombre != ''))
  `).all(cupo.fecha).map((a) => ({
    origen: 'lista_espera', id: a.id, rut: a.rut, nombre: a.nombre, clase: a.clase, correo: a.correo,
    contacto: a.contacto, fecha: a.fecha, hora: a.hora, examinador: a.examinador,
    fecha_inicio_tramite: a.fecha_inicio_tramite,
  }));

  const cambio = db.prepare(`${SQL_CAMBIO} AND a.id != ?`).all(hoyISO(), cupo.id)
    .map((a) => ({ ...desdeCita(a, hoyISO()), origen: 'cambio' }));

  const vistos = new Set();
  const candidatos = conFaltas([...cola, ...cambio, ...lista])
    .filter((c) => esCompatible(cupo, c))
    .filter((c) => {
      const k = clavePersona(c);
      if (!k || ocupadosDia.has(k)) return false;
      return true;
    })
    .map((c) => ({ ...c, vigencia: vigenciaTramite(c) }));

  const ranking = rankear(candidatos).filter((c) => {
    const k = clavePersona(c);
    if (vistos.has(k)) return false; // misma persona en cola y lista: se muestra una vez
    vistos.add(k);
    return true;
  }).slice(0, MAX_CANDIDATOS);

  const avisos = [];
  if (cupo.hora === HORA_D_A5 && ranking.some((c) => tienePesada(c.clase))) {
    const ocupados = pesada.ocupadosDependientes(cupo.fecha, cupo.examinador_id);
    if (ocupados.length) avisos.push(`El examinador ya tiene citas en ${ocupados.map((o) => o.hora).join(' y ')}: una clase pesada aquí requiere liberarlas.`);
  }
  return { candidatos: ranking, avisos };
}

// ---------- Pestaña "Lista de espera": todos los que esperan + cupos compatibles ----------
const DIAS_VENTANA = 30;
const MAX_CUPOS = 50;
const ORIGENES = { reagendar: 'cola', cambio: 'cambio', lista_espera: 'lista_espera' };

const desdeCola = (c, hoy) => ({
  origen: 'cola', id: c.id, rut: c.rut, nombre: c.nombre, clase: c.clase, correo: c.correo,
  contacto: c.contacto, creado_en: c.creado_en, motivo: c.motivo, origen_fecha: c.origen_fecha,
  origen_hora: c.origen_hora, fecha_inicio_tramite: c.fecha_inicio_tramite, tipo: c.tipo,
  dias_esperando: c.creado_en ? Math.max(0, diasEntre(String(c.creado_en).slice(0, 10), hoy)) : null,
});
const desdeCita = (a, hoy) => ({
  origen: 'lista_espera', id: a.id, rut: a.rut, nombre: a.nombre, clase: a.clase, correo: a.correo,
  contacto: a.contacto, fecha: a.fecha, hora: a.hora, examinador: a.examinador,
  fecha_inicio_tramite: a.fecha_inicio_tramite,
  dias_esperando: a.agendado_en ? Math.max(0, diasEntre(String(a.agendado_en).slice(0, 10), hoy)) : null,
});

const SQL_LISTA = `SELECT a.*, e.nombre AS examinador FROM agenda a LEFT JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.lista_espera = 'SI' AND a.fecha > ? AND a.bloqueado = 0 AND COALESCE(a.pendiente_reagendar, 0) = 0 AND COALESCE(a.confirmo_asistencia, 0) != 1
    AND ((a.rut IS NOT NULL AND a.rut != '') OR (a.nombre IS NOT NULL AND a.nombre != ''))`;

// Citas cuyo postulante pidio cambio ("Reagendar" sin destino): siguen con su cita actual.
const SQL_CAMBIO = `SELECT a.*, e.nombre AS examinador FROM agenda a LEFT JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.pendiente_reagendar = 1 AND a.fecha >= ? AND a.bloqueado = 0 AND COALESCE(a.confirmo_asistencia, 0) != 1
    AND ((a.rut IS NOT NULL AND a.rut != '') OR (a.nombre IS NOT NULL AND a.nombre != ''))`;

// Cupos libres de la ventana + personas con cita por dia (regla: no dos veces el mismo dia).
function contexto(hoy) {
  const hasta = sumarDias(hoy, DIAS_VENTANA);
  const libres = db.prepare(`
    SELECT a.id, a.fecha, a.hora, a.examinador_id, e.nombre AS examinador FROM agenda a
    LEFT JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.fecha > ? AND a.fecha <= ? AND a.bloqueado = 0
      AND (a.rut IS NULL OR a.rut = '') AND (a.nombre IS NULL OR a.nombre = '')
    ORDER BY a.fecha, a.hora, a.id`).all(hoy, hasta);
  const ocupadosPorDia = new Map();
  db.prepare(`SELECT fecha, rut, nombre FROM agenda WHERE fecha > ? AND fecha <= ?
    AND ((rut IS NOT NULL AND rut != '') OR (nombre IS NOT NULL AND nombre != ''))
    AND COALESCE(resultado, '') NOT IN ('NO ASISTIO', 'REPROBADO INASISTENCIA')`).all(hoy, hasta)
    .forEach((r) => {
      if (!ocupadosPorDia.has(r.fecha)) ocupadosPorDia.set(r.fecha, new Set());
      ocupadosPorDia.get(r.fecha).add(clavePersona(r));
    });
  return { libres, ocupadosPorDia };
}

function cuposPara(persona, ctx) {
  const k = clavePersona(persona);
  return ctx.libres.filter((cupo) => esCompatible(cupo, persona)
    && !(persona.origen === 'lista_espera' && cupo.fecha >= persona.fecha)
    && !(k && ctx.ocupadosPorDia.has(cupo.fecha) && ctx.ocupadosPorDia.get(cupo.fecha).has(k)));
}

function listarEspera(hoy = hoyISO()) {
  const cola = db.prepare(`SELECT * FROM cola_reagendar WHERE estado = 'pendiente'`).all().map((c) => desdeCola(c, hoy));
  const cambio = db.prepare(SQL_CAMBIO).all(hoy).map((a) => ({ ...desdeCita(a, hoy), origen: 'cambio' }));
  const lista = db.prepare(SQL_LISTA).all(hoy).map((a) => desdeCita(a, hoy));
  const ctx = contexto(hoy);
  return rankear(conFaltas([...cola, ...cambio, ...lista]).map((p) => ({ ...p, vigencia: vigenciaTramite(p, hoy) })))
    .map((p) => ({
      ...p,
      origen: p.origen === 'cola' ? 'reagendar' : p.origen,
      dias_restantes_tramite: p.vigencia ? p.vigencia.dias : null,
      tramite_vence: p.vigencia ? p.vigencia.vence : null,
      cupos_compatibles: cuposPara(p, ctx).length,
    }));
}

// Devuelve null si la persona ya no esta esperando; lanza si el origen es invalido.
function cuposCompatibles(origen, id, hoy = hoyISO()) {
  const interno = ORIGENES[origen];
  if (!interno) { const e = new Error('Origen inválido.'); e.status = 400; throw e; }
  let persona;
  if (interno === 'cola') {
    const c = db.prepare(`SELECT * FROM cola_reagendar WHERE id = ? AND estado = 'pendiente'`).get(Number(id));
    persona = c && desdeCola(c, hoy);
  } else if (interno === 'cambio') {
    const a = db.prepare(`${SQL_CAMBIO} AND a.id = ?`).get(hoy, Number(id));
    persona = a && { ...desdeCita(a, hoy), origen: 'cambio' };
  } else {
    const a = db.prepare(`${SQL_LISTA} AND a.id = ?`).get(hoy, Number(id));
    persona = a && desdeCita(a, hoy);
  }
  if (!persona) return null;
  return cuposPara(persona, contexto(hoy)).slice(0, MAX_CUPOS);
}

module.exports = { esCompatible, rankear, sugerir, tienePesada, listarEspera, cuposCompatibles };
