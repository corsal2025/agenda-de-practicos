// Chips de licencia: marca la seleccion con una clase (.marcada) para que se vea
// tambien en navegadores sin soporte de :has. La casilla sigue siendo la fuente de verdad.
(function () {
  function sincronizar(raiz) {
    raiz.querySelectorAll('.chk-clase').forEach((etiqueta) => {
      const casilla = etiqueta.querySelector('input[type="checkbox"]');
      if (casilla) etiqueta.classList.toggle('marcada', casilla.checked);
    });
  }

  document.addEventListener('change', (e) => {
    const etiqueta = e.target.closest && e.target.closest('.chk-clase');
    if (etiqueta && e.target.type === 'checkbox') etiqueta.classList.toggle('marcada', e.target.checked);
  });

  const modal = document.getElementById('modal-root');
  if (modal) {
    new MutationObserver(() => sincronizar(modal)).observe(modal, { childList: true, subtree: true });
    sincronizar(modal);
  }
})();
