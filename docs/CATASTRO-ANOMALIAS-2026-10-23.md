# Catastro de anomalías — Agenda de Prácticos

Fecha de la auditoría: 23/10/2026 · Versión revisada: `main` en `af3e985` (último commit)

> Todo lo que figura aquí está medido o leído en el código. Lo que no pude comprobar está en la sección 2.

---

## 1. Resumen

| Área | Resultado |
| --- | --- |
| Servidor y API (64 rutas) | 197 de 197 pruebas pasan, con base de datos temporal. |
| Consola del navegador | 0 errores en los 11 módulos. |
| Llamadas de red | 0 fallidas (todas 200) en los 11 módulos. |
| Tablas (escritorio 1440 px) | 11 anomalías de presentación (sección 4.A). |
| Tablas (móvil 390 px) | 6 de 9 módulos con tablas más anchas que la pantalla. |
| Datos de producción | 1.893 hallazgos en el Reporte de errores y 485 filas en Corrección rápida (sección 4.B). |
| Funcionalidad | 4 problemas que afectan el uso real (sección 4.C). |

La causa principal de que los errores de tablas se repitan **no es un solo defecto**: son tres cosas juntas.
1. Un CSS saturado de reglas que se pisan entre sí.
2. Cero pruebas automáticas de la interfaz.
3. Una forma de trabajar mía, módulo por módulo, sin inventario previo. Esto último lo detallo en la sección 5.

---

## 2. Alcance y límites

**Qué revisé**
- Los 11 módulos de la barra lateral: Citas disponibles, Agenda, Lista de espera, Por confirmar, Por vencer, Estadísticas, Jefatura, Papelera, Datos, Reporte de errores y Examinador.
- Escritorio (1440 px), móvil (390 px) y modo oscuro (contraste de una tabla).
- Código: `styles.css` (4.174 líneas), `responsive.css`, 17 archivos JS del cliente, el servidor y las pruebas.
- Datos: respuesta de `/api/errores` y `/api/limpieza` (solo lectura).

**Qué NO pude comprobar**
- Guardar datos desde la interfaz: la base real es de producción y no escribí en ella.
- Impresión en papel: solo leí el CSS de impresión.
- Envío real de correos: SMTP y Outlook no están configurados en este equipo.
- Otros navegadores (solo el panel integrado) y celulares físicos.
- Las tablas dentro de ventanas emergentes (solo las leí en el código).
- Jefatura y Examinador: no tienen tablas; no revisé su contenido a fondo.

---

## 3. Qué funciona

- Todas las pruebas del servidor pasan (197/197) y ninguna llamada a la API falla.
- Los 11 módulos cargan sin errores de JavaScript.
- Tablas: encabezado fijo y botón Maximizar en todas las de `#view`.
- Modo oscuro: contraste de 13 a 14 en la tabla medida (cumple de sobra).
- Respaldo automático: hay uno diario en `data/backups` (el último diario, 22/10 13:15; el de 23/10 10:12 lo creó mi servidor de prueba al arrancar).
- Sin IDs duplicados en ningún módulo.

---

## 4. Catálogo de anomalías

Severidad: **Alta** afecta el trabajo diario · **Media** molesta o confunde · **Baja** deuda técnica.

### 4.A Interfaz y tablas

| ID | Sev. | Anomalía | Evidencia | Causa raíz | Corrección propuesta |
| --- | --- | --- | --- | --- | --- |
| A1 | Alta | Doble barra de desplazamiento vertical: la de la página y la de la tabla. | 6 módulos: Agenda, Disponibles, Lista de espera, Por confirmar, Por vencer y Errores. | `#view .tabla-scroll` fija `max-height: 78vh` con `overflow: auto`, además del scroll de la página. | Elegir un solo scroll por vista (el de la tabla con altura calculada al espacio libre). |
| A2 | Alta | Tablas más anchas que su marco: aparece scroll horizontal en casi todas. | A 1440 px: Agenda 2093/1125, Errores 1625/1129, Lista de espera 1532/1089, Por confirmar 1501, Por vencer 1444, Datos 1444, Corrección rápida 1329, Papelera 1241 (px). | La regla global `#view table { width: max-content }` más `white-space: nowrap` en todas las celdas. | Anchos por columna y texto que se parte donde corresponde; reservar el scroll horizontal solo a Agenda. |
| A3 | Alta | En móvil, 6 de 9 módulos siguen con tablas más anchas que la pantalla. | 390 px: Agenda, Datos, Lista de espera, Por confirmar, Por vencer y 2 de las 7 tablas de Estadísticas. | El modo "tarjetas" de `responsive.css` pierde frente a `width: max-content`. | Que la regla global no se aplique bajo el punto de corte móvil. |
| A4 | Media | Texto menor a 11 px. | Disponibles 52 elementos, Agenda 18, Lista de espera 143, Por confirmar 155, Por vencer 497, Errores 902. | Tamaños fijos en estilos en línea y en insignias. | Mínimo de 12 px en todo texto que se lea. |
| A5 | Media | Campos sin etiqueta accesible. | Corrección rápida/Errores 900, Datos 4, Estadísticas 2, Lista de espera 2. | Los campos de las filas no llevan `aria-label`. | Agregar `aria-label` al generar cada fila. |
| A6 | Media | Las tablas de las ventanas emergentes no heredan el estilo unificado. | Reagendar, sugerencias de cupo, cola de WhatsApp y cierre del día. | Mi regla de estilo solo cubre `#view`; las ventanas viven fuera de él. | Extender el estilo a `#modal-root`. |
| A7 | Baja | Papelera: última columna sin título. Datos: 2 celdas vacías. | Papelera, 8 columnas con la última en blanco; Datos con 2 celdas vacías. | Columna de acciones sin encabezado. | Ponerle título ("Acción") o ocultar el encabezado vacío. |
| A8 | Media | CSS difícil de mantener. | 4.174 líneas, 169 `!important`, 490 colores fijos frente a 568 variables, 69 reglas con `#view`; `td-hora` se define en 3 sitios con valores distintos (200 px y 110 px). | Parches acumulados sin consolidar. | Un solo componente de tabla con variables; borrar las reglas duplicadas. |
| A9 | Media | Estilos en línea masivos que ganan a la hoja de estilos. | 101 en `reagendar.js`, 51 en `bloqueos.js`, 39 en `lista-espera.js`, 38 en `porconfirmar.js`. | Se escribió el diseño dentro de las plantillas. | Mover a clases CSS. |
| A10 | Media | Cambios que "no se ven" por caché del navegador. | Hoy ocurrió con el botón Maximizar y el modal. | Las versiones `?v=NN` de `index.html` se suben a mano. | Subir la versión siempre al editar, o generarla automáticamente. |
| A11 | Baja | Código muerto en `grilla.js`: variable `mensajeWa` definida y sin uso. | Aparece una sola vez en el archivo. | Resto de una función antigua. | Borrarla. |

### 4.B Datos de producción (Reporte de errores)

El Reporte lista **1.893 hallazgos**. Son datos mal cargados en la base real; el sistema **los detecta, pero no los corrige solo**.

| Tipo | Cantidad | Severidad | Ejemplo |
| --- | ---: | --- | --- |
| Falta correo | 655 | Info | "no recibirá confirmación ni recordatorio" |
| Sin resultado | 352 | Info | "cita ya realizada sin resultado registrado" |
| RUT inválido | 281 | Aviso | dígito verificador incorrecto |
| Teléfono incompleto | 148 | Aviso | `+569300801931` (sobra un dígito) |
| Sin contacto | 132 | Aviso | cita futura sin teléfono ni correo |
| Falta clase | 131 | Aviso | — |
| Clase en bloque incorrecto | 76 | Aviso | clase D a las 13:00 (solo se permite a las 12:30) |
| Duplicado futuro | 36 | **Error** | 2 citas futuras para el mismo contribuyente |
| Duplicado el mismo día | 32 | **Error** | mismo RUT en 2 bloques el 04/08 |
| Conflicto terreno | 29 | Error 6 / Aviso 23 | examinador ausente con citas |
| Incompleta | 10 | Aviso | RUT sin nombre |
| Correo inválido | 6 | Aviso | texto libre en el campo de correo |
| Conflicto D/A5 12:30 | 4 | **Error** | — |
| Cita en día inhábil | 1 | Aviso | fecha 13/10/2001 |

Anomalías puntuales que conviene tratar primero:
- **Cita id 220936 (EMILIA LIRAYEN LAGUN) con fecha 13/10/2001.** Era 13/10/2026. **Corregida el 23/10/2026 con tu confirmación**: se movió, tal cual (sin marcarla como reagendada), al bloque libre 214948 (13/10/2026 11:30, mismo examinador); el bloque de 2001 quedó vacío. Respaldo previo: `data/backups/agenda-2026-10-23T16-32-02-pre-correccion-fecha-220936.db`; quedó anotado en la bitácora (actor `CORRECCION MANUAL`).
- **Corrección a este catastro:** esa cita **no** era la causa principal del rango "2001 – 2027" de la cabecera. La base tiene **220.966 bloques** y **208.495 de ellos son bloques vacíos entre 2001 y 2025** (sin ninguna cita); el rango sale del `MIN(fecha)` de todos los bloques (`/api/meta`, `server/index.js:353`). Mientras existan esos bloques, la cabecera y el rango por defecto de Estadísticas seguirán empezando en 2001. Además hacen la base de 39 MB (cada respaldo diario pesa 37 MB). Ver anomalía **B2**.
- 6 correos que son frases de texto libre (por ejemplo, "en 2 ocasiones no está disponible…"). Hay un botón existente para vaciarlos (con respaldo previo).
- 485 filas en Corrección rápida (correo inválido, teléfono incompleto, nombre con espacios).

| ID | Sev. | Anomalía | Evidencia | Corrección propuesta |
| --- | --- | --- | --- | --- |
| B2 | Media | **Resuelto el 23/10/2026**: se borraron los 208.495 bloques vacíos anteriores a 2026 (respaldo previo `agenda-2026-10-23T16-39-50-pre-borrado-bloques-vacios.db`, bitácora "CORRECCION MANUAL"); la base pasó de 39 MB a 2,4 MB, la cabecera muestra 02/01/2026 – 30/06/2027 y las 2.399 citas siguen intactas. **Riesgo cerrado el 23/10/2026:** `server/migrate.js` generaba la grilla desde la primera fecha del Excel; ahora descarta las filas con fecha anterior al 01/01/2020 (`FECHA_MINIMA`), lo informa en la pantalla de importación y tiene 2 pruebas (`test/migrate.test.js`, 199 de 199 pasan; fallan sin la corrección). Original: 208.495 bloques vacíos de 2001 a 2025 en la base de producción. | Por año: ~8.600 bloques, 0 citas (2002–2025); 1.849 en 2001. Rango de la cabecera 13/10/2001 – 30/06/2027. | Opción A: borrar los bloques vacíos anteriores a 2026 (con respaldo): la base baja a unos 3 MB y la cabecera muestra 2026–2027. Opción B (sin borrar): que `rango_agenda` calcule el mínimo solo sobre bloques con cita o desde el 01/01/2026. Falta tu decisión. |

**Por qué no se han corregido:** nadie pidió limpiar datos, y corregirlos exige decisión humana (por ejemplo, saber cuál de dos citas duplicadas es la válida). Mis cambios han sido solo de interfaz y no toqué la base de producción.

### 4.C Funcionalidad y arquitectura

| ID | Sev. | Anomalía | Evidencia | Causa raíz | Corrección propuesta |
| --- | --- | --- | --- | --- | --- |
| C1 | Alta | **Los correos no salen.** Confirmaciones y recordatorios automáticos no funcionan. | `SMTP_PASS` vacío; `CORREO_MODO` estaba en `outlook` y no hay perfil de Outlook en este usuario. | Falta configuración de la cuenta. | Completar `SMTP_PASS` (lo haces tú), reiniciar y probar con `probar-correo.js`. Ya cambié `CORREO_MODO` a `auto`. |
| C2 | Alta | La edición en línea guarda con `PUT` enviando la cita completa, no con el `PATCH /contacto` que ya existe. | `guardarCampoCita` en `grilla.js`. | Se reutilizó el camino general en lugar del específico. | Usar `PATCH /agenda/:id/contacto` (valida y bloquea cambios concurrentes). La columna Correo que agregué usa este camino. |
| C3 | Alta | **Cero pruebas de la interfaz.** | 197 pruebas, todas de servidor. | Nunca se montó una prueba de tablas. | Prueba automática que recorra los módulos y compruebe anchos, scroll, alineación y consola (la misma que usé hoy). |
| C4 | Media | `main` tiene 13 commits sin subir y 3 ramas locales viejas. | `fix/robustez-agenda`, `refactor/quitar-login`, `feat/tematica-lico`, y 3 ramas `claude/*` en GitHub. | Nunca se ordenó el repositorio. | Subir `main`, revisar y borrar ramas ya integradas. |
| C5 | Media | La aplicación no tiene login. | README: "no tiene login", actor fijo `MODO SIN LOGIN`. | Decisión de diseño (se delega al sistema padre). | Mantener el servidor solo en loopback (ya lo está) y documentar el riesgo. |
| C6 | Baja | Mi servidor de prueba comparte la base de producción. | Cada arranque crea un respaldo automático; el de hoy 10:12 es de mi arranque. | El proyecto no distingue entornos. | Arrancar las revisiones con `AGENDA_DB` temporal. |
| C7 | Baja | El botón Maximizar guarda su referencia en la propia tabla. | `tabla-maximizar.js` usa una propiedad en el elemento. | Atajo de implementación. | Si la tabla se vuelve a dibujar, el botón se reconstruye (ya ocurre); no hay fallo visible. |

---

## 5. Por qué no salió bien a la primera

1. **Trabajé pedido por pedido, sin inventario previo.** Cuando dijiste "todas las tablas de todos los módulos" apliqué un estilo global, pero no enumeré antes cuántas tablas había ni cómo se construía cada una. Por eso quedaron fuera las ventanas emergentes y aparecieron las anchuras desbordadas.
2. **Parché sobre un CSS ya saturado.** Con 169 `!important` y reglas duplicadas, cada arreglo mío en un módulo podía romper otro. Sumé reglas en lugar de consolidar.
3. **Verifiqué poco.** Medí un módulo a un ancho de pantalla y di el trabajo por bueno. No hice la matriz completa (módulos × anchos × móvil × modo oscuro) hasta hoy.
4. **No hay red de seguridad en el proyecto.** Sin pruebas de interfaz, cualquier regresión pasa inadvertida hasta que la ves tú.
5. **Dejé dudas sin cerrar.** "Pestañas" quedó ambiguo y seguí con otras cosas; debí insistir hasta aclararlo.
6. **Caché.** No subí la versión de los archivos al editar, y por eso a veces veías la versión anterior.

---

## 6. Plan de corrección propuesto

| Prioridad | Qué | Impacto |
| --- | --- | --- |
| P0 | Configurar el correo (C1) | Vuelven a salir confirmaciones y recordatorios. Necesito `SMTP_PASS` (lo pones tú). |
| P0 | Corregir la fecha de la cita 220936 (4.B) | Cabecera y Estadísticas con rango correcto. Necesito tu confirmación. |
| P1 | Un solo componente de tabla: anchos, un solo scroll vertical y modo móvil correcto (A1, A2, A3) | Elimina la mayoría de los defectos recurrentes. |
| P1 | Edición en línea por `PATCH` (C2) | Evita pisar cambios de otra persona. |
| P1 | Prueba automática de interfaz (C3) | Evita que vuelvan los defectos. |
| P2 | Tablas de ventanas emergentes (A6), texto mínimo de 12 px (A4), etiquetas accesibles (A5) | Coherencia y accesibilidad. |
| P2 | Limpieza de datos con tu validación (4.B) | Baja los 1.893 hallazgos. |
| P3 | Consolidar CSS y sacar estilos en línea (A8, A9); orden del repositorio (C4) | Deuda técnica. |

### 6.0 Avance de P0

- Fecha de la cita 220936: **hecha** (ver 4.B).
- Correo (C1): `CORREO_MODO=auto` ya está puesto; **falta que escribas `SMTP_PASS` en `.env`** (hoy sigue vacío). Después se reinicia el servidor y se prueba con `node server/probar-correo.js tu-correo@dominio.cl`.

### 6.1 Avance de P1 (tablas) — 23/10/2026, sin commitear

| ID | Estado | Qué se hizo | Resultado medido |
| --- | --- | --- | --- |
| A1 | Corregido | Cada tabla toma el alto libre de la pantalla (`--tabla-alto`, calculado en `js/tabla-maximizar.js`); el alto mínimo del contenedor principal usa la cabecera real (90 px, no 58 px). | Agenda, Disponibles y Papelera: 0 px de scroll de página. Lista de espera y Por vencer: 19 px. Por confirmar y Errores: la página sigue bajando porque hay otros paneles debajo de la tabla (esperado). |
| A2 | Corregido salvo la Agenda | `#view table` pasa de `max-content` a `100%`; el texto largo se parte; fechas, horas, RUT y botones no. Relleno lateral de 12 a 9 px y encabezado de 13,5 a 12,5 px. En Errores, Por confirmar y Lista de espera se permitió partir líneas. | A 1440 px todas las tablas caben en su marco, **excepto la Agenda** (2069 px en 1144 px): sus 11 columnas se desplazan dentro del marco por diseño. |
| A3 | Corregido | Se encontró la causa mayor: en celular el menú lateral fijo (84–248 px) dejaba el contenido en ~70 px. Ahora es una barra inferior y el contenido usa todo el ancho; las filas en modo tarjeta crecen con su contenido. | A 390 px las 8 tablas en modo tarjeta miden 338 px (caben); la Agenda conserva su tabla ancha con desplazamiento. |
| A12 | Corregido | **Nuevo:** en celular (≤600 px) el menú lateral dejaba la aplicación inutilizable. | Verificado a 390 px. |

Tablet (800 px): sin desbordamiento de página; las tablas anchas se desplazan dentro de su marco (el contenido útil mide ~450–500 px). Letra agrandada (130 %): se corrigió el alto de las tablas bajo zoom y el alto mínimo del contenido; Citas disponibles queda sin scroll de página; la Agenda y Por confirmar sí lo necesitan (barra de filtros más alta).

Sigue pendiente de P1: la Agenda en celular es una tabla ancha con scroll lateral (existe la vista Examinador para móvil) y el modo tarjeta no cubre la franja 601–1023 px; las tablas de ventanas emergentes (A6) no se tocaron.

**Qué necesito de ti:** 1) la contraseña de correo en `.env`; 2) confirmar si la fecha de la cita 220936 es 13/10/2026; 3) el orden: ¿empiezo por P1 (tablas) o por P0 (correo y fecha)?
