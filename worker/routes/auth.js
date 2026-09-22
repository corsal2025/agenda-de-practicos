// Rutas de sesion/autenticacion. Reemplaza el bloque de login/sesion/logout +
// las rutas publicas /confirmar, /rechazar y /api/mi-clave de server/index.js.
import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import * as usuarios from '../lib/usuarios.js';
import { ahoraChile } from '../lib/fechas.js';
import { log } from '../lib/db.js';
import { bad, logoDisponible, logReq } from '../lib/comun.js';

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

// ---------- confirmar / rechazar por correo (publico, sin login) ----------
// Estas dos rutas NO viven bajo /api y se montan aparte en worker/app.js (fuera
// del router /api), igual que en server/index.js.
export const publicasRoutes = new Hono();

function paginaPublica(titulo, mensaje, ok) {
  return `<!doctype html><html lang="es"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${titulo}</title>
    <body style="font-family:sans-serif;background:#f1f5f9;margin:0;padding:2.5rem 1.2rem;color:#1e293b">
      <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:10px;padding:2rem 1.6rem;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center">
        <div style="font-size:2.2rem">${ok ? '✅' : '⚠️'}</div>
        <h1 style="font-size:1.2rem;margin:.8rem 0 .4rem">${titulo}</h1>
        <p style="color:#475569;margin:0">${mensaje}</p>
      </div>
    </body></html>`;
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

publicasRoutes.get('/confirmar/:id/:token', async (c) => {
  const db = c.env.DB;
  try {
    const bloque = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(Number(c.req.param('id'))).first();
    if (!tokenValido(bloque, c.req.param('token'))) {
      return c.html(paginaPublica('Link no válido', 'Este link ya se usó o no es válido.', false), 404);
    }
    await db.prepare("UPDATE agenda SET confirmo_asistencia = 1, token_confirmacion = NULL, actualizado_en = ? WHERE id = ?")
      .bind(ahoraChile(), bloque.id).run();
    await log(db, bloque.id, 'confirmar', `${bloque.fecha} ${bloque.hora} confirmado por correo`, null, ahoraChile());
    return c.html(paginaPublica('¡Listo, tu hora quedó confirmada!', 'Te esperamos el día y la hora agendada. Gracias por confirmar.', true));
  } catch (e) {
    return c.html(paginaPublica('Ocurrió un error', 'No pudimos procesar tu confirmación. Contacta a la oficina.', false), 500);
  }
});

publicasRoutes.get('/rechazar/:id/:token', async (c) => {
  const db = c.env.DB;
  try {
    const bloque = await db.prepare('SELECT * FROM agenda WHERE id = ?').bind(Number(c.req.param('id'))).first();
    if (!tokenValido(bloque, c.req.param('token'))) {
      return c.html(paginaPublica('Link no válido', 'Este link ya se usó o no es válido.', false), 404);
    }
    await db.prepare(`
      UPDATE agenda SET confirmo_asistencia = 0, pendiente_reagendar = 1,
        pendiente_nota = 'No puede asistir (avisado por correo automatico)',
        token_confirmacion = NULL, actualizado_en = ?
      WHERE id = ?
    `).bind(ahoraChile(), bloque.id).run();
    await log(db, bloque.id, 'rechazar', `${bloque.fecha} ${bloque.hora} avisó que no puede asistir (correo)`, null, ahoraChile());
    return c.html(paginaPublica('Gracias por avisar', 'Registramos que no puedes asistir. El equipo te contactará para reagendar tu hora.', true));
  } catch (e) {
    return c.html(paginaPublica('Ocurrió un error', 'No pudimos procesar tu aviso. Contacta a la oficina.', false), 500);
  }
});
