'use strict';
// Vista de solo lectura: pantalla de sala de espera.
const { db } = require('./db');
const { hoyISO } = require('./fechas');

const DURACION_MIN = 30;


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

module.exports = { iniciales, estadoSala, salaHoy };
