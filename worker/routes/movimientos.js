import { Hono } from 'hono';

export const movimientosRoutes = new Hono();

movimientosRoutes.get('/movimientos', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM movimientos ORDER BY id DESC LIMIT 300').all();
  return c.json(results);
});
