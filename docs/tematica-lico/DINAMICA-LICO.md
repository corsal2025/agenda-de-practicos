# Dinámica de Lico: origen (Petición Cambio de Domicilio) y adaptación a la Agenda de Prácticos

## 1. Cómo interactúa Lico en el origen

Origen: `docs/tematica-lico/` (`lico.js`, `guia-interactiva.js`, `lico-juegos.js`, `tema-lico.css`) y vistas `Pages/Index.cshtml` y `Pages/Shared/_Layout.cshtml`. La copia publicada (`publish/wwwroot`) es idéntica.

Lo que SÍ hace Lico allí: es un personaje de presencia discreta, con tres capas.

1. **Cabecera de la página principal** (`#btn-lico-saludo`, clase `.head-lico`, pose `saluda`, globo fijo "¡Hola! Me llamo Lico", oculto bajo 900 px). Al hacerle clic ejecuta una **gracia al azar** en su sitio (sin repetir la anterior) y cambia el texto del globo durante la gracia.
2. **Travesuras por inactividad** (`lico-juegos.js`): a los 90 s sin actividad aparece a pie de pantalla y hace un juego. Si se va solo, la siguiente travesura tarda el doble.
3. **Guía interactiva** (`guia-interactiva.js`): Lico dentro de la tarjeta del paso, con pose según el paso. Botón global "Cómo usar el sistema" con su carita (`.lico-mini`).

Lo que NO hace: no sigue el cursor, no reacciona a formularios ni a acciones (guardar, enviar, error), no tiene frases por pantalla, no guarda nada en `localStorage` (solo `sessionStorage` para el scroll, ajeno a Lico), no tiene atajos de teclado ni interruptor para silenciarlo (solo `window.LICO_JUEGOS = false` antes de cargar el script, o `prefers-reduced-motion`).

### Tabla gatillo -> reacción

| Gatillo | Reacción de Lico |
|---|---|
| Carga de página | Se monta en todo `[data-lico]` (cabecera, botón guía, guía). Rebote lento, parpadeo cada 4,5 s; la pose `saluda` mueve el brazo. |
| Clic en Lico de cabecera | Gracia al azar: `salta`, `gira`, `baila`, `toc` (ondas amarillas), `duerme` (gorro y Zzz), `pelota` (patea), `domina` (cabecea la pelota). Globo con frase propia ("¡Wiii!", "¡Gooool!", ...). Reemplaza al clic que antes abría la guía. |
| 90 s sin mouse/teclado/clic/scroll/toque | Travesura al azar (no repite la última): `toc` (7 s, "¡Toc, toc! ¿Sigues ahí?"), `pelota` (9,5 s, "¡Gooool!"), `duerme` (16 s, "Zzz…"), `domina` (11 s). |
| Cualquier actividad durante la travesura | Desaparece al instante (se ignoran los primeros 400 ms). |
| Guía abierta, `.modal.show`, pestaña oculta, `prefers-reduced-motion` | No aparece (la travesura se reprograma). |
| Clic en "Cómo usar el sistema" | Abre la guía en el primer paso de la página actual. Teclas: Esc cierra, flechas navegan. |
| Cada paso de la guía | Pose según el paso: `saluda` (inicio y secciones), `alerta` (puntos delicados), `explica` (por defecto), `celebra` (último paso). Al terminar, toast "¡Guía interactiva completada!". |

### API pública

| Script | API |
|---|---|
| `lico.js` | `Lico.svg(pose)` devuelve el SVG (`saluda` / `explica` / `alerta` / `celebra`). `Lico.mount()` monta `[data-lico]`. Auto-monta en `DOMContentLoaded`. |
| `lico-juegos.js` | `LicoJuegos.jugar('toc'\|'pelota'\|'duerme'\|'domina')` (prueba manual; solo clic o tecla la despiden), `LicoJuegos.terminar()`. Config: `window.LICO_IDLE_MS` (por defecto 90000) y `window.LICO_JUEGOS = false`, ambos antes de cargar. |
| `guia-interactiva.js` | `iniciarGuiaInteractiva(paso)`, `cerrarGuiaInteractiva()`; incluye su propia copia de Lico (`window.Lico` si no existe). Soporta `?guia=1&paso=N` para continuar entre páginas. |

## 2. Adaptación en la Agenda de Prácticos

Se conserva todo lo previo (Lico de cabecera con consejos, estados vacíos, toasts, confeti, guía de 56 pasos) y se agrega lo que el origen tiene y aquí faltaba, más reacciones contextuales propias de la agenda.

| Gatillo en la agenda | Reacción |
|---|---|
| Primera carga de la sesión (una vez, `sessionStorage`) | Globo "Buenos días / Buenas tardes / Buenas noches. Soy Lico..." durante 5,5 s. |
| Clic en Lico de cabecera | Gracia al azar (7 del origen) y, a la vez, consejo de texto: mezcla de frases generales y de la pestaña abierta (las de la pestaña pesan el doble). |
| Toast de logro (agendada, asignada, reagendada, aprobó, éxito, importación completada, grilla generada) | El Lico de cabecera cambia a `celebra` y salta 2,8 s. Es la misma señal que ya mostraba Lico en el toast. |
| Toast de error o validación fallida (RUT inválido, faltan datos, error de servidor) | Cabecera en pose `alerta` 2,8 s. |
| Marcar Aprobó / Por confirmar en cero | Confeti existente (ahora respeta el interruptor). |
| 90 s sin actividad | Travesura (toc, pelota, duerme, domina). No aparece con modal abierto, guía abierta, campo de formulario con foco (salvo el buscador), pestaña oculta ni movimiento reducido. |
| Interruptor `☺` junto al tema | Apaga/enciende gracias, reacciones, travesuras y confeti. Guarda `agenda-lico` en `localStorage` (con try/catch). Los textos y estados vacíos con Lico siguen. |
| Impresión | Todo oculto (`@media print`). |

API: `LicoJuegos.jugar(id)`, `.terminar()`, `.reaccionar('celebra'\|'alerta')`, `.activo()`, `.animado()`, `.activar(bool)`. Configuración: `window.LICO_IDLE_MS`, `window.LICO_JUEGOS = false`.

Archivos: `public/lico-juegos.js` (nuevo), bloque "Lico travieso" en `public/styles.css`, `FRASES_TAB` y saludo en `public/app.js`, interruptor y scripts en `public/index.html`.

### No trasladado del origen

- Globo permanente "¡Hola! Me llamo Lico" y placa con el texto "LICO": la agenda ya usa globo bajo demanda y su Lico no lleva placa.
- Textos del globo de cada gracia: aquí el globo muestra consejos útiles; el movimiento sí se copió.
- Pasos, rutas y `?guia=1&paso=N` de la guía Razor: la guía de la agenda ya existe y es propia.
- Acoplamientos Razor/Bootstrap (`.modal.show`, `asp-append-version`): se reemplazaron por `#modal-root` y versiones `?v=` manuales.
