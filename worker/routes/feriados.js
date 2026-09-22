import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import * as feriados from '../lib/feriados.js';
import { bad, logReq } from '../lib/comun.js';

export const feriadosRoutes = new Hono();

feriadosRoutes.get('/feriados', async (c) => c.json(await feriados.listar(c.env.DB)));

feriadosRoutes.post('/feriados', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { fecha, nombre } = body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw bad('Fecha invalida (YYYY-MM-DD)');
  await feriados.agregar(db, fecha, nombre);
  await logReq(c, db, null, 'editar', `feriado + ${fecha}`);
  return c.json({ ok: true });
});

feriadosRoutes.delete('/feriados', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const fecha = c.req.query('fecha');
  await feriados.quitar(db, fecha);
  await logReq(c, db, null, 'editar', `feriado - ${fecha}`);
  return c.json({ ok: true });
});
