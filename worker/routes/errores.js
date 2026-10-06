import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import { reporte } from '../lib/errores.js';
import { enviarReporte } from '../lib/reporte-correo.js';
import { logReq } from '../lib/comun.js';

export const erroresRoutes = new Hono();

erroresRoutes.get('/errores', async (c) => c.json(await reporte(c.env.DB)));

// Envia el reporte por correo a AGENDA_REPORTE_DESTINATARIOS (solo administradores).
erroresRoutes.post('/errores/enviar', auth.soloAdmin, async (c) => {
  const r = await enviarReporte(c.env, c.env.DB);
  await logReq(c, c.env.DB, null, 'editar', `reporte de errores enviado a ${r.destinatarios.join(', ')} (${r.total})`);
  return c.json({ ok: true, ...r });
});
