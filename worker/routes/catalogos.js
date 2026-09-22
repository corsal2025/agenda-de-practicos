import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import { bad } from '../lib/comun.js';

export const catalogosRoutes = new Hono();

catalogosRoutes.post('/catalogos', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { tipo, valor } = body || {};
  if (!tipo || !valor) throw bad('Indica tipo y valor');
  const ordenRow = await db.prepare('SELECT COALESCE(MAX(orden),0)+1 n FROM catalogos WHERE tipo=?').bind(tipo).first();
  await db.prepare('INSERT OR REPLACE INTO catalogos (tipo, valor, orden, activo) VALUES (?, ?, ?, 1)')
    .bind(tipo, String(valor).trim().toUpperCase(), ordenRow.n).run();
  return c.json({ ok: true });
});

catalogosRoutes.delete('/catalogos', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  await db.prepare('UPDATE catalogos SET activo = 0 WHERE tipo = ? AND valor = ?')
    .bind(c.req.query('tipo'), c.req.query('valor')).run();
  return c.json({ ok: true });
});
