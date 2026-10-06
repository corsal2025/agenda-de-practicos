// Rutas de sesion/autenticacion. Reemplaza el bloque de login/sesion/logout +
// las rutas publicas /confirmar, /rechazar y /api/mi-clave de server/index.js.
import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import * as usuarios from '../lib/usuarios.js';
import { ahoraChile, hoyISOChile, sumarDias } from '../lib/fechas.js';
import { HORA_D_A5, CLASES_PESADAS } from '../lib/config.js';
import { esc } from '../lib/html.js';
import * as pesada from '../lib/pesada.js';
import * as correo from '../lib/correo.js';
import { log } from '../lib/db.js';
import { bad, logoDisponible, logReq, traer, LIMPIAR_SQL } from '../lib/comun.js';

// Rutas publicas (login/sesion/logout): se montan en worker/app.js ANTES de
// registrar el guard de sesion en el router /api, igual que en server/index.js
// (que las declaraba antes de app.use(auth.guard)).
export const authPublicRoutes = new Hono();

authPublicRoutes.post('/login', (c) => auth.login(c));

authPublicRoutes.get('/sesion', async (c) => {
  const sesion = await auth.obtenerSesion(c);
  return c.json({
    funcionario: (sesion && sesion.funcionario) || null,
    logo: await logoDisponible(c.env, c.req.url),
    organismo: c.env.AGENDA_ORGANISMO || 'Municipalidad de Valparaíso',
    unidad: c.env.AGENDA_UNIDAD || 'Departamento de Licencias de Conducir',
  });
});

authPublicRoutes.post('/logout', (c) => auth.logout(c));

// Self-service: cualquier persona logueada con cuenta individual puede
// cambiar su propia contraseña (sin necesitar rol admin). Debe montarse en
// worker/app.js DESPUES del guard (exige sesion), igual que en server/index.js.
export const authPrivateRoutes = new Hono();

authPrivateRoutes.put('/mi-clave', async (c) => {
  const db = c.env.DB;
  const sesion = await auth.obtenerSesion(c);
  const id = sesion && sesion.funcionario_id;
  if (!id) throw bad('Tu sesión no tiene una cuenta individual asociada. Pide a un administrador que te cree un usuario en Datos → Funcionarios.');
  const body = await c.req.json().catch(() => ({}));
  const { clave_actual, clave_nueva } = body || {};
  if (!clave_nueva || String(clave_nueva).length < 4) throw bad('La contraseña nueva debe tener al menos 4 caracteres.');
  const u = await db.prepare('SELECT * FROM funcionarios WHERE id = ?').bind(id).first();
  if (!u) throw bad('Cuenta no encontrada', 404);
  if (u.clave_hash && !(await usuarios.verificarClave(clave_actual, u.clave_hash))) throw bad('La contraseña actual no es correcta.');
  await db.prepare('UPDATE funcionarios SET clave_hash = ? WHERE id = ?').bind(await usuarios.hashClave(clave_nueva), id).run();
  await logReq(c, db, null, 'editar', 'cambió su propia contraseña');
  return c.json({ ok: true });
});

// ---------- confirmar / rechazar / reagendar por correo (publico, sin login) ----------
// Estas rutas NO viven bajo /api y se montan aparte en worker/app.js (fuera del router
// /api), igual que en server/index.js. Se validan con el token de la cita.
export const publicasRoutes = new Hono();

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

// Comparacion en tiempo constante (equivalente a crypto.timingSafeEqual de Node).
function tokenValido(bloque, token) {
  if (!bloque || !bloque.token_confirmacion || !token) return false;
  const a = String(bloque.token_confirmacion);
  const b = String(token);
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// Los correos traen links GET, pero abrirlos NO ejecuta nada: los escaneres de correo (Outlook
// SafeLinks, antivirus) visitan los links y confirmarian solos. El GET muestra un boton y solo el
// POST (click real de la persona) realiza la accion y consume el token.
function botonPost(accion, id, token, texto, color) {
  return `<form method="POST" action="/${accion}/${Number(id)}/${esc(token)}" style="margin:1.4rem 0 0">
    <button type="submit" style="background:${color};color:#fff;border:none;padding:.7rem 1.4rem;border-radius:6px;font-weight:700;font-size:.95rem;cursor:pointer">${texto}</button>
  </form>`;
}

async function bloquePorToken(c) {
  const bloque = await c.env.DB.prepare('SELECT * FROM agenda WHERE id = ?').bind(Number(c.req.param('id'))).first();
  return tokenValido(bloque, c.req.param('token')) ? bloque : null;
}
const linkInvalido = (c) => c.html(paginaPublica('Link no válido', 'Este link ya se usó o no es válido.', false), 404);
const errorPublico = (c, e, contexto) => {
  console.error(`[PUBLICO] ${contexto}:`, e);
  return c.html(paginaPublica('Ocurrió un error', 'No pudimos procesar tu solicitud. Contacta a la oficina.', false), 500);
};

publicasRoutes.get('/confirmar/:id/:token', async (c) => {
  try {
    const bloque = await bloquePorToken(c);
    if (!bloque) return linkInvalido(c);
    return c.html(paginaPublica('Confirma tu asistencia',
      `Examen práctico el <b>${esc(fFecha(bloque.fecha))}</b> a las <b>${esc(bloque.hora)}</b> hrs.`,
      true, botonPost('confirmar', bloque.id, c.req.param('token'), '✔ Confirmo mi asistencia', '#15803d')));
  } catch (e) { return errorPublico(c, e, 'GET confirmar'); }
});

publicasRoutes.post('/confirmar/:id/:token', async (c) => {
  const db = c.env.DB;
  try {
    const bloque = await bloquePorToken(c);
    if (!bloque) return linkInvalido(c);
    await db.prepare('UPDATE agenda SET confirmo_asistencia = 1, token_confirmacion = NULL, actualizado_en = ? WHERE id = ?')
      .bind(ahoraChile(), bloque.id).run();
    await log(db, bloque.id, 'confirmar', `${bloque.fecha} ${bloque.hora} confirmado por correo`, null, ahoraChile());
    return c.html(paginaPublica('¡Listo, tu hora quedó confirmada!', 'Te esperamos el día y la hora agendada. Gracias por confirmar.', true));
  } catch (e) { return errorPublico(c, e, 'POST confirmar'); }
});

publicasRoutes.get('/rechazar/:id/:token', async (c) => {
  try {
    const bloque = await bloquePorToken(c);
    if (!bloque) return linkInvalido(c);
    return c.html(paginaPublica('¿No puedes asistir?',
      `Tu examen práctico es el <b>${esc(fFecha(bloque.fecha))}</b> a las <b>${esc(bloque.hora)}</b> hrs. Si no puedes asistir, avísanos para reagendar.`,
      false, botonPost('rechazar', bloque.id, c.req.param('token'), 'No puedo asistir', '#b91c1c')));
  } catch (e) { return errorPublico(c, e, 'GET rechazar'); }
});

publicasRoutes.post('/rechazar/:id/:token', async (c) => {
  const db = c.env.DB;
  try {
    const bloque = await bloquePorToken(c);
    if (!bloque) return linkInvalido(c);
    await db.prepare(`
      UPDATE agenda SET confirmo_asistencia = 0, pendiente_reagendar = 1,
        pendiente_nota = 'No puede asistir (avisado por correo automatico)',
        token_confirmacion = NULL, actualizado_en = ?
      WHERE id = ?
    `).bind(ahoraChile(), bloque.id).run();
    await log(db, bloque.id, 'rechazar', `${bloque.fecha} ${bloque.hora} avisó que no puede asistir (correo)`, null, ahoraChile());
    return c.html(paginaPublica('Gracias por avisar', 'Registramos que no puedes asistir. El equipo te contactará para reagendar tu hora.', true));
  } catch (e) { return errorPublico(c, e, 'POST rechazar'); }
});

// ---------- reagendar por el propio ciudadano (publico, con token) ----------
const tieneClasePesada = (clase) => String(clase || '').toUpperCase().split(',').map((s) => s.trim())
  .some((cl) => CLASES_PESADAS.includes(cl));
const VENTANA_REAGENDAR_DIAS = 35;

// Horarios que se le ofrecen: libres, no bloqueados, entre manana y +35 dias (hora de Chile) y
// respetando la regla D/A5 (solo 12:30, y solo si el examinador no tiene citas despues).
async function opcionesReagendar(db, bloque) {
  const pesadaCita = tieneClasePesada(bloque.clase);
  const hoy = hoyISOChile();
  const { results: filas } = await db.prepare(`
    SELECT a.id, a.fecha, a.hora, a.examinador_id, e.nombre AS examinador
    FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
    WHERE a.fecha >= ? AND a.fecha <= ?
      AND a.bloqueado = 0 AND (a.rut IS NULL OR a.rut = '') AND (a.nombre IS NULL OR a.nombre = '')
      ${pesadaCita ? 'AND a.hora = ?' : ''}
    ORDER BY a.fecha ASC, a.hora ASC
    LIMIT 300
  `).bind(sumarDias(hoy, 1), sumarDias(hoy, VENTANA_REAGENDAR_DIAS), ...(pesadaCita ? [HORA_D_A5] : [])).all();
  const out = [];
  for (const f of filas) {
    if (pesadaCita && (await pesada.ocupadosDependientes(db, f.fecha, f.examinador_id)).length) continue;
    out.push(f);
    if (out.length >= 25) break;
  }
  return out;
}

const BLOQUE_CON_EXAMINADOR = 'SELECT a.*, e.nombre AS examinador FROM agenda a JOIN examinadores e ON e.id = a.examinador_id WHERE a.id = ?';

publicasRoutes.get('/reagendar/:id/:token', async (c) => {
  const db = c.env.DB;
  try {
    const bloque = await db.prepare(BLOQUE_CON_EXAMINADOR).bind(Number(c.req.param('id'))).first();
    if (!tokenValido(bloque, c.req.param('token'))) {
      return c.html(paginaPublica('Link no válido', 'Este enlace ya fue utilizado o ha expirado.', false), 404);
    }
    const disponibles = await opcionesReagendar(db, bloque);
    const opcionesHtml = disponibles.length ? disponibles.map((d) => `
      <div style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:12px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        <div>
          <div style="font-weight:700;color:#0f172a;font-size:14px">📅 ${esc(fFecha(d.fecha))} a las ${esc(d.hora)} hrs</div>
          <div style="font-size:12px;color:#64748b">Examinador/a: ${esc(d.examinador)}</div>
        </div>
        <form method="POST" action="/reagendar/${bloque.id}/${esc(c.req.param('token'))}/elegir" style="margin:0">
          <input type="hidden" name="nuevo_slot_id" value="${d.id}">
          <button type="submit" style="background:#0284c7;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer">
            Elegir este horario
          </button>
        </form>
      </div>`).join('') : '<p style="color:#64748b">No hay cupos libres en los próximos 35 días. Por favor contacta directamente a la Dirección de Tránsito.</p>';

    return c.html(`<!DOCTYPE html>
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
</html>`);
  } catch (e) { return errorPublico(c, e, 'GET reagendar'); }
});

publicasRoutes.post('/reagendar/:id/:token/elegir', async (c) => {
  const db = c.env.DB;
  try {
    const bloque = await db.prepare(BLOQUE_CON_EXAMINADOR).bind(Number(c.req.param('id'))).first();
    if (!tokenValido(bloque, c.req.param('token'))) {
      return c.html(paginaPublica('Link no válido', 'Este enlace ya fue utilizado o ha expirado.', false), 404);
    }
    const form = await c.req.parseBody().catch(() => ({}));
    const nuevoId = Number(form && form.nuevo_slot_id);
    const nuevoToken = crypto.randomUUID().replace(/-/g, '');

    const destino = await db.prepare(BLOQUE_CON_EXAMINADOR).bind(nuevoId).first();
    const noDisponible = () => bad('Ese horario ya no está disponible. Por favor regresa y selecciona otra fecha.');
    if (!destino || destino.bloqueado || destino.rut || destino.nombre) throw noDisponible();
    // Mismas reglas que el listado: ventana de fechas y regla D/A5.
    const hoy = hoyISOChile();
    if (destino.fecha < sumarDias(hoy, 1) || destino.fecha > sumarDias(hoy, VENTANA_REAGENDAR_DIAS)) throw noDisponible();
    if (tieneClasePesada(bloque.clase)) {
      if (destino.hora !== HORA_D_A5) throw noDisponible();
      if ((await pesada.ocupadosDependientes(db, destino.fecha, destino.examinador_id)).length) throw noDisponible();
    }

    const ts = ahoraChile();
    // Un solo batch (transaccion en D1): el UPDATE del destino solo aplica si sigue libre, y el
    // origen se libera junto con el: no queda el estado a medias si algo falla.
    const [movido] = await db.batch([
      db.prepare(`
        UPDATE agenda SET
          rut = ?, nombre = ?, clase = ?, contacto = ?, correo = ?,
          tipo_cita = 'REAGENDADO', motivo_reagendamiento = 'Reagendamiento autónomo por correo',
          lista_espera = ?, intento = ?, funcionario_id = ?,
          fecha_inicio_tramite = ?, confirmo_asistencia = 1,
          resultado = NULL, pendiente_reagendar = 0, pendiente_nota = NULL,
          comentarios = ?, agendado_en = COALESCE(agendado_en, ?),
          token_confirmacion = ?, correo_confirmacion_enviado = 0, correo_recordatorio_enviado = 0,
          actualizado_en = ?
        WHERE id = ? AND bloqueado = 0 AND (rut IS NULL OR rut = '') AND (nombre IS NULL OR nombre = '')
      `).bind(
        bloque.rut, bloque.nombre, bloque.clase, bloque.contacto, bloque.correo,
        bloque.lista_espera, bloque.intento, bloque.funcionario_id, bloque.fecha_inicio_tramite,
        [bloque.comentarios, `Reagendada desde ${bloque.fecha} ${bloque.hora} (autoservicio por correo)`].filter(Boolean).join(' | '),
        ts, nuevoToken, ts, destino.id,
      ),
      db.prepare(`UPDATE agenda SET ${LIMPIAR_SQL} WHERE id = ? AND EXISTS (SELECT 1 FROM agenda d WHERE d.id = ? AND d.token_confirmacion = ?)`)
        .bind(ts, bloque.id, destino.id, nuevoToken),
    ]);
    if (!movido.meta.changes) throw noDisponible();

    // Regla de clase pesada (D/A5): libera los bloques auto-bloqueados del origen y bloquea los del destino.
    if (pesada.esPesadaEnHoraValida(bloque)) await pesada.liberar(db, bloque.fecha, bloque.examinador_id);
    if (pesada.esPesadaEnHoraValida({ hora: destino.hora, clase: bloque.clase })) {
      await pesada.aplicar(db, destino.fecha, destino.examinador_id);
    }
    await log(db, destino.id, 'reagendar', `${bloque.fecha} ${bloque.hora} -> ${destino.fecha} ${destino.hora} (Autoservicio ciudadano por correo)`, null, ts);

    const nuevoFinal = await traer(db, destino.id);
    if (nuevoFinal && nuevoFinal.correo) {
      c.executionCtx.waitUntil(
        correo.confirmacion(c.env, db, nuevoFinal)
          .then(async (ok) => { if (ok) await correo.marcarConfirmacionEnviada(db, nuevoFinal); })
          .catch(() => {})
      );
    }
    return c.html(paginaPublica(
      '¡Hora reagendada con éxito!',
      `Tu examen práctico ha sido reprogramado para el <b>${esc(fFecha(destino.fecha))} a las ${esc(destino.hora)} hrs</b> con ${esc(destino.examinador)}. Hemos enviado tu nuevo comprobante a tu correo.`,
      true));
  } catch (e) {
    // Errores previstos (bad) se muestran tal cual; cualquier otro se registra y se oculta al ciudadano.
    if (e.status) return c.html(paginaPublica('No pudimos reagendar', esc(e.message), false), e.status);
    return errorPublico(c, e, 'POST reagendar/elegir');
  }
});
