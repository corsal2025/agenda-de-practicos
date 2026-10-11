/* ================= GUÍA INTERACTIVA / SIMULADOR ================= */
// Cada paso: { seccion, tab?, target, fallback?, listo?, titulo, icono, descripcion, pose? }
//  - tab: pestaña que se abre (irA) antes de apuntar al target.
//  - listo: selector (o función) que indica que la vista ya pintó; por defecto, el propio target.
//  - fallback: elemento a resaltar si el target no existe (p. ej. no hay datos para esa fecha).
// El número del título se antepone automáticamente según la posición del paso.
let tourPasoActual = 0;
let tourToken = 0;
let tourTabOrigen = null;
const tourTabActual = () => (location.hash.slice(1) || 'disponibles').split('?')[0];
const tourQuery = (sel) => { if (!sel) return null; try { return document.querySelector(sel); } catch (_) { return null; } };
const tourSinCargando = (sel) => () => { const el = tourQuery(sel); return !!el && !/Cargando/i.test(el.textContent || ''); };
const tourPausa = (ms) => new Promise((r) => setTimeout(r, ms));
const TOUR_GRILLA_LISTA = '#a-grid .g-head, #a-grid .gh-exam-col, #a-grid .lico-vacio';

const PASOS_TOUR = [
  /* ---------- Entorno general ---------- */
  {
    seccion: 'Entorno general',
    target: '#nav',
    titulo: 'Pestañas y módulos principales',
    icono: '🧭',
    descripcion: 'Desde aquí accedes a todos los módulos: <b>Citas disponibles</b>, <b>Agenda</b>, <b>Reagendar</b>, <b>Por confirmar</b>, <b>Calendario</b>, <b>Agenda del día</b>, <b>Estadísticas</b> y el menú <b>Más ▾</b>. Los números de color junto a algunas pestañas son avisos pendientes. Esta guía los recorre uno por uno.'
  },
  {
    seccion: 'Entorno general',
    target: '#nav-mas-btn',
    titulo: 'Menú «Más»',
    icono: '☰',
    descripcion: 'Las pestañas de uso ocasional están en <b>Más ▾</b>: <b>Jefatura</b>, <b>Papelera</b>, <b>Datos</b> y <b>Reporte de errores</b>. El número sobre <b>Más</b> suma los avisos de esas pestañas. Con el teclado: <b>↓</b> abre el menú, <b>↑ ↓</b> recorren las opciones y <b>Esc</b> lo cierra.'
  },
  {
    seccion: 'Entorno general',
    target: '#bq',
    titulo: 'Buscador global',
    icono: '🔎',
    descripcion: 'Escribe un <b>RUT, nombre o teléfono</b> (mínimo 3 caracteres). Navega los resultados con las flechas <b>↑ ↓</b> y elige con <b>Enter</b> o con clic: se abre el <b>historial completo</b> de esa persona, con un botón <b>Abrir</b> en cada cita para ver su ficha. <b>Esc</b> cierra la lista. Al escribir un RUT, este se <b>formatea solo</b> (puntos y guion). En el historial, el botón <b>Ir a la agenda</b> te lleva al día de la cita con su tarjeta <b>resaltada</b>.'
  },
  {
    seccion: 'Entorno general',
    target: '#tema',
    titulo: 'Tema claro u oscuro',
    icono: '🌗',
    descripcion: 'Alterna entre el tema <b>claro</b> y el <b>oscuro</b>. El sistema recuerda tu elección en este equipo.'
  },
  {
    seccion: 'Entorno general',
    target: '#btn-guia-global',
    titulo: 'Esta guía, cuando la necesites',
    icono: '🧑‍🏫',
    descripcion: 'Puedes volver a abrir esta guía en cualquier momento con este botón. Dentro de ella usa <b>← →</b> para avanzar o retroceder y <b>Esc</b> para salir. Al cerrarla, regresas a la pestaña donde estabas.',
    pose: 'saluda'
  },

  /* ---------- Citas disponibles ---------- */
  {
    seccion: 'Citas disponibles',
    tab: 'disponibles',
    target: '#view > .panel.no-print',
    listo: '#d-buscar',
    titulo: 'Citas disponibles: filtros de búsqueda',
    icono: '🗓️',
    descripcion: 'Busca cupos libres por rango <b>Desde / Hasta</b> (por defecto, los próximos 60 días), <b>Clase</b> y <b>Examinador</b>, y pulsa <b>Buscar</b>. Si eliges clase <b>D</b> o <b>A5</b>, solo se muestran los bloques reservados para clases pesadas.'
  },
  {
    seccion: 'Citas disponibles',
    tab: 'disponibles',
    target: '#d-body button[data-id]',
    fallback: '#d-body',
    listo: tourSinCargando('#d-body'),
    titulo: 'Reservar un cupo (Agendar)',
    icono: '✍️',
    descripcion: 'Cada fila es un bloque libre. <b>Agendar</b> abre el formulario de la cita: <b>nombre, RUT</b> (con validación), <b>celular</b>, <b>clase(s)</b> (puedes marcar más de una), <b>correo</b> y el <b>funcionario/a</b> que agenda. Para clases pesadas fuera de su bloque aparece la casilla <b>Forzar</b>. Termina con <b>Confirmar y agendar cita</b>. Si no hay cupos en el rango, amplía la fecha <b>Hasta</b>.'
  },

  /* ---------- Agenda ---------- */
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-fecha',
    titulo: 'Agenda: navegación por fechas',
    icono: '📅',
    descripcion: 'Elige la fecha en el calendario o usa las flechas <b>← →</b> para saltar al día anterior o siguiente con agenda. El botón <b>Hoy</b> te devuelve de inmediato a la jornada actual.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-exam',
    titulo: 'Filtro de examinadores',
    icono: '👤',
    descripcion: 'Ve la grilla con <b>todos</b> los examinadores en columnas paralelas, o selecciona uno para concentrarte en sus citas y cupos.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-libres',
    titulo: 'Contador de bloques libres',
    icono: '🔢',
    descripcion: 'Indica cuántos bloques quedan <b>disponibles para agendar</b> en la fecha (y examinador) que estás viendo.',
    listo: () => { const el = tourQuery('#a-libres'); return !!el && !/^—/.test(el.textContent.trim()); }
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '.vista-selector',
    titulo: 'Vistas vertical y horizontal',
    icono: '📐',
    descripcion: 'Cambia entre la vista clásica en <b>columnas por examinador</b> (vertical) o la <b>vista horizontal continua</b> tipo línea de tiempo. El sistema recuerda tu preferencia.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'La grilla operativa',
    icono: '🗂️',
    descripcion: 'Una columna por examinador y una fila por horario. El horario reservado para clases pesadas se marca con la etiqueta <b>D · A5</b>. Cada examinador muestra cuántas citas tiene ese día. Los bloques libres se ven con un guion (<b>—</b>) y los cupos se reservan desde <b>Citas disponibles</b>.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .slot.ocupada',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Tarjeta de cita',
    icono: '🪪',
    descripcion: 'Cada tarjeta muestra <b>postulante, clase, RUT, funcionario/a, teléfono y correo</b>. El símbolo <b>⚠</b> avisa de datos faltantes o inválidos (RUT, teléfono o correo). Las insignias indican <b>1° o 2° vez</b>, <b>Reagendada</b>, <b>Confirmó asistencia</b> y el <b>resultado</b>. Para ver o editar la ficha completa de una cita (incluida <b>Liberar bloque</b>), usa el buscador global o el Reporte de errores y pulsa <b>Abrir</b>.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .slot-top',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Cuenta regresiva del trámite',
    icono: '⏳',
    descripcion: 'La franja superior de cada tarjeta muestra los <b>días que quedan</b> antes de que venza el trámite (6 meses desde su inicio): <b>verde</b> con más de 30 días, <b>amarillo</b> entre 15 y 30, y <b>rojo parpadeante</b> con 14 días o menos. Si aún no se registró la fecha de inicio, aparece <b>Sin fecha de inicio</b> en gris.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-hist',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Botón Historial: ficha lateral',
    icono: '📋',
    descripcion: 'Abre la <b>ficha lateral</b> del postulante, donde puedes editar sus datos, registrar la <b>Fecha de inicio de trámite</b> (obligatoria, con su cuenta regresiva), la <b>Escuela</b> de conductores (solo clases D y A5) y el <b>Tipo de reagendamiento</b>.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-hist',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Ficha lateral: seguimiento e historial',
    icono: '🗃️',
    descripcion: 'En la misma ficha registras <b>Confirmó asistencia</b>, el <b>Resultado</b> y los <b>Comentarios</b>. Más abajo verás el <b>historial del solicitante</b> con el <b>inicio y término del trámite</b>; si la persona va por su <b>3er intento</b>, el sistema lo advierte. Con <b>Imprimir ficha</b> obtienes una copia en papel.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-wa',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Contacto por WhatsApp',
    icono: '💬',
    descripcion: 'Si la cita tiene un celular válido, el botón <b>WhatsApp</b> abre la conversación con un mensaje institucional ya redactado (fecha, hora y examinador). También verás el teléfono y el correo registrados.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-confirmar',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Confirmar asistencia',
    icono: '✅',
    descripcion: 'Marca que el postulante <b>confirmó su asistencia</b>. Si ya estaba confirmado, el sistema pide confirmación antes de volver a dejarlo como pendiente. Las citas sin confirmar aparecen en la pestaña <b>Por confirmar</b>.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-reagendar',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Derivar a Reagendar',
    icono: '🔄',
    descripcion: 'Envía al postulante a la lista de <b>Reagendar</b> (motivo: solicita cambio) y te lleva a esa pestaña para elegirle un nuevo cupo.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .slot-res',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Resultados: Aprobó, Reprobó, No asistió',
    icono: '🏁',
    descripcion: 'En las citas de <b>hoy o de días pasados</b> aparecen tres botones rápidos: <b>Aprobó</b>, <b>Reprobó</b> y <b>No asistió</b>. El resultado se guarda al instante; si pulsas de nuevo el botón activo, el resultado se <b>borra</b>. En citas futuras estos botones no se muestran.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .slot.bloqueado',
    fallback: '#a-grid',
    listo: TOUR_GRILLA_LISTA,
    titulo: 'Bloques inhabilitados',
    icono: '🔒',
    descripcion: 'Los bloques bloqueados se muestran con el candado y el <b>motivo</b> (licencia, feriado, capacitación, terreno...). No se pueden agendar hasta que se desbloqueen con el botón <b>Desbloquear</b> de arriba.',
    pose: 'alerta'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-bloqdia',
    titulo: 'Bloquear días u horas',
    icono: '🔐',
    descripcion: 'Inhabilita franjas por licencias, feriados, capacitaciones o terreno. En el diálogo eliges <b>Día(s) completo(s)</b> (con <i>Ajustar a semanas completas lun–vie</i>) o <b>Por horas / bloques</b> (chips por hora, rango rápido, Mañana, Mediodía y aplicar a varios días), el <b>examinador</b> (o todos) y el <b>motivo</b>. Con la casilla <b>Incluir bloques que ya tienen cita</b> activa, esos postulantes pasan automáticamente a <b>Reagendar</b> para proteger su cupo.',
    pose: 'alerta'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-desbloqdia',
    titulo: 'Desbloquear días u horas',
    icono: '🔓',
    descripcion: 'Estructura simétrica al bloqueo: reactiva días completos o bloques de horas específicos cuando una ausencia se cancela. Antes de confirmar, el diálogo te informa <b>cuántos bloques se reactivarán</b>.'
  },

  /* ---------- Reagendar ---------- */
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-filtros-origen',
    listo: tourSinCargando('#r-filtros-origen'),
    titulo: 'Reagendar: origen y prioridad',
    icono: '🚨',
    descripcion: 'Reúne a quienes necesitan una nueva hora, ordenados por prioridad: primero los afectados por un <b>bloqueo</b> (urgentes) y luego las <b>solicitudes de cambio</b>. Filtra con <b>Todos</b>, <b>Por bloqueo</b> o <b>Solicitud de cambio</b>; cada botón muestra su contador.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-detalle',
    listo: '#r-detalle .panel',
    titulo: 'Búsqueda de cupos libres',
    icono: '🧭',
    descripcion: 'Define el rango de destino (<b>Destino desde / Hasta</b>) y el <b>examinador</b>, y pulsa <b>Ver bloques libres</b> para explorar qué cupos hay. Al seleccionar a un postulante, este mismo panel pasa a mostrar su cita actual y los cupos donde puede ir.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-tabla-unificada button[data-id]',
    fallback: '#r-tabla-unificada',
    listo: tourSinCargando('#r-tabla-unificada'),
    titulo: 'Reagendar una solicitud de cambio',
    icono: '🔁',
    descripcion: 'Con <b>Reagendar</b> seleccionas al postulante: se abre el panel <b>Reagendamiento en curso</b>. Elige el rango y el examinador, pulsa <b>Ver bloques libres</b> y usa <b>Mover aquí</b> sobre el cupo deseado. <b>Cancelar selección</b> deshace la elección. Si no hay filas, la lista está vacía y no hay nadie pendiente.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-tabla-unificada button[data-cola]',
    fallback: '#r-tabla-unificada',
    listo: tourSinCargando('#r-tabla-unificada'),
    titulo: 'Asignar hora por bloqueo',
    icono: '📌',
    descripcion: 'Para quienes perdieron su cita por un bloqueo: <b>Asignar hora</b> abre la búsqueda de cupos, con un <b>correo opcional</b> para enviar la confirmación. Elige <b>Asignar este cupo</b> y confirma. Las clases pesadas solo ven bloques D/A5.'
  },
  {
    seccion: 'Reagendar',
    tab: 'reagendar',
    target: '#r-tabla-unificada button[data-desc]',
    fallback: '#r-tabla-unificada',
    listo: tourSinCargando('#r-tabla-unificada'),
    titulo: 'Descartar de la lista',
    icono: '🗑️',
    descripcion: '<b>Descartar</b> retira a un postulante de la lista de reagendamiento (pide confirmación). Úsalo cuando ya no corresponde reagendarlo.'
  },

  /* ---------- Lista de espera ---------- */
  {
    seccion: 'Lista de espera',
    tab: 'espera',
    target: '#le-tabla button[data-le]',
    fallback: '#le-tabla',
    listo: tourSinCargando('#le-tabla'),
    titulo: 'Lista de espera: quién espera un cupo',
    icono: '⏱️',
    descripcion: 'Reúne la <b>cola de reagendar</b> y a quienes <b>quieren adelantar</b> su cita, en orden de prioridad. Filtra por origen, clase o texto. <b>Cupos disponibles</b> cuenta los cupos libres compatibles de los próximos 30 días; <b>Buscar cupo</b> los lista y <b>Asignar</b> los agenda (pide confirmación).'
  },

  /* ---------- Por confirmar ---------- */
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-total-badge',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Por confirmar: citas pendientes',
    icono: '📋',
    descripcion: 'Lista a los postulantes citados que <b>aún no confirman asistencia</b>. El contador muestra cuántos hay y <b>↻ Actualizar</b> recarga la lista.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-q',
    titulo: 'Buscar en la lista',
    icono: '🔍',
    descripcion: 'Filtra al instante por <b>RUT, nombre o teléfono</b> mientras escribes.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-rango',
    titulo: 'Rango de fechas',
    icono: '⏳',
    descripcion: 'Elige ver los próximos <b>7, 15 o 30 días</b>, o <b>todas las fechas futuras</b>.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-tbody .btn-wa',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Contactar al postulante',
    icono: '📞',
    descripcion: 'En cada fila tienes el <b>teléfono</b>, el enlace de <b>WhatsApp</b> con un mensaje que pide confirmar o reagendar, y el <b>correo</b>. Si falta el dato, la fila indica <i>Sin teléfono</i> o <i>Sin correo</i>.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-tbody button[data-si]',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Registrar la respuesta',
    icono: '✔️',
    descripcion: '<b>✔ Confirmó</b> registra la asistencia; <b>✖ No asiste</b> registra que no vendrá. En ambos casos la fila sale de la lista de pendientes.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#pc-tbody button[data-reag]',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Derivar a Reagendar',
    icono: '🔄',
    descripcion: '<b>🔄 Reagendar</b> envía al postulante a la lista de Reagendar y abre su panel para asignarle un nuevo cupo.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#btn-enviar-correos-masivos',
    titulo: 'Enviar correos a pendientes',
    icono: '✉️',
    descripcion: 'Envía el <b>enlace de confirmación por correo</b> a todos los postulantes citados que tengan correo registrado (pide confirmación antes). Si el servicio de correo (SMTP) no está activo, solo se generan los enlaces y el sistema te lo avisa.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '#btn-correo-prueba',
    titulo: 'Correo de prueba',
    icono: '🧪',
    descripcion: 'Envía los correos de confirmación de prueba a <b>la dirección que tú indiques</b>, para revisar cómo se ven antes de enviar los reales.'
  },
  {
    seccion: 'Por confirmar',
    tab: 'porconfirmar',
    target: '.pc-toolbar',
    titulo: 'Selección múltiple y envíos por lote',
    icono: '☑️',
    descripcion: 'Marca las <b>casillas</b> de cada fila (o la del encabezado para todas). Luego usa <b>Enviar correo de confirmación</b> para mandar el correo solo a los seleccionados (requiere el servicio de correo SMTP configurado), o <b>WhatsApp a seleccionados</b> para abrir una <b>cola de WhatsApp</b>: cada clic abre wa.me con el mensaje listo, <b>una persona a la vez</b>.'
  },

  /* ---------- Calendario ---------- */
  {
    seccion: 'Calendario',
    tab: 'calendario',
    target: '#cal-cont',
    titulo: 'Calendario mensual',
    icono: '📅',
    descripcion: 'Vista del mes completo: cada día se colorea según su ocupación (<b>verde</b> mucho libre, <b>amarillo</b> medio, <b>rojo</b> lleno, <b>gris</b> feriado o fin de semana). Muestra cuántos cupos quedan libres y la marca <b>12:30 libre</b> cuando hay cupo apto para D/A5. Haz clic en un día para abrirlo en la Agenda.'
  },
  {
    seccion: 'Calendario',
    tab: 'calendario',
    target: '#cal-hoy',
    titulo: 'Cambiar de mes',
    icono: '↔️',
    descripcion: 'Usa las flechas para ir al mes anterior o siguiente, y <b>Hoy</b> para volver al mes actual. Arriba verás el total de cupos libres y el % de ocupación del mes.'
  },

  /* ---------- Agenda del día ---------- */
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-fecha',
    titulo: 'Agenda del día: fecha',
    icono: '🖨️',
    descripcion: 'Informe imprimible de la jornada. Elige la <b>fecha</b> del informe; por defecto es la fecha que estabas viendo en la pestaña Agenda.'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-formato',
    titulo: 'Formato y orientación de la hoja',
    icono: '📄',
    descripcion: 'Selecciona el <b>formato de hoja</b> y, justo al lado, la <b>orientación</b> (vertical u horizontal). Los cambios se aplican de inmediato a la impresión.'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-diseno',
    titulo: 'Diseño del informe',
    icono: '🧩',
    descripcion: 'Imprime a <b>todos los examinadores en una sola hoja</b> o <b>una hoja por examinador/a</b>.'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-print',
    titulo: 'Imprimir informe',
    icono: '🖨️',
    descripcion: 'Abre el cuadro de impresión del navegador con la hoja tal como se ve abajo (la barra de filtros no se imprime). Al lado, <b>Abrir pantalla sala de espera</b> abre una vista para la TV con las citas de hoy (solo iniciales, sin RUT ni datos de contacto), que se actualiza sola cada 30 segundos.'
  },
  {
    seccion: 'Agenda del día',
    tab: 'dia',
    target: '#dd-cont',
    listo: tourSinCargando('#dd-cont'),
    titulo: 'Vista previa del informe',
    icono: '👁️',
    descripcion: 'Así saldrá el informe en papel: las citas del día por examinador. Si la fecha no tiene bloques (fin de semana o feriado), verás un aviso.'
  },

  /* ---------- Por vencer ---------- */
  {
    seccion: 'Por vencer',
    tab: 'vencimientos',
    target: '#ven-filtro',
    titulo: 'Trámites por vencer',
    icono: '⌛',
    descripcion: 'Lista las citas según el vencimiento de su trámite. Filtra por los que vencen en <b>7 días</b> o <b>30 días</b> o menos, los <b>vencidos</b> o <b>todos</b>.'
  },
  {
    seccion: 'Por vencer',
    tab: 'vencimientos',
    target: '#ven-body tr[data-id]',
    fallback: '#ven-body',
    listo: tourSinCargando('#ven-body'),
    titulo: 'Abrir la ficha desde la lista',
    icono: '🖱️',
    descripcion: 'Haz <b>clic en una fila</b> para abrir la ficha del postulante y actualizar sus datos o la fecha de inicio del trámite.'
  },

  /* ---------- Estadísticas ---------- */
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '#view > .panel.no-print',
    listo: '#an-ok',
    titulo: 'Estadísticas: filtro de período',
    icono: '📊',
    descripcion: 'Define el período con <b>Desde / Hasta</b> y pulsa <b>Aplicar filtro</b> para recalcular los indicadores y gráficos.'
  },
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '#an-kpis',
    listo: '#an-kpis .kpi',
    titulo: 'Indicadores (KPI)',
    icono: '🎯',
    descripcion: 'Resumen del período: <b>bloques, bloqueados, citas agendadas, ocupación, aprobación, inasistencia, reagendadas</b>, lista de espera y agendadas hoy.'
  },
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '#view .grid2',
    listo: '#an-kpis .kpi',
    titulo: 'Gráficos',
    icono: '📈',
    descripcion: 'Resultado de exámenes, citas por examinador, por clase, por funcionario/a, tipo de cita, citas por día y agendamientos por día.'
  },
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '.panel:has(#exres-tabla)',
    fallback: '#view .grid2',
    listo: '#an-kpis .kpi',
    titulo: 'Resultados por examinador',
    icono: '🧮',
    descripcion: 'Tabla con <b>Aprobó, Reprobó, No asistió</b> y <b>% de aprobación</b> de cada examinador en el período filtrado.'
  },
  {
    seccion: 'Estadísticas',
    tab: 'analitica',
    target: '.panel:has(#esc-tabla)',
    listo: tourSinCargando('#esc-tabla'),
    titulo: 'Resultados por escuela de conductores',
    icono: '🏫',
    descripcion: 'Muestra, por <b>escuela de conductores</b>, la cantidad de citas, <b>aprobados, reprobados</b> y el <b>% de aprobación</b> (calculado sobre aprobados + reprobados).'
  },

  /* ---------- Jefatura ---------- */
  {
    seccion: 'Jefatura',
    tab: 'jefatura',
    target: '#jf-root',
    listo: '#jf-kpis',
    titulo: 'Tablero de Jefatura',
    icono: '📋',
    descripcion: 'Resumen de una página para la jefatura: <b>citas, ocupación, aprobación e inasistencia</b> con su variación frente al período anterior, la <b>proyección de capacidad</b>, avisos de <b>desbalance de carga</b> entre examinadores, los horarios con más inasistencia y los pendientes. Elige <b>Mes actual</b>, <b>Mes anterior</b> o un <b>Rango</b> y usa <b>Imprimir</b> para obtener una hoja A4.'
  },

  /* ---------- Papelera ---------- */
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#view > .panel',
    listo: '#pap-body',
    titulo: 'Papelera: citas retiradas',
    icono: '🗑️',
    descripcion: 'Guarda las citas que salieron de un bloque al <b>liberarlo, bloquearlo, pisarlo con otra cita o reagendarlo</b>. Se conservan las últimas 200 y se listan las 80 más recientes.',
    pose: 'alerta'
  },
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#pap-body button[data-id]',
    fallback: '#pap-body',
    listo: tourSinCargando('#pap-body'),
    titulo: 'Restaurar una cita',
    icono: '♻️',
    descripcion: '<b>Restaurar</b> devuelve la cita a su bloque original. Solo funciona si ese bloque sigue libre.'
  },
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#pap-body button[data-del]',
    fallback: '#pap-body',
    listo: tourSinCargando('#pap-body'),
    titulo: 'Eliminar una entrada',
    icono: '❌',
    descripcion: '<b>Eliminar</b> borra definitivamente esa entrada (pide confirmación y no se puede deshacer).'
  },
  {
    seccion: 'Papelera',
    tab: 'papelera',
    target: '#pap-vaciar',
    titulo: 'Vaciar la papelera',
    icono: '🧹',
    descripcion: '<b>Vaciar papelera</b> elimina todas las entradas guardadas. Pide confirmación y no se puede deshacer.',
    pose: 'alerta'
  },

  /* ---------- Datos ---------- */
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#im-btn)',
    fallback: '#im-btn',
    listo: '#im-btn',
    titulo: 'Datos: importar desde Excel',
    icono: '📥',
    descripcion: 'Selecciona un archivo <b>.xlsx o .xls</b> y pulsa <b>Importar</b>. Sin marcar <i>Reemplazar todo</i>, el sistema hace un <b>backup antes</b> y fusiona las citas por fecha, hora y examinador. Con la casilla marcada se <b>borra lo actual</b>: úsala con cuidado.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: 'a[href="/api/export"]',
    listo: '#im-btn',
    titulo: 'Exportar a Excel',
    icono: '📤',
    descripcion: 'Descarga las citas en <b>formato dashboard</b> o en el <b>formato Excel original</b> (el segundo botón).'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '#bk-btn',
    listo: '#bk-btn',
    titulo: 'Backup de la base',
    icono: '💾',
    descripcion: '<b>Crear backup de la base</b> guarda una copia de seguridad de todos los datos y te informa el nombre del archivo creado.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#gb-btn)',
    fallback: '#gb-btn',
    listo: '#gb-btn',
    titulo: 'Generar bloques de agenda',
    icono: '🧱',
    descripcion: 'Indica <b>Desde / Hasta</b> y pulsa <b>Generar</b> para crear los bloques que falten (días hábiles, por examinador activo). No pisa lo existente.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#fe-add)',
    fallback: '#fe-add',
    listo: '#fe-add',
    titulo: 'Feriados y días inhábiles',
    icono: '🎌',
    descripcion: 'Agrega un feriado con su fecha (y nombre opcional) o quita uno con la <b>×</b>. Después de cambiarlos, vuelve a generar los bloques del período afectado.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#cat-cont)',
    fallback: '#cat-cont',
    listo: '#cat-cont',
    titulo: 'Listas desplegables',
    icono: '📚',
    descripcion: 'Administra las opciones de los catálogos del sistema (clases, motivos, etc.): agrega un valor nuevo o quítalo con la <b>×</b>. Aquí también agregas las <b>escuelas de conductores</b> y los <b>tipos de reagendamiento</b>: escribe el nombre en la lista correspondiente y pulsa <b>Agregar</b>; quedará disponible de inmediato en la ficha de la cita.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.grid2:has(#ex-cont)',
    fallback: '#ex-cont',
    listo: '#ex-cont',
    titulo: 'Examinadores y funcionarios/as',
    icono: '👥',
    descripcion: 'Agrega nuevas personas y marca o desmarca <b>activo</b> para que aparezcan (o no) en la agenda y en los formularios.'
  },
  {
    seccion: 'Datos',
    tab: 'datos',
    target: '.panel:has(#mov-body)',
    fallback: '#mov-body',
    listo: '#mov-body',
    titulo: 'Últimos movimientos',
    icono: '🕘',
    descripcion: 'Bitácora de acciones recientes: fecha, acción, quién la hizo y el detalle.'
  },

  /* ---------- Reporte de errores ---------- */
  {
    seccion: 'Reporte de errores',
    tab: 'errores',
    target: '#e-refresh',
    listo: '#e-refresh',
    titulo: 'Reporte de errores',
    icono: '⚠️',
    descripcion: 'Revisa la calidad de los datos: citas incompletas, RUT inválido, duplicados, sin teléfono o correo, conflictos de clase en el bloque D/A5, etc. <b>Recalcular</b> actualiza el análisis.',
    pose: 'alerta'
  },
  {
    seccion: 'Reporte de errores',
    tab: 'errores',
    target: '#e-chips',
    listo: '#e-chips .chip',
    titulo: 'Filtrar por tipo de error',
    icono: '🏷️',
    descripcion: 'Cada chip muestra un tipo de hallazgo con su cantidad. Pulsa uno para filtrar la tabla, o <b>Todos</b> para verlos juntos.'
  },
  {
    seccion: 'Reporte de errores',
    tab: 'errores',
    target: '#e-body button[data-id]',
    fallback: '#e-body',
    listo: tourSinCargando('#e-body'),
    titulo: 'Abrir y corregir la cita',
    icono: '🛠️',
    descripcion: '<b>Abrir</b> muestra la ficha de la cita para corregir sus datos o usar <b>Liberar bloque</b> y <b>Reagendar postulante</b>. Si la tabla dice <i>Nada que mostrar</i>, no hay errores. ¡Eso es lo ideal!',
    pose: 'celebra'
  }
];
