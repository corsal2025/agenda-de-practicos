// Sugerencias de dominio para los campos de correo: al escribir "@" aparece una lista
// (gmail.com, hotmail.com, outlook.com, yahoo.com) para elegir con el mouse, el touch o el teclado.
(function () {
  const DOMINIOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'];
  // Campos de correo: los de tipo email y el editor de la columna CORREO de la tabla (normal y maximizada)
  const SELECTOR = 'input[type="email"], .celda-edicion[data-campo="correo"] > input';
  const PATRON = /^([^\s@]+)@([^\s@]*)$/;

  let lista = null;
  let campo = null;
  let opciones = [];
  let activa = 0;

  function cerrar() {
    if (lista) lista.remove();
    lista = null;
    campo = null;
    opciones = [];
    activa = 0;
  }

  function coincidencias(parcial) {
    const p = parcial.toLowerCase();
    return DOMINIOS.filter((d) => d.startsWith(p) && d !== p);
  }

  function pintar() {
    if (!lista || !campo) return;
    lista.innerHTML = opciones
      .map((d, i) => `<button type="button" class="correo-dominio${i === activa ? ' activa' : ''}" data-dominio="${d}">${d}</button>`)
      .join('');
  }

  function elegir(dominio) {
    if (!campo) return;
    const usuario = campo.value.split('@')[0];
    const destino = campo;
    destino.value = `${usuario}@${dominio}`;
    destino.dispatchEvent(new Event('input', { bubbles: true }));
    cerrar();
    destino.focus();
  }

  function abrir(input) {
    const m = PATRON.exec(input.value);
    if (!m) return cerrar();
    const sugeridos = coincidencias(m[2]);
    if (!sugeridos.length) return cerrar();
    if (!lista) {
      lista = document.createElement('div');
      lista.className = 'correo-dominios';
      document.body.appendChild(lista);
    }
    campo = input;
    opciones = sugeridos;
    activa = Math.min(activa, opciones.length - 1);
    const r = input.getBoundingClientRect();
    lista.style.top = `${r.bottom + 4}px`;
    lista.style.left = `${r.left}px`;
    lista.style.minWidth = `${Math.max(180, r.width)}px`;
    pintar();
  }

  // Mientras se escribe, actualizar la lista
  document.addEventListener('input', (e) => {
    const input = e.target;
    if (input.matches && input.matches(SELECTOR)) abrir(input);
  });

  // Teclado: flechas para moverse, Enter o Tab para elegir, Escape para cerrar.
  // En captura, para que una lista abierta gane sobre el guardado con Enter del campo.
  document.addEventListener('keydown', (e) => {
    if (!lista || e.target !== campo) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      activa = (activa + (e.key === 'ArrowDown' ? 1 : -1) + opciones.length) % opciones.length;
      pintar();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      elegir(opciones[activa]);
    } else if (e.key === 'Escape') {
      // Sin detener el evento: el campo tambien cancela su edicion
      cerrar();
    }
  }, true);

  // Mouse y touch: elegir una opcion sin que el campo pierda el foco
  document.addEventListener('pointerdown', (e) => {
    if (!lista) return;
    const boton = e.target.closest && e.target.closest('.correo-dominio');
    if (boton) {
      e.preventDefault();
      elegir(boton.dataset.dominio);
      return;
    }
    if (!lista.contains(e.target) && e.target !== campo) cerrar();
  }, true);

  window.addEventListener('resize', cerrar);
})();
