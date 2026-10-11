let tourKeyHandler = null;

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

  // Indicador compacto: sección actual y avance dentro de ella (en lugar de un punto por paso)
  const delaSeccion = PASOS_TOUR.filter((p) => p.seccion === paso.seccion);
  const enSeccion = delaSeccion.indexOf(paso) + 1;
  $('#tour-dots').innerHTML = `<span class="tour-seccion" title="${esc(paso.seccion)}">${esc(paso.seccion)} <small>${enSeccion}/${delaSeccion.length}</small></span>`;

  // Cambio de pestaña si el paso lo pide (y no estamos ya en ella)
  if (paso.tab && tourTabActual() !== paso.tab) {
    spot.classList.remove('visible');
    irA(paso.tab);
    await tourPausa(140);
    if (token !== tourToken) return;
  }
  await tourEsperar(paso, token);
  if (token !== tourToken || !$('#tour-card')) return;

  const target = tourQuery(paso.target) || tourQuery(paso.fallback) || tourQuery('.panel-fijo') || view;
  if (!target) return;

  const posicionar = () => {
    if (token !== tourToken) return;
    const r = target.getBoundingClientRect();
    const flecha = $('#tour-flecha');
    if (!spot || !card) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = card.offsetWidth || Math.min(520, vw - 32);
    const cardH = card.offsetHeight || 290;
    const pad = 6;
    const esGrilla = target.id === 'a-grid' || target === view || r.height > vh * 0.55;

    // Al iniciar el tour (paso 1), desactivar temporalmente transiciones para evitar
    // el salto visible ("pestañeo") desde (0,0) hacia la posición calculada.
    if (esPrimerRender) {
      spot.style.transition = 'none';
      card.style.transition = 'none';
    }

    if (esGrilla) {
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
      flecha.style.display = 'block';

      // Spotlight regular
      spot.style.left = `${Math.max(0, Math.round(r.left - pad))}px`;
      spot.style.top = `${Math.max(0, Math.round(r.top - pad))}px`;
      spot.style.width = `${Math.round(r.width + pad * 2)}px`;
      spot.style.height = `${Math.round(r.height + pad * 2)}px`;

      // Posicionar tarjeta
      let cardLeft = Math.round(r.left + (r.width / 2) - (cardW / 2));
      if (cardLeft + cardW > vw - 16) cardLeft = vw - cardW - 16;
      if (cardLeft < 16) cardLeft = 16;

      let cardTop = Math.round(r.bottom + 14);
      let flechaArriba = true;

      // Si se sale por abajo, poner arriba del elemento
      if (cardTop + cardH > vh - 16) {
        cardTop = Math.round(r.top - cardH - 14);
        flechaArriba = false;
      }

      if (cardTop + cardH > vh - 16) cardTop = vh - cardH - 16;
      if (cardTop < 16) cardTop = 16;

      card.style.left = `${cardLeft}px`;
      card.style.top = `${cardTop}px`;

      // Si la tarjeta quedó encima del elemento (no cabe ni arriba ni abajo), sin flecha
      const solapa = cardTop < r.bottom + 4 && cardTop + cardH > r.top - 4;
      flecha.style.display = solapa ? 'none' : 'block';
      flecha.className = `tour-flecha ${flechaArriba ? 'flecha-arriba' : 'flecha-abajo'}`;
      const flechaX = Math.max(24, Math.min(cardW - 36, (r.left + r.width / 2) - cardLeft));
      flecha.style.left = `${Math.round(flechaX)}px`;
    }

    if (esPrimerRender) {
      // Forzar reflow para que el navegador aplique left/top antes de habilitar transición y opacidad
      void card.offsetHeight;
      spot.style.transition = '';
      card.style.transition = '';
    }

    spot.classList.add('visible');
    card.classList.add('visible');
  };

  // Zona realmente visible: el encabezado y el panel fijo son sticky y tapan lo que quede debajo.
  // Un elemento "dentro del viewport" pero bajo esas barras no se ve, así que se desplaza igual.
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
    // Centrar en la zona visible (bajo las barras fijas), no en todo el viewport
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
  const o = document.getElementById('tour-overlay');
  if (o) o.remove();
  // Volver a la pestaña desde la que se abrió la guía
  if (o && restaurar && tourTabOrigen && tourTabActual() !== tourTabOrigen) irA(tourTabOrigen);
  tourTabOrigen = null;
}
