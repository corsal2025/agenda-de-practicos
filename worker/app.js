// App Hono: monta todos los routers + middleware de sesion, en el mismo orden
// que server/index.js (rutas publicas antes del guard, soloAdmin en las rutas
// de configuracion). Reemplaza el archivo server/index.js completo (que en la
// version Node tambien hacia de entrypoint HTTP: aqui ese rol lo cumple
// functions/[[path]].js).
import { Hono } from 'hono';
import { guard } from './lib/auth.js';
import { authPublicRoutes, authPrivateRoutes, publicasRoutes } from './routes/auth.js';
import { agendaRoutes } from './routes/agenda.js';
import { catalogosRoutes } from './routes/catalogos.js';
import { feriadosRoutes } from './routes/feriados.js';
import { examinadoresRoutes } from './routes/examinadores.js';
import { papeleraRoutes } from './routes/papelera.js';
import { importExportRoutes } from './routes/importExport.js';
import { analiticaRoutes } from './routes/analitica.js';
import { erroresRoutes } from './routes/errores.js';
import { movimientosRoutes } from './routes/movimientos.js';

export const app = new Hono();

// ---------- rutas publicas fuera de /api (confirmar/rechazar por correo) ----------
// Nunca pasan por el guard de sesion: los links del correo recordatorio no
// tienen cookie de sesion, se validan con su propio token.
app.route('/', publicasRoutes);

// ---------- /api/* ----------
const api = new Hono();

// login/sesion/logout: deben quedar libres de sesion (mismo LIBRES que
// worker/lib/auth.js). Se registran ANTES de instalar el guard.
api.route('/', authPublicRoutes);

// A partir de aqui, toda ruta /api/* exige sesion valida (401 + {login:true}
// si no la hay — contrato no negociable con el frontend).
api.use('*', guard);

api.route('/', agendaRoutes);
api.route('/', catalogosRoutes);
api.route('/', feriadosRoutes);
api.route('/', examinadoresRoutes);
api.route('/', papeleraRoutes);
api.route('/', importExportRoutes);
api.route('/', analiticaRoutes);
api.route('/', erroresRoutes);
api.route('/', movimientosRoutes);
api.route('/', authPrivateRoutes); // /mi-clave: exige sesion pero no rol admin

app.route('/api', api);

// ---------- errores ----------
// Mismo contrato que el manejador de server/index.js: con status es un error previsto
// (bad(), validaciones) y su mensaje llega a la UI; sin status es un error inesperado
// (SQL, bug): se registra y al cliente solo le llega un texto generico.
app.onError((err, c) => {
  if (!err.status || err.status >= 500) {
    console.error(err);
    return c.json({ error: 'Error interno del servidor. Intenta de nuevo; si persiste, avisa al administrador.' }, 500);
  }
  const cuerpo = { error: err.message || 'Error' };
  if (err.bloque) cuerpo.bloque = err.bloque;
  if (err.login) cuerpo.login = true;
  return c.json(cuerpo, err.status);
});

export default app;
