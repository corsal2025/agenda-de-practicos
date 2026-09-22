// Import/export de Excel + "backup". Reemplaza server/index.js (rutas
// /api/import, /api/export, /api/backup). multer se cae: se lee
// c.req.formData() directo (API web estandar). El backup real (copia de
// archivo) se cae: D1 Time Travel lo reemplaza automaticamente, asi que la
// ruta solo devuelve el mensaje explicativo (decision confirmada con el usuario).
import { Hono } from 'hono';
import * as auth from '../lib/auth.js';
import { importar } from '../lib/migrate.js';
import { generarXlsx, generarXlsxOriginal } from '../lib/export.js';
import { hoyISOChile } from '../lib/fechas.js';
import { bad, logReq } from '../lib/comun.js';

export const importExportRoutes = new Hono();

importExportRoutes.post('/import', auth.soloAdmin, async (c) => {
  const db = c.env.DB;
  const form = await c.req.formData();
  const archivo = form.get('archivo');
  if (!archivo || typeof archivo === 'string') throw bad('Sube un archivo .xlsx en el campo "archivo"');
  const limpiarRaw = form.get('limpiar');
  const limpiar = limpiarRaw === 'true' || limpiarRaw === '1';
  const buf = await archivo.arrayBuffer();
  const r = await importar(db, buf, { limpiar });
  await logReq(c, db, null, 'importar', JSON.stringify(r));
  return c.json({ ok: true, resumen: r });
});

importExportRoutes.get('/export', async (c) => {
  const db = c.env.DB;
  const original = c.req.query('formato') === 'original';
  const buf = original ? await generarXlsxOriginal(db) : await generarXlsx(db);
  c.header('Content-Disposition', `attachment; filename="agenda-practicos${original ? '-formato-excel' : ''}-${hoyISOChile()}.xlsx"`);
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return c.body(buf);
});

// D1 Time Travel reemplaza el respaldo manual a archivo: se mantiene el mismo
// boton/endpoint pero el mensaje explica que el respaldo ahora es automatico.
importExportRoutes.post('/backup', async (c) => {
  return c.json({
    ok: true,
    archivo: 'Respaldo automático (Cloudflare D1 Time Travel — restaurar desde el panel de Cloudflare)',
  });
});
