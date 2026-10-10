# Plan: versión web en Cloudflare (Workers + D1 + Access, plan gratuito)

Estado: propuesta, sin implementar. Los límites de Cloudflare se deben confirmar en la Fase 0.

## Hallazgos

- La base real pesa ~2 MB: muy por debajo de los límites de D1.
- Ya hubo un port paralelo en Hono (~5.000 líneas), eliminado en `45514d2` porque quedaba desactualizado
  respecto de `server/`. **Lección: una sola base de código compartida entre local y nube.**
- El Worker `agenda-practicos-recordatorios` (cron horario + Resend) y la D1 `agenda-practicos-db`
  siguen en la cuenta de Cloudflare. Revisarlos y desactivarlos antes de cargar datos reales.
- Las rutas públicas `/confirmar/*`, `/rechazar/*`, `/reagendar/*` (links del correo) necesitan
  una política **Bypass** en Access; ya validan con su propio token.

## Enfoque

- **Router compartido Hono**: corre en Node (`@hono/node-server`) y en Workers. Un solo `server/app.js`
  con dos entradas: `server/local.js` (Windows) y `worker/index.js` (fetch + scheduled).
- **Adaptador de base asíncrono** (`get/all/run/batch/exec`) con dos implementaciones:
  `node:sqlite` (local) y D1 (nube). ~120 llamadas en 13 archivos pasan a `async`.
- Los 9 usos de `tx()` se reescriben como lectura + `batch` con guardas en el `WHERE`
  (D1 no tiene transacciones interactivas). Es el mayor riesgo de corrección.
- Import/export de Excel en el navegador (SheetJS) para respetar el límite de 10 ms de CPU.
- Correo: interfaz común; nodemailer en local, Resend por `fetch` en la nube.
- Recordatorios y backups: `setInterval` en local, Cron Triggers en la nube; backup con D1 Time Travel
  (7 días en plan gratis) y export opcional a R2.
- Seguridad: Cloudflare Access en `workers.dev` (Allow `@munivalpo.cl`), `preview_urls = false`,
  validación del JWT `Cf-Access-Jwt-Assertion` en el Worker, actor = email autenticado.

## Fases

| Fase | Contenido | Esfuerzo |
|---|---|---|
| 0 | Decisiones (ADR), desactivar Worker/D1 viejos, spike Express vs Hono, pedir autorización municipal | 0,5–1 día |
| 1 | Adaptador async + tests de contrato (sqlite y D1); 90 tests en verde | 3–5 días |
| 2 | Router Hono compartido; `npm start` y `.bat` sin cambios | 2–3 días |
| 3 | Excel en navegador, correo con dos implementaciones, capacidades en `/api/meta` | 1,5–2 días |
| 4 | `wrangler.jsonc`, migraciones D1, deploy con datos de prueba | 1 día |
| 5 | Middleware JWT de Access, `actor(req)`, rutas públicas con Bypass | 1 día |
| 6 | Datos reales (solo con autorización): export/import, verificación, humo | 0,5 día |

Total estimado: 9–14 días-persona.

## Riesgos

1. Atomicidad sin transacciones interactivas (doble reserva de bloques).
2. Límite de 10 ms de CPU por request.
3. Correo a ciudadanos: Resend exige un **dominio verificado** para escribir a terceros.
4. Volver a separar código local y nube.
5. Dos bases vivas (local y D1) sin sincronización: definir cuál es la oficial.
6. Datos personales fuera de Chile (Ley 19.628 / 21.719): requiere autorización formal.
7. El Worker viejo enviando correos sobre la D1 antigua.

## Tareas manuales del usuario

- `npx wrangler login`
- Zero Trust: crear team, activar Access en el Worker, políticas Allow y Bypass.
- `wrangler secret put RESEND_API_KEY`, `ACCESS_AUD`, `AGENDA_URL_PUBLICA`.
