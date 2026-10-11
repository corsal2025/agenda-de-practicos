const tabs = {
  agenda: renderAgenda, disponibles: renderDisponibles, reagendar: renderReagendar, espera: () => renderListaEspera(),
  porconfirmar: renderPorConfirmar,
  buscar: renderBuscar, errores: renderErrores, dia: renderDia, analitica: renderAnalitica,
  papelera: renderPapelera, datos: renderDatos, vencimientos: renderVencimientos,
  examinador: () => window.renderExaminador(),
  calendario: renderCalendario,
  jefatura: renderJefatura,
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

/* menu "Más" del nav: pestañas de uso ocasional (accesible con teclado) */
(function navMas() {
  const btn = document.getElementById('nav-mas-btn');
  const menu = document.getElementById('nav-mas-menu');
  if (!btn || !menu) return;
  const items = () => [...menu.querySelectorAll('button[data-tab]')];
  const posicionar = () => {
    const r = btn.getBoundingClientRect();
    const ancho = menu.offsetWidth || 220;
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)))}px`;
  };
  const abierto = () => btn.getAttribute('aria-expanded') === 'true';
  const cerrar = (foco) => {
    if (!abierto()) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (foco) btn.focus();
  };
  const abrir = (idx = 0) => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    posicionar();
    const it = items();
    if (idx != null && it.length) it[(idx + it.length) % it.length].focus();
  };
  btn.onclick = () => (abierto() ? cerrar(false) : abrir(null));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); abrir(0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); abrir(-1); }
    else if (e.key === 'Escape') cerrar(true);
  });
  menu.addEventListener('keydown', (e) => {
    const it = items();
    const i = it.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); cerrar(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); it[(i + 1) % it.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); it[(i - 1 + it.length) % it.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); it[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); it[it.length - 1].focus(); }
    else if (e.key === 'Tab') cerrar(false);
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('button[data-tab]')) cerrar(false); });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#nav-mas')) cerrar(false); });
  window.addEventListener('resize', () => cerrar(false));
  document.getElementById('nav')?.addEventListener('scroll', () => cerrar(false), { passive: true });
  // El boton "Más" se marca activo si la pestaña actual esta dentro del menu.
  const marcar = () => {
    const tab = (location.hash.slice(1) || '').split('?')[0];
    btn.classList.toggle('activo', items().some((b) => b.dataset.tab === tab));
  };
  window.addEventListener('hashchange', marcar);
  marcar();
  // Insignia del "Más" = suma de las insignias de las pestañas del menu.
  const badge = document.getElementById('badge-mas');
  const sumar = () => {
    let n = 0;
    menu.querySelectorAll('.nav-badge').forEach((b) => {
      if (b.hidden) return;
      const v = parseInt(b.textContent, 10);
      if (v > 0) n += v;
    });
    badge.textContent = n > 99 ? '99+' : n ? String(n) : '';
    badge.hidden = !n;
  };
  new MutationObserver(sumar).observe(menu, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  sumar();
})();

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

