/* ================= funcionario/a temporal (sesion del navegador) =================
   Sin login propio (ver auth-app-padre): mientras la app padre no este conectada,
   cada navegador elige una vez por sesion quien esta agendando. Modulo aislado y
   facil de borrar cuando exista login real: este archivo + la etiqueta <script> en
   index.html + las pocas lineas que lo usan en editor-cita.js. */
(function () {
  const CLAVE = 'agenda_funcionario_id';

  // El funcionario elegido en esta sesion, o null si no hay ninguno elegido o si el
  // guardado ya no es un funcionario activo (nunca cae de vuelta al "primero activo").
  function actual() {
    let guardado;
    try { guardado = sessionStorage.getItem(CLAVE); } catch (_) { return null; }
    if (!guardado) return null;
    const id = Number(guardado);
    return (META && META.funcionarios || []).find((f) => f.id === id && f.activo) || null;
  }

  function elegir(id) {
    try { sessionStorage.setItem(CLAVE, String(id)); } catch (_) { /* sesion no disponible */ }
  }

  function olvidar() {
    try { sessionStorage.removeItem(CLAVE); } catch (_) { /* sesion no disponible */ }
  }

  // Muestra un selector con los funcionarios activos y resuelve con el elegido (o null
  // si se cancela). No usa el modal principal: así se puede abrir encima de un formulario
  // ya abierto (por ejemplo, al entrar a "Agendar nueva cita" sin funcionario elegido).
  function elegirModal() {
    return new Promise((resolver) => {
      const activos = ((META && META.funcionarios) || []).filter((f) => f.activo);
      const ov = h(`<div class="overlay" style="z-index:1100">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="fs-titulo" style="max-width:420px">
          <header><h3 id="fs-titulo">¿Quién está agendando?</h3></header>
          <div class="cuerpo">
            <p class="muted">Elige tu nombre. Se recordará mientras tengas esta pestaña abierta.</p>
            <select id="fs-select" style="width:100%;padding:.5rem .6rem;border:1px solid var(--linea);border-radius:6px">
              <option value="">-- Selecciona --</option>
              ${activos.map((f) => `<option value="${f.id}">${esc(f.nombre)}</option>`).join('')}
            </select>
          </div>
          <footer>
            <button type="button" class="btn sec" id="fs-cancelar">Cancelar</button>
            <button type="button" class="btn" id="fs-confirmar">Continuar</button>
          </footer>
        </div></div>`);
      const terminar = (v) => { ov.remove(); resolver(v); };
      ov.querySelector('#fs-cancelar').onclick = () => terminar(null);
      ov.querySelector('#fs-confirmar').onclick = () => {
        const id = Number(ov.querySelector('#fs-select').value);
        const elegido = activos.find((f) => f.id === id);
        if (!elegido) return;
        elegir(elegido.id);
        terminar(elegido);
      };
      ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); terminar(null); } });
      document.body.appendChild(ov);
    });
  }

  window.FuncionarioSesion = { actual, elegir, olvidar, elegirModal };
})();
