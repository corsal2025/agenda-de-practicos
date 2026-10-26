'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const { db, tx, upsertFuncionario, upsertExaminador, log } = require('./db');
const { PUERTO, HOST, RAIZ, HORAS, HORA_D_A5, CLASES_PESADAS, CATALOGOS } = require('./config');
const { generar } = require('./slots');
const { reporte } = require('./errores');
const { resumen } = require('./analitica');
const { vigenciaTramite } = require('./tramite');
const { generarXlsx, generarXlsxOriginal } = require('./export');
const { importar } = require('./migrate');
const backupMod = require('./backup');
const { hoyISO, sumarDias, ahoraTS } = require('./fechas');
const feriados = require('./feriados');
const validar = require('./validar');
const papelera = require('./papelera');
const cola = require('./cola');
const bloqueo = require('./bloqueo');
const pesada = require('./pesada');
const correo = require('./correo');
const { esc } = require('./html');
const recordatorios = require('./recordatorios');
const auth = require('./auth');
const rut = require('./rut');
const telefono = require('./telefono');
const sugerencias = require('./sugerencias');
const limpieza = require('./limpieza');
const vistas = require('./vistas');
const intentos = require('./intentos');
const asistencia = require('./asistencia');
const { SELECT_BLOQUE, traer, marcarConfirmacionEnviada, motivoCorreo } = asistencia;
const respuestasCorreo = require('./respuestas-correo');
const enlacePublico = require('./enlace-publico');
const historial = require('./historial');

const app = express();
app.disable('x-powered-by');
// Host, Origin, cabeceras y limite de cuerpo JSON (1 MB; /api/import 25 MB): antes de static y de las rutas.
const seguridad = require('./seguridad-acceso').desdeEntorno();
app.use(seguridad.cabeceras, seguridad.acceso, seguridad.json);
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    const t0 = Date.now();
    res.on('finish', () => {
      console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - t0}ms)`);
    });
  }
  next();
});
app.use(express.static(path.join(RAIZ, 'public'), {
  etag: false, lastModified: false,
  setHeaders: (res, ruta) => {
    // App local: nunca cachear HTML/CSS/JS (asi los cambios se ven al recargar sin trucos).
    if (/\.(html|css|js)$/i.test(ruta)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));
const subir = multer({ dest: path.join(os.tmpdir(), 'agenda-uploads'), limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- confirmar / rechazar por correo (publico, sin login) ----------
// `mensaje` y `extra` son HTML: quien llama debe escapar los datos que interpole.
function paginaPublica(titulo, mensaje, ok, extra = '') {
  return `<!doctype html><html lang="es"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${titulo}</title>
    <body style="font-family:sans-serif;background:#f1f5f9;margin:0;padding:2.5rem 1.2rem;color:#1e293b">
      <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:10px;padding:2rem 1.6rem;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center">
        <div style="font-size:2.2rem">${ok ? '✅' : '⚠️'}</div>
        <h1 style="font-size:1.2rem;margin:.8rem 0 .4rem">${titulo}</h1>
        <p style="color:#475569;margin:0">${mensaje}</p>
        ${extra}
      </div>
    </body></html>`;
}

function fFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return (d && m && y) ? `${d}/${m}/${y}` : String(iso);
}

// Los correos traen links GET, pero abrirlos NO ejecuta nada: los escaneres de correo
// (Outlook SafeLinks, antivirus) visitan los links y confirmarian solos. El GET muestra un
// boton y solo el POST (click real de la persona) realiza la accion y consume el token.
function botonPost(accion, id, token, texto, color) {
  return `<form method="POST" action="/${accion}/${Number(id)}/${esc(token)}" style="margin:1.4rem 0 0">
    <button type="submit" style="background:${color};color:#fff;border:none;padding:.7rem 1.4rem;border-radius:6px;font-weight:700;font-size:.95rem;cursor:pointer">${texto}</button>
  </form>`;
}
// Evalua el enlace (token, fecha pasada, resultado ya registrado) y responde con el motivo
// honesto si no es valido. Devuelve el bloque solo si el enlace sigue siendo valido.
function bloquePorEnlace(req, res) {
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(Number(req.params.id));
  const ev = enlacePublico.evaluarEnlace(bloque, req.params.token);
  if (!ev.ok) {
    res.status(ev.status).send(paginaPublica('Link no válido', ev.mensaje, false));
    return null;
  }
  return bloque;
}
const errorPublico = (res, e, contexto) => {
  console.error(`[PUBLICO] ${contexto}:`, e);
  res.status(500).send(paginaPublica('Ocurrió un error', 'No pudimos procesar tu solicitud. Contacta a la oficina.', false));
};

app.get('/confirmar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorEnlace(req, res);
    if (!bloque) return;
    res.send(paginaPublica('Confirma tu asistencia',
      `Examen práctico el <b>${esc(fFecha(bloque.fecha))}</b> a las <b>${esc(bloque.hora)}</b> hrs.`,
      true, botonPost('confirmar', bloque.id, req.params.token, '✔ Confirmo mi asistencia', '#15803d')));
  } catch (e) { errorPublico(res, e, 'GET confirmar'); }
});
app.post('/confirmar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorEnlace(req, res);
    if (!bloque) return;
    db.prepare("UPDATE agenda SET confirmo_asistencia = 1, token_confirmacion = NULL, actualizado_en = datetime('now','localtime') WHERE id = ?").run(bloque.id);
    log(bloque.id, 'confirmar', `${bloque.fecha} ${bloque.hora} confirmado por correo`);
    res.send(paginaPublica('¡Listo, tu hora quedó confirmada!', 'Te esperamos el día y la hora agendada. Gracias por confirmar.', true));
  } catch (e) { errorPublico(res, e, 'POST confirmar'); }
});
app.get('/rechazar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorEnlace(req, res);
    if (!bloque) return;
    res.send(paginaPublica('¿No puedes asistir?',
      `Tu examen práctico es el <b>${esc(fFecha(bloque.fecha))}</b> a las <b>${esc(bloque.hora)}</b> hrs. Si no puedes asistir, avísanos para reagendar.`,
      false, botonPost('rechazar', bloque.id, req.params.token, 'No puedo asistir', '#b91c1c')));
  } catch (e) { errorPublico(res, e, 'GET rechazar'); }
});
app.post('/rechazar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorEnlace(req, res);
    if (!bloque) return;
    db.prepare(`
      UPDATE agenda SET confirmo_asistencia = 0, pendiente_reagendar = 1,
        pendiente_nota = 'No puede asistir (avisado por correo automatico)',
        token_confirmacion = NULL, actualizado_en = datetime('now','localtime')
      WHERE id = ?
    `).run(bloque.id);
    log(bloque.id, 'rechazar', `${bloque.fecha} ${bloque.hora} avisó que no puede asistir (correo)`);
    res.send(paginaPublica('Gracias por avisar', 'Registramos que no puedes asistir. El equipo te contactará para reagendar tu hora.', true));
  } catch (e) { errorPublico(res, e, 'POST rechazar'); }
});
// ---------- reagendar por el propio ciudadano (publico, con token) ----------
const tieneClasePesada = (clase) => String(clase || '').toUpperCase().split(',').map((s) => s.trim())
  .some((cl) => CLASES_PESADAS.includes(cl));
const VENTANA_REAGENDAR_DIAS = 35;

// Horarios que se le ofrecen: libres, no bloqueados, entre manana y +35 dias (hora local) y
// respetando la regla D/A5 (solo 12:30, y solo si el examinador no tiene citas despues).
function opcionesReagendar(bloque) {
  const pesadaCita = tieneClasePesada(bloque.clase);
  const hoy = hoyISO();
  const filas = db.prepare(`
    SELECT a.id, a.fecha, a.hora, a.examinador_id, e.nombre as examinador
    FROM agenda a
    JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.fecha >= ? AND a.fecha <= ?
      AND a.bloqueado = 0 AND (a.rut IS NULL OR a.rut = '') AND (a.nombre IS NULL OR a.nombre = '')
      ${pesadaCita ? 'AND a.hora = ?' : ''}
    ORDER BY a.fecha ASC, a.hora ASC
    LIMIT 300
  `).all(sumarDias(hoy, 1), sumarDias(hoy, VENTANA_REAGENDAR_DIAS), ...(pesadaCita ? [HORA_D_A5] : []));
  const feriadosSet = feriados.set();
  return filas
    .filter((f) => !feriadosSet.has(f.fecha))
    .filter((f) => !pesadaCita || !pesada.ocupadosDependientes(f.fecha, f.examinador_id).length)
    .slice(0, 25);
}

const SIN_REAGENDAR_CONFIRMADA = (fecha) => `Ya confirmaste tu asistencia para el <b>${esc(fFecha(fecha))}</b>. `
  + 'Puedes reagendar después de esa fecha; si no vas a poder asistir, avísanos para que te contactemos.';

app.get('/reagendar/:id/:token', (req, res) => { try {
  const bloque = db.prepare('SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id WHERE a.id = ?').get(Number(req.params.id));
  const ev = enlacePublico.evaluarEnlace(bloque, req.params.token);
  if (!ev.ok) return res.status(ev.status).send(paginaPublica('Link no válido', ev.mensaje, false));
  if (asistencia.confirmadaBloqueaReagendar(bloque)) {
    return res.status(409).send(paginaPublica('Todavía no puedes reagendar', SIN_REAGENDAR_CONFIRMADA(bloque.fecha), false));
  }

  const disponibles = opcionesReagendar(bloque);

  const opcionesHtml = disponibles.length ? disponibles.map(d => `
    <div style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:12px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
      <div>
        <div style="font-weight:700;color:#0f172a;font-size:14px">📅 ${esc(fFecha(d.fecha))} a las ${esc(d.hora)} hrs</div>
        <div style="font-size:12px;color:#64748b">Examinador/a: ${esc(d.examinador)}</div>
      </div>
      <form method="POST" action="/reagendar/${bloque.id}/${esc(req.params.token)}/elegir" style="margin:0">
        <input type="hidden" name="nuevo_slot_id" value="${d.id}">
        <button type="submit" style="background:#0284c7;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer">
          Elegir este horario
        </button>
      </form>
    </div>
  `).join('') : '<p style="color:#64748b">No hay cupos libres en los próximos 35 días. Por favor contacta directamente a la Dirección de Tránsito.</p>';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reagendamiento de Examen Práctico</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1e293b; padding: 20px; margin: 0; }
    .card { max-width: 640px; margin: 20px auto; background: #fff; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    h1 { font-size: 20px; color: #0f172a; margin: 0 0 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔄 Reagendar Examen Práctico de Conducir</h1>
    <div style="background:#f1f5f9;padding:12px 16px;border-radius:8px;margin-bottom:18px;font-size:13px">
      <div><b>Postulante:</b> ${esc(bloque.nombre)} (${esc(bloque.rut || '')})</div>
      <div><b>Hora actual agendada:</b> ${esc(fFecha(bloque.fecha))} a las ${esc(bloque.hora)} hrs (Examinador: ${esc(bloque.examinador)})</div>
    </div>
    <p style="font-size:13.5px;color:#334155;margin-bottom:16px">
      Selecciona tu <b>nueva fecha y horario</b>. Tu hora anterior se liberará automáticamente y el nuevo horario quedará agendado de inmediato:
    </p>
    <div>${opcionesHtml}</div>
  </div>
</body>
</html>`;

  res.send(html);
} catch (e) { errorPublico(res, e, 'GET reagendar'); } });

app.post('/reagendar/:id/:token/elegir', express.urlencoded({ extended: true }), (req, res) => { try {
  const bloque = db.prepare('SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id WHERE a.id = ?').get(Number(req.params.id));
  const ev = enlacePublico.evaluarEnlace(bloque, req.params.token);
  if (!ev.ok) return res.status(ev.status).send(paginaPublica('Link no válido', ev.mensaje, false));
  if (asistencia.confirmadaBloqueaReagendar(bloque)) {
    return res.status(409).send(paginaPublica('Todavía no puedes reagendar', SIN_REAGENDAR_CONFIRMADA(bloque.fecha), false));
  }

  const nuevoId = Number((req.body || {}).nuevo_slot_id);
  const nuevoToken = crypto.randomBytes(16).toString('hex');

  // Todo en una transaccion: se relee y valida el origen y el destino, y se mueve la cita
  // sin dejar el estado a medias si algo falla (seguridad ante carreras).
  const nuevoSlot = tx(() => {
    const origenActual = db.prepare('SELECT * FROM agenda WHERE id = ?').get(bloque.id);
    const evTx = enlacePublico.evaluarEnlace(origenActual, req.params.token);
    if (!evTx.ok) throw bad(evTx.mensaje, evTx.status);
    if (asistencia.confirmadaBloqueaReagendar(origenActual)) throw bad(SIN_REAGENDAR_CONFIRMADA(origenActual.fecha).replace(/<\/?b>/g, ''), 409);

    const destino = db.prepare('SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id WHERE a.id = ?').get(nuevoId);
    const noDisponible = () => bad('Ese horario ya no está disponible. Por favor regresa y selecciona otra fecha.');
    if (!destino || destino.bloqueado || destino.rut || destino.nombre) throw noDisponible();
    // Mismas reglas que el listado: ventana de fechas, feriados y regla D/A5.
    const hoy = hoyISO();
    if (destino.fecha < sumarDias(hoy, 1) || destino.fecha > sumarDias(hoy, VENTANA_REAGENDAR_DIAS)) throw noDisponible();
    if (feriados.set().has(destino.fecha)) throw noDisponible();
    if (tieneClasePesada(bloque.clase)) {
      if (destino.hora !== HORA_D_A5) throw noDisponible();
      if (pesada.ocupadosDependientes(destino.fecha, destino.examinador_id).length) throw noDisponible();
    }

    db.prepare(`
      UPDATE agenda SET
        rut = @rut, nombre = @nombre, clase = @clase, contacto = @contacto, correo = @correo,
        tipo_cita = 'REAGENDADO', motivo_reagendamiento = 'Reagendamiento autónomo por correo',
        lista_espera = @lista_espera, intento = @intento, funcionario_id = @funcionario_id,
        fecha_inicio_tramite = @fecha_inicio_tramite, confirmo_asistencia = 1,
        resultado = NULL, pendiente_reagendar = 0, pendiente_nota = NULL,
        comentarios = @comentarios, agendado_en = COALESCE(agendado_en, datetime('now','localtime')),
        token_confirmacion = @token, correo_confirmacion_enviado = 0, correo_recordatorio_enviado = 0,
        actualizado_en = datetime('now', 'localtime')
      WHERE id = @nuevoId
    `).run({
      rut: bloque.rut,
      nombre: bloque.nombre,
      clase: bloque.clase,
      contacto: bloque.contacto,
      correo: bloque.correo,
      lista_espera: bloque.lista_espera,
      intento: bloque.intento,
      funcionario_id: bloque.funcionario_id,
      fecha_inicio_tramite: bloque.fecha_inicio_tramite,
      comentarios: [bloque.comentarios, `Reagendada desde ${bloque.fecha} ${bloque.hora} (autoservicio por correo)`].filter(Boolean).join(' | '),
      token: nuevoToken,
      nuevoId: destino.id,
    });

    if (Number(bloque.cupo) > 1) {
      db.prepare('DELETE FROM agenda WHERE id = ?').run(bloque.id);
    } else {
      db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL} WHERE id = ?`).run(bloque.id);
    }
    return destino;
  });

  // Regla de clase pesada (D/A5): libera los bloques auto-bloqueados del origen y bloquea los del destino.
  if (pesada.esPesadaEnHoraValida(bloque)) pesada.liberar(bloque.fecha, bloque.examinador_id);
  if (pesada.esPesadaEnHoraValida({ hora: nuevoSlot.hora, clase: bloque.clase })) {
    pesada.aplicar(nuevoSlot.fecha, nuevoSlot.examinador_id);
  }

  log(nuevoSlot.id, 'reagendar', `${bloque.fecha} ${bloque.hora} -> ${nuevoSlot.fecha} ${nuevoSlot.hora} (Autoservicio ciudadano por correo)`);

  const nuevoFinal = traer(nuevoSlot.id);
  if (nuevoFinal.correo) {
    correo.confirmacion(nuevoFinal)
      .then((ok) => { if (ok) marcarConfirmacionEnviada(nuevoFinal); })
      .catch((e) => console.error('Correo de confirmacion fallo:', e.message));
  }

  res.send(paginaPublica(
    '¡Hora reagendada con éxito!',
    `Tu examen práctico ha sido reprogramado para el <b>${esc(fFecha(nuevoSlot.fecha))} a las ${esc(nuevoSlot.hora)} hrs</b> con ${esc(nuevoSlot.examinador)}. Hemos enviado tu nuevo comprobante a tu correo.`,
    true
  ));
} catch (e) {
  // Errores previstos (bad) se muestran tal cual; cualquier otro se registra y se oculta al ciudadano.
  if (e.status) return res.status(e.status).send(paginaPublica('No pudimos reagendar', esc(e.message), false));
  errorPublico(res, e, 'POST reagendar/elegir');
} });



// Captura tanto errores sincronos como rechazos de handlers async.
const wrap = (fn) => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(next);
};
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// Regla principal: no se da hora a una persona sin correo valido (lo exigen la
// confirmacion y el recordatorio automatico).
const CORREO_RE = validar.CORREO_FORMATO;
function correoValido(c) { return CORREO_RE.test(String(c || '').trim()); }
function exigirCorreo(c) {
  if (!String(c || '').trim()) throw bad('Falta el correo: no se puede dar hora a una persona sin correo electrónico.');
  if (!correoValido(c)) throw bad(`Correo con formato inválido: ${String(c).trim()}`);
  return String(c).trim().toLowerCase();
}
const actorDe = (req) => auth.actor(req);
const logReq = (req, id, accion, detalle) => log(id, accion, detalle, actorDe(req));

// ---------- catalogos ----------
function catalogo(tipo) {
  return db.prepare('SELECT valor FROM catalogos WHERE tipo = ? AND activo = 1 ORDER BY orden, valor')
    .all(tipo).map((r) => r.valor);
}
function enCatalogo(tipo, valor) {
  if (valor == null || valor === '') return true;
  return catalogo(tipo).includes(valor);
}

// ---------- META ----------
app.get('/api/meta', wrap((req, res) => {
  res.json({
    horas: HORAS,
    hora_d_a5: HORA_D_A5,
    clases_pesadas: CLASES_PESADAS,
    hoy: hoyISO(),
    examinadores: db.prepare('SELECT id, nombre, activo FROM examinadores ORDER BY nombre').all(),
    funcionarios: db.prepare('SELECT id, nombre, activo FROM funcionarios ORDER BY nombre').all(),
    catalogos: {
      clase: catalogo('clase'),
      tipo_cita: catalogo('tipo_cita'),
      resultado: catalogo('resultado'),
      intento: catalogo('intento'),
      lista_espera: catalogo('lista_espera'),
      escuela_conductores: catalogo('escuela_conductores'),
      tipo_reagendamiento: catalogo('tipo_reagendamiento'),
    },
    feriados: feriados.listar(),
    rango_agenda: db.prepare('SELECT MIN(fecha) desde, MAX(fecha) hasta FROM agenda').get(),
    logo: logoDisponible(),
    correo: { modo: correo.modo() },
    motivos_bloqueo: bloqueo.MOTIVOS_BLOQUEO,
    organismo: process.env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso',
    unidad: process.env.AGENDA_UNIDAD || 'Departamento de Licencias de Conducir',
  });
}));

// Busca un archivo de logo puesto por el usuario en public/ (logo.svg, .png, .jpg, .webp).
function logoDisponible() {
  for (const nombre of ['logo.svg', 'logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp']) {
    if (fs.existsSync(path.join(RAIZ, 'public', nombre))) return '/' + nombre;
  }
  return null;
}

// ---------- AGENDA ----------

// Clases que exigen escuela de conductores (la vigencia de 6 meses aplica a todas las clases).
const CLASES_TRAMITE = ['D', 'A5'];
const tieneClaseTramite = (clase) => String(clase || '').split(',').some((c) => CLASES_TRAMITE.includes(c.trim()));
const DIAS_AVISO_TRAMITE = 7;
function alertasTramite(row, hoy = hoyISO()) {
  const v = vigenciaTramite(row, hoy);
  if (!v) return [];
  if (v.dias <= 0) return [`Trámite vencido (venció el ${v.vence})`];
  if (v.dias <= DIAS_AVISO_TRAMITE) return [`Trámite próximo a vencer (${v.vence})`];
  return [];
}
function conAlertas(row) {
  const v = vigenciaTramite(row);
  return {
    ...row,
    alerts: alertasTramite(row),
    dias_restantes_tramite: v ? v.dias : null,
    fecha_vencimiento_tramite: v ? v.vence : null,
  };
}

app.get('/api/agenda', wrap((req, res) => {
  const { fecha, desde, hasta, examinador_id, estado, clase } = req.query;
  const cond = [];
  const p = [];
  if (fecha) { cond.push('a.fecha = ?'); p.push(fecha); }
  if (desde) { cond.push('a.fecha >= ?'); p.push(desde); }
  if (hasta) { cond.push('a.fecha <= ?'); p.push(hasta); }
  if (examinador_id) { cond.push('a.examinador_id = ?'); p.push(Number(examinador_id)); }
  if (clase) {
    // Coincidencia por token exacto: 'A' no debe traer A1..A5. La clase guardada es "B,A2".
    const token = `%,${String(clase).toUpperCase().replace(/\s/g, '')},%`;
    const enClase = "(',' || REPLACE(COALESCE(a.clase, ''), ' ', '') || ',') LIKE ?";
    if (CLASES_PESADAS.includes(String(clase).toUpperCase())) {
      cond.push(`(${enClase} OR ((a.rut IS NULL AND a.nombre IS NULL AND a.bloqueado = 0) AND a.hora = ?))`);
      p.push(token, HORA_D_A5);
    } else {
      cond.push(`(${enClase} OR (a.rut IS NULL AND a.nombre IS NULL AND a.bloqueado = 0))`);
      p.push(token);
    }
  }
  if (estado === 'libre') cond.push('a.rut IS NULL AND a.nombre IS NULL AND a.bloqueado = 0');
  if (estado === 'ocupada') cond.push('(a.rut IS NOT NULL OR a.nombre IS NOT NULL) AND a.bloqueado = 0');
  if (estado === 'bloqueada') cond.push('a.bloqueado = 1');
  if (estado === 'pendiente') cond.push('a.pendiente_reagendar = 1');
  if (estado === 'porconfirmar') cond.push("(a.rut IS NOT NULL OR a.nombre IS NOT NULL) AND a.bloqueado = 0 AND (a.confirmo_asistencia IS NULL) AND a.fecha >= date('now','localtime')");
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = db.prepare(`${SELECT_BLOQUE} ${where} ORDER BY a.fecha, a.hora, e.nombre LIMIT 6000`).all(...p);
  
  res.json(rows.map(conAlertas));
}));

app.get('/api/agenda/:id', wrap((req, res) => {
  const row = traer(req.params.id);
  if (!row) throw bad('Bloque no encontrado', 404);
  res.json(conAlertas(row));
}));

app.post('/api/agenda/generar', wrap((req, res) => {
  const { desde, hasta } = req.body || {};
  if (!desde || !hasta) throw bad('Indica desde y hasta (YYYY-MM-DD)');
  const r = generar(desde, hasta);
  logReq(req, null, 'generar', `${desde}..${hasta}: ${r.creados}`);
  res.json(r);
}));

function validarBloque(body, bloque) {
  const avisos = [];
  // Una cita puede tener varias clases marcadas a la vez: "B,A2". Se valida
  // cada una por separado y se guarda como lista normalizada.
  const clases = [...new Set(String(body.clase || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))];
  for (const cl of clases) if (!enCatalogo('clase', cl)) throw bad(`Clase no valida: ${cl}`);
  const clase = clases.length ? clases.join(',') : null;
  const tienePesada = clases.some((cl) => CLASES_PESADAS.includes(cl));
  // Un valor que no cambia no se revalida: datos antiguos fuera del catalogo se pueden seguir editando
  const catalogoSiCambia = (tipo, campo) => body[campo] === bloque[campo] || enCatalogo(tipo, body[campo]);
  if (!catalogoSiCambia('tipo_cita', 'tipo_cita')) throw bad(`Tipo de cita no valido: ${body.tipo_cita}`);
  if (!catalogoSiCambia('resultado', 'resultado')) throw bad(`Resultado no valido: ${body.resultado}`);
  if (!catalogoSiCambia('tipo_reagendamiento', 'tipo_reagendamiento')) throw bad(`Tipo de reagendamiento no valido: ${body.tipo_reagendamiento}`);
  if (!catalogoSiCambia('escuela_conductores', 'escuela_conductores')) throw bad(`Escuela no valida: ${body.escuela_conductores}`);
  if (!catalogoSiCambia('intento', 'intento')) throw bad(`Intento no valido: ${body.intento}`);
  if (!catalogoSiCambia('lista_espera', 'lista_espera')) throw bad(`Lista de espera no valida: ${body.lista_espera}`);

  if (tienePesada && bloque.hora !== HORA_D_A5 && !body.forzar) {
    throw bad(`Las clases D/A5 solo se agendan en el bloque ${HORA_D_A5}. Elige ese horario o marca "forzar".`);
  }
  if (tienePesada && bloque.hora === HORA_D_A5 && !body.forzar) {
    const ocupados = pesada.ocupadosDependientes(bloque.fecha, bloque.examinador_id);
    if (ocupados.length) {
      const detalle = ocupados.map((o) => `${o.hora} (${o.nombre || o.rut})`).join(' y ');
      throw bad(
        `No se puede agendar clase D/A5 a las ${HORA_D_A5}: el examinador ya tiene cita en ${detalle}. `
        + 'Libera esas horas primero o marca "forzar" para agendar igual (esas horas no quedaran bloqueadas).'
      );
    }
  }
  let rutFmt = null;
  if (body.rut && String(body.rut).trim()) {
    rutFmt = rut.formatear(body.rut);
    // Solo se revalida si el RUT cambia: un RUT antiguo fuera de formato no bloquea otras ediciones
    if (rut.limpiar(rutFmt) !== rut.limpiar(bloque.rut)) validar.exigirRut(rutFmt);
  }
  if (body.tipo_cita === 'REAGENDADO' && !body.motivo_reagendamiento) {
    avisos.push('Cita marcada como REAGENDADO sin motivo de reagendamiento.');
  }
  return { avisos, rutFmt, clase };
}

// Devuelve null si no aplica la regla, o { clase, reprobados, motivo } si se autorizo.
// Lanza 409 TERCER_INTENTO sin autorizacion y 400 si el motivo es muy corto.
function verificarTercerIntento(body, bloque, rutFmt, clase) {
  if (!rutFmt) return null;
  const mismoRut = rut.limpiar(bloque.rut) === rut.limpiar(rutFmt);
  const mismaClase = intentos.clasesDe(bloque.clase).join(',') === intentos.clasesDe(clase).join(',');
  if (mismoRut && mismaClase) return null;
  const b = intentos.bloqueoTercerIntento(db, { rut: rutFmt, clase, excluirId: bloque.id });
  if (!b) return null;
  const aut = body.autorizar_tercer_intento;
  if (!aut) {
    const e = bad(b.mensaje, 409);
    Object.assign(e, { codigo: 'TERCER_INTENTO', clase: b.clase, reprobados: b.reprobados });
    throw e;
  }
  const motivo = String(aut.motivo || '').trim().replace(/\s+/g, ' ');
  if (motivo.length < intentos.MOTIVO_MINIMO) {
    throw bad(`El motivo de la autorización debe tener al menos ${intentos.MOTIVO_MINIMO} caracteres.`);
  }
  return { clase: b.clase, reprobados: b.reprobados, motivo };
}

app.put('/api/agenda/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  const body = req.body || {};

  // Bloqueo optimista: el cliente manda el actualizado_en que vio.
  if (body.visto_en && bloque.actualizado_en && body.visto_en !== bloque.actualizado_en) {
    const e = bad('Otra persona modifico este bloque mientras lo editabas. Se recargaron los datos.', 409);
    e.bloque = traer(id);
    throw e;
  }

  // --- Bloqueo administrativo ---
  if (body.bloqueado) {
    const motivo = String(body.bloqueo_motivo || 'BLOQUEADO').trim().toUpperCase();
    let aReagendar = false;
    if (bloque.rut || bloque.nombre) {
      papelera.guardar(bloque, 'bloquear', actorDe(req));
      cola.encolar(bloque, motivo, actorDe(req));
      aReagendar = true;
    }
    db.prepare(`
      UPDATE agenda SET bloqueado = 1, bloqueo_motivo = @motivo,
        rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
        motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
        fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL, avisado_por=NULL,
        pendiente_reagendar=0, pendiente_nota=NULL,
        token_confirmacion=NULL, correo_confirmacion_enviado=0, correo_recordatorio_enviado=0,
        comentarios=@com, agendado_en=NULL, actualizado_en=datetime('now','localtime')
      WHERE id = @id
    `).run({ id, motivo, com: body.comentarios ? String(body.comentarios).trim() : null });
    if (pesada.esPesadaEnHoraValida(bloque) && (bloque.rut || bloque.nombre)) {
      pesada.liberar(bloque.fecha, bloque.examinador_id);
    }
    logReq(req, id, 'bloquear', `${bloque.fecha} ${bloque.hora} (${motivo})`);
    return res.json({ ok: true, avisos: [], bloque: traer(id), a_reagendar: aReagendar });
  }

  const { avisos, rutFmt, clase } = validarBloque(body, bloque);

  // Un bloque bloqueado no se ocupa en silencio: hay que desbloquearlo antes (POST /liberar).
  if (bloque.bloqueado && (rutFmt || (body.nombre && String(body.nombre).trim()))) {
    throw bad(`El bloque esta bloqueado: ${bloque.bloqueo_motivo || 'BLOQUEADO'}. Desbloquealo primero.`, 409);
  }

  // Regla de 3er intento: solo al ocupar el bloque o cambiar RUT/clase (editar otros campos no bloquea).
  const autorizacion = verificarTercerIntento(body, bloque, rutFmt, clase);

  const tel = telefono.normalizar(body.contacto);
  // Solo se revalida si el telefono cambia: un telefono antiguo fuera de formato no bloquea otras ediciones
  if (!tel.vacio && tel.valor !== (bloque.contacto || null)) validar.exigirTelefono(body.contacto);

  let funcionario_id = body.funcionario_id ? Number(body.funcionario_id) : null;
  if (!funcionario_id && body.funcionario_nombre) funcionario_id = upsertFuncionario(String(body.funcionario_nombre).trim().toUpperCase());

  const nombre = body.nombre ? String(body.nombre).trim().replace(/\s+/g, ' ').toUpperCase() : null;
  const estabaOcupada = Boolean(bloque.rut || bloque.nombre);
  const quedaOcupada = Boolean(rutFmt || nombre);
  // Es otra persona solo si cambian a la vez el RUT y el nombre (comparados normalizados), o si
  // el bloque pasa de vacio a ocupado o de ocupado a vacio. Corregir uno solo de los dos
  // (un RUT o un nombre mal escrito) es una correccion: conserva token, marcas y confirmacion.
  const normNombre = (n) => String(n || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const cambiaRut = rut.limpiar(bloque.rut) !== rut.limpiar(rutFmt);
  const cambiaNombre = normNombre(bloque.nombre) !== normNombre(nombre);
  const cambiaPersona = estabaOcupada !== quedaOcupada || (cambiaRut && cambiaNombre);
  const esCorreccion = estabaOcupada && quedaOcupada && !cambiaPersona && (cambiaRut || cambiaNombre);
  // Dar hora (bloque libre -> ocupado) o cambiar de persona exige correo valido.
  // Corregir un dato o editar otros campos de una cita antigua sin correo no lo exige.
  if (quedaOcupada && cambiaPersona) exigirCorreo(body.correo);
  else if (body.correo && String(body.correo).trim().toLowerCase() !== (bloque.correo || '').toLowerCase()
    && !correoValido(body.correo)) throw bad(`Correo con formato inválido: ${String(body.correo).trim()}`);
  const correoNuevo = body.correo ? String(body.correo).trim().toLowerCase() : null;
  const cambiaCorreo = Boolean(correoNuevo) && correoNuevo !== (bloque.correo || '').toLowerCase();

  // Si se va a pisar una cita distinta, guardar la anterior en papelera.
  if (estabaOcupada && cambiaPersona) {
    papelera.guardar(bloque, 'sobrescribir', actorDe(req));
  }

  let confirmo = bloque.confirmo_asistencia;
  if (body.confirmo_asistencia === true || body.confirmo_asistencia === 1) confirmo = 1;
  else if (body.confirmo_asistencia === false || body.confirmo_asistencia === 0) confirmo = 0;
  else if (body.confirmo_asistencia === null || body.confirmo_asistencia === '') confirmo = null;

  const pendiente = body.pendiente_reagendar ? 1 : 0;

  // Fecha de inicio de tramite: vacia/null o AAAA-MM-DD real (se usa en atributos HTML).
  if (body.fecha_inicio_tramite != null && body.fecha_inicio_tramite !== '') {
    const fit = String(body.fecha_inicio_tramite);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(fit) ? new Date(`${fit}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fit) throw bad('Fecha de inicio de trámite inválida');
  }

  // Cambia el ocupante (se ocupa, se libera o entra otra persona): el token y las
  // banderas de correo del ocupante anterior no deben pasar al nuevo.
  db.prepare(`
    UPDATE agenda SET
      rut = @rut, nombre = @nombre, clase = @clase, contacto = @contacto, correo = @correo,
      tipo_cita = @tipo_cita, motivo_reagendamiento = @motivo_reagendamiento,
      lista_espera = @lista_espera, intento = @intento, funcionario_id = @funcionario_id,
      fecha_inicio_tramite = @fecha_inicio_tramite, escuela_conductores = @escuela_conductores, tipo_reagendamiento = @tipo_reagendamiento,
      confirmo_asistencia = @confirmo_asistencia,
      resultado = @resultado, comentarios = @comentarios,
      pendiente_reagendar = @pendiente, pendiente_nota = @pnota,
      token_confirmacion = CASE WHEN @cambia = 1 THEN NULL ELSE token_confirmacion END,
      correo_confirmacion_enviado = CASE WHEN @cambia = 1 THEN 0 ELSE correo_confirmacion_enviado END,
      correo_recordatorio_enviado = CASE WHEN @cambia = 1 OR @cambiaCorreo = 1 THEN 0 ELSE correo_recordatorio_enviado END,
      agendado_en = CASE WHEN @quedaOcupada = 1 THEN COALESCE(agendado_en, @agendado_en) ELSE NULL END,
      actualizado_en = datetime('now','localtime')
    WHERE id = @id
  `).run({
    id,
    rut: rutFmt,
    nombre,
    clase,
    contacto: tel.valor,
    correo: correoNuevo,
    tipo_cita: body.tipo_cita || null,
    motivo_reagendamiento: body.motivo_reagendamiento ? String(body.motivo_reagendamiento).trim() : null,
    lista_espera: body.lista_espera || null,
    intento: body.intento || null,
    funcionario_id,
    fecha_inicio_tramite: body.fecha_inicio_tramite || null,
    escuela_conductores: tieneClaseTramite(clase) && body.escuela_conductores ? String(body.escuela_conductores) : null,
    tipo_reagendamiento: body.tipo_reagendamiento || null,
    confirmo_asistencia: confirmo,
    resultado: body.resultado || null,
    comentarios: [body.comentarios ? String(body.comentarios).trim() : null,
      autorizacion ? `Autorizado 3er intento: ${autorizacion.motivo}` : null].filter(Boolean).join(' | ') || null,
    pendiente,
    pnota: pendiente && body.pendiente_nota ? String(body.pendiente_nota).trim() : null,
    quedaOcupada: quedaOcupada ? 1 : 0,
    cambia: cambiaPersona ? 1 : 0,
    cambiaCorreo: cambiaCorreo ? 1 : 0,
    agendado_en: `${hoyISO()} ${new Date().toTimeString().slice(0, 8)}`,
  });

  const accion = !estabaOcupada && quedaOcupada ? 'agendar'
    : estabaOcupada && !quedaOcupada ? 'liberar' : 'editar';
  const cambios = [];
  if (cambiaRut) cambios.push(`RUT ${bloque.rut || '—'} → ${rutFmt || '—'}`);
  if (cambiaNombre) cambios.push(`nombre ${bloque.nombre || '—'} → ${nombre || '—'}`);
  logReq(req, id, accion, esCorreccion
    ? `corrección ${bloque.fecha} ${bloque.hora}: ${cambios.join('; ')}`
    : `${bloque.fecha} ${bloque.hora} ${nombre || bloque.nombre || ''}`);
  if (autorizacion) {
    logReq(req, id, 'autorizar_tercer_intento',
      `${rutFmt} clase ${autorizacion.clase} (${autorizacion.reprobados} reprobados): ${autorizacion.motivo}`);
  }

  // Clase pesada (D/A5) a las 12:30: bloquea/libera automaticamente los
  // bloques siguientes del mismo examinador ese dia.
  const eraPesada = pesada.esPesadaEnHoraValida(bloque) && estabaOcupada;
  const esPesadaAhora = pesada.esPesadaEnHoraValida({ hora: bloque.hora, clase }) && quedaOcupada;
  if (esPesadaAhora && !eraPesada) {
    avisos.push(...pesada.aplicar(bloque.fecha, bloque.examinador_id));
  } else if (eraPesada && !esPesadaAhora) {
    pesada.liberar(bloque.fecha, bloque.examinador_id);
  }

  const bloqueFinal = traer(id);
  // Cita nueva o de otra persona: se ESPERA el resultado del correo (puede tardar hasta ~40-60 s)
  // para mostrarle a quien agenda lo que realmente pasó.
  let resultadoCorreo = null;
  if (quedaOcupada && cambiaPersona) {
    if (bloqueFinal.correo && !bloqueFinal.token_confirmacion) {
      bloqueFinal.token_confirmacion = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?').run(bloqueFinal.token_confirmacion, id);
    }
    resultadoCorreo = await asistencia.enviarConfirmacionNueva(bloqueFinal);
  }

  res.json({ ok: true, avisos, bloque: traer(id), correo: resultadoCorreo });
}));

const LIMPIAR_SQL = `
  rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
  motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
  fecha_inicio_tramite=NULL, escuela_conductores=NULL, tipo_reagendamiento=NULL, confirmo_asistencia=NULL, resultado=NULL, comentarios=NULL, avisado_por=NULL,
  bloqueado=0, bloqueo_motivo=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
  token_confirmacion=NULL, correo_confirmacion_enviado=0, correo_recordatorio_enviado=0,
  agendado_en=NULL, actualizado_en=datetime('now','localtime')`;

app.post('/api/agenda/:id/liberar', wrap((req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  const actor = actorDe(req);
  const motivo = (req.body && req.body.motivo) || 'Examinador no disponible';
  const teniaPersona = Boolean(bloque.rut || bloque.nombre);

  tx(() => {
    if (teniaPersona) cola.encolar(bloque, motivo, actor);
    if (teniaPersona || bloque.bloqueado) papelera.guardar(bloque, 'liberar', actor);
    if (Number(bloque.cupo) > 1) {
      db.prepare('DELETE FROM agenda WHERE id = ?').run(id);
    } else {
      db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL} WHERE id = ?`).run(id);
    }
    if (pesada.esPesadaEnHoraValida(bloque) && teniaPersona) {
      pesada.liberar(bloque.fecha, bloque.examinador_id);
    }
  });
  logReq(req, id, 'liberar', `${bloque.fecha} ${bloque.hora} ${bloque.nombre || bloque.bloqueo_motivo || ''}`);
  res.json({ ok: true, encolado: teniaPersona, eliminado: Number(bloque.cupo) > 1 });
}));

// ---------- VARIAS PERSONAS EN LA MISMA HORA ----------
// Crea un cupo extra (cupo = MAX+1) en el mismo (fecha, hora, examinador) del bloque :id, libre.
app.post('/api/agenda/:id/persona', wrap((req, res) => {
  const id = Number(req.params.id);
  const origen = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!origen) throw bad('Bloque no encontrado', 404);
  if (origen.bloqueado) throw bad('El bloque está bloqueado.', 409);

  const nuevoId = tx(() => {
    const { maximo } = db.prepare(
      'SELECT COALESCE(MAX(cupo), 1) AS maximo FROM agenda WHERE fecha = ? AND hora = ? AND examinador_id = ?'
    ).get(origen.fecha, origen.hora, origen.examinador_id);
    const cupo = maximo + 1;
    const r = db.prepare('INSERT INTO agenda (fecha, hora, examinador_id, cupo) VALUES (?, ?, ?, ?)')
      .run(origen.fecha, origen.hora, origen.examinador_id, cupo);
    return { id: Number(r.lastInsertRowid), cupo };
  });
  logReq(req, nuevoId.id, 'generar', `cupo ${nuevoId.cupo} en ${origen.fecha} ${origen.hora} (examinador ${origen.examinador_id})`);
  res.json({ ok: true, bloque: traer(nuevoId.id) });
}));

// ---------- LISTA DE ESPERA: sugerencias para un cupo libre ----------
// Solo sugiere candidatos; la asignacion usa /cola-reagendar/:id/asignar o /agenda/:id/reagendar.
app.get('/api/sugerencias-cupo/:id', wrap((req, res) => {
  const cupo = db.prepare('SELECT * FROM agenda WHERE id = ?').get(Number(req.params.id));
  if (!cupo) throw bad('Bloque no encontrado', 404);
  if (cupo.rut || cupo.nombre) throw bad('El bloque ya está ocupado.');
  if (cupo.bloqueado) throw bad('El bloque está bloqueado.');
  res.json({ cupo: traer(cupo.id), ...sugerencias.sugerir(cupo) });
}));

// ---------- PESTAÑA LISTA DE ESPERA ----------
app.get('/api/lista-espera', wrap((req, res) => res.json({ personas: sugerencias.listarEspera() })));

app.get('/api/lista-espera/:origen/:id/cupos', wrap((req, res) => {
  let cupos;
  try { cupos = sugerencias.cuposCompatibles(req.params.origen, req.params.id); } catch (e) { throw bad(e.message, e.status || 400); }
  if (!cupos) throw bad('Esta persona ya no está en lista de espera.', 404);
  res.json({ cupos });
}));

// ---------- LIMPIEZA DE DATOS (correccion rapida) ----------
app.get('/api/limpieza', wrap((req, res) => res.json(limpieza.listar())));

app.patch('/api/agenda/:id/contacto', wrap((req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  if (!(bloque.rut || bloque.nombre)) throw bad('El bloque no tiene una cita.');
  const body = req.body || {};
  if (body.visto_en && bloque.actualizado_en && body.visto_en !== bloque.actualizado_en) {
    const e = bad('Otra persona modificó esta cita. Recarga la lista.', 409);
    e.bloque = traer(id);
    throw e;
  }
  const cambios = limpieza.validarContacto(body);
  limpieza.aplicarContacto(id, cambios);
  const detalle = Object.entries(cambios).map(([k, v]) => `${k}: ${bloque[k] ?? '—'} -> ${v ?? '—'}`).join('; ');
  logReq(req, id, 'editar', `correccion rapida ${bloque.fecha} ${bloque.hora}: ${detalle}`);
  res.json({ ok: true, bloque: traer(id) });
}));

app.post('/api/limpieza/vaciar-correos-invalidos', wrap((req, res) => {
  if (!(req.body && req.body.confirmar === true)) throw bad('Falta confirmar la operación.');
  const archivo = backupMod.backup('pre-limpieza');
  const ids = limpieza.vaciarCorreosInvalidos();
  logReq(req, null, 'editar', `limpieza: ${ids.length} correo(s) invalido(s) vaciado(s)`);
  res.json({ ok: true, vaciados: ids.length, backup: archivo });
}));

// ---------- COLA DE REAGENDAMIENTO ----------
app.get('/api/cola-reagendar', wrap((req, res) => {
  res.json(cola.listarPendientes());
}));

app.post('/api/cola-reagendar/:id/asignar', wrap((req, res) => {
  const item = cola.traerPendiente(req.params.id);
  if (!item) throw bad('Esta persona ya no está pendiente de reagendar.', 404);
  const destino_id = Number((req.body && req.body.destino_id) || (req.body && req.body.agenda_id));
  const destino = db.prepare('SELECT * FROM agenda WHERE id = ?').get(destino_id);
  if (!destino) throw bad('Bloque de destino no encontrado', 404);
  if (destino.rut || destino.nombre) throw bad('El bloque de destino ya está ocupado.');
  if (destino.bloqueado) throw bad('El bloque de destino está bloqueado.');

  const correoFinal = exigirCorreo((req.body && req.body.correo) || item.correo);

  const tienePesada = String(item.clase || '').toUpperCase().split(',').map((s) => s.trim())
    .some((cl) => CLASES_PESADAS.includes(cl));
  if (tienePesada && destino.hora !== HORA_D_A5) throw bad(`La clase ${item.clase} solo se agenda en el bloque ${HORA_D_A5}.`);

  const ts = ahoraTS();
  const motivo = (req.body && req.body.motivo) || `Reagendado por: ${item.motivo || 'Examinador no disponible'}`;
  const comentarios = [item.comentarios, `Reagendada desde ${item.origen_fecha} ${item.origen_hora} (${item.motivo || ''})`].filter(Boolean).join(' | ');

  tx(() => {
    db.prepare(`
      UPDATE agenda SET rut=?, nombre=?, clase=?, contacto=?, correo=?, tipo_cita='REAGENDADO',
        motivo_reagendamiento=?, lista_espera=?, intento=?, funcionario_id=?, fecha_inicio_tramite=?,
        confirmo_asistencia=NULL, resultado=NULL, avisado_por=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
        token_confirmacion=NULL, correo_confirmacion_enviado=0, correo_recordatorio_enviado=0,
        comentarios=?, agendado_en=?, actualizado_en=datetime('now','localtime')
      WHERE id=? AND (rut IS NULL OR rut='') AND (nombre IS NULL OR nombre='') AND bloqueado = 0
    `).run(item.rut, item.nombre, item.clase, item.contacto, correoFinal, motivo, item.lista_espera,
      item.intento, item.funcionario_id, item.fecha_inicio_tramite, comentarios, ts, destino.id);

    db.prepare(`UPDATE cola_reagendar SET estado='reagendado', destino_agenda_id=?, correo=?, resuelto_en=? WHERE id=?`)
      .run(destino.id, correoFinal, ts, item.id);
  });

  const avisos = [];
  if (pesada.esPesadaEnHoraValida({ hora: destino.hora, clase: item.clase })) {
    avisos.push(...pesada.aplicar(destino.fecha, destino.examinador_id));
  }
  logReq(req, destino.id, 'reagendar',
    `${item.nombre || item.rut}: reasignado ${item.origen_fecha} ${item.origen_hora} -> ${destino.fecha} ${destino.hora}`);

  res.json({ ok: true, avisos, destino: db.prepare('SELECT * FROM agenda WHERE id = ?').get(destino.id) });
}));

app.post('/api/cola-reagendar/:id/descartar', wrap((req, res) => {
  const item = cola.traerPendiente(req.params.id);
  if (!item) throw bad('Esta persona ya no está pendiente de reagendar.', 404);
  const ts = ahoraTS();
  const nota = req.body && req.body.nota;
  const comentarios = [item.comentarios, nota && `Descartado: ${String(nota).trim()}`].filter(Boolean).join(' | ') || null;
  db.prepare(`UPDATE cola_reagendar SET estado='descartado', comentarios=?, resuelto_en=? WHERE id=?` )
    .run(comentarios, ts, item.id);
  logReq(req, null, 'editar', `cola reagendar: descartado ${item.nombre || item.rut}`);
  res.json({ ok: true });
}));

app.post('/api/agenda/:id/pendiente', wrap((req, res) => {
  const id = Number(req.params.id);
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  if (!(bloque.rut || bloque.nombre)) throw bad('El bloque no tiene una cita.');
  const valor = req.body && req.body.valor === false ? 0 : 1;
  db.prepare('UPDATE agenda SET pendiente_reagendar = ?, pendiente_nota = ?, actualizado_en = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(valor, valor && req.body && req.body.nota ? String(req.body.nota).trim() : null, id);
  logReq(req, id, 'editar', `pendiente reagendar = ${valor}`);
  res.json({ ok: true, bloque: traer(id) });
}));

app.post('/api/agenda/enviar-correos-pendientes', wrap(async (req, res) => {
  const hoy = hoyISO();

  // Modo prueba: UN solo correo al destino indicado, con datos de la primera cita pendiente
  // (o de ejemplo). No genera tokens, no cambia banderas, no escribe en la base.
  if (req.body && req.body.correo_prueba !== undefined) {
    const destino = String(req.body.correo_prueba || '').trim();
    if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(destino)) throw bad('Indica un correo de prueba valido.');
    const base = db.prepare(`
      SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
      WHERE a.fecha >= ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
        AND a.correo IS NOT NULL AND TRIM(a.correo) != '' AND a.confirmo_asistencia IS NULL
      ORDER BY a.fecha ASC, a.hora ASC LIMIT 1
    `).get(hoy) || { id: 0, fecha: hoy, hora: HORAS[0], examinador: 'EXAMINADOR DE EJEMPLO', nombre: 'POSTULANTE DE EJEMPLO', rut: '11.111.111-1', clase: 'B' };
    // Sin token: el correo de prueba no lleva links vivos de la cita real.
    const muestra = { ...base, correo: destino, token_confirmacion: null };
    let enviado = false;
    let motivo = null;
    if (correo.habilitado) {
      correo.ultimoError = null;
      try { enviado = Boolean(await correo.confirmacion(muestra)); }
      catch (e) { console.error('Error enviando correo de prueba:', e.message); motivo = e.message; }
      if (!enviado && !motivo) motivo = motivoCorreo(correo.ultimoError);
    }
    return res.json({ ok: true, prueba: true, enviado, enviados: enviado ? 1 : 0, smtp_habilitado: correo.habilitado, motivo });
  }

  const filas = db.prepare(`
    SELECT a.*, e.nombre AS examinador
    FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.fecha >= ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      AND a.correo IS NOT NULL AND TRIM(a.correo) != ''
      AND a.confirmo_asistencia IS NULL
    ORDER BY a.fecha ASC, a.hora ASC
  `).all(hoy);

  let tokensGenerados = 0;
  let enviados = 0;

  for (const bloque of filas) {
    if (!bloque.token_confirmacion) {
      bloque.token_confirmacion = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?').run(bloque.token_confirmacion, bloque.id);
      tokensGenerados++;
    }
    // Solo a quienes aun no recibieron la confirmacion (evita duplicados al re-ejecutar).
    if (correo.habilitado && !bloque.correo_confirmacion_enviado) {
      try {
        const ok = await correo.confirmacion(bloque);
        if (ok) {
          marcarConfirmacionEnviada(bloque);
          enviados++;
        }
      } catch (e) {
        console.error(`Error enviando a ${bloque.correo}:`, e.message);
      }
    }
  }

  res.json({
    ok: true,
    total_pendientes: filas.length,
    tokens_generados: tokensGenerados,
    enviados,
    smtp_habilitado: correo.habilitado
  });
}));

// Solicitud de confirmacion masiva para las citas elegidas en "Por confirmar".
const MAX_IDS_MASIVO = 500;
// Estado del correo para la etiqueta de "Por confirmar": solo lectura, sin credenciales.
app.get('/api/correo/estado', wrap((req, res) => res.json(correo.estado())));

app.post('/api/correo/confirmacion-masiva', wrap(async (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS_MASIVO || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    throw bad(`ids debe ser una lista de 1 a ${MAX_IDS_MASIVO} identificadores enteros.`);
  }
  if (!correo.habilitado) {
    return res.status(400).json({ error: 'El envío de correos no está configurado (SMTP)', habilitado: false, enviados: 0, sin_correo: 0, fallidos: 0 });
  }
  const unicos = [...new Set(ids)];
  const sel = db.prepare(`
    SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.id = ? AND a.bloqueado = 0 AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
  `);
  const enviarFn = correo.solicitudConfirmacion || correo.recordatorio;
  let enviados = 0; let sinCorreo = 0; let fallidos = 0;
  for (const id of unicos) {
    const bloque = sel.get(id);
    if (!bloque) { fallidos++; continue; }
    if (!correoValido(bloque.correo)) { sinCorreo++; continue; }
    if (!bloque.token_confirmacion) {
      bloque.token_confirmacion = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?').run(bloque.token_confirmacion, bloque.id);
    }
    let ok = false; let err = null;
    correo.ultimoError = null;
    try { ok = Boolean(await enviarFn(bloque)); } catch (e) { err = e; console.error(`Error enviando a ${bloque.correo}:`, e.message); }
    if (ok) {
      enviados++;
      logReq(req, bloque.id, 'correo_solicitud_confirmacion', String(bloque.correo).trim());
      continue;
    }
    fallidos++;
    // Error de autenticacion o conexion: fallaran todos los demas; se corta para no esperar timeouts.
    err = err || correo.ultimoError;
    if (correo.esErrorGeneral(err)) {
      return res.json({ ok: false, habilitado: true, abortado: true, motivo: `${err.code}: ${err.message || 'error de servidor de correo'}`, enviados, sin_correo: sinCorreo, fallidos });
    }
  }
  res.json({ ok: true, habilitado: true, enviados, sin_correo: sinCorreo, fallidos });
}));

app.post('/api/agenda/:id/confirmar', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { valor } = req.body || {};
  const bloque = traer(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  const confirmo = valor === 1 || valor === true ? 1 : (valor === 0 || valor === false ? 0 : null);
  if (!asistencia.registrarAsistencia(id, confirmo, actorDe(req))) throw bad('El bloque no tiene una cita.', 404);
  const correoEnviado = confirmo === 1 ? await asistencia.enviarConfirmacionSiFalta(id) : false;

  res.json({ ok: true, confirmo_asistencia: confirmo, correo_enviado: correoEnviado });
}));

// ---------- respuestas por correo (lectura automatica de Outlook) ----------
app.get('/api/respuestas-correo', wrap((req, res) => {
  const estado = ['revisar', 'aplicada', 'ignorada'].includes(req.query.estado) ? req.query.estado : null;
  res.json({ items: respuestasCorreo.listar({ estado }), resumen: respuestasCorreo.resumen() });
}));
app.post('/api/respuestas-correo/:id/resolver', wrap(async (req, res) => {
  const { accion, agenda_id } = req.body || {};
  const r = respuestasCorreo.resolver(Number(req.params.id), { accion, agenda_id }, actorDe(req));
  const correoEnviado = r.confirmar ? await asistencia.enviarConfirmacionSiFalta(r.agenda_id) : false;
  res.json({ ok: true, estado: r.estado, agenda_id: r.agenda_id, correo_enviado: correoEnviado });
}));

app.post('/api/agenda/:id/resultado', wrap((req, res) => {
  const id = Number(req.params.id);
  const resultado = (req.body && req.body.resultado) || null;
  const cats = catalogo('resultado');
  if (resultado && !cats.includes(resultado)) throw bad(`Resultado no valido: ${resultado}`);
  const r = db.prepare(`UPDATE agenda SET resultado = ?, actualizado_en = datetime('now','localtime')
    WHERE id = ? AND (rut IS NOT NULL OR nombre IS NOT NULL) AND bloqueado = 0`).run(resultado, id);
  if (!r.changes) throw bad('El bloque no tiene una cita.', 404);
  logReq(req, id, 'editar', `resultado = ${resultado || '(borrado)'}`);
  res.json({ ok: true });
}));

// ---------- AVISOS AL POSTULANTE ----------
const MEDIOS_AVISO = ['telefono', 'whatsapp', 'correo'];
app.post('/api/agenda/:id/aviso', wrap((req, res) => {
  const id = Number(req.params.id);
  const medio = String((req.body && req.body.medio) || '');
  if (!MEDIOS_AVISO.includes(medio)) throw bad(`Medio de aviso no valido: ${medio}`);
  const b = db.prepare('SELECT avisado_por FROM agenda WHERE id = ? AND (rut IS NOT NULL OR nombre IS NOT NULL) AND bloqueado = 0').get(id);
  if (!b) throw bad('El bloque no tiene una cita.', 404);
  const set = new Set(String(b.avisado_por || '').split(',').filter(Boolean));
  if (req.body.avisado === false || req.body.avisado === 0) set.delete(medio); else set.add(medio);
  const lista = MEDIOS_AVISO.filter((m) => set.has(m));
  db.prepare("UPDATE agenda SET avisado_por = ?, actualizado_en = datetime('now','localtime') WHERE id = ?").run(lista.join(',') || null, id);
  logReq(req, id, 'editar', `avisado por: ${lista.join(', ') || '(ninguno)'}`);
  res.json({ ok: true, avisado_por: lista });
}));

app.post('/api/agenda/:id/reagendar', wrap((req, res) => {
  const origenId = Number(req.params.id);
  const { destino_id, motivo, forzar } = req.body || {};
  const origen = db.prepare('SELECT * FROM agenda WHERE id = ?').get(origenId);
  if (!origen) throw bad('Cita de origen no encontrada', 404);
  if (!(origen.rut || origen.nombre)) throw bad('El bloque de origen no tiene una cita.');
  // Regla: quien confirmo asistencia no se reagenda hasta que pase el dia del examen
  // (si no se presenta se marca No asistio). forzar_confirmada es la salida excepcional.
  if (asistencia.confirmadaBloqueaReagendar(origen) && !(req.body && req.body.forzar_confirmada === true)) {
    const f = String(origen.fecha).split('-').reverse().join('/');
    throw bad(`La persona confirmó asistencia para el ${f}: se puede reagendar después de esa fecha (o márcala como No asistió)`, 409);
  }

  // Si no se indica destino_id, se deriva a la cola de pendientes de reagendar directamente
  if (!destino_id) {
    asistencia.marcarPendienteReagendar(origenId, motivo, actorDe(req));
    return res.json({ ok: true, bloque: traer(origenId) });
  }

  const destino = db.prepare('SELECT * FROM agenda WHERE id = ?').get(Number(destino_id));
  if (!destino) throw bad('Bloque de destino no encontrado', 404);
  if (destino.rut || destino.nombre) throw bad('El bloque de destino ya esta ocupado.');
  if (destino.bloqueado) throw bad('El bloque de destino esta bloqueado.');
  // La nueva hora exige correo (el de la cita o uno nuevo enviado en el cuerpo).
  origen.correo = exigirCorreo((req.body && req.body.correo) || origen.correo);
  const origenTienePesada = String(origen.clase || '').toUpperCase().split(',').map((s) => s.trim())
    .some((cl) => CLASES_PESADAS.includes(cl));
  if (origenTienePesada && destino.hora !== HORA_D_A5) {
    throw bad(`La clase ${origen.clase} solo se agenda en el bloque ${HORA_D_A5}.`);
  }
  if (origenTienePesada && destino.hora === HORA_D_A5 && !forzar) {
    const ocupados = pesada.ocupadosDependientes(destino.fecha, destino.examinador_id);
    if (ocupados.length) {
      const detalle = ocupados.map((o) => `${o.hora} (${o.nombre || o.rut})`).join(' y ');
      throw bad(
        `No se puede reagendar aqui: el examinador ya tiene cita en ${detalle}. `
        + 'Libera esas horas primero o marca "forzar" para reagendar igual.'
      );
    }
  }

  tx(() => {
    db.prepare(`
      UPDATE agenda SET rut=@rut, nombre=@nombre, clase=@clase, contacto=@contacto, correo=@correo,
        tipo_cita='REAGENDADO', motivo_reagendamiento=@motivo, lista_espera=@lista_espera,
        intento=@intento, funcionario_id=@funcionario_id, fecha_inicio_tramite=@fit,
        confirmo_asistencia=NULL, resultado=NULL, avisado_por=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
        token_confirmacion=NULL, correo_confirmacion_enviado=0, correo_recordatorio_enviado=0,
        comentarios=@comentarios, agendado_en=COALESCE(agendado_en, datetime('now','localtime')),
        actualizado_en=datetime('now','localtime')
      WHERE id=@id
    `).run({
      id: destino.id, rut: origen.rut, nombre: origen.nombre, clase: origen.clase,
      contacto: origen.contacto, correo: origen.correo,
      motivo: motivo || origen.motivo_reagendamiento || 'Reagendada',
      lista_espera: origen.lista_espera, intento: origen.intento, funcionario_id: origen.funcionario_id,
      fit: origen.fecha_inicio_tramite,
      comentarios: [origen.comentarios, `Reagendada desde ${origen.fecha} ${origen.hora}`].filter(Boolean).join(' | '),
    });
    if (Number(origen.cupo) > 1) {
      db.prepare('DELETE FROM agenda WHERE id = ?').run(origen.id);
    } else {
      db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL.replace('comentarios=NULL', 'comentarios=@c')} WHERE id=@id`)
        .run({ id: origen.id, c: `Reagendada a ${destino.fecha} ${destino.hora} (${motivo || 'sin motivo'})` });
    }
  });

  const avisos = [];
  if (pesada.esPesadaEnHoraValida(origen)) pesada.liberar(origen.fecha, origen.examinador_id);
  if (pesada.esPesadaEnHoraValida({ hora: destino.hora, clase: origen.clase })) {
    avisos.push(...pesada.aplicar(destino.fecha, destino.examinador_id));
  }

  logReq(req, origen.id, 'reagendar', `${origen.fecha} ${origen.hora} -> ${destino.fecha} ${destino.hora}`);

  const destinoFinal = traer(destino.id);
  if (destinoFinal.correo) {
    // El destino parte sin token (se reseteo arriba): se genera uno para que el correo traiga sus links.
    destinoFinal.token_confirmacion = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?').run(destinoFinal.token_confirmacion, destino.id);
    correo.confirmacion(destinoFinal)
      .then((ok) => { if (ok) marcarConfirmacionEnviada(destinoFinal); })
      .catch((e) => console.error('Correo de confirmacion fallo:', e.message));
  }

  res.json({ ok: true, avisos, destino: destinoFinal });
}));

// ---------- BLOQUEAR / DESBLOQUEAR DIA ----------
app.post('/api/bloquear-dia', wrap((req, res) => {
  const rango = bloqueo.leerRangoBloqueo(req.body);
  const incluirOcupados = !!req.body.incluir_ocupados;

  if (req.body.simular) {
    const { where, params } = bloqueo.filtroBloqueo(rango, { bloqueado: 0, incluirOcupados: true });
    const r = db.prepare(`SELECT COUNT(*) as total,
        SUM(CASE WHEN (rut IS NOT NULL AND rut != '') OR (nombre IS NOT NULL AND nombre != '') THEN 1 ELSE 0 END) as con_cita
      FROM agenda WHERE ${where}`).get(...params);
    const total = Number((r && r.total) || 0);
    const conCita = Number((r && r.con_cita) || 0);
    return res.json({ ok: true, bloqueables: incluirOcupados ? total : total - conCita, con_cita: conCita });
  }

  const { where, params } = bloqueo.filtroBloqueo(rango, { bloqueado: 0, incluirOcupados });
  const objetivo = db.prepare(`SELECT * FROM agenda WHERE ${where}`).all(...params);

  const actor = actorDe(req);
  let aReagendar = 0;
  tx(() => {
    for (const b of objetivo) {
      if (b.rut || b.nombre) {
        papelera.guardar(b, 'bloquear-dia', actor);
        cola.encolar(b, rango.motivo, actor);
        aReagendar++;
      }
      db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL.replace('bloqueado=0, bloqueo_motivo=NULL', 'bloqueado=1, bloqueo_motivo=@m')} WHERE id=@id`)
        .run({ id: b.id, m: rango.motivo });
      // Clase pesada (D/A5) a las 12:30: los bloques automaticos de 13:00/13:30 pasan al
      // motivo del bloqueo si caen dentro del rango bloqueado, en vez de quedar liberados.
      if (pesada.esPesadaEnHoraValida(b)) {
        pesada.absorberEnBloqueo(b.fecha, b.examinador_id, rango.motivo, (hora) => bloqueo.horaEnRango(rango, hora));
      }
    }
  });

  const quien = rango.examinador_id ? 'exam ' + rango.examinador_id : 'todos';
  logReq(req, null, 'bloquear', `${rango.desde}..${rango.hasta} ${quien}: ${objetivo.length} bloques (${rango.motivo})`);
  res.json({ ok: true, bloqueados: objetivo.length, a_reagendar: aReagendar, a_papelera: aReagendar });
}));

app.post('/api/desbloquear-dia', wrap((req, res) => {
  const rango = bloqueo.leerRangoBloqueo(req.body);
  const { where, params } = bloqueo.filtroBloqueo(rango, { bloqueado: 1, incluirOcupados: true });
  const soloMotivo = req.body.motivo ? ' AND bloqueo_motivo = ?' : '';
  const pMotivo = soloMotivo ? [rango.motivo] : [];

  // Los bloqueos automaticos de clase pesada (13:00/13:30) no se liberan mientras el 12:30
  // del mismo examinador siga ocupado por una clase D/A5: se quitan solos al liberar esa cita.
  const objetivo = db.prepare(`SELECT * FROM agenda WHERE ${where}${soloMotivo}`).all(...params, ...pMotivo)
    .filter((b) => !pesada.bloqueoAutoVigente(b));

  if (req.body.simular) {
    const porMotivo = new Map();
    for (const b of objetivo) {
      const m = b.bloqueo_motivo || 'BLOQUEADO';
      porMotivo.set(m, (porMotivo.get(m) || 0) + 1);
    }
    const results = [...porMotivo].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n);
    return res.json({ ok: true, desbloqueables: objetivo.length, por_motivo: results });
  }

  const upd = db.prepare("UPDATE agenda SET bloqueado=0, bloqueo_motivo=NULL, actualizado_en=datetime('now','localtime') WHERE id = ?");
  tx(() => { for (const b of objetivo) upd.run(b.id); });
  logReq(req, null, 'editar', `desbloquear ${rango.desde}..${rango.hasta}: ${objetivo.length}`);
  res.json({ ok: true, desbloqueados: objetivo.length });
}));

// ---------- DISPONIBLES ----------
app.get('/api/disponibles', wrap((req, res) => {
  const { desde, hasta, clase, examinador_id } = req.query;
  const cond = ['a.rut IS NULL', 'a.nombre IS NULL', 'a.bloqueado = 0', 'a.fecha NOT IN (SELECT fecha FROM feriados)'];
  const p = [];
  if (desde) { cond.push('a.fecha >= ?'); p.push(desde); }
  if (hasta) { cond.push('a.fecha <= ?'); p.push(hasta); }
  if (examinador_id) { cond.push('a.examinador_id = ?'); p.push(Number(examinador_id)); }
  if (clase && CLASES_PESADAS.includes(String(clase).toUpperCase())) { cond.push('a.hora = ?'); p.push(HORA_D_A5); }
  const rows = db.prepare(`${SELECT_BLOQUE} WHERE ${cond.join(' AND ')} ORDER BY a.fecha, a.hora, e.nombre LIMIT 3000`).all(...p);
  res.json(rows.map((r) => ({
    ...r,
    apto_pesada: r.hora === HORA_D_A5,
    regla: r.hora === HORA_D_A5 ? 'IDEAL para D y A5 (tambien B, C, profesionales)' : 'B, C, A1-A4 (PROHIBIDO D y A5)',
  })));
}));

// ---------- HISTORIAL ----------
app.get('/api/historial', wrap((req, res) => {
  const r = rut.limpiar(req.query.rut || '');
  if (r.length < 2) return res.json([]);
  const rows = db.prepare(`
    ${SELECT_BLOQUE}
    WHERE REPLACE(REPLACE(a.rut,'.',''),'-','') = ?
    ORDER BY a.fecha, a.hora
  `).all(r);
  res.json(rows);
}));

// ---------- DIA / IMPRESION ----------
app.get('/api/dia', wrap((req, res) => {
  const fecha = req.query.fecha || hoyISO();
  const rows = db.prepare(`${SELECT_BLOQUE} WHERE a.fecha = ? ORDER BY e.nombre, a.hora, a.cupo`).all(fecha);
  const porExaminador = {};
  for (const r of rows) (porExaminador[r.examinador] ||= []).push(r);
  res.json({ fecha, examinadores: porExaminador });
}));

// ---------- SALA DE ESPERA ----------
// Pantalla publica (TV): solo hora, iniciales, clase, examinador y estado.
app.get('/api/sala', wrap((req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '') ? req.query.fecha : hoyISO();
  res.json(vistas.salaHoy(fecha));
}));

// ---------- ERRORES ----------
app.get('/api/errores', wrap((req, res) => res.json(reporte())));

// ---------- ANALITICA ----------
app.get('/api/analitica', wrap((req, res) => res.json(resumen(req.query.desde, req.query.hasta))));

// ---------- CATALOGOS ----------
app.post('/api/catalogos', wrap((req, res) => {
  const { tipo, valor } = req.body || {};
  if (!tipo || !valor) throw bad('Indica tipo y valor');
  if (!Object.prototype.hasOwnProperty.call(CATALOGOS, tipo)) throw bad(`Catálogo no válido: ${tipo}`);
  const orden = (db.prepare('SELECT COALESCE(MAX(orden),0)+1 n FROM catalogos WHERE tipo=?').get(tipo)).n;
  db.prepare('INSERT OR REPLACE INTO catalogos (tipo, valor, orden, activo) VALUES (?, ?, ?, 1)')
    .run(tipo, String(valor).trim().toUpperCase(), orden);
  res.json({ ok: true });
}));
app.delete('/api/catalogos', wrap((req, res) => {
  db.prepare('UPDATE catalogos SET activo = 0 WHERE tipo = ? AND valor = ?').run(req.query.tipo, req.query.valor);
  res.json({ ok: true });
}));

// ---------- FERIADOS ----------
app.post('/api/feriados', wrap((req, res) => {
  const { fecha, nombre } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw bad('Fecha invalida (YYYY-MM-DD)');
  feriados.agregar(fecha, nombre);
  logReq(req, null, 'editar', `feriado + ${fecha}`);
  res.json({ ok: true });
}));
app.post('/api/feriados/sincronizar', wrap(async (req, res) => {
  const pedido = req.body && req.body.anio;
  const actual = new Date().getFullYear();
  if (pedido !== undefined && pedido !== null && pedido !== '' && !/^\d{4}$/.test(String(pedido))) throw bad('Anio invalido');
  const anios = pedido ? [Number(pedido)] : [actual, actual + 1];
  const detalle = [];
  for (const anio of anios) detalle.push({ anio, ...(await feriados.sincronizar(anio)) });
  const agregados = detalle.reduce((s, d) => s + d.agregados, 0);
  logReq(req, null, 'editar', `feriados sincronizados (+${agregados})`);
  res.json({ ok: true, agregados, detalle });
}));
app.delete('/api/feriados', wrap((req, res) => {
  feriados.quitar(req.query.fecha);
  logReq(req, null, 'editar', `feriado - ${req.query.fecha}`);
  res.json({ ok: true });
}));

// ---------- EXAMINADORES / FUNCIONARIOS ----------
// SQLITE_CONSTRAINT_UNIQUE: nombre repetido. Cualquier otro error sigue a wrap() (500 generico).
const esDuplicado = (e) => e && e.errcode === 2067;
// Nombre en mayusculas si llega texto; cualquier otro tipo se ignora (no revienta con 500).
const textoOpcional = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);
app.post('/api/examinadores', wrap((req, res) => {
  try {
    const id = upsertExaminador(String((req.body || {}).nombre || '').trim().toUpperCase());
    res.json({ ok: true, id });
  } catch (e) {
    if (!esDuplicado(e)) throw e;
    res.status(400).json({ error: 'El examinador ya existe' });
  }
}));
app.put('/api/examinadores/:id', wrap((req, res) => {
  try {
    const { nombre, activo } = req.body || {};
    db.prepare('UPDATE examinadores SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
      .run(textoOpcional(nombre), activo == null ? null : (activo ? 1 : 0), Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    if (!esDuplicado(e)) throw e;
    res.status(400).json({ error: 'El examinador ya existe' });
  }
}));
app.post('/api/funcionarios', wrap((req, res) => {
  try {
    const id = upsertFuncionario(String((req.body || {}).nombre || '').trim().toUpperCase());
    res.json({ ok: true, id });
  } catch (e) {
    if (!esDuplicado(e)) throw e;
    res.status(400).json({ error: 'El funcionario ya existe' });
  }
}));
app.put('/api/funcionarios/:id', wrap((req, res) => {
  try {
    const id = Number(req.params.id);
    const { nombre, activo } = req.body || {};
    db.prepare('UPDATE funcionarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
      .run(textoOpcional(nombre), activo == null ? null : (activo ? 1 : 0), id);
    res.json({ ok: true });
  } catch (e) {
    if (!esDuplicado(e)) throw e;
    res.status(400).json({ error: 'El funcionario ya existe' });
  }
}));

// ---------- PAPELERA ----------
app.get('/api/papelera', wrap((req, res) => res.json(papelera.listar(80))));
app.post('/api/papelera/:id/restaurar', wrap((req, res) => {
  const b = papelera.restaurar(Number(req.params.id));
  logReq(req, b.id, 'editar', `restaurado desde papelera: ${b.fecha} ${b.hora}`);
  res.json({ ok: true, bloque: traer(b.id) });
}));
app.post('/api/papelera/:id/eliminar', wrap((req, res) => {
  papelera.eliminar(Number(req.params.id));
  logReq(req, null, 'editar', `eliminada entrada de papelera #${req.params.id}`);
  res.json({ ok: true });
}));
app.post('/api/papelera/vaciar', wrap((req, res) => {
  const n = papelera.vaciar();
  logReq(req, null, 'editar', `papelera vaciada: ${n} entradas`);
  res.json({ ok: true, eliminadas: n });
}));

// ---------- IMPORT / EXPORT / BACKUP ----------
app.post('/api/import', subir.single('archivo'), wrap((req, res) => {
  const limpiar = String(req.body && req.body.limpiar) === 'true' || (req.body && req.body.limpiar === true) || (req.body && req.body.limpiar === '1');
  // Siempre se respalda antes de importar; con limpiar=true es aun mas importante (borra todo).
  backupMod.backup('pre-import');

  let r;
  try {
    if (req.body && req.body.hojas && typeof req.body.hojas === 'object') {
      r = importar(req.body.hojas, { limpiar });
    } else if (req.file) {
      try {
        r = importar(req.file.path, { limpiar });
      } finally {
        fs.unlink(req.file.path, () => {});
      }
    } else {
      throw bad('Sube un archivo .xlsx o .xls');
    }
  } catch (err) {
    // Un archivo ilegible/invalido es un error del usuario: se informa el motivo (admin).
    if (err.status) throw err;
    console.error('[IMPORT]', err);
    throw bad(`No se pudo importar el archivo: ${err.message}`);
  }
  logReq(req, null, 'importar', JSON.stringify(r));
  res.json({ ok: true, resumen: r });
}));

app.get('/api/export', wrap((req, res) => {
  const original = req.query.formato === 'original';
  const buf = original ? generarXlsxOriginal() : generarXlsx();
  res.setHeader('Content-Disposition', `attachment; filename="agenda-practicos${original ? '-formato-excel' : ''}-${hoyISO()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

app.post('/api/backup', wrap((req, res) => res.json({ ok: true, archivo: backupMod.backup('manual') })));

// Tramites D/A5 de citas desde hoy (o pasadas recientes sin resultado), por dias restantes.
const FILTROS_VENCIMIENTO = {
  7: (d) => d > 0 && d <= DIAS_AVISO_TRAMITE,
  30: (d) => d > 0 && d <= 30,
  vencidos: (d) => d <= 0,
  todos: () => true,
};
const DIAS_PASADOS_SIN_RESULTADO = 30;
app.get('/api/tramites-por-vencer', wrap((req, res) => {
  const filtro = FILTROS_VENCIMIENTO[req.query.filtro || 'todos'];
  if (!filtro) throw bad('Filtro inválido');
  const hoy = hoyISO();
  const rows = db.prepare(`${SELECT_BLOQUE}
    WHERE a.bloqueado = 0 AND a.fecha_inicio_tramite IS NOT NULL AND (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      AND (a.fecha >= ? OR (a.fecha >= ? AND (a.resultado IS NULL OR a.resultado = '')))`)
    .all(hoy, sumarDias(hoy, -DIAS_PASADOS_SIN_RESULTADO));
  const lista = rows.map(conAlertas)
    .filter((r) => r.dias_restantes_tramite !== null && filtro(r.dias_restantes_tramite))
    .sort((a, b) => a.dias_restantes_tramite - b.dias_restantes_tramite || a.fecha.localeCompare(b.fecha));
  res.json(lista);
}));

const esFechaISO = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const pctAprobacion = (r) => {
  const conResultado = r.aprobados + r.reprobados;
  return conResultado ? Math.round((r.aprobados * 1000) / conResultado) / 10 : null;
};
app.get('/api/estadisticas-escuelas', wrap((req, res) => {
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  if ((desde && !esFechaISO(desde)) || (hasta && !esFechaISO(hasta))) throw bad('Fecha inválida');
  const rows = db.prepare(`
    SELECT escuela_conductores,
           COUNT(*) as total,
           SUM(CASE WHEN resultado = 'APROBADO' THEN 1 ELSE 0 END) as aprobados,
           SUM(CASE WHEN resultado LIKE 'REPROBADO%' THEN 1 ELSE 0 END) as reprobados,
           SUM(CASE WHEN resultado = 'NO ASISTIO' THEN 1 ELSE 0 END) as no_asistio
    FROM agenda
    WHERE escuela_conductores IS NOT NULL AND escuela_conductores <> ''
      AND (? IS NULL OR fecha >= ?) AND (? IS NULL OR fecha <= ?)
    GROUP BY escuela_conductores
    ORDER BY total DESC
  `).all(desde, desde, hasta, hasta);
  res.json(rows.map((r) => ({ ...r, pct_aprobacion: pctAprobacion(r) })));
}));

// Historial del solicitante para el formulario: por RUT exacto; sin RUT, por nombre.
app.get('/api/buscar-historial', wrap((req, res) => {
  const r = rut.limpiar(req.query.rut || '');
  const nombre = String(req.query.nombre || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (r.length < 2 && nombre.length < 3) throw bad('RUT o nombre requerido');
  const rows = r.length >= 2
    ? db.prepare(`${SELECT_BLOQUE} WHERE REPLACE(REPLACE(a.rut,'.',''),'-','') = ? ORDER BY a.fecha DESC, a.hora DESC LIMIT 200`).all(r)
    : db.prepare(`${SELECT_BLOQUE} WHERE UPPER(a.nombre) = ? ORDER BY a.fecha DESC, a.hora DESC LIMIT 200`).all(nombre);
  res.json(rows.map(conAlertas));
}));

app.get('/api/movimientos', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM movimientos ORDER BY id DESC LIMIT 300').all());
}));

// Borra todo el historial de movimientos (respaldo previo, confirmacion exacta obligatoria).
// Pendiente: restringir a un rol de administrador cuando exista login de la app padre (hoy no hay login).
app.post('/api/movimientos/borrar', wrap((req, res) => {
  if ((req.body && req.body.confirmacion) !== historial.FRASE_CONFIRMACION) {
    throw bad(`Escribe exactamente "${historial.FRASE_CONFIRMACION}" para confirmar.`);
  }
  const r = historial.borrarTodo(actorDe(req));
  res.json({ ok: true, eliminados: r.eliminados, backup: r.backup });
}));

// ---------- errores ----------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Con status: error previsto (bad(), validaciones): su mensaje llega a la UI.
  // Sin status: error inesperado (SQL, bug): se registra y al cliente solo le llega un texto generico.
  if (err.status) {
    console.error(`[HTTP ERROR] ${req.method} ${req.url}:`, err.message || err);
  } else {
    console.error(`[HTTP ERROR] ${req.method} ${req.url}:`, err);
  }
  const cuerpo = { error: err.status ? (err.message || 'Error') : 'Error interno del servidor' };
  if (err.bloque) cuerpo.bloque = err.bloque;
  if (err.codigo) {
    cuerpo.codigo = err.codigo;
    if (err.clase) cuerpo.clase = err.clase;
    if (err.reprobados != null) cuerpo.reprobados = err.reprobados;
  }
  res.status(err.status || 500).json(cuerpo);
});

function iniciar() {
  // Un rechazo no capturado se registra pero no tumba el servidor.
  const archivoLog = path.join(RAIZ, 'data', 'server.log');
  const registrar = (etiqueta, e) => {
    const linea = `${new Date().toISOString()} [${etiqueta}] ${(e && e.stack) || e}\n`;
    console.error(linea.trimEnd());
    try { fs.appendFileSync(archivoLog, linea); } catch { /* sin log, no bloquear */ }
  };
  process.on('unhandledRejection', (motivo) => registrar('unhandledRejection', motivo));
  // Una excepcion sincrona no capturada se registra pero no tumba el servidor.
  process.on('uncaughtException', (e) => registrar('uncaughtException', e));
  // Solo este PC: la app no tiene login, asi que no se expone a la red local.
  const servidor = app.listen(PUERTO, HOST, () => {
    console.log(`\n  Agenda de Practicos`);
    console.log(`  Este PC:        http://localhost:${PUERTO}`);
    const n = db.prepare('SELECT COUNT(*) n FROM agenda').get().n;
    if (!n) console.log('  Base vacia. Importa el Excel desde "Datos" o corre: npm run migrar\n');
    backupMod.programar();
    // Feriados automaticos: solo si el anio actual no tiene ninguno. No bloquea el arranque.
    const anio = new Date().getFullYear();
    if (!feriados.cantidadAnio(anio)) {
      feriados.sincronizar(anio)
        .then((r) => console.log(`  Feriados ${anio}: +${r.agregados} desde ${r.fuente}`))
        .catch((e) => console.log(`  Feriados ${anio}: ${e.message}`));
    }
    if (correo.habilitado) recordatorios.programar();
    else console.log('  Correos deshabilitados (falta configurar SMTP_HOST/SMTP_USER/SMTP_PASS)\n');
    if (respuestasCorreo.programar()) console.log('  Lectura de respuestas por correo: cada 10 min (Outlook)');
  });
  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') registrar('listen', `Puerto ${PUERTO} ocupado: otra instancia ya esta corriendo. Cierrala o usa PORT=otro.`);
    else if (e.code === 'EACCES') registrar('listen', `Sin permiso para usar el puerto ${PUERTO}.`);
    else registrar('listen', e);
    process.exit(1);
  });
}

// Solo escucha al arrancar con `node server/index.js` (npm start / iniciar.bat);
// los tests importan la app y la levantan en un puerto efimero.
if (require.main === module) iniciar();

module.exports = app;
