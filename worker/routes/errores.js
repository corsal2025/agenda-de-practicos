import { Hono } from 'hono';
import { reporte } from '../lib/errores.js';

export const erroresRoutes = new Hono();

erroresRoutes.get('/errores', async (c) => c.json(await reporte(c.env.DB)));
