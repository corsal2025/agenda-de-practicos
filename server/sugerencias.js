'use strict';
// Lista de espera automatica: cuando un cupo queda libre, sugiere a quien darselo.
// Candidatos: personas pendientes en la cola de reagendamiento y citas marcadas
// lista_espera='SI' con fecha posterior al cupo. Solo sugiere; la asignacion usa
// las rutas existentes (cola-reagendar/:id/asignar y agenda/:id/reagendar).
const { db } = require('./db');
const { HORA_D_A5, CLASES_PESADAS } = require('./config');
const { vigenciaTramite } = require('./tramite');
const pesada = require('./pesada');
const rut = require('./rut');

const MAX_CANDIDATOS = 15;

const tienePesada = (clase) => String(clase || '').toUpperCase().split(',')
  .map((s) => s.trim()).some((cl) => CLASES_PESADAS.includes(cl));

// Regla D/A5: las clases pesadas solo van en el bloque HORA_D_A5.
function esCompatible(cupo, candidato) {
  return !tienePesada(candidato.clase) || cupo.hora === HORA_D_A5;
}

// Orden: cola (mas antigua primero) > lista de espera (cita mas lejana primero);
// desempate final: tramite mas cerca de vencer.
function rankear(candidatos) {
  const dias = (c) => (c.vigencia ? c.vigencia.dias : Infinity);
  return [...candidatos].sort((a, b) => {
    const pa = a.origen === 'cola' ? 0 : 1;
    const pb = b.origen === 'cola' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0 && a.creado_en !== b.creado_en) return String(a.creado_en).localeCompare(String(b.creado_en));
    if (pa === 1 && a.fecha !== b.fecha) return String(b.fecha).localeCompare(String(a.fecha));
    return dias(a) - dias(b);
  });
}

// Clave de persona: RUT normalizado o, sin RUT, el nombre en mayusculas.
const clavePersona = (p) => rut.limpiar(p.rut) || String(p.nombre || '').toUpperCase().replace(/\s+/g, ' ').trim();

function sugerir(cupo) {
  const ocupadosDia = new Set(db.prepare(
    `SELECT rut, nombre FROM agenda WHERE fecha = ? AND (rut IS NOT NULL OR nombre IS NOT NULL)`
  ).all(cupo.fecha).map(clavePersona).filter(Boolean));

  const cola = db.prepare(`SELECT * FROM cola_reagendar WHERE estado = 'pendiente'`).all()
    .map((c) => ({
      origen: 'cola', id: c.id, rut: c.rut, nombre: c.nombre, clase: c.clase, correo: c.correo,
      contacto: c.contacto, creado_en: c.creado_en, motivo: c.motivo,
      origen_fecha: c.origen_fecha, origen_hora: c.origen_hora, fecha_inicio_tramite: c.fecha_inicio_tramite,
    }));
  const lista = db.prepare(`
    SELECT a.*, e.nombre AS examinador FROM agenda a LEFT JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.lista_espera = 'SI' AND a.fecha > ? AND a.bloqueado = 0
      AND ((a.rut IS NOT NULL AND a.rut != '') OR (a.nombre IS NOT NULL AND a.nombre != ''))
  `).all(cupo.fecha).map((a) => ({
    origen: 'lista_espera', id: a.id, rut: a.rut, nombre: a.nombre, clase: a.clase, correo: a.correo,
    contacto: a.contacto, fecha: a.fecha, hora: a.hora, examinador: a.examinador,
    fecha_inicio_tramite: a.fecha_inicio_tramite,
  }));

  const vistos = new Set();
  const candidatos = [...cola, ...lista]
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

module.exports = { esCompatible, rankear, sugerir, tienePesada };
