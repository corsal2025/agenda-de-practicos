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

  function alternar(contenedor) {
    const btn = contenedor._btnMax;
    const activar = !contenedor.classList.contains(CLASE_TABLA);
    contenedor.classList.toggle(CLASE_TABLA, activar);
    btn.classList.toggle('tabla-btn-fija', activar);
    btn.textContent = activar ? TEXTO.on : TEXTO.off;
    document.body.classList.toggle('tabla-max-activa', activar);
  }

  // Fila con buscador justo encima de la tabla: el boton se pone a la derecha del buscador.
  function filaConBuscador(contenedor) {
    const prev = contenedor.previousElementSibling;
    if (!prev || !prev.querySelector('input[type="search"]')) return null;
    return getComputedStyle(prev).display === 'flex' ? prev : null;
  }

  function agregarBotones(view) {
    view.querySelectorAll('.tabla-scroll, .tabla-agenda-card').forEach((c) => {
      if (c._btnMax || !c.querySelector('table') || !c.parentNode) return;
      const btn = crearBoton(c);
      c._btnMax = btn;
      const fila = filaConBuscador(c);
      if (fila) {
        btn.classList.add('tabla-btn-en-fila');
        fila.appendChild(btn);
        return;
      }
      const barra = document.createElement('div');
      barra.className = CLASE_BARRA;
      barra.appendChild(btn);
      c.parentNode.insertBefore(barra, c);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const activa = document.querySelector(`.${CLASE_TABLA}`);
    if (activa) alternar(activa);
  });

  // Sin requestAnimationFrame: en pestanas en segundo plano no se ejecuta y el boton no aparece.
  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => agregarBotones(view)).observe(view, { childList: true, subtree: true });
    agregarBotones(view);
  }
})();
