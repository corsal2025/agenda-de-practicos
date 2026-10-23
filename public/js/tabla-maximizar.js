/* Boton "Maximizar" sobre cada tabla de #view: la muestra a pantalla completa dentro de la app.
   Esc o el mismo boton la devuelven a su tamano normal. Se agrega solo al renderizar. */
(function () {
  const CLASE_TABLA = 'tabla-maximizada';
  const CLASE_BARRA = 'tabla-barra-max';
  const TEXTO = { on: '⤡ Salir de pantalla completa', off: '⤢ Maximizar' };

  function barraDe(contenedor) {
    const prev = contenedor.previousElementSibling;
    return prev && prev.classList.contains(CLASE_BARRA) ? prev : null;
  }

  function alternar(contenedor, barra) {
    const activar = !contenedor.classList.contains(CLASE_TABLA);
    contenedor.classList.toggle(CLASE_TABLA, activar);
    barra.classList.toggle('tabla-barra-fija', activar);
    barra.querySelector('button').textContent = activar ? TEXTO.on : TEXTO.off;
    document.body.classList.toggle('tabla-max-activa', activar);
  }

  function agregarBotones(view) {
    view.querySelectorAll('.tabla-scroll, .tabla-agenda-card').forEach((c) => {
      if (barraDe(c) || !c.querySelector('table') || !c.parentNode) return;
      const barra = document.createElement('div');
      barra.className = CLASE_BARRA;
      barra.innerHTML = `<button type="button" class="btn chico sec" title="Ver la tabla a pantalla completa">${TEXTO.off}</button>`;
      barra.querySelector('button').onclick = () => alternar(c, barra);
      c.parentNode.insertBefore(barra, c);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const activa = document.querySelector(`.${CLASE_TABLA}`);
    if (!activa) return;
    const barra = barraDe(activa);
    if (barra) alternar(activa, barra);
  });

  // Sin requestAnimationFrame: en pestanas en segundo plano no se ejecuta y el boton no aparece.
  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => agregarBotones(view)).observe(view, { childList: true, subtree: true });
    agregarBotones(view);
  }
})();
