'use strict';
const { db } = require('./db');
const { HORA_D_A5, CLASES_PESADAS } = require('./config');
const { hoyISO } = require('./fechas');
const rut = require('./rut');

// Recalcula el reporte de errores sobre el estado actual de la agenda.
// Devuelve una lista de hallazgos { tipo, severidad, fecha, hora, examinador, rut, nombre, mensaje }.
function reporte() {
  const hoy = hoyISO();
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const filas = db.prepare(`
    SELECT a.*, e.nombre AS examinador
    FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.rut IS NOT NULL OR a.nombre IS NOT NULL OR a.bloqueado = 1
  `).all();

  const esTerreno = (f) => f.tipo_cita === 'TRASLADO EN TERRENO'
    || (f.bloqueado && /TERRENO|TRASLADO/i.test(f.bloqueo_motivo || ''));
  // Bloqueos que dejan al examinador fuera todo el dia.
  const esAusenciaDia = (f) => f.bloqueado
    && /ADMINISTRATIVO|FIESTAS PATRIAS|FERIADO|LICENCIA|VACACIONES|CAPACITACI|PERMISO|COMET[IÍ]DO/i.test(f.bloqueo_motivo || '');

  const hallazgos = [];
  const base = (f) => ({
    agenda_id: f.id, fecha: f.fecha, hora: f.hora, examinador: f.examinador,
    rut: f.rut, nombre: f.nombre,
  });

  // Indice: rut valido -> citas futuras
  const futurasPorRut = new Map();
  // Indice: examinador+fecha -> tipos presentes
  const terrenoPorDia = new Map();

  for (const f of filas) {
    const ocupada = Boolean(f.rut || f.nombre) && !f.bloqueado;

    // 1) Cita incompleta
    if (ocupada && f.nombre && !f.rut) {
      hallazgos.push({ ...base(f), tipo: 'INCOMPLETA', severidad: 'warning',
        mensaje: 'Registra nombre pero falta RUT' });
    }
    if (ocupada && f.rut && !f.nombre) {
      hallazgos.push({ ...base(f), tipo: 'INCOMPLETA', severidad: 'warning',
        mensaje: 'Registra RUT pero falta nombre' });
    }

    // 2) RUT invalido
    if (f.rut && !rut.esValido(f.rut)) {
      hallazgos.push({ ...base(f), tipo: 'RUT_INVALIDO', severidad: 'warning',
        mensaje: `RUT con digito verificador invalido: ${f.rut}` });
    }

    // 3) Clase pesada en bloque incorrecto
    if (ocupada && CLASES_PESADAS.includes((f.clase || '').toUpperCase()) && f.hora !== HORA_D_A5) {
      hallazgos.push({ ...base(f), tipo: 'CLASE_BLOQUE', severidad: 'warning',
        mensaje: `Clase ${f.clase} agendada ${f.hora}; solo se permite en el bloque ${HORA_D_A5}` });
    }

    // 4) Cita pasada reciente sin resultado (ultimos 30 dias; mas atras se asume cerrada)
    if (ocupada && f.fecha < hoy && f.fecha >= hace30 && !f.resultado && f.confirmo_asistencia !== 0) {
      hallazgos.push({ ...base(f), tipo: 'SIN_RESULTADO', severidad: 'info',
        mensaje: 'Cita ya realizada sin resultado registrado' });
    }


    // acumular indices
    if (f.rut && rut.esValido(f.rut) && f.fecha >= hoy) {
      const k = rut.limpiar(f.rut);
      if (!futurasPorRut.has(k)) futurasPorRut.set(k, []);
      futurasPorRut.get(k).push(f);
    }
    const kd = `${f.examinador}|${f.fecha}`;
    if (!terrenoPorDia.has(kd)) terrenoPorDia.set(kd, { terreno: 0, normales: 0, ausenciaDia: false, filas: [] });
    const slot = terrenoPorDia.get(kd);
    if (esAusenciaDia(f)) slot.ausenciaDia = true;
    else if (esTerreno(f)) slot.terreno++;
    else if (ocupada) slot.normales++;
    slot.filas.push(f);
  }

  // 6) Duplicado futuro: mismo RUT con 2+ citas desde hoy
  for (const [, citas] of futurasPorRut) {
    if (citas.length < 2) continue;
    const detalle = citas.map((c) => `${c.fecha} ${c.hora} (${c.examinador})`).join(', ');
    for (const c of citas) {
      hallazgos.push({ ...base(c), tipo: 'DUPLICADO_FUTURO', severidad: 'error',
        mensaje: `El contribuyente ya tiene ${citas.length} citas futuras: ${detalle}` });
    }
  }

  // 7) Conflicto terreno: examinador con traslado en terreno y ademas citas normales el mismo
  //    dia. Un solo hallazgo por (examinador, fecha), anclado al primer bloque en terreno.
  for (const [k, slot] of terrenoPorDia) {
    if (slot.normales === 0) continue;
    const [examinador, fecha] = k.split('|');
    const ancla = slot.filas.find((c) => c.bloqueado) || slot.filas[0];
    if (slot.ausenciaDia) {
      hallazgos.push({ ...base(ancla), tipo: 'CONFLICTO_TERRENO', severidad: 'error',
        mensaje: `${examinador} figura ausente el ${fecha} (dia administrativo/permiso) pero tiene ${slot.normales} cita(s) en oficina` });
    } else if (slot.terreno > 2) {
      hallazgos.push({ ...base(ancla), tipo: 'CONFLICTO_TERRENO', severidad: 'warning',
        mensaje: `${examinador} el ${fecha}: ${slot.terreno} bloques en terreno (mas que el traslado habitual) y ${slot.normales} cita(s) en oficina` });
    }
  }

  const orden = { error: 0, warning: 1, info: 2 };
  hallazgos.sort((a, b) =>
    orden[a.severidad] - orden[b.severidad] ||
    (a.fecha || '').localeCompare(b.fecha || '') ||
    (a.hora || '').localeCompare(b.hora || ''));

  const resumen = hallazgos.reduce((acc, h) => {
    acc[h.tipo] = (acc[h.tipo] || 0) + 1;
    return acc;
  }, {});

  return { total: hallazgos.length, resumen, hallazgos };
}

module.exports = { reporte };
