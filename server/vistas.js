'use strict';
// Vistas de solo lectura: calendario mensual y pantalla de sala de espera.
const { db } = require('./db');
const { HORA_D_A5 } = require('./config');
const { esHabil, hoyISO } = require('./fechas');
const feriados = require('./feriados');

const DURACION_MIN = 30;
const RE_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

function calendarioMes(mes) {
  const m = RE_MES.exec(String(mes || ''));
  if (!m) return null;
  const anio = Number(m[1]);
  const nMes = Number(m[2]);
  const ultimo = new Date(anio, nMes, 0).getDate();
  const desde = `${mes}-01`;
  const hasta = `${mes}-${String(ultimo).padStart(2, '0')}`;
  const filas = db.prepare(`
    SELECT fecha,
      COUNT(*) total_bloques,
      SUM(CASE WHEN bloqueado = 1 THEN 1 ELSE 0 END) bloqueados,
      SUM(CASE WHEN bloqueado = 0 AND (rut IS NOT NULL OR nombre IS NOT NULL) THEN 1 ELSE 0 END) ocupados,
      SUM(CASE WHEN bloqueado = 0 AND rut IS NULL AND nombre IS NULL THEN 1 ELSE 0 END) libres,
      SUM(CASE WHEN bloqueado = 0 AND rut IS NULL AND nombre IS NULL AND hora = ? THEN 1 ELSE 0 END) libres_pesada
    FROM agenda WHERE fecha BETWEEN ? AND ? GROUP BY fecha
  `).all(HORA_D_A5, desde, hasta);
  const porFecha = new Map(filas.map((f) => [f.fecha, f]));
  const nombres = new Map(feriados.listar().filter((f) => f.fecha >= desde && f.fecha <= hasta).map((f) => [f.fecha, f.nombre]));
  const set = feriados.set();
  const dias = [];
  for (let d = 1; d <= ultimo; d++) {
    const fecha = `${mes}-${String(d).padStart(2, '0')}`;
    const f = porFecha.get(fecha) || {};
    dias.push({
      fecha,
      total_bloques: Number(f.total_bloques || 0),
      ocupados: Number(f.ocupados || 0),
      libres: Number(f.libres || 0),
      bloqueados: Number(f.bloqueados || 0),
      libres_pesada: Number(f.libres_pesada || 0),
      feriado: nombres.get(fecha) || null,
      es_habil: esHabil(fecha, set),
    });
  }
  return { mes, dias };
}

// "JUAN ANDRES GONZALEZ PEREZ" -> "J. G." (primer nombre + primer apellido, formato chileno).
function iniciales(nombre) {
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '';
  const apellido = p.length >= 4 ? p[2] : (p[1] || null);
  const ini = (s) => `${s[0].toUpperCase()}.`;
  return apellido ? `${ini(p[0])} ${ini(apellido)}` : ini(p[0]);
}

const aMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };

// citas ordenadas por hora; ahora "HH:MM". Devuelve el estado de cada una.
function estadoSala(citas, ahora) {
  const t = aMin(ahora);
  // "Siguiente" = todas las citas de la proxima hora aun no iniciada (una por examinador).
  const futuras = citas.filter((c) => !c.resultado && aMin(c.hora) > t).map((c) => aMin(c.hora));
  const proxima = futuras.length ? Math.min(...futuras) : null;
  return citas.map((c) => {
    const ini = aMin(c.hora);
    if (c.resultado || t >= ini + DURACION_MIN) return 'finalizado';
    if (t >= ini) return 'en curso';
    return ini === proxima ? 'siguiente' : 'pendiente';
  });
}

function salaHoy(fecha = hoyISO(), ahora = new Date()) {
  const hhmm = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const filas = db.prepare(`
    SELECT a.hora, a.nombre, a.clase, a.resultado, e.nombre examinador
    FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.fecha = ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
    ORDER BY a.hora, e.nombre
  `).all(fecha);
  const estados = estadoSala(filas, fecha === hoyISO() ? hhmm : (fecha < hoyISO() ? '23:59' : '00:00'));
  // Lista blanca explicita: nunca RUT, nombre completo, telefono ni correo.
  const citas = filas.map((f, i) => ({
    hora: f.hora, iniciales: iniciales(f.nombre), clase: f.clase || '', examinador: f.examinador, estado: estados[i],
  }));
  return { fecha, citas };
}

module.exports = { calendarioMes, iniciales, estadoSala, salaHoy };
