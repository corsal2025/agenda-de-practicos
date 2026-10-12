'use strict';
// Procesamiento automatico de respuestas a los correos del sistema.
// Flujo: leer (Outlook) -> asociar a una cita -> clasificar -> aplicar en BD (tx) -> marcar categoria en Outlook.
// Idempotente por entry_id. Nunca sobrescribe una cita que ya tiene resultado ni toca citas pasadas.
const { db, tx, log } = require('./db');
const { hoyISO, ahoraTS } = require('./fechas');
const ce = require('./correo-entrada');
const asistencia = require('./asistencia');

db.exec(`
CREATE TABLE IF NOT EXISTS respuestas_correo (
  id            INTEGER PRIMARY KEY,
  entry_id      TEXT NOT NULL UNIQUE,
  agenda_id     INTEGER,
  remitente     TEXT,
  asunto        TEXT,
  extracto      TEXT,
  clasificacion TEXT NOT NULL,
  estado        TEXT NOT NULL,           -- aplicada | revisar | ignorada
  recibido_en   TEXT,
  procesado_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_respuestas_correo_estado ON respuestas_correo(estado);
`);

const ACTOR = 'correo-automatico';
const MOTIVO_REAGENDAR = 'Solicitado por correo';
const MAX_EXTRACTO = 300;
const ACCIONES = new Set(['confirma', 'no_asiste', 'reagendar']);
const INTERVALO_MS = 10 * 60 * 1000;
const RETARDO_INICIAL_MS = 30 * 1000;

const ocupada = (c) => Boolean(c && (c.rut || c.nombre));
// Cita sobre la que se puede actuar automaticamente.
function citaActuable(c, hoy) {
  return ocupada(c) && !c.bloqueado && String(c.fecha) >= hoy && !c.resultado;
}

function citaPorRemitente(remitente, hoy) {
  const r = String(remitente || '').trim().toLowerCase();
  if (!r) return null;
  const citas = db.prepare(`SELECT * FROM agenda WHERE lower(trim(correo)) = ? AND (rut IS NOT NULL OR nombre IS NOT NULL)
    AND bloqueado = 0 AND fecha >= ? ORDER BY fecha, hora`).all(r, hoy);
  return ce.elegirCitaPorRemitente(citas, hoy);
}

// Aplica una accion sobre la cita (sin tx propia). Devuelve true si cambio algo.
function aplicarAccion(cita, accion, actor) {
  const sufijo = ' (respuesta por correo)';
  if (accion === 'confirma') return asistencia.registrarAsistencia(cita.id, 1, actor, sufijo);
  if (accion === 'no_asiste') return asistencia.registrarAsistencia(cita.id, 0, actor, sufijo);
  if (accion === 'reagendar') {
    // Quien ya confirmo no se reagenda automaticamente (misma regla que la API).
    if (Number(cita.confirmo_asistencia) === 1) return false;
    return asistencia.marcarPendienteReagendar(cita.id, MOTIVO_REAGENDAR, actor);
  }
  return false;
}

// Decide y aplica dentro de una transaccion. Devuelve la fila guardada (o la existente si ya se proceso).
function procesarMensaje(msg, hoy = hoyISO()) {
  const entryId = String(msg && msg.entryId || '').trim();
  if (!entryId) return null;
  return tx(() => {
    const previa = db.prepare('SELECT * FROM respuestas_correo WHERE entry_id = ?').get(entryId);
    if (previa) return { ...previa, duplicada: true };

    const texto = ce.limpiarRespuesta(msg.body);
    const clasificacion = ce.clasificar(texto);
    const idAsunto = ce.extraerId(msg.subject);
    const cita = idAsunto
      ? db.prepare('SELECT * FROM agenda WHERE id = ?').get(idAsunto)
      : citaPorRemitente(msg.from, hoy);

    // Seguridad: el remitente debe ser el correo de la cita (un tercero no puede cambiarla citando el id).
    const mismoRemitente = Boolean(cita && cita.correo)
      && String(cita.correo).trim().toLowerCase() === String(msg.from || '').trim().toLowerCase();
    let estado = 'revisar';
    if (ACCIONES.has(clasificacion) && mismoRemitente && citaActuable(cita, hoy) && aplicarAccion(cita, clasificacion, ACTOR)) {
      estado = 'aplicada';
      log(cita.id, 'respuesta_correo', `${clasificacion}: ${String(msg.from || '')}`, ACTOR);
    }
    const sugerida = ocupada(cita) ? cita.id : null;
    const r = db.prepare(`INSERT INTO respuestas_correo
      (entry_id, agenda_id, remitente, asunto, extracto, clasificacion, estado, recibido_en, procesado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(entryId, sugerida, String(msg.from || '') || null,
      String(msg.subject || '') || null, texto.slice(0, MAX_EXTRACTO), clasificacion, estado,
      msg.received ? String(msg.received) : null, ahoraTS());
    return db.prepare('SELECT * FROM respuestas_correo WHERE id = ?').get(Number(r.lastInsertRowid));
  });
}

function categoriasDe(fila) {
  const cats = [{ entryId: fila.entry_id, categoria: ce.CATEGORIA_PROCESADO }];
  if (fila.estado === 'revisar') cats.push({ entryId: fila.entry_id, categoria: ce.CATEGORIA_REVISAR });
  return cats;
}

// Un ciclo completo. leer/marcar inyectables para test (por defecto Outlook real).
async function procesar({ leer = ce.leer, marcar = ce.marcar, hoy = hoyISO() } = {}) {
  const mensajes = await leer();
  const marcas = [];
  const confirmadas = [];
  const res = { leidos: mensajes.length, aplicadas: 0, revisar: 0, duplicadas: 0 };
  for (const m of mensajes) {
    const fila = procesarMensaje(m, hoy);
    if (!fila) continue;
    if (fila.duplicada) res.duplicadas++;
    else if (fila.estado === 'aplicada') {
      res.aplicadas++;
      if (fila.clasificacion === 'confirma') confirmadas.push(fila.agenda_id);
    } else if (fila.estado === 'revisar') res.revisar++;
    marcas.push(...categoriasDe(fila));
  }
  // Solo despues del commit se marca el correo en Outlook.
  if (marcas.length) await marcar(marcas);
  for (const id of confirmadas) await asistencia.enviarConfirmacionSiFalta(id);
  return res;
}

// Resolucion manual de una respuesta 'revisar' (desde la UI).
function resolver(id, { accion, agenda_id } = {}, actor, hoy = hoyISO()) {
  const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const fila = db.prepare('SELECT * FROM respuestas_correo WHERE id = ?').get(Number(id));
  if (!fila) throw err('Respuesta no encontrada.', 404);
  if (fila.estado !== 'revisar') throw err('Esta respuesta ya fue resuelta.', 409);
  if (accion === 'ignorar') {
    db.prepare("UPDATE respuestas_correo SET estado = 'ignorada', procesado_en = ? WHERE id = ?").run(ahoraTS(), fila.id);
    return { estado: 'ignorada', agenda_id: fila.agenda_id, confirmar: false };
  }
  if (!ACCIONES.has(accion)) throw err('Acción no válida.');
  const agendaId = Number(agenda_id || fila.agenda_id);
  if (!agendaId) throw err('Indica la cita a la que corresponde la respuesta.');
  return tx(() => {
    const cita = db.prepare('SELECT * FROM agenda WHERE id = ?').get(agendaId);
    if (!cita) throw err('Cita no encontrada.', 404);
    if (!citaActuable(cita, hoy)) throw err('La cita ya no admite cambios (pasada, liberada, bloqueada o con resultado).', 409);
    if (accion === 'reagendar' && Number(cita.confirmo_asistencia) === 1) {
      throw err('La persona confirmó asistencia: reagenda desde la agenda si corresponde.', 409);
    }
    aplicarAccion(cita, accion, actor);
    log(cita.id, 'respuesta_correo', `${accion} (revisada): ${fila.remitente || ''}`, actor);
    db.prepare("UPDATE respuestas_correo SET estado = 'aplicada', agenda_id = ?, clasificacion = ?, procesado_en = ? WHERE id = ?")
      .run(cita.id, accion, ahoraTS(), fila.id);
    return { estado: 'aplicada', agenda_id: cita.id, confirmar: accion === 'confirma' };
  });
}

function listar({ estado } = {}) {
  const filtro = estado ? 'WHERE r.estado = ?' : '';
  const filas = db.prepare(`SELECT r.*, a.fecha AS cita_fecha, a.hora AS cita_hora, a.nombre AS cita_nombre, a.rut AS cita_rut
    FROM respuestas_correo r LEFT JOIN agenda a ON a.id = r.agenda_id ${filtro}
    ORDER BY r.recibido_en DESC, r.id DESC LIMIT 200`).all(...(estado ? [estado] : []));
  return filas;
}

function resumen(hoy = hoyISO()) {
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;
  return {
    aplicadas_hoy: n("SELECT COUNT(*) n FROM respuestas_correo WHERE estado = 'aplicada' AND substr(procesado_en, 1, 10) = ?", hoy),
    revisar: n("SELECT COUNT(*) n FROM respuestas_correo WHERE estado = 'revisar'"),
    // "No asiste" por correo: la hora sigue ocupada; el personal decide si liberarla.
    por_liberar: n(`SELECT COUNT(DISTINCT r.agenda_id) n FROM respuestas_correo r JOIN agenda a ON a.id = r.agenda_id
      WHERE r.estado = 'aplicada' AND r.clasificacion = 'no_asiste' AND a.confirmo_asistencia = 0
        AND a.resultado IS NULL AND a.fecha >= ? AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)`, hoy),
  };
}

// ---------- programador ----------
function habilitado() {
  const v = String(process.env.CORREO_LEER ?? '').trim();
  if (v === '0') return false;
  if (!ce.soportado()) return false;
  if (v === '1') return true;
  return String(process.env.CORREO_MODO || '').toLowerCase() !== 'smtp';
}

let enCurso = false;
async function ciclo() {
  if (enCurso) return null; // nunca se superponen
  enCurso = true;
  try {
    const outlook = require('./correo-outlook');
    if (!(await outlook.disponible())) return null;
    const r = await procesar();
    if (r.aplicadas || r.revisar) console.log(`[respuestas-correo] aplicadas ${r.aplicadas}, por revisar ${r.revisar}`);
    return r;
  } catch (e) {
    console.error('[respuestas-correo]', e.message);
    log(null, 'correo_error', `Lectura de respuestas: ${e.message}`);
    return null;
  } finally {
    enCurso = false;
  }
}

function programar() {
  if (!habilitado()) return false;
  setTimeout(ciclo, RETARDO_INICIAL_MS);
  setInterval(ciclo, INTERVALO_MS);
  return true;
}

module.exports = { procesar, procesarMensaje, resolver, listar, resumen, programar, habilitado, ciclo };
