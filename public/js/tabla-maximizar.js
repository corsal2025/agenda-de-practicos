/* Boton "Maximizar" sobre cada tabla de #view: la muestra a pantalla completa dentro de la app.
   Si la tabla tiene un buscador justo encima, el boton va en esa misma fila, a la derecha del buscador.
   Esc o el mismo boton la devuelven a su tamano normal. Se agrega solo al renderizar. */
(function () {
  const CLASE_TABLA = 'tabla-maximizada';
  const CLASE_BARRA = 'tabla-barra-max';
  const TEXTO = { on: '⤡ Salir de pantalla completa', off: '⤢ Maximizar' };

  function crearBoton(contenedor) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn chico sec btn-max-tabla';
    btn.title = 'Ver la tabla a pantalla completa';
    btn.textContent = TEXTO.off;
    btn.onclick = () => alternar(contenedor);
    return btn;
  }

  // Nombre del modulo activo (boton marcado en el menu), para la barra superior de la vista maximizada
  function ponerTitulo(activar) {
    document.querySelectorAll('.tabla-max-titulo').forEach((el) => el.remove());
    if (!activar) return;
    const activo = document.querySelector('nav#nav button.activo');
    if (!activo) return;
    const titulo = document.createElement('span');
    titulo.className = 'tabla-max-titulo';
    // Solo el nombre del modulo (sin el contador del menu, p. ej. "78")
    titulo.textContent = (activo.querySelector('.nav-txt') || activo).textContent.trim();
    document.body.appendChild(titulo);
  }

  // Identifica la tabla maximizada para reconocerla si la vista se vuelve a dibujar (modulo + id de la tabla)
  let claveMax = null;
  let salida = null;
  function claveDe(contenedor) {
    const tabla = contenedor.querySelector('table');
    if (tabla && tabla.id) return `${location.hash}|#${tabla.id}`;
    const todas = [...document.querySelectorAll('#view .tabla-scroll, #view .tabla-agenda-card')];
    return `${location.hash}|n${todas.indexOf(contenedor)}`;
  }

  function alternar(contenedor) {
    const btn = contenedor._btnMax;
    const activar = !contenedor.classList.contains(CLASE_TABLA);
    contenedor.classList.toggle(CLASE_TABLA, activar);
    if (btn) {
      btn.classList.toggle('tabla-btn-fija', activar);
      btn.textContent = activar ? TEXTO.on : TEXTO.off;
    }
    document.body.classList.toggle('tabla-max-activa', activar);
    ponerTitulo(activar);
    claveMax = activar ? claveDe(contenedor) : null;
  }

  // Si la vista se dibuja de nuevo con una tabla maximizada (p. ej. al agendar desde la vista ampliada),
  // la tabla nueva queda maximizada otra vez. Si no aparece una igual, se sale de pantalla completa
  // para no dejar la app tapada por el fondo.
  function restaurarMaximizada(view) {
    if (!document.body.classList.contains('tabla-max-activa') || view.querySelector(`.${CLASE_TABLA}`)) return;
    const nueva = [...view.querySelectorAll('.tabla-scroll, .tabla-agenda-card')]
      .find((c) => c._btnMax && claveDe(c) === claveMax);
    clearTimeout(salida);
    if (nueva) { alternar(nueva); return; }
    salida = setTimeout(() => {
      if (document.querySelector(`.${CLASE_TABLA}`)) return;
      document.body.classList.remove('tabla-max-activa');
      ponerTitulo(false);
      claveMax = null;
    }, 1200);
  }

  // Buscador (input type="search") que queda antes de la tabla, dentro de su misma seccion.
  // Cada buscador sirve a una sola tabla: la primera que le sigue.
  function buscadorDe(contenedor) {
    const previos = [...document.querySelectorAll('#view input[type="search"]')]
      .filter((i) => !contenedor.contains(i) && (i.compareDocumentPosition(contenedor) & Node.DOCUMENT_POSITION_FOLLOWING));
    const buscador = previos[previos.length - 1];
    if (!buscador || buscador._btnMax) return null;
    return buscador;
  }

  // Hijo directo de la fila (.fila) que contiene al buscador: el boton se pone justo antes de el
  function hijoDeFila(buscador) {
    let hijo = buscador;
    while (hijo.parentElement && hijo.parentElement.id !== 'view') {
      if (hijo.parentElement.classList.contains('fila')) return hijo;
      hijo = hijo.parentElement;
    }
    return null;
  }

  // Citas disponibles: el boton va en la fila de filtros, pegado al resumen "· N libres".
  // Agenda: el boton va junto a "Imprimir dia", en la fila pegada a la tabla.
  function filaDeResumen(contenedor) {
    if (contenedor.querySelector('#tabla-disponibles-main')) return document.querySelector('#view .disp-filtros-cab');
    if (contenedor.querySelector('#tabla-agenda-main')) return document.querySelector('#view #a-acciones-dia');
    return null;
  }

  // Fila de cabecera con h2/h3 o barra de acciones en el mismo panel (p. ej. Papelera, Datos, Por confirmar)
  function filaDeCabecera(contenedor) {
    const resumen = filaDeResumen(contenedor);
    if (resumen) return resumen;
    const ant = contenedor.previousElementSibling;
    if (ant && (ant.classList.contains('pc-toolbar') || ant.classList.contains('tabla-toolbar') || ant.classList.contains('fila-acciones'))) {
      return ant;
    }
    const panel = contenedor.closest('.panel');
    if (panel) {
      const filas = [...panel.querySelectorAll('.fila')].filter((f) => {
        return (f.compareDocumentPosition(contenedor) & Node.DOCUMENT_POSITION_FOLLOWING) && !f.querySelector('table');
      });
      if (filas.length) {
        const conTitulo = filas.find((f) => f.querySelector('h2, h3'));
        if (conTitulo) return conTitulo;
        return filas[filas.length - 1];
      }
    }
    return null;
  }

  function agregarBotones(view) {
    // Limpiar botones huerfanos si su contenedor ya no esta en el DOM
    document.querySelectorAll('.btn-max-tabla').forEach((btn) => {
      if (btn._tablaContenedor && !btn._tablaContenedor.isConnected) {
        btn.remove();
      }
    });

    view.querySelectorAll('.tabla-scroll, .tabla-agenda-card').forEach((c) => {
      if (c._btnMax && c._btnMax.isConnected) return;
      if (!c.querySelector('table') || !c.parentNode) return;
      const btn = crearBoton(c);
      c._btnMax = btn;
      btn._tablaContenedor = c;
      const fila = filaDeCabecera(c);
      if (fila) {
        // Si la fila ya tenia un boton de maximizar previo (p. ej. de un re-render de la grilla),
        // eliminarlo para garantizar que quede exactamente UN boton.
        fila.querySelectorAll('.btn-max-tabla').forEach((b) => b.remove());
        btn.classList.add('tabla-btn-en-fila');
        fila.appendChild(btn);
        return;
      }
      const buscador = buscadorDe(c);
      const hijo = buscador && hijoDeFila(buscador);
      // Solo si la fila del buscador queda pegada a la tabla; si hay otros bloques entre ambos, va la barra
      if (hijo && hijo.parentElement.nextElementSibling === c && hijo.previousElementSibling) {
        // Hay filtros antes del buscador (p. ej. prioridad y clase): boton y buscador siguen en su misma linea
        if (hijo.parentElement) hijo.parentElement.querySelectorAll('.btn-max-tabla').forEach((b) => b.remove());
        buscador._btnMax = btn;
        btn.classList.add('tabla-btn-en-fila');
        hijo.parentNode.insertBefore(btn, hijo);
        return;
      }
      if (hijo && hijo.parentElement.nextElementSibling === c) {
        // Buscador y boton en su propia linea: el boton queda a la izquierda del buscador
        if (hijo.parentElement) hijo.parentElement.querySelectorAll('.btn-max-tabla').forEach((b) => b.remove());
        const linea = document.createElement('div');
        linea.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1 1 100%;min-width:0';
        buscador._btnMax = btn;
        btn.classList.add('tabla-btn-en-fila');
        hijo.parentNode.insertBefore(linea, hijo);
        linea.append(btn, hijo);
        return;
      }
      // Sin barra previa ni buscador: barra propia pegada a la tabla, con el boton a la derecha
      if (c.previousElementSibling && c.previousElementSibling.classList.contains(CLASE_BARRA)) {
        c.previousElementSibling.remove();
      }
      const barra = document.createElement('div');
      barra.className = CLASE_BARRA;
      barra.appendChild(btn);
      c.parentNode.insertBefore(barra, c);
    });
  }

  // Escape sale de la vista maximizada, salvo que haya un formulario abierto (ese lo cierra Escape)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('#modal-root .modal')) return;
    const activa = document.querySelector(`.${CLASE_TABLA}`);
    if (activa) alternar(activa);
  }, true);

  // Un solo scroll vertical: cada tabla ocupa el alto libre de la pantalla (desde donde empieza hasta
  // el borde inferior). Si tiene mas filas, se desplaza dentro de su marco y la pagina casi no se mueve.
  // En celular (modo tarjeta) no se limita el alto.
  const MOVIL = window.matchMedia('(max-width: 600px)');
  function ajustarAltura(contenedor) {
    if (contenedor.classList.contains(CLASE_TABLA)) return;
    if (MOVIL.matches) { contenedor.style.removeProperty('--tabla-alto'); return; }
    const main = document.getElementById('view');
    const arriba = contenedor.getBoundingClientRect().top + window.scrollY;
    const reserva = (parseFloat(getComputedStyle(main).paddingBottom) || 0)
      + (parseFloat(getComputedStyle(contenedor).marginBottom) || 0) + 16;
    let libre = Math.floor(window.innerHeight - arriba - reserva);
    // Tabla que empieza bajo el pliegue (paginas con varios paneles): al llegar a ella tiene casi toda la pantalla
    if (libre < 360) libre = Math.max(360, window.innerHeight - 160);
    // Con letra agrandada (zoom en body) los px del CSS se amplian: se divide entre el zoom
    const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
    contenedor.style.setProperty('--tabla-alto', `${Math.floor(libre / zoom)}px`);
  }
  // Alto del encabezado: la barra de desplazamiento empieza justo debajo de el
  function ajustarCabecera(contenedor) {
    const cab = contenedor.querySelector('thead');
    // Donde termina el encabezado medido desde el borde interior del marco (con decimales: con zoom o
    // pantallas escaladas no es un entero, y los bordes colapsados lo corren una fraccion de pixel)
    if (!cab) return;
    const zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const fin = cab.getBoundingClientRect().bottom - (contenedor.getBoundingClientRect().top + contenedor.clientTop);
    const h = `${fin / zoom}px`;
    contenedor.style.setProperty('--cab-alto', h);
    contenedor.style.setProperty('--thead-h', h);
  }
  function ajustarAlturas(view) {
    view.querySelectorAll('.tabla-scroll, .tabla-agenda-card').forEach(ajustarAltura);
    view.querySelectorAll('.tabla-scroll, .tabla-agenda-scroll').forEach(ajustarCabecera);
  }

  // Sin requestAnimationFrame: en pestanas en segundo plano no se ejecuta y el boton no aparece.
  const view = document.getElementById('view');
  if (view) {
    let pendiente = null;
    const programarAjuste = () => {
      clearTimeout(pendiente);
      pendiente = setTimeout(() => ajustarAlturas(view), 120);
    };
    new MutationObserver(() => { agregarBotones(view); restaurarMaximizada(view); programarAjuste(); }).observe(view, { childList: true, subtree: true });
    window.addEventListener('resize', programarAjuste);
    MOVIL.addEventListener('change', programarAjuste);
    agregarBotones(view);
    programarAjuste();
  }
})();
