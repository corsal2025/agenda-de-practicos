import { Hono } from 'hono';
import * as papelera from '../lib/papelera.js';
import { traer, logReq } from '../lib/comun.js';

export const papeleraRoutes = new Hono();

papeleraRoutes.get('/papelera', async (c) => c.json(await papelera.listar(c.env.DB, 80)));

papeleraRoutes.post('/papelera/:id/restaurar', async (c) => {
  const db = c.env.DB;
  const b = await papelera.restaurar(db, Number(c.req.param('id')));
  await logReq(c, db, b.id, 'editar', `restaurado desde papelera: ${b.fecha} ${b.hora}`);
  return c.json({ ok: true, bloque: await traer(db, b.id) });
});

papeleraRoutes.post('/papelera/:id/eliminar', async (c) => {
  const db = c.env.DB;
  await papelera.eliminar(db, Number(c.req.param('id')));
  await logReq(c, db, null, 'editar', `eliminada entrada de papelera #${c.req.param('id')}`);
  return c.json({ ok: true });
});

papeleraRoutes.post('/papelera/vaciar', async (c) => {
  const db = c.env.DB;
  const n = await papelera.vaciar(db);
  await logReq(c, db, null, 'editar', `papelera vaciada: ${n} entradas`);
  return c.json({ ok: true, eliminadas: n });
});
