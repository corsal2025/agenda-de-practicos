// Altura de las tablas: cada caja llega hasta el borde inferior de la ventana, sin hueco
// sobre la barra de tareas. Las tablas maximizadas (tabla-maximizar.js) conservan su altura.
(function () {
  const MARGEN_INFERIOR = 12;
  const ALTURA_MINIMA = 160;
  const SELECTOR_CAJAS = '#view .tabla-scroll, #view .tabla-agenda-scroll';

  function ajustarAlturas() {
    document.querySelectorAll(SELECTOR_CAJAS).forEach((caja) => {
      if (caja.closest('.tabla-maximizada')) return;
      // Espacio que el marco ocupa debajo de la caja (barra lateral y bordes de la Agenda)
      const marco = caja.closest('.tabla-agenda-card') || caja;
      const bajoLaCaja = marco.getBoundingClientRect().bottom - caja.getBoundingClientRect().bottom;
      const disponible = window.innerHeight - caja.getBoundingClientRect().top - bajoLaCaja - MARGEN_INFERIOR;
      // Si la tabla queda muy abajo (poco espacio), se usa la altura normal de la hoja de estilos
      caja.style.maxHeight = disponible < ALTURA_MINIMA ? '' : `${Math.floor(disponible)}px`;
    });
  }

  let pendiente = false;
  function programarAjuste() {
    if (pendiente) return;
    pendiente = true;
    setTimeout(() => {
      pendiente = false;
      ajustarAlturas();
    }, 0);
  }

  window.addEventListener('resize', programarAjuste);
  window.addEventListener('hashchange', programarAjuste);
  const vista = document.getElementById('view');
  if (vista) new MutationObserver(programarAjuste).observe(vista, { childList: true, subtree: true });
  programarAjuste();
})();
