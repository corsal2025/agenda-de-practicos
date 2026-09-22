// Examinadores y funcionarios (server/index.js no los separaba tampoco).
import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import { upsertExaminador, upsertFuncionario } from '../lib/db.js';
import * as usuarios from '../lib/usuarios.js';
import { bad } from '../lib/comun.js';

export const examinadoresRoutes = new Hono();

examinadoresRoutes.post('/examinadores', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const id = await upsertExaminador(db, String((body || {}).nombre || '').trim().toUpperCase());
  return c.json({ ok: true, id });
});

examinadoresRoutes.put('/examinadores/:id', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const { nombre, activo } = body || {};
  await db.prepare('UPDATE examinadores SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .bind(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), Number(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

examinadoresRoutes.post('/funcionarios', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const id = await upsertFuncionario(db, String((body || {}).nombre || '').trim().toUpperCase());
  return c.json({ ok: true, id });
});

examinadoresRoutes.put('/funcionarios/:id', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const { nombre, activo, usuario, clave, rol } = body || {};
  await db.prepare('UPDATE funcionarios SET nombre = COALESCE(?, nombre), activo = COALESCE(?, activo) WHERE id = ?')
    .bind(nombre ? nombre.toUpperCase() : null, activo == null ? null : (activo ? 1 : 0), id)
    .run();
  if (usuario != null) {
    const limpio = String(usuario).trim();
    if (limpio && !(await usuarios.usuarioDisponible(db, limpio, id))) throw bad('Ese usuario ya esta en uso por otra persona.');
    await db.prepare('UPDATE funcionarios SET usuario = ? WHERE id = ?').bind(limpio || null, id).run();
  }
  if (clave) {
    if (String(clave).length < 4) throw bad('La contraseña debe tener al menos 4 caracteres.');
    await db.prepare('UPDATE funcionarios SET clave_hash = ? WHERE id = ?').bind(await usuarios.hashClave(clave), id).run();
  }
  if (rol) {
    if (!['admin', 'staff'].includes(rol)) throw bad('Rol no valido');
    await db.prepare('UPDATE funcionarios SET rol = ? WHERE id = ?').bind(rol, id).run();
  }
  return c.json({ ok: true });
});
