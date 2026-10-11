// Tablas responsivas: en celular cada fila se muestra como tarjeta.
// Copia el texto de cada <th> al atributo data-label de sus celdas.
(function () {
  const EXCLUIR = '.tabla-heat, .hd-tabla, .no-responsiva';
  function etiquetar(tabla) {
    if (tabla.matches(EXCLUIR)) return;
    const ths = tabla.tHead ? [...tabla.tHead.rows[0]?.cells || []] : [];
    if (!ths.length) return;
    tabla.classList.add('tabla-responsiva');
    const nombres = ths.map((th) => th.textContent.trim());
    for (const tb of tabla.tBodies) {
      for (const tr of tb.rows) {
        let i = 0;
        for (const td of tr.cells) {
          const n = nombres[i] || '';
          if (n && td.getAttribute('data-label') !== n) td.setAttribute('data-label', n);
          if (!n || td.colSpan > 1) td.classList.add('sin-label');
          i += td.colSpan || 1;
        }
      }
    }
  }
  let pendiente = false;
  function procesar() {
    pendiente = false;
    document.querySelectorAll('table').forEach(etiquetar);
  }
  function programar() {
    if (pendiente) return;
    pendiente = true;
    setTimeout(procesar, 30); // setTimeout: rAF se pausa en pestanas en segundo plano
  }
  function iniciar() {
    procesar();
    new MutationObserver(programar).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
