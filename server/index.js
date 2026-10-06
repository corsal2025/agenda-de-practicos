'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const { db, tx, upsertFuncionario, upsertExaminador, log } = require('./db');
const { PUERTO, RAIZ, HORAS, HORA_D_A5, CLASES_PESADAS } = require('./config');
const { generar } = require('./slots');
const { reporte } = require('./errores');
const { resumen } = require('./analitica');
const { generarXlsx, generarXlsxOriginal } = require('./export');
const { importar } = require('./migrate');
const backupMod = require('./backup');
const { hoyISO, sumarDias, ahoraTS } = require('./fechas');
const feriados = require('./feriados');
const papelera = require('./papelera');
const cola = require('./cola');
const bloqueo = require('./bloqueo');
const pesada = require('./pesada');
const correo = require('./correo');
const { esc } = require('./html');
const recordatorios = require('./recordatorios');
const auth = require('./auth');
const usuarios = require('./usuarios');
const rut = require('./rut');
const telefono = require('./telefono');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    const t0 = Date.now();
    res.on('finish', () => {
      console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - t0}ms)`);
    });
  }
  next();
});
app.use(auth.middleware);
app.use(express.static(path.join(RAIZ, 'public'), {
  etag: false, lastModified: false,
  setHeaders: (res, ruta) => {
    // App local: nunca cachear HTML/CSS/JS (asi los cambios se ven al recargar sin trucos).
    if (/\.(html|css|js)$/i.test(ruta)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));
const subir = multer({ dest: path.join(os.tmpdir(), 'agenda-uploads'), limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- login (antes del guard) ----------
app.post('/api/login', (req, res) => auth.login(req, res));
app.get('/api/sesion', (req, res) => {
  res.json({
    funcionario: (req.session && req.session.funcionario) || null,
    sin_login: auth.SIN_LOGIN,
    logo: logoDisponible(),
    organismo: process.env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso',
    unidad: process.env.AGENDA_UNIDAD || 'Departamento de Licencias de Conducir',
  });
});
app.post('/api/logout', (req, res) => auth.logout(req, res));

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

function tokenValido(bloque, token) {
  if (!bloque || !bloque.token_confirmacion || !token) return false;
  const a = Buffer.from(bloque.token_confirmacion);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Los correos traen links GET, pero abrirlos NO ejecuta nada: los escaneres de correo
// (Outlook SafeLinks, antivirus) visitan los links y confirmarian solos. El GET muestra un
// boton y solo el POST (click real de la persona) realiza la accion y consume el token.
function botonPost(accion, id, token, texto, color) {
  return `<form method="POST" action="/${accion}/${Number(id)}/${esc(token)}" style="margin:1.4rem 0 0">
    <button type="submit" style="background:${color};color:#fff;border:none;padding:.7rem 1.4rem;border-radius:6px;font-weight:700;font-size:.95rem;cursor:pointer">${texto}</button>
  </form>`;
}
function bloquePorToken(req) {
  const bloque = db.prepare('SELECT * FROM agenda WHERE id = ?').get(Number(req.params.id));
  return tokenValido(bloque, req.params.token) ? bloque : null;
}
const linkInvalido = (res) => res.status(404).send(paginaPublica('Link no válido', 'Este link ya se usó o no es válido.', false));
const errorPublico = (res, e, contexto) => {
  console.error(`[PUBLICO] ${contexto}:`, e);
  res.status(500).send(paginaPublica('Ocurrió un error', 'No pudimos procesar tu solicitud. Contacta a la oficina.', false));
};

app.get('/confirmar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorToken(req);
    if (!bloque) return linkInvalido(res);
    res.send(paginaPublica('Confirma tu asistencia',
      `Examen práctico el <b>${esc(fFecha(bloque.fecha))}</b> a las <b>${esc(bloque.hora)}</b> hrs.`,
      true, botonPost('confirmar', bloque.id, req.params.token, '✔ Confirmo mi asistencia', '#15803d')));
  } catch (e) { errorPublico(res, e, 'GET confirmar'); }
});
app.post('/confirmar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorToken(req);
    if (!bloque) return linkInvalido(res);
    db.prepare("UPDATE agenda SET confirmo_asistencia = 1, token_confirmacion = NULL, actualizado_en = datetime('now','localtime') WHERE id = ?").run(bloque.id);
    log(bloque.id, 'confirmar', `${bloque.fecha} ${bloque.hora} confirmado por correo`);
    res.send(paginaPublica('¡Listo, tu hora quedó confirmada!', 'Te esperamos el día y la hora agendada. Gracias por confirmar.', true));
  } catch (e) { errorPublico(res, e, 'POST confirmar'); }
});
app.get('/rechazar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorToken(req);
    if (!bloque) return linkInvalido(res);
    res.send(paginaPublica('¿No puedes asistir?',
      `Tu examen práctico es el <b>${esc(fFecha(bloque.fecha))}</b> a las <b>${esc(bloque.hora)}</b> hrs. Si no puedes asistir, avísanos para reagendar.`,
      false, botonPost('rechazar', bloque.id, req.params.token, 'No puedo asistir', '#b91c1c')));
  } catch (e) { errorPublico(res, e, 'GET rechazar'); }
});
app.post('/rechazar/:id/:token', (req, res) => {
  try {
    const bloque = bloquePorToken(req);
    if (!bloque) return linkInvalido(res);
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
  return filas
    .filter((f) => !pesadaCita || !pesada.ocupadosDependientes(f.fecha, f.examinador_id).length)
    .slice(0, 25);
}

app.get('/reagendar/:id/:token', (req, res) => { try {
  const bloque = db.prepare('SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id WHERE a.id = ?').get(Number(req.params.id));
  if (!tokenValido(bloque, req.params.token)) {
    return res.status(404).send(paginaPublica('Link no válido', 'Este enlace ya fue utilizado o ha expirado.', false));
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
  if (!tokenValido(bloque, req.params.token)) {
    return res.status(404).send(paginaPublica('Link no válido', 'Este enlace ya fue utilizado o ha expirado.', false));
  }

  const nuevoId = Number((req.body || {}).nuevo_slot_id);
  const nuevoToken = crypto.randomBytes(16).toString('hex');

  // Todo en una transaccion: se relee y valida el destino y se mueve la cita sin dejar
  // el estado a medias si algo falla.
  const nuevoSlot = tx(() => {
    const destino = db.prepare('SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id WHERE a.id = ?').get(nuevoId);
    const noDisponible = () => bad('Ese horario ya no está disponible. Por favor regresa y selecciona otra fecha.');
    if (!destino || destino.bloqueado || destino.rut || destino.nombre) throw noDisponible();
    // Mismas reglas que el listado: ventana de fechas y regla D/A5.
    const hoy = hoyISO();
    if (destino.fecha < sumarDias(hoy, 1) || destino.fecha > sumarDias(hoy, VENTANA_REAGENDAR_DIAS)) throw noDisponible();
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

    db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL} WHERE id = ?`).run(bloque.id);
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
      .then((ok) => { if (ok) db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').run(nuevoSlot.id); })
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


app.use(auth.guard);

// Captura tanto errores sincronos como rechazos de handlers async.
const wrap = (fn) => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(next);
};
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
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
  const actor = actorDe(req);
  let funcionario_id = (req.session && req.session.funcionario_id) || null;
  if (!funcionario_id && actor) {
    const f = db.prepare('SELECT id FROM funcionarios WHERE LOWER(nombre) = LOWER(?) OR LOWER(usuario) = LOWER(?)').get(actor, actor);
    if (f) {
      funcionario_id = f.id;
      if (req.session) req.session.funcionario_id = f.id;
    }
  }
  res.json({
    horas: HORAS,
    hora_d_a5: HORA_D_A5,
    clases_pesadas: CLASES_PESADAS,
    hoy: hoyISO(),
    usuario: actor,
    funcionario_id,
    rol: (req.session && req.session.rol) || null,
    examinadores: db.prepare('SELECT id, nombre, activo FROM examinadores ORDER BY nombre').all(),
    funcionarios: db.prepare('SELECT id, nombre, activo, usuario, rol FROM funcionarios ORDER BY nombre').all(),
    catalogos: {
      clase: catalogo('clase'),
      tipo_cita: catalogo('tipo_cita'),
      resultado: catalogo('resultado'),
      intento: catalogo('intento'),
      lista_espera: catalogo('lista_espera'),
    },
    feriados: feriados.listar(),
    rango_agenda: db.prepare('SELECT MIN(fecha) desde, MAX(fecha) hasta FROM agenda').get(),
    logo: logoDisponible(),
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
const SELECT_BLOQUE = `
  SELECT a.*, e.nombre AS examinador, f.nombre AS funcionario,
         (a.rut IS NOT NULL OR a.nombre IS NOT NULL) AS ocupada
  FROM agenda a
  JOIN examinadores e ON e.id = a.examinador_id
  LEFT JOIN funcionarios f ON f.id = a.funcionario_id
`;
const traer = (id) => db.prepare(`${SELECT_BLOQUE} WHERE a.id = ?`).get(Number(id));

app.get('/api/agenda', wrap((req, res) => {
  const { fecha, desde, hasta, examinador_id, estado } = req.query;
  const cond = [];
  const p = [];
  if (fecha) { cond.push('a.fecha = ?'); p.push(fecha); }
  if (desde) { cond.push('a.fecha >= ?'); p.push(desde); }
  if (hasta) { cond.push('a.fecha <= ?'); p.push(hasta); }
  if (examinador_id) { cond.push('a.examinador_id = ?'); p.push(Number(examinador_id)); }
  if (estado === 'libre') cond.push('a.rut IS NULL AND a.nombre IS NULL AND a.bloqueado = 0');
  if (estado === 'ocupada') cond.push('(a.rut IS NOT NULL OR a.nombre IS NOT NULL) AND a.bloqueado = 0');
  if (estado === 'bloqueada') cond.push('a.bloqueado = 1');
  if (estado === 'pendiente') cond.push('a.pendiente_reagendar = 1');
  if (estado === 'porconfirmar') cond.push("(a.rut IS NOT NULL OR a.nombre IS NOT NULL) AND a.bloqueado = 0 AND (a.confirmo_asistencia IS NULL) AND a.fecha >= date('now','localtime')");
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = db.prepare(`${SELECT_BLOQUE} ${where} ORDER BY a.fecha, a.hora, e.nombre LIMIT 6000`).all(...p);
  res.json(rows);
}));

app.get('/api/agenda/:id', wrap((req, res) => {
  const row = traer(req.params.id);
  if (!row) throw bad('Bloque no encontrado', 404);
  res.json(row);
}));

app.post('/api/agenda/generar', auth.soloAdmin, wrap((req, res) => {
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
  if (!enCatalogo('tipo_cita', body.tipo_cita)) throw bad(`Tipo de cita no valido: ${body.tipo_cita}`);
  if (!enCatalogo('resultado', body.resultado)) throw bad(`Resultado no valido: ${body.resultado}`);
  if (!enCatalogo('intento', body.intento)) throw bad(`Intento no valido: ${body.intento}`);
  if (!enCatalogo('lista_espera', body.lista_espera)) throw bad(`Lista de espera no valida: ${body.lista_espera}`);

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
    if (!rut.esValido(body.rut)) avisos.push(`RUT ${rutFmt} tiene digito verificador invalido.`);
  }
  if (body.tipo_cita === 'REAGENDADO' && !body.motivo_reagendamiento) {
    avisos.push('Cita marcada como REAGENDADO sin motivo de reagendamiento.');
  }
  return { avisos, rutFmt, clase };
}

app.put('/api/agenda/:id', wrap((req, res) => {
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
        fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL,
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

  const tel = telefono.normalizar(body.contacto);
  if (!tel.vacio && !tel.valido) {
    throw bad('Teléfono incompleto. Un número chileno tiene 9 dígitos (celular: 9 XXXX XXXX). Se guarda como +56.');
  }

  let funcionario_id = body.funcionario_id ? Number(body.funcionario_id) : null;
  if (!funcionario_id && body.funcionario_nombre) funcionario_id = upsertFuncionario(String(body.funcionario_nombre).trim().toUpperCase());
  if (!funcionario_id) {
    funcionario_id = (req.session && req.session.funcionario_id) || null;
    if (!funcionario_id && actorDe(req)) {
      const f = db.prepare('SELECT id FROM funcionarios WHERE LOWER(nombre) = LOWER(?) OR LOWER(usuario) = LOWER(?)').get(actorDe(req), actorDe(req));
      if (f) funcionario_id = f.id;
    }
  }
  // Auto session funcionario fallback

  const nombre = body.nombre ? String(body.nombre).trim().replace(/\s+/g, ' ').toUpperCase() : null;
  const estabaOcupada = Boolean(bloque.rut || bloque.nombre);
  const quedaOcupada = Boolean(rutFmt || nombre);

  // Si se va a pisar una cita distinta, guardar la anterior en papelera.
  if (estabaOcupada && (bloque.rut !== rutFmt || (bloque.nombre || '') !== (nombre || ''))) {
    papelera.guardar(bloque, 'sobrescribir', actorDe(req));
  }

  let confirmo = bloque.confirmo_asistencia;
  if (body.confirmo_asistencia === true || body.confirmo_asistencia === 1) confirmo = 1;
  else if (body.confirmo_asistencia === false || body.confirmo_asistencia === 0) confirmo = 0;
  else if (body.confirmo_asistencia === null || body.confirmo_asistencia === '') confirmo = null;

  const pendiente = body.pendiente_reagendar ? 1 : 0;

  // Cambia el ocupante (se ocupa, se libera o entra otra persona): el token y las
  // banderas de correo del ocupante anterior no deben pasar al nuevo.
  const cambiaPersona = estabaOcupada !== quedaOcupada
    || (estabaOcupada && (bloque.rut !== rutFmt || (bloque.nombre || '') !== (nombre || '')));

  db.prepare(`
    UPDATE agenda SET
      rut = @rut, nombre = @nombre, clase = @clase, contacto = @contacto, correo = @correo,
      tipo_cita = @tipo_cita, motivo_reagendamiento = @motivo_reagendamiento,
      lista_espera = @lista_espera, intento = @intento, funcionario_id = @funcionario_id,
      fecha_inicio_tramite = @fecha_inicio_tramite, confirmo_asistencia = @confirmo_asistencia,
      resultado = @resultado, comentarios = @comentarios,
      pendiente_reagendar = @pendiente, pendiente_nota = @pnota,
      token_confirmacion = CASE WHEN @cambia = 1 THEN NULL ELSE token_confirmacion END,
      correo_confirmacion_enviado = CASE WHEN @cambia = 1 THEN 0 ELSE correo_confirmacion_enviado END,
      correo_recordatorio_enviado = CASE WHEN @cambia = 1 THEN 0 ELSE correo_recordatorio_enviado END,
      agendado_en = CASE WHEN @quedaOcupada = 1 THEN COALESCE(agendado_en, @agendado_en) ELSE NULL END,
      actualizado_en = datetime('now','localtime')
    WHERE id = @id
  `).run({
    id,
    rut: rutFmt,
    nombre,
    clase,
    contacto: tel.valor,
    correo: body.correo ? String(body.correo).trim().toLowerCase() : null,
    tipo_cita: body.tipo_cita || null,
    motivo_reagendamiento: body.motivo_reagendamiento ? String(body.motivo_reagendamiento).trim() : null,
    lista_espera: body.lista_espera || null,
    intento: body.intento || null,
    funcionario_id,
    fecha_inicio_tramite: body.fecha_inicio_tramite || null,
    confirmo_asistencia: confirmo,
    resultado: body.resultado || null,
    comentarios: body.comentarios ? String(body.comentarios).trim() : null,
    pendiente,
    pnota: pendiente && body.pendiente_nota ? String(body.pendiente_nota).trim() : null,
    quedaOcupada: quedaOcupada ? 1 : 0,
    cambia: cambiaPersona ? 1 : 0,
    agendado_en: `${hoyISO()} ${new Date().toTimeString().slice(0, 8)}`,
  });

  const accion = !estabaOcupada && quedaOcupada ? 'agendar'
    : estabaOcupada && !quedaOcupada ? 'liberar' : 'editar';
  logReq(req, id, accion, `${bloque.fecha} ${bloque.hora} ${nombre || bloque.nombre || ''}`);

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
  if (quedaOcupada && cambiaPersona && bloqueFinal.correo) {
    if (!bloqueFinal.token_confirmacion) {
      bloqueFinal.token_confirmacion = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE agenda SET token_confirmacion = ? WHERE id = ?').run(bloqueFinal.token_confirmacion, id);
    }
    correo.confirmacion(bloqueFinal)
      .then((ok) => { if (ok) db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').run(id); })
      .catch((e) => console.error('Correo de confirmacion fallo:', e.message));
  }

  res.json({ ok: true, avisos, bloque: bloqueFinal });
}));

const LIMPIAR_SQL = `
  rut=NULL, nombre=NULL, clase=NULL, contacto=NULL, correo=NULL, tipo_cita=NULL,
  motivo_reagendamiento=NULL, lista_espera=NULL, intento=NULL, funcionario_id=NULL,
  fecha_inicio_tramite=NULL, confirmo_asistencia=NULL, resultado=NULL, comentarios=NULL,
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

  if (teniaPersona) {
    cola.encolar(bloque, motivo, actor);
  }
  papelera.guardar(bloque, 'liberar', actor);

  db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL} WHERE id = ?`).run(id);
  if (pesada.esPesadaEnHoraValida(bloque) && (bloque.rut || bloque.nombre)) {
    pesada.liberar(bloque.fecha, bloque.examinador_id);
  }
  logReq(req, id, 'liberar', `${bloque.fecha} ${bloque.hora} ${bloque.nombre || bloque.bloqueo_motivo || ''}`);
  res.json({ ok: true, encolado: teniaPersona });
}));

// ---------- COLA DE REAGENDAMIENTO ----------
app.get('/api/cola-reagendar', wrap((req, res) => {
  res.json(cola.listarPendientes());
}));

app.get('/api/cola-reagendar/:id/sugerencias', wrap((req, res) => {
  res.json(cola.sugerencias(req.params.id));
}));

app.post('/api/cola-reagendar/:id/asignar', wrap((req, res) => {
  const item = cola.traerPendiente(req.params.id);
  if (!item) throw bad('Esta persona ya no está pendiente de reagendar.', 404);
  const destino_id = Number((req.body && req.body.destino_id) || (req.body && req.body.agenda_id));
  const destino = db.prepare('SELECT * FROM agenda WHERE id = ?').get(destino_id);
  if (!destino) throw bad('Bloque de destino no encontrado', 404);
  if (destino.rut || destino.nombre) throw bad('El bloque de destino ya está ocupado.');
  if (destino.bloqueado) throw bad('El bloque de destino está bloqueado.');

  const correoFinal = (req.body && req.body.correo) || item.correo;

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
        confirmo_asistencia=NULL, resultado=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
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
          db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').run(bloque.id);
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

app.post('/api/agenda/:id/confirmar', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { valor } = req.body || {};
  const bloque = traer(id);
  if (!bloque) throw bad('Bloque no encontrado', 404);
  const confirmo = valor === 1 || valor === true ? 1 : (valor === 0 || valor === false ? 0 : null);
  const r = db.prepare(`UPDATE agenda SET confirmo_asistencia = ?, token_confirmacion = NULL, actualizado_en = datetime('now','localtime')
    WHERE id = ? AND (rut IS NOT NULL OR nombre IS NOT NULL) AND bloqueado = 0`).run(confirmo, id);
  if (!r.changes) throw bad('El bloque no tiene una cita.', 404);
  logReq(req, id, 'confirmar_asistencia', `${bloque.fecha} ${bloque.hora} ${confirmo === 1 ? 'CONFIRMA' : confirmo === 0 ? 'NO ASISTE' : 'SIN CONFIRMAR'}`);

  let correoEnviado = false;
  const bloqueFinal = traer(id);
  if (confirmo === 1 && bloqueFinal && bloqueFinal.correo && !bloqueFinal.correo_confirmacion_enviado) {
    try {
      const ok = await correo.confirmacion(bloqueFinal);
      if (ok) db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').run(id);
      correoEnviado = Boolean(ok);
    } catch (e) {
      console.error('Error enviando correo de confirmacion:', e.message);
    }
  }

  res.json({ ok: true, confirmo_asistencia: confirmo, correo_enviado: correoEnviado });
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

app.post('/api/agenda/:id/reagendar', wrap((req, res) => {
  const origenId = Number(req.params.id);
  const { destino_id, motivo, forzar } = req.body || {};
  const origen = db.prepare('SELECT * FROM agenda WHERE id = ?').get(origenId);
  if (!origen) throw bad('Cita de origen no encontrada', 404);
  if (!(origen.rut || origen.nombre)) throw bad('El bloque de origen no tiene una cita.');

  // Si no se indica destino_id, se deriva a la cola de pendientes de reagendar directamente
  if (!destino_id) {
    const mot = String(motivo || 'POSTULANTE SOLICITA CAMBIO').trim();
    db.prepare(`UPDATE agenda SET pendiente_reagendar = 1, pendiente_nota = ?, motivo_reagendamiento = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`)
      .run(mot, mot, origenId);
    logReq(req, origenId, 'editar', `pendiente reagendar: ${mot}`);
    return res.json({ ok: true, bloque: traer(origenId) });
  }

  const destino = db.prepare('SELECT * FROM agenda WHERE id = ?').get(Number(destino_id));
  if (!destino) throw bad('Bloque de destino no encontrado', 404);
  if (destino.rut || destino.nombre) throw bad('El bloque de destino ya esta ocupado.');
  if (destino.bloqueado) throw bad('El bloque de destino esta bloqueado.');
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
        confirmo_asistencia=NULL, resultado=NULL, pendiente_reagendar=0, pendiente_nota=NULL,
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
    db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL.replace('comentarios=NULL', 'comentarios=@c')} WHERE id=@id`)
      .run({ id: origen.id, c: `Reagendada a ${destino.fecha} ${destino.hora} (${motivo || 'sin motivo'})` });
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
      .then((ok) => { if (ok) db.prepare('UPDATE agenda SET correo_confirmacion_enviado = 1 WHERE id = ?').run(destino.id); })
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
        if (pesada.esPesadaEnHoraValida(b)) {
          pesada.liberar(b.fecha, b.examinador_id);
        }
      }
      db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL.replace('bloqueado=0, bloqueo_motivo=NULL', 'bloqueado=1, bloqueo_motivo=@m')} WHERE id=@id`)
        .run({ id: b.id, m: rango.motivo });
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

  if (req.body.simular) {
    const results = db.prepare(`SELECT COALESCE(bloqueo_motivo, 'BLOQUEADO') as motivo, COUNT(*) as n
      FROM agenda WHERE ${where}${soloMotivo} GROUP BY 1 ORDER BY n DESC`).all(...params, ...pMotivo);
    const total = results.reduce((s, x) => s + Number(x.n), 0);
    return res.json({ ok: true, desbloqueables: total, por_motivo: results });
  }

  const r = db.prepare(`UPDATE agenda SET bloqueado=0, bloqueo_motivo=NULL, actualizado_en=datetime('now','localtime') WHERE ${where}${soloMotivo}`)
    .run(...params, ...pMotivo);
  logReq(req, null, 'editar', `desbloquear ${rango.desde}..${rango.hasta}: ${r.changes}`);
  res.json({ ok: true, desbloqueados: Number(r.changes) });
}));

app.get('/api/bloqueos', wrap((req, res) => {
  const { desde, hasta, examinador_id, motivo, historico } = req.query || {};
  const cond = ['a.bloqueado = 1'];
  const params = [];
  if (desde) {
    cond.push('a.fecha >= ?');
    params.push(desde);
  } else if (!historico || historico === '0' || historico === 'false') {
    // Por defecto solo mostrar bloqueos activos/vigentes desde hoy en adelante (no meses pasados)
    cond.push('a.fecha >= ?');
    params.push(hoyISO());
  }
  if (hasta) { cond.push('a.fecha <= ?'); params.push(hasta); }
  if (examinador_id) { cond.push('a.examinador_id = ?'); params.push(Number(examinador_id)); }
  if (motivo) { cond.push('a.bloqueo_motivo = ?'); params.push(motivo); }

  const rows = db.prepare(`
    SELECT a.fecha, a.examinador_id, COALESCE(e.nombre, 'Sin examinador') as examinador,
           COALESCE(a.bloqueo_motivo, 'BLOQUEADO') as motivo,
           COUNT(*) as cant_bloques,
           MIN(a.hora) as desde_hora,
           MAX(a.hora) as hasta_hora
    FROM agenda a
    LEFT JOIN examinadores e ON e.id = a.examinador_id
    WHERE ${cond.join(' AND ')}
    GROUP BY a.fecha, a.examinador_id, a.bloqueo_motivo
    ORDER BY a.fecha ASC, e.nombre ASC, desde_hora ASC
  `).all(...params);

  res.json(rows);
}));

// ---------- DISPONIBLES ----------
app.get('/api/disponibles', wrap((req, res) => {
  const { desde, hasta, clase, examinador_id } = req.query;
  const cond = ['a.rut IS NULL', 'a.nombre IS NULL', 'a.bloqueado = 0'];
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

// ---------- BUSCAR / HISTORIAL ----------
app.get('/api/buscar', wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  const like = `%${q}%`;
  const rutLimpio = `%${rut.limpiar(q)}%`;
  const rows = db.prepare(`
    ${SELECT_BLOQUE}
    WHERE (a.rut IS NOT NULL OR a.nombre IS NOT NULL)
      AND (REPLACE(REPLACE(a.rut,'.',''),'-','') LIKE ? OR UPPER(a.nombre) LIKE UPPER(?) OR a.contacto LIKE ?)
    ORDER BY a.fecha DESC, a.hora LIMIT 100
  `).all(rutLimpio, like, like);
  res.json(rows);
}));

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
  const rows = db.prepare(`${SELECT_BLOQUE} WHERE a.fecha = ? ORDER BY e.nombre, a.hora`).all(fecha);
  const porExaminador = {};
  for (const r of rows) (porExaminador[r.examinador] ||= []).push(r);
  res.json({ fecha, examinadores: porExaminador });
}));

// ---------- ERRORES ----------
app.get('/api/errores', wrap((req, res) => res.json(reporte())));

// ---------- ANALITICA ----------
app.get('/api/analitica', wrap((req, res) => res.json(resumen(req.query.desde, req.query.hasta))));

// ---------- CATALOGOS ----------
app.post('/api/catalogos', auth.soloAdmin, wrap((req, res) => {
  const { tipo, valor } = req.body || {};
  if (!tipo || !valor) throw bad('Indica tipo y valor');
  const orden = (db.prepare('SELECT COALESCE(MAX(orden),0)+1 n FROM catalogos WHERE tipo=?').get(tipo)).n;
  db.prepare('INSERT OR REPLACE INTO catalogos (tipo, valor, orden, activo) VALUES (?, ?, ?, 1)')
    .run(tipo, String(valor).trim().toUpperCase(), orden);
  res.json({ ok: true });
}));
app.delete('/api/catalogos', auth.soloAdmin, wrap((req, res) => {
  db.prepare('UPDATE catalogos SET activo = 0 WHERE tipo = ? AND valor = ?').run(req.query.tipo, req.query.valor);
  res.json({ ok: true });
}));

// ---------- FERIADOS ----------
app.get('/api/feriados', wrap((req, res) => res.json(feriados.listar())));
app.post('/api/feriados', auth.soloAdmin, wrap((req, res) => {
  const { fecha, nombre } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw bad('Fecha invalida (YYYY-MM-DD)');
  feriados.agregar(fecha, nombre);
  logReq(req, null, 'editar', `feriado + ${fecha}`);
  res.json({ ok: true });
}));
app.delete('/api/feriados', auth.soloAdmin, wrap((req, res) => {
  feriados.quitar(req.query.fecha);
  logReq(req, null, 'editar', `feriado - ${req.query.fecha}`);
  res.json({ ok: true });
}));

// ---------- EXAMINADORES / FUNCIONARIOS ----------
app.post('/api/examinadores', auth.soloAdmin, wrap((req, res) => {
  res.json({ ok: true, id: upsertExaminador(String((req.body || {}).nombre || '').trim().toUpperCase()) });
}));
app.put('/api/examinadores/:id', auth.soloAdmin, wrap((req, res) => {
  const { nombre, activo } = req.body || {};
  db.prepare('UPDATE examinadores SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .run(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), Number(req.params.id));
  res.json({ ok: true });
}));
app.post('/api/funcionarios', auth.soloAdmin, wrap((req, res) => {
  res.json({ ok: true, id: upsertFuncionario(String((req.body || {}).nombre || '').trim().toUpperCase()) });
}));
app.put('/api/funcionarios/:id', auth.soloAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  const { nombre, activo, usuario, clave, rol } = req.body || {};
  db.prepare('UPDATE funcionarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .run(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), id);
  if (usuario != null) {
    const limpio = String(usuario).trim();
    if (limpio && !usuarios.usuarioDisponible(limpio, id)) throw bad('Ese usuario ya esta en uso por otra persona.');
    db.prepare('UPDATE funcionarios SET usuario = ? WHERE id = ?').run(limpio || null, id);
  }
  if (clave) {
    if (String(clave).length < 4) throw bad('La contraseña debe tener al menos 4 caracteres.');
    db.prepare('UPDATE funcionarios SET clave_hash = ? WHERE id = ?').run(usuarios.hashClave(clave), id);
  }
  if (rol) {
    if (!['admin', 'staff'].includes(rol)) throw bad('Rol no valido');
    db.prepare('UPDATE funcionarios SET rol = ? WHERE id = ?').run(rol, id);
  }
  res.json({ ok: true });
}));

// Self-service: cualquier persona logueada con cuenta individual puede
// cambiar su propia contraseña (sin necesitar rol admin).
app.put('/api/mi-clave', wrap((req, res) => {
  const id = req.session && req.session.funcionario_id;
  if (!id) throw bad('Tu sesión no tiene una cuenta individual asociada. Pide a un administrador que te cree un usuario en Datos → Funcionarios.');
  const { clave_actual, clave_nueva } = req.body || {};
  if (!clave_nueva || String(clave_nueva).length < 4) throw bad('La contraseña nueva debe tener al menos 4 caracteres.');
  const u = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(id);
  if (!u) throw bad('Cuenta no encontrada', 404);
  if (u.clave_hash && !usuarios.verificarClave(clave_actual, u.clave_hash)) throw bad('La contraseña actual no es correcta.');
  db.prepare('UPDATE funcionarios SET clave_hash = ? WHERE id = ?').run(usuarios.hashClave(clave_nueva), id);
  logReq(req, null, 'editar', 'cambió su propia contraseña');
  res.json({ ok: true });
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
app.post('/api/import', auth.soloAdmin, subir.single('archivo'), wrap((req, res) => {
  const limpiar = String(req.body && req.body.limpiar) === 'true' || (req.body && req.body.limpiar === true) || (req.body && req.body.limpiar === '1');
  if (!limpiar) backupMod.backup('pre-import');

  let r;
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

app.get('/api/movimientos', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM movimientos ORDER BY id DESC LIMIT 300').all());
}));

// ---------- errores ----------
app.use((err, req, res, next) => {
  console.error(`[HTTP ERROR] ${req.method} ${req.url}:`, err.message || err);
  const cuerpo = { error: err.message || 'Error interno' };
  if (err.bloque) cuerpo.bloque = err.bloque;
  if (err.login) cuerpo.login = true;
  res.status(err.status || 400).json(cuerpo);
});

function ipsLan() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal) out.push(nic.address);
    }
  }
  return out;
}

function iniciar() {
  // Un rechazo no capturado se registra pero no tumba el servidor.
  process.on('unhandledRejection', (motivo) => {
    console.error('[unhandledRejection]', motivo);
  });
  app.listen(PUERTO, () => {
    console.log(`\n  Agenda de Practicos`);
    console.log(`  Este PC:        http://localhost:${PUERTO}`);
    for (const ip of ipsLan()) console.log(`  Otros PC (LAN): http://${ip}:${PUERTO}`);
    console.log(auth.SIN_LOGIN ? '  Modo sin login\n' : '  Login con PIN\n');
    const n = db.prepare('SELECT COUNT(*) n FROM agenda').get().n;
    if (!n) console.log('  Base vacia. Importa el Excel desde "Datos" o corre: npm run migrar\n');
    backupMod.programar();
    if (correo.habilitado) recordatorios.programar();
    else console.log('  Correos deshabilitados (falta configurar SMTP_HOST/SMTP_USER/SMTP_PASS)\n');
  });
}

// Solo escucha al arrancar con `node server/index.js` (npm start / iniciar.bat);
// los tests importan la app y la levantan en un puerto efimero.
if (require.main === module) iniciar();

module.exports = app;
