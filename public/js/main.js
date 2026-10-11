const tabs = {
  agenda: renderAgenda, disponibles: renderDisponibles, reagendar: renderReagendar, espera: () => renderListaEspera(),
  porconfirmar: renderPorConfirmar,
  buscar: renderBuscar, errores: renderErrores, dia: renderDia, analitica: renderAnalitica,
  papelera: renderPapelera, datos: renderDatos, vencimientos: renderVencimientos,
  examinador: () => window.renderExaminador(),
  calendario: renderCalendario,
};
/* ================= arranque ================= */
async function init({ forzarAgenda = false } = {}) {
  try {
    META = await api('/meta');
    MARCA = { logo: META.logo, organismo: META.organismo || MARCA.organismo, unidad: META.unidad || MARCA.unidad };
    $('#marca').innerHTML = MARCA.logo
      ? `${logoHtml('escudo')}<span class="marca-txt"><span class="marca-titulo">Agenda de Prácticos</span></span>`
      : `${ESCUDO_FALLBACK}<span class="marca-txt">
          <span class="marca-org">${esc(MARCA.organismo)} · ${esc(MARCA.unidad)}</span>
          <span class="marca-titulo">Agenda de Prácticos</span></span>`;
    const r = META.rango_agenda || {};
    $('#estado').innerHTML = `${r.desde ? `Agenda ${fFecha(r.desde)} – ${fFecha(r.hasta)} · ` : ''}hoy ${fFecha(META.hoy)}`;
    // Al abrir el sistema siempre parte en Agenda, aunque la
    // URL guardada traiga otra pestaña (#datos, etc.). Solo un F5 conserva la actual.
    // replaceState no dispara hashchange, asi la vista no se dibuja dos veces.
    const esRecarga = performance.getEntriesByType('navigation')[0]?.type === 'reload';
    const curTab = (location.hash.slice(1) || '').split('?')[0];
    if (forzarAgenda || (!tabs[curTab] && !location.hash)) history.replaceState(null, '', '#disponibles');
    ruta();
    actualizarBadgePapelera();
    actualizarBadgeErrores();
    actualizarBadgePorConfirmar();
  } catch (e) {
    view.innerHTML = `<div class="panel"><h2>No se pudo conectar</h2><p>${esc(e.message)}</p></div>`;
  }
}
document.querySelectorAll('#nav button[data-tab]').forEach((b) => { b.onclick = () => irA(b.dataset.tab); });

/* tema claro / oscuro */
(function tema() {
  const btn = document.getElementById('tema');
  try {
    const g = localStorage.getItem('agenda-tema');
    if (g) document.documentElement.dataset.tema = g;
  } catch (_) { /* ignore */ }
  const pinta = () => { btn.textContent = document.documentElement.dataset.tema === 'oscuro' ? '☀' : '☾'; };
  pinta();
  btn.onclick = () => {
    const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
    document.documentElement.dataset.tema = nuevo;
    try { localStorage.setItem('agenda-tema', nuevo); } catch (_) { /* ignore */ }
    pinta();
    if ((location.hash.slice(1) || 'agenda') === 'analitica') renderAnalitica();
  };
})();

const btnGuiaGlobal = document.getElementById('btn-guia-global');
if (btnGuiaGlobal) {
  btnGuiaGlobal.onclick = () => iniciarGuiaInteractiva(); // el primer paso decide la pestaña
}

init();


/* ================= INICIALIZACIÓN DE TOOLTIPS ================= */
function iniciarTooltipsGlobales() {
  let tip = document.getElementById('tooltip-flotante');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tooltip-flotante';
    tip.className = 'tooltip-flotante';
    document.body.appendChild(tip);
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) {
      tip.classList.remove('visible');
      return;
    }
    const texto = el.getAttribute('data-tooltip');
    if (!texto) return;
    tip.textContent = texto;
    tip.classList.add('visible');

    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    if (left < 10) left = 10;
    if (left + tipRect.width > window.innerWidth - 10) left = window.innerWidth - tipRect.width - 10;
    let top = rect.bottom + 8;
    if (top + tipRect.height > window.innerHeight - 8) {
      top = rect.top - tipRect.height - 8;
      tip.classList.add('pos-arriba');
    } else {
      tip.classList.remove('pos-arriba');
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (el && !e.relatedTarget?.closest('[data-tooltip]')) {
      tip.classList.remove('visible');
    }
  });
}

// Iniciar tooltips
iniciarTooltipsGlobales();

