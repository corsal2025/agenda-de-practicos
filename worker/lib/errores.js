// Reemplaza server/errores.js. Ya usaba parametros posicionales; el cambio es
// pasar a async/await sobre D1 y usar hoyISOChile() (no hoyISO(), que en un
// Worker corre en UTC) para el corte de "hoy".
import { HORA_D_A5, CLASES_PESADAS } from './config.js';
import { hoyISOChile, esHabil } from './fechas.js';
import * as feriados from './feriados.js';
import * as rut from './rut.js';
import * as telefono from './telefono.js';
import * as pesada from './pesada.js';
import { HORAS } from './config.js';

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Bloques que ocupa una clase pesada agendada a las 12:30 (13:00 y 13:30).
const HORAS_TRAS_PESADA = HORAS.slice(HORAS.indexOf(HORA_D_A5) + 1);

// Recalcula el reporte de errores sobre el estado actual de la agenda.
// Devuelve una lista de hallazgos { tipo, severidad, fecha, hora, examinador, rut, nombre, mensaje }.
//
// NOTA: la hoja "REPORTE DE ERRORES" del Excel original venia de ARRAYFORMULA/FILTER de
// Google Sheets y no pudo leerse programaticamente. Estas reglas reconstruyen las 3 familias
// visibles en los mensajes ("Cita Incompleta", "CONFLICTO TERRENO", "DUPLICADO FUTURO") y
// agregan validaciones utiles (RUT modulo 11, clase en bloque, sin contacto, en feriado).
export async function reporte(db) {
  const hoy = hoyISOChile();
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const fset = await feriados.set(db);
  const { results: filas } = await db.prepare(`
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
  // Conflicto D/A5: cita a las 13:00/13:30 con el mismo examinador que tiene
  // clase pesada a las 12:30 (el examinador sale a terreno). La app lo impide al
  // agendar, pero puede venir de una importacion del Excel.
  const pesadasPorDia = new Set();
  const posiblesConflictoPesada = [];
  const base = (f) => ({
    agenda_id: f.id, fecha: f.fecha, hora: f.hora, examinador: f.examinador,
    rut: f.rut, nombre: f.nombre,
  });

  // Indice: rut valido -> citas futuras
  const futurasPorRut = new Map();
  // Indice: rut|fecha -> conteo (para duplicado el mismo dia)
  const mismoDiaPorRut = new Map();
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

    // 3) Clase pesada en bloque incorrecto (puede venir mas de una clase, ej. "B,D")
    const clasesF = String(f.clase || '').toUpperCase().split(',').map((s) => s.trim());
    if (ocupada && clasesF.some((cl) => CLASES_PESADAS.includes(cl)) && f.hora !== HORA_D_A5) {
      hallazgos.push({ ...base(f), tipo: 'CLASE_BLOQUE', severidad: 'warning',
        mensaje: `Clase ${f.clase} agendada ${f.hora}; solo se permite en el bloque ${HORA_D_A5}` });
    }

    // 4) Cita pasada reciente sin resultado (ultimos 30 dias; mas atras se asume cerrada)
    if (ocupada && f.fecha < hoy && f.fecha >= hace30 && !f.resultado && f.confirmo_asistencia !== 0) {
      hallazgos.push({ ...base(f), tipo: 'SIN_RESULTADO', severidad: 'info',
        mensaje: 'Cita ya realizada sin resultado registrado' });
    }

    // 5) Cita futura sin ningun medio de contacto
    if (ocupada && f.fecha >= hoy && !f.contacto && !f.correo) {
      hallazgos.push({ ...base(f), tipo: 'SIN_CONTACTO', severidad: 'warning',
        mensaje: 'Cita futura sin telefono ni correo: no se puede avisar ni confirmar' });
    }

    // 5b) Telefono incompleto (no llega a 9 digitos)
    if (ocupada && f.contacto && telefono.digitos(f.contacto).length !== 9) {
      hallazgos.push({ ...base(f), tipo: 'TELEFONO_INCOMPLETO', severidad: 'warning',
        mensaje: `Telefono incompleto: ${f.contacto} (deben ser 9 digitos)` });
    }

    // 5c) Reglas de la auditoria del Apps Script ("Auditar Agenda desde Hoy"):
    //     solo citas desde hoy. SIN_CONTACTO ya cubre "sin telefono ni correo",
    //     asi que aqui se marca lo que falta cuando el otro medio si existe.
    if (ocupada && f.fecha >= hoy) {
      if (!f.contacto && f.correo) {
        hallazgos.push({ ...base(f), tipo: 'FALTA_TELEFONO', severidad: 'warning',
          mensaje: 'Falta numero de contacto' });
      }
      if (!f.correo && f.contacto) {
        hallazgos.push({ ...base(f), tipo: 'FALTA_CORREO', severidad: 'info',
          mensaje: 'Falta correo: no recibira confirmacion ni recordatorio' });
      }
      if (f.correo && !CORREO_RE.test(String(f.correo).trim())) {
        hallazgos.push({ ...base(f), tipo: 'CORREO_INVALIDO', severidad: 'warning',
          mensaje: `Correo con formato invalido: ${f.correo}` });
      }
      if (!f.clase) {
        hallazgos.push({ ...base(f), tipo: 'FALTA_CLASE', severidad: 'warning',
          mensaje: 'Falta clase de licencia' });
      }
      if (f.hora !== HORA_D_A5 && HORAS_TRAS_PESADA.includes(f.hora)) posiblesConflictoPesada.push(f);
    }
    if (ocupada && f.fecha >= hoy && pesada.esPesadaEnHoraValida(f)) {
      pesadasPorDia.add(`${f.examinador_id}|${f.fecha}`);
    }

    // 6) Cita en un dia que hoy es feriado o fin de semana
    if (ocupada && !esHabil(f.fecha, fset)) {
      hallazgos.push({ ...base(f), tipo: 'DIA_INHABIL', severidad: 'warning',
        mensaje: 'Cita en fin de semana o feriado' });
    }

    // 7) Cita marcada como pendiente de reagendar
    if (ocupada && f.pendiente_reagendar) {
      hallazgos.push({ ...base(f), tipo: 'PENDIENTE_REAGENDAR', severidad: 'info',
        mensaje: `Pendiente de reagendar${f.pendiente_nota ? ': ' + f.pendiente_nota : ''}` });
    }

    // acumular indices
    if (f.rut && rut.esValido(f.rut)) {
      const k = rut.limpiar(f.rut);
      if (f.fecha >= hoy) {
        if (!futurasPorRut.has(k)) futurasPorRut.set(k, []);
        futurasPorRut.get(k).push(f);
      }
      const kf = `${k}|${f.fecha}`;
      if (!mismoDiaPorRut.has(kf)) mismoDiaPorRut.set(kf, []);
      mismoDiaPorRut.get(kf).push(f);
    }
    const kd = `${f.examinador}|${f.fecha}`;
    if (!terrenoPorDia.has(kd)) terrenoPorDia.set(kd, { terreno: 0, normales: 0, ausenciaDia: false, filas: [] });
    const slot = terrenoPorDia.get(kd);
    if (esAusenciaDia(f)) slot.ausenciaDia = true;
    else if (esTerreno(f)) slot.terreno++;
    else if (ocupada) slot.normales++;
    slot.filas.push(f);
  }

  // 8) Duplicado futuro: mismo RUT con 2+ citas desde hoy
  for (const [, citas] of futurasPorRut) {
    if (citas.length < 2) continue;
    const detalle = citas.map((c) => `${c.fecha} ${c.hora} (${c.examinador})`).join(', ');
    for (const c of citas) {
      hallazgos.push({ ...base(c), tipo: 'DUPLICADO_FUTURO', severidad: 'error',
        mensaje: `El contribuyente ya tiene ${citas.length} citas futuras: ${detalle}` });
    }
  }

  // 9) Duplicado el mismo dia: mismo RUT con 2+ bloques la misma fecha
  for (const [, citas] of mismoDiaPorRut) {
    if (citas.length < 2) continue;
    for (const c of citas) {
      hallazgos.push({ ...base(c), tipo: 'DUPLICADO_DIA', severidad: 'error',
        mensaje: `Mismo RUT en ${citas.length} bloques el ${c.fecha}` });
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

  for (const f of posiblesConflictoPesada) {
    if (!pesadasPorDia.has(`${f.examinador_id}|${f.fecha}`)) continue;
    hallazgos.push({ ...base(f), tipo: 'CONFLICTO_PESADA', severidad: 'error',
      mensaje: `${f.examinador} tiene clase D/A5 a las ${HORA_D_A5} ese dia: no puede tomar esta cita de las ${f.hora}` });
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
