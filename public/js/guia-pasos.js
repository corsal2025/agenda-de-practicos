/* ================= GUÍA INTERACTIVA / SIMULADOR ================= */
// Cada paso: { seccion, tab?, target, fallback?, listo?, titulo, icono, descripcion, pose? }
//  - tab: pestaña que se abre (tourNavegar) antes de apuntar al target.
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

const PASOS_TOUR = [
  /* ---------- Entorno general ---------- */
  {
    seccion: 'Entorno general',
    target: '#nav',
    titulo: 'Pestañas y módulos principales',
    icono: '🧭',
    descripcion: 'Desde aquí accedes a todos los módulos: <b>Citas disponibles</b>, <b>Agenda</b>, <b>Lista de espera</b>, <b>Confirmaciones</b>, <b>Por vencer</b>, <b>Estadísticas</b>, <b>Jefatura</b>, <b>Papelera</b>, <b>Reporte de errores</b> y <b>Ajustes</b>. Los números de color junto a algunas pestañas son avisos pendientes. Esta guía los recorre uno por uno.'
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
    target: '.disp-filtros',
    fallback: '#view > .panel.no-print',
    listo: '#d-buscar',
    titulo: 'Citas disponibles: filtros de búsqueda',
    icono: '🗓️',
    descripcion: 'Busca cupos libres por rango <b>Desde / Hasta</b> (por defecto, los próximos 60 días), <b>Clase</b> y <b>Examinador</b>, y pulsa <b>Buscar</b>. Las citas se agrupan ordenadamente por bloques de fecha (línea azul marino) y bloques de hora (línea celeste). Si eliges clase <b>D</b> o <b>A5</b>, solo se muestran los bloques reservados para clases pesadas.'
  },
  {
    seccion: 'Citas disponibles',
    tab: 'disponibles',
    target: '#d-body .btn-agendar-tabla, #d-body button[data-id]',
    fallback: '#tabla-disponibles-main',
    listo: tourSinCargando('#d-body'),
    titulo: 'Reservar un cupo (+ Agendar)',
    icono: '✍️',
    descripcion: 'Cada fila es un bloque libre. <b>+ Agendar</b> abre de inmediato el formulario: <b>nombre, RUT</b> (con validación y autoformato), <b>celular</b>, <b>clase(s)</b> (puedes marcar más de una) y <b>correo</b>. No requiere elegir usuario, el control lo gestiona el sistema. Para clases pesadas fuera de su horario aparece la casilla <b>Forzar</b>. Termina con <b>Confirmar y agendar cita</b>.'
  },

  /* ---------- Agenda ---------- */
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-fecha',
    fallback: '.agenda-toolbar',
    listo: '#a-fecha',
    titulo: 'Agenda: navegación por fechas',
    icono: '📅',
    descripcion: 'Elige la fecha en el calendario o usa las flechas <b>← →</b> para saltar al día anterior o siguiente con agenda. El botón <b>Hoy</b> te devuelve de inmediato a la jornada actual.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-exam',
    fallback: '.agenda-toolbar',
    titulo: 'Filtro de examinadores',
    icono: '👤',
    descripcion: 'Ve la grilla con <b>todos</b> los examinadores en columnas paralelas, o selecciona uno para concentrarte en sus citas y cupos.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid .btn-agendar-tabla, #a-grid tr.fila-libre',
    fallback: '#a-grid',
    titulo: 'Cupos libres y agendamiento rápido',
    icono: '⚡',
    descripcion: 'En la grilla diaria, los bloques libres tienen el botón <b>+ Agendar cita</b> para citar al instante con apertura directa del diálogo y validación automática de RUT y teléfono.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid tr.fila-ocupada td.td-nombre, #a-grid tr.fila-ocupada td.td-rut, #a-grid td.td-nombre, #a-grid td.td-rut',
    fallback: '#a-grid',
    listo: tourSinCargando('#a-grid'),
    titulo: 'Edición rápida en planilla',
    icono: '✏️',
    descripcion: 'En las citas agendadas, puedes hacer <b>clic directo sobre cualquier celda</b> (nombre, RUT, teléfono, correo) para editar los datos en línea al instante, con protección contra modificaciones simultáneas.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid tr.fila-ocupada .td-tipo-cita select, #a-grid .td-tipo-cita select, #a-grid th.th-tipo-cita, #a-grid .td-tipo-cita',
    fallback: '#a-grid th.th-tipo-cita, #a-grid',
    listo: tourSinCargando('#a-grid'),
    titulo: 'Tipo de cita y reagendamientos',
    icono: '🏷️',
    descripcion: 'La columna <b>TIPO DE CITA</b> permite clasificar cada cupo al instante (<i>NORMAL</i>, <i>REAGENDAMIENTO PRESENCIAL</i>, <i>LLAMADA</i>, <i>CORREO</i> o <i>POR NOSOTROS</i>). Al cambiar la opción en el selector, el estado se guarda automáticamente.'
  },
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-grid tr.fila-ocupada .accion-celda-wrap, #a-grid .accion-celda-wrap, #a-grid .td-accion .btn-tabla-liberar, #a-grid th.th-accion, #a-grid th.th-acciones',
    fallback: '#a-grid th.th-accion, #a-grid th.th-acciones, #a-grid',
    listo: tourSinCargando('#a-grid'),
    titulo: 'Acciones de cita y sobrecupos automáticos',
    icono: '👥',
    descripcion: 'Cada cita cuenta con botones rápidos: <b>liberar cupo (🗑️)</b>, <b>derivar a Lista de espera (🔄)</b> y <b>agregar otra persona en la misma hora (👤+)</b>. Si se cancela la creación o se libera la hora extra, el sobrecupo se elimina automáticamente sin dejar filas vacías huérfanas.',
    lado: 'izquierda'
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
    target: '#a-bloqdia',
    titulo: 'Bloquear días u horas',
    icono: '🔐',
    descripcion: 'Inhabilita franjas por licencias, feriados, capacitaciones o terreno. En el diálogo eliges <b>Día(s) completo(s)</b> o <b>Por horas / bloques</b>, el <b>examinador</b> y el <b>motivo</b>. Con la casilla <b>Incluir bloques que ya tienen cita</b> activa, esos postulantes pasan automáticamente a <b>Lista de espera</b>.',
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
  {
    seccion: 'Agenda',
    tab: 'agenda',
    target: '#a-imprimir',
    fallback: '#a-acciones-dia',
    titulo: 'Imprimir el día',
    icono: '🖨️',
    descripcion: '<b>Imprimir día</b> genera el informe de la fecha y examinador seleccionados, ordenado cronológicamente por hora (eliges formato, orientación y diseño: hoja unificada o una por examinador/a).'
  },

  /* ---------- Lista de espera ---------- */
  {
    seccion: 'Lista de espera',
    tab: 'espera',
    target: '#le-tabla button[data-le], #le-tabla tr',
    fallback: '#le-tabla',
    listo: tourSinCargando('#le-tabla'),
    titulo: 'Lista de espera: quién espera un cupo',
    icono: '⏱️',
    descripcion: 'Reúne la <b>cola de reagendar</b> y a quienes <b>quieren adelantar</b> su cita, ordenados por prioridad. Filtra por origen, clase o texto. <b>Cupos disponibles</b> cuenta los cupos libres compatibles de los próximos 30 días; <b>Buscar cupo</b> los lista y <b>Asignar</b> los agenda de inmediato.'
  },

  /* ---------- Confirmaciones (antes Por confirmar) ---------- */
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#pc-total-badge',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Confirmaciones: citas pendientes',
    icono: '📋',
    descripcion: 'Lista a los postulantes citados que <b>aún no confirman asistencia</b>. El contador muestra cuántos hay y <b>↻ Actualizar</b> recarga la lista al instante.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#pc-q',
    titulo: 'Buscar en la lista',
    icono: '🔍',
    descripcion: 'Filtra al instante por <b>RUT, nombre o teléfono</b> mientras escribes.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#pc-rango',
    titulo: 'Rango de fechas',
    icono: '⏳',
    descripcion: 'Elige ver los próximos <b>7, 15 o 30 días</b>, o <b>todas las fechas futuras</b>.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#pc-tbody .btn-sms',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Contactar al postulante',
    icono: '📞',
    descripcion: 'En cada fila tienes el <b>teléfono</b>, el enlace de <b>SMS</b> con un mensaje que pide confirmar o reagendar, y el <b>correo</b> institucional.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#pc-tbody button[data-si]',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Registrar la respuesta',
    icono: '✔️',
    descripcion: '<b>✔ Confirmó</b> registra la asistencia; <b>✖ No asiste</b> registra que no vendrá. En ambos casos la fila sale de la lista de pendientes.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#pc-tbody button[data-reag]',
    fallback: '#pc-tbody',
    listo: tourSinCargando('#pc-total-badge'),
    titulo: 'Derivar a Lista de espera',
    icono: '🔄',
    descripcion: '<b>🔄 Reagendar</b> envía al postulante a la Lista de espera y abre su panel para asignarle un nuevo cupo compatible.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#btn-enviar-correos-masivos',
    titulo: 'Enviar correos a pendientes',
    icono: '✉️',
    descripcion: 'Envía el <b>enlace de confirmación por correo</b> a todos los postulantes citados que tengan correo registrado (pide confirmación antes). Si el servicio de correo SMTP no está activo, solo se generan los enlaces y el sistema te lo avisa.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '#btn-correo-prueba',
    titulo: 'Correo de prueba',
    icono: '🧪',
    descripcion: 'Envía los correos de confirmación de prueba a <b>la dirección que tú indiques</b>, para revisar cómo se ven antes de enviar a postulantes reales.'
  },
  {
    seccion: 'Confirmaciones',
    tab: 'porconfirmar',
    target: '.pc-toolbar',
    titulo: 'Selección múltiple y envíos por lote',
    icono: '☑️',
    descripcion: 'Marca las <b>casillas</b> de cada fila (o la del encabezado para todas). Luego usa <b>Enviar correo de confirmación</b> para mandar el correo solo a los seleccionados, o <b>SMS a seleccionados</b> para abrir una <b>cola de SMS</b> asistida.'
  },

  /* ---------- Por vencer ---------- */
  {
    seccion: 'Por vencer',
    tab: 'vencimientos',
    target: '#ven-filtro',
    titulo: 'Trámites por vencer',
    icono: '⌛',
    descripcion: 'Lista las citas según el vencimiento de su trámite. Filtra por los que vencen en <b>7 días</b>, <b>30 días</b>, los <b>vencidos</b> o <b>todos</b>.'
  },
  {
    seccion: 'Por vencer',
    tab: 'vencimientos',
    target: '#ven-body button[data-prioridad]',
    fallback: '#ven-body',
    listo: tourSinCargando('#ven-body'),
    titulo: 'Dar prioridad en Lista de espera',
    icono: '🖱️',
    descripcion: 'Usa el botón <b>Dar prioridad en lista de espera</b> de cada fila para que ese postulante aparezca de inmediato en la pestaña <b>Lista de espera</b> y se le pueda asignar un cupo libre.'
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
    titulo: 'Gráficos analíticos',
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
    fallback: '#view .grid2',
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

  /* ---------- Reporte de errores (posición 9 en el menú) ---------- */
  {
    seccion: 'Reporte de errores',
    tab: 'errores',
    target: '#e-refresh',
    listo: '#e-refresh',
    titulo: 'Reporte de errores: calidad de datos',
    icono: '⚠️',
    descripcion: 'Revisa la calidad de los datos: citas incompletas, RUT inválido, duplicados, sin teléfono o correo, y conflictos de clase en el bloque D/A5. <b>Recalcular</b> actualiza el análisis en tiempo real.',
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
    target: '#e-body .btn-err-editar, #e-body button[data-id]',
    fallback: '#e-body',
    listo: tourSinCargando('#e-body'),
    titulo: 'Abrir y corregir la cita',
    icono: '🛠️',
    descripcion: '<b>✏️ Editar</b> corrige los datos en la misma planilla, <b>🗑️ Liberar</b> deja el cupo libre y <b>🔄 Espera</b> envía al postulante a la Lista de espera. Si la tabla dice <i>Nada que mostrar</i>, no hay errores. ¡Eso es lo ideal!',
    pose: 'celebra'
  },

  /* ---------- Ajustes (posición 10 en el menú, antes Datos) ---------- */
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: '#im-btn',
    fallback: '.panel:has(#im-btn)',
    listo: '#im-btn',
    titulo: 'Ajustes: importar desde Excel',
    icono: '📥',
    descripcion: 'Selecciona un archivo <b>.xlsx o .xls</b> y pulsa <b>Importar</b>. Sin marcar <i>Reemplazar todo</i>, el sistema hace un <b>backup previo automático</b> y fusiona las citas por fecha, hora y examinador. Con la casilla marcada se <b>borra lo actual</b>: úsala con cuidado.'
  },
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: 'a[href*="/api/export"]',
    fallback: '.panel:has(#im-btn)',
    listo: '#im-btn',
    titulo: 'Exportar a Excel',
    icono: '📤',
    descripcion: 'Descarga las citas en <b>formato Excel completo (Todos los datos)</b>, en <b>formato dashboard</b> o en el <b>formato Excel original</b> según lo que necesites.'
  },
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: '#bk-btn',
    listo: '#bk-btn',
    titulo: 'Backup de la base',
    icono: '💾',
    descripcion: '<b>Crear backup de la base</b> guarda una copia de seguridad SQLite con respaldo de transacciones activas y te informa el nombre del archivo creado.'
  },
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: '#gb-btn',
    fallback: '.panel:has(#gb-btn)',
    listo: '#gb-btn',
    titulo: 'Generar bloques de agenda',
    icono: '🧱',
    descripcion: 'Indica <b>Desde / Hasta</b> y pulsa <b>Generar</b> para crear los bloques que falten (días hábiles, por examinador activo). Respeta lo existente y no pisa citas ya creadas.'
  },
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: '.panel:has(#fe-add)',
    fallback: '#fe-add',
    listo: '#fe-add',
    titulo: 'Feriados y días inhábiles',
    icono: '🎌',
    descripcion: 'Agrega un feriado con su fecha (y nombre opcional), sincroniza con feriados oficiales o quita uno con la <b>×</b>. Después de cambiarlos, vuelve a generar los bloques del período afectado.'
  },
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: '.panel:has(#cat-cont)',
    fallback: '#cat-cont',
    listo: '#cat-cont',
    titulo: 'Listas desplegables y catálogos',
    icono: '📚',
    descripcion: 'Administra las opciones de los catálogos del sistema (clases, motivos de bloqueo, etc.). Aquí también agregas las <b>escuelas de conductores</b> y los <b>tipos de reagendamiento</b>: pulsa <b>Agregar</b> y quedarán disponibles de inmediato en la ficha de la cita.'
  },
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: '.grid2:has(#ex-cont), .panel:has(#ex-cont)',
    fallback: '#ex-cont',
    listo: '#ex-cont',
    titulo: 'Examinadores y funcionarios/as',
    icono: '👥',
    descripcion: 'Agrega nuevas personas y marca o desmarca <b>activo</b> para que aparezcan (o no) en la agenda y en los formularios.'
  },
  {
    seccion: 'Ajustes',
    tab: 'datos',
    target: '.panel:has(#mov-body)',
    fallback: '#mov-body',
    listo: '#mov-body',
    titulo: 'Últimos movimientos',
    icono: '🕘',
    descripcion: 'Bitácora de auditoría con las acciones recientes: fecha y hora exacta, acción ejecutada, quién la realizó y el detalle de los cambios.'
  }
];
