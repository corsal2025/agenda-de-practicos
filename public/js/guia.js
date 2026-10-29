let tourKeyHandler = null;
let tourHashHandler = null;
let tourTabEsperada = null; // pestaña a la que la propia guía acaba de navegar

// Navega a la pestaña de un paso registrando antes cuál espera, para distinguir
// el cambio de pestaña de la guía del que hace el usuario por fuera (Atrás, URL).
function tourNavegar(tab) {
  tourTabEsperada = tab;
  irA(tab);
}

// Si la pestaña cambia a algo distinto de lo que la guía espera, la guía se cierra sola
// (sin devolver al usuario a la pestaña de origen). Al cerrarse deja de escuchar.
function tourVigilarPestana() {
  tourTabEsperada = tourTabActual();
  tourHashHandler = () => {
    if (!document.getElementById('tour-overlay')) return;
    if (tourTabActual() !== tourTabEsperada) cerrarGuiaInteractiva(false);
  };
  window.addEventListener('hashchange', tourHashHandler);
}

function iniciarGuiaInteractiva() {
  const tip = document.getElementById('tooltip-flotante');
  if (tip) tip.classList.remove('visible');
  cerrarGuiaInteractiva(false);
  tourPasoActual = 0;
  tourTabOrigen = tourTabActual();

  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.className = 'tour-overlay';
  overlay.innerHTML = `
    <button class="tour-btn-salir-flotante" id="tour-salir-flotante" title="Terminar y cerrar la guía">
      <span>✕</span> Cerrar guía
    </button>
    <div id="tour-spotlight" class="tour-spotlight"></div>
    <div id="tour-card" class="tour-card">
      <div class="tour-card-header">
        <span class="tour-paso-badge" id="tour-badge">Paso 1 de ${PASOS_TOUR.length}</span>
        <button class="tour-btn-cerrar" id="tour-cerrar" title="Cerrar guía">&times;</button>
      </div>
      <div class="tour-card-body">
        <div class="tour-mascota" id="tour-mascota" aria-hidden="true"></div>
        <div class="tour-card-texto">
          <h3 id="tour-titulo" class="tour-card-titulo"></h3>
          <p id="tour-desc" class="tour-card-desc"></p>
        </div>
      </div>
      <span class="tour-progreso" aria-hidden="true"><i id="tour-prog"></i></span>
      <div class="tour-card-footer">
        <button class="btn chico sec" id="tour-prev">Anterior</button>
        <div class="tour-dots" id="tour-dots"></div>
        <button class="btn chico" id="tour-next">Siguiente</button>
      </div>
      <div id="tour-flecha" class="tour-flecha"></div>
    </div>`;
  document.body.appendChild(overlay);

  const ir = (delta) => {
    const nuevo = tourPasoActual + delta;
    if (nuevo < 0 || nuevo > PASOS_TOUR.length - 1) return;
    tourPasoActual = nuevo;
    renderPasoTour();
  };

  $('#tour-cerrar').onclick = () => cerrarGuiaInteractiva();
  $('#tour-salir-flotante').onclick = () => cerrarGuiaInteractiva();
  overlay.onclick = (e) => {
    if (e.target === overlay) cerrarGuiaInteractiva();
  };

  tourKeyHandler = (e) => {
    if (e.key === 'Escape') cerrarGuiaInteractiva();
    else if (e.key === 'ArrowRight') ir(1);
    else if (e.key === 'ArrowLeft') ir(-1);
  };
  window.addEventListener('keydown', tourKeyHandler);
  tourVigilarPestana();

  $('#tour-prev').onclick = () => ir(-1);
  $('#tour-next').onclick = () => {
    if (tourPasoActual < PASOS_TOUR.length - 1) {
      ir(1);
    } else {
      cerrarGuiaInteractiva();
      toast('¡Guía interactiva completada!', 'ok');
    }
  };

  renderPasoTour(true);
}

// Espera (con tope de tiempo) a que la vista del paso haya renderizado.
function tourEsperar(paso, token) {
  const listo = paso.listo || paso.target;
  const ok = () => (typeof listo === 'function' ? listo() : !!tourQuery(listo));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (token !== tourToken) return resolve(false);
      if (ok() || Date.now() - t0 > 3000) return resolve(true);
      setTimeout(tick, 80);
    };
    tick();
  });
}

async function renderPasoTour(esPrimerRender = false) {
  const token = ++tourToken;
  const paso = PASOS_TOUR[tourPasoActual];
  const card = $('#tour-card');
  const spot = $('#tour-spotlight');
  if (!card || !spot) return;

  // Contenido del paso (se pinta de inmediato; el resaltado llega cuando la vista esté lista)
  $('#tour-badge').textContent = `Paso ${tourPasoActual + 1} de ${PASOS_TOUR.length}`;
  $('#tour-titulo').innerHTML = `<span class="tour-ico">${paso.icono}</span> ${tourPasoActual + 1}. ${paso.titulo}`;
  $('#tour-desc').innerHTML = paso.descripcion;
  // Lico (kit "Lico"): pose del paso; por defecto explica, saluda al inicio y celebra al final
  const poseLico = paso.pose || (tourPasoActual === 0 ? 'saluda' : tourPasoActual === PASOS_TOUR.length - 1 ? 'celebra' : 'explica');
  if (window.Lico) $('#tour-mascota').innerHTML = window.Lico.svg(poseLico, { decorativo: true });
  $('#tour-prog').style.width = `${Math.round(((tourPasoActual + 1) / PASOS_TOUR.length) * 100)}%`;
  $('#tour-prev').disabled = tourPasoActual === 0;

  const esUltimo = tourPasoActual === PASOS_TOUR.length - 1;
  const btnNext = $('#tour-next');
  if (esUltimo) {
    btnNext.textContent = '✔ ¡Finalizar!';
    btnNext.style.background = '#10b981';
    btnNext.style.borderColor = '#059669';
    btnNext.style.color = '#fff';
    btnNext.style.fontWeight = '700';
  } else {
    btnNext.textContent = 'Siguiente';
    btnNext.style.background = '';
    btnNext.style.borderColor = '';
    btnNext.style.color = '';
    btnNext.style.fontWeight = '';
  }

  // Indicador compacto: sección actual y avance dentro de ella
  const delaSeccion = PASOS_TOUR.filter((p) => p.seccion === paso.seccion);
  const enSeccion = delaSeccion.indexOf(paso) + 1;
  $('#tour-dots').innerHTML = `<span class="tour-seccion" title="${esc(paso.seccion)}">${esc(paso.seccion)} <small>${enSeccion}/${delaSeccion.length}</small></span>`;

  // Cambio de pestaña si el paso lo pide (y no estamos ya en ella)
  if (paso.tab && tourTabActual() !== paso.tab) {
    spot.classList.remove('visible');
    tourNavegar(paso.tab);
    await tourPausa(140);
    if (token !== tourToken) return;
  }
  await tourEsperar(paso, token);
  if (token !== tourToken || !$('#tour-card')) return;

  // Desplegar automáticamente paneles de filtros plegados si el elemento a resaltar está dentro de ellos
  const desocultarPaneles = () => {
    const aCampos = document.getElementById('a-campos');
    if (aCampos && aCampos.hidden && paso.target && (paso.target.includes('a-fecha') || paso.target.includes('a-exam') || paso.target.includes('a-campos'))) {
      aCampos.hidden = false;
      const b = document.getElementById('a-plegar');
      if (b) b.setAttribute('aria-expanded', 'true');
      const f = document.getElementById('a-plegar-flecha');
      if (f) f.textContent = '▾';
      const rEl = document.getElementById('a-resumen');
      if (rEl) rEl.hidden = true;
    }
    const dCampos = document.getElementById('d-campos');
    if (dCampos && dCampos.hidden && paso.target && (paso.target.includes('d-desde') || paso.target.includes('d-hasta') || paso.target.includes('d-campos') || paso.target.includes('d-buscar'))) {
      dCampos.hidden = false;
      const b = document.getElementById('d-plegar');
      if (b) b.setAttribute('aria-expanded', 'true');
      const f = b ? b.querySelector('span') : null;
      if (f) f.textContent = '▾';
      const rEl = document.getElementById('d-resumen');
      if (rEl) rEl.hidden = true;
    }
  };
  desocultarPaneles();

  let target = tourQuery(paso.target) || tourQuery(paso.fallback) || tourQuery('.panel-fijo') || view;
  if (!target) return;

  // Si el target está dentro de una tabla o contenedor con scroll horizontal, desplazar para centrarlo
  const scrollHoriz = target.closest ? target.closest('.tabla-agenda-scroll, .tabla-scroll, .panel-scroll') : null;
  if (scrollHoriz) {
    try {
      target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    } catch (_) {}
    try {
      const sRect = scrollHoriz.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      if (tRect.right > sRect.right - 12) {
        scrollHoriz.scrollLeft += Math.round(tRect.right - sRect.right + 48);
      } else if (tRect.left < sRect.left + 12) {
        scrollHoriz.scrollLeft -= Math.round(sRect.left - tRect.left + 48);
      }
    } catch (_) {}
  } else if (target !== view && !target.closest('header.top, #sidebar-modulos')) {
    try {
      target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    } catch (_) {}
  }

  const posicionar = () => {
    if (token !== tourToken) return;
    // Con letra agrandada (zoom en body) las coordenadas del viewport se pasan a unidades locales.
    const Z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    let r0 = target.getBoundingClientRect();
    if (r0.width === 0 && r0.height === 0 && paso.fallback) {
      const alt = tourQuery(paso.fallback);
      if (alt) { target = alt; r0 = target.getBoundingClientRect(); }
    }
    const r = { left: r0.left / Z, top: r0.top / Z, right: r0.right / Z, bottom: r0.bottom / Z, width: r0.width / Z, height: r0.height / Z };
    const flecha = $('#tour-flecha');
    if (!spot || !card) return;

    const vw = window.innerWidth / Z;
    const vh = window.innerHeight / Z;
    // Forzar reflow para medir dimensiones exactas con el contenido recién renderizado
    void card.offsetHeight;
    const cardW = card.offsetWidth || Math.min(520, vw - 32);
    const cardH = card.offsetHeight || 290;
    const pad = 6;

    // Detectar si el elemento es la grilla masiva o está anclado al menú lateral izquierdo
    const esLateralIzquierda = target.id === 'nav' || !!target.closest('#sidebar-modulos') || (r.left < 80 && r.right < vw * 0.35 && r.height > 120);
    const esGrilla = !esLateralIzquierda && (target.id === 'a-grid' || target === view) && (r.height > vh * 0.5);

    if (esPrimerRender) {
      spot.style.transition = 'none';
      card.style.transition = 'none';
    }

    if (esLateralIzquierda) {
      // Elementos laterales como el menú de navegación: spotlight sobre el elemento y tarjeta a su derecha
      spot.style.left = `${Math.max(0, Math.round(r.left - pad))}px`;
      spot.style.top = `${Math.max(0, Math.round(r.top - pad))}px`;
      spot.style.width = `${Math.round(r.width + pad * 2)}px`;
      spot.style.height = `${Math.min(vh - Math.max(0, r.top) - 16, Math.round(r.height + pad * 2))}px`;

      let cardLeft = Math.round(r.right + 20);
      if (cardLeft + cardW > vw - 16) cardLeft = vw - cardW - 16;
      let cardTop = Math.round(r.top + 24);
      if (cardTop + cardH > vh - 20) cardTop = vh - cardH - 20;
      if (cardTop < 20) cardTop = 20;

      card.style.left = `${cardLeft}px`;
      card.style.top = `${cardTop}px`;
      flecha.style.display = 'none';
    } else if (esGrilla) {
      const spotTop = Math.max(12, Math.round(r.top));
      const spotH = Math.min(Math.round(r.height), vh - spotTop - 24);
      spot.style.left = `${Math.max(10, Math.round(r.left - pad))}px`;
      spot.style.top = `${spotTop}px`;
      spot.style.width = `${Math.min(vw - 20, Math.round(r.width + pad * 2))}px`;
      spot.style.height = `${Math.max(120, spotH)}px`;

      card.style.left = `${Math.max(16, Math.round((vw - cardW) / 2))}px`;
      card.style.top = `${Math.round(Math.max(16, (vh - cardH) / 2))}px`;
      flecha.style.display = 'none';
    } else {
      // Spotlight regular sobre el elemento
      spot.style.left = `${Math.max(0, Math.round(r.left - pad))}px`;
      spot.style.top = `${Math.max(0, Math.round(r.top - pad))}px`;
      spot.style.width = `${Math.round(r.width + pad * 2)}px`;
      spot.style.height = `${Math.round(r.height + pad * 2)}px`;

      // Posicionamiento lateral a la izquierda: si el paso lo pide explícitamente o si el target
      // está en el extremo derecho de la pantalla y cabe la tarjeta a la izquierda sin taparlo
      const pideIzquierda = paso.lado === 'izquierda' || paso.posicion === 'izquierda';
      const espacioIzq = r.left;
      const cabeAIzquierda = espacioIzq >= cardW + 20;
      const usarIzquierda = (pideIzquierda && cabeAIzquierda) || (!pideIzquierda && r.left > vw * 0.65 && cabeAIzquierda && r.height < 140);

      if (usarIzquierda) {
        let cardLeft = Math.round(r.left - cardW - 14);
        if (cardLeft < 16) cardLeft = 16;

        let cardTop = Math.round(r.top + (r.height / 2) - (cardH / 2));
        if (cardTop < 16) cardTop = 16;
        if (cardTop + cardH > vh - 16) cardTop = Math.max(16, vh - cardH - 16);

        card.style.left = `${cardLeft}px`;
        card.style.top = `${cardTop}px`;

        flecha.className = 'tour-flecha flecha-derecha';
        const flechaY = Math.max(16, Math.min(cardH - 24, (r.top + r.height / 2) - cardTop - 7));
        flecha.style.top = `${Math.round(flechaY)}px`;
        flecha.style.bottom = '';
        flecha.style.left = '';
        flecha.style.right = '-7px';
        flecha.style.display = 'block';
      } else {
        // Posicionar tarjeta centrada sobre el elemento horizontalmente
        let cardLeft = Math.round(r.left + (r.width / 2) - (cardW / 2));
        if (cardLeft + cardW > vw - 16) cardLeft = vw - cardW - 16;
        if (cardLeft < 16) cardLeft = 16;

        let cardTop = Math.round(r.bottom + 14);
        let flechaArriba = true;

        // Si no cabe abajo, intentar colocar arriba del elemento
        if (cardTop + cardH > vh - 16) {
          cardTop = Math.round(r.top - cardH - 14);
          flechaArriba = false;
        }

        // Si tampoco cabe arriba, ubicar en la zona vertical disponible más despejada
        if (cardTop < 16) {
          cardTop = Math.round(Math.max(16, (vh - cardH) / 2));
        }

        card.style.left = `${cardLeft}px`;
        card.style.top = `${cardTop}px`;

        // Si la tarjeta quedó solapando el elemento (no cupo ni arriba ni abajo con holgura), ocultar flecha
        const solapa = cardTop < r.bottom + 4 && cardTop + cardH > r.top - 4;
        flecha.style.display = solapa ? 'none' : 'block';
        if (!solapa) {
          flecha.className = `tour-flecha ${flechaArriba ? 'flecha-arriba' : 'flecha-abajo'}`;
          const flechaX = Math.max(24, Math.min(cardW - 36, (r.left + r.width / 2) - cardLeft));
          flecha.style.left = `${Math.round(flechaX)}px`;
          flecha.style.right = '';
          flecha.style.top = flechaArriba ? '-7px' : '';
          flecha.style.bottom = flechaArriba ? '' : '-7px';
        }
      }
    }

    if (esPrimerRender) {
      void card.offsetHeight;
      spot.style.transition = '';
      card.style.transition = '';
    }

    spot.classList.add('visible');
    card.classList.add('visible');
  };

  // Zona realmente visible: el encabezado y el panel fijo son sticky y tapan lo que quede debajo.
  const enBarraFija = !!target.closest('header.top, .panel-fijo, .g-head');
  let topVisible = 0;
  if (!enBarraFija) {
    document.querySelectorAll('header.top, .panel-fijo, .g-head').forEach((el) => {
      if (getComputedStyle(el).position === 'sticky') topVisible = Math.max(topVisible, el.getBoundingClientRect().bottom);
    });
    if (topVisible) topVisible += 8;
  }
  const rect = target.getBoundingClientRect();
  const yaVisible = rect.top >= topVisible && rect.bottom <= window.innerHeight;

  if (yaVisible) {
    posicionar();
  } else {
    // Centrar en la zona visible (bajo las barras fijas)
    const grande = rect.height > (window.innerHeight - topVisible) * 0.7;
    const destino = grande
      ? rect.top - topVisible
      : rect.top - topVisible - ((window.innerHeight - topVisible - rect.height) / 2);
    window.scrollBy({ top: destino, behavior: 'auto' });
    setTimeout(posicionar, 80);
  }
}

function cerrarGuiaInteractiva(restaurar = true) {
  tourToken++; // cancela cualquier espera pendiente
  if (tourKeyHandler) {
    window.removeEventListener('keydown', tourKeyHandler);
    tourKeyHandler = null;
  }
  if (tourHashHandler) {
    window.removeEventListener('hashchange', tourHashHandler);
    tourHashHandler = null;
  }
  tourTabEsperada = null;
  const o = document.getElementById('tour-overlay');
  if (o) o.remove();
  // Volver a la pestaña desde la que se abrió la guía
  if (o && restaurar && tourTabOrigen && tourTabActual() !== tourTabOrigen) irA(tourTabOrigen);
  tourTabOrigen = null;
}
