import { Hono } from 'hono';
import { resumen } from '../lib/analitica.js';

export const analiticaRoutes = new Hono();

analiticaRoutes.get('/analitica', async (c) => {
  return c.json(await resumen(c.env.DB, c.req.query('desde'), c.req.query('hasta')));
});
