/* Vista movil del examinador (#examinador): registrar resultados en terreno.
 * Se carga antes de app.js; usa sus helpers (api, esc, toast, marcarResultado,
 * cuentaRegresivaHtml, telWaDe, mensajeWaCita...) solo en tiempo de ejecucion. */
(function () {
  const LS_EXAM = 'movil.examinador_id';
  const LS_AVISO = 'movil.aviso_cerrado';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

  const estado = { fecha: null };
  const ETIQ = { APROBADO: 'Aprobó', REPROBADO: 'Reprobó', 'NO ASISTIO': 'No asistió' };
  const esNoAsiste = (r) => r === 'NO ASISTIO' || r === 'REPROBADO INASISTENCIA';
  const ocupada = (b) => !!(b.rut || b.nombre);

  function intentoTxt(i) {
    const s = String(i || '').toUpperCase();
    if (!s) return '';
    if (s.includes('1') || s.includes('PRIMERA')) return '1° vez';
    if (s.includes('2') || s.includes('SEGUNDA')) return '2° vez';
    return s;
  }

  function tarjeta(b, examNombre) {
    if (b.bloqueado) {
      return `<div class="mv-card mv-bloq"><span class="mv-hora">${esc(b.hora)}</span><span>Bloqueado${b.bloqueo_motivo ? ` · ${esc(b.bloqueo_motivo)}` : ''}</span></div>`;
    }
    const tel = telWaDe(b.contacto);
    const cuenta = b.dias_restantes_tramite != null ? cuentaRegresivaHtml(b.dias_restantes_tramite, b.fecha_vencimiento_tramite) : SIN_INICIO_HTML;
    const conf = b.confirmo_asistencia === 1 ? '<span class="badge aprob">Confirmó asistencia</span>'
      : b.confirmo_asistencia === 0 ? '<span class="badge reprob">No confirmó</span>'
        : '<span class="badge noasiste">Sin confirmar</span>';
    const it = intentoTxt(b.intento);
    const btn = (r, cls) => {
      const on = r === 'NO ASISTIO' ? esNoAsiste(b.resultado) : b.resultado === r;
      return `<button type="button" class="mv-res ${cls}${on ? ' on' : ''}" data-r="${r}" aria-pressed="${on}">${ETIQ[r]}</button>`;
    };
    return `<div class="mv-card${b.resultado ? ' mv-hecha' : ''}" data-id="${Number(b.id)}">
      <div class="mv-fila"><span class="mv-hora">${esc(b.hora)}</span>${cuenta}</div>
      <div class="mv-nombre">${esc(nom(b.nombre) || '(SIN NOMBRE)')}</div>
      <div class="mv-sub">${clasesTagsHtml(b.clase)} <span class="num">${esc(b.rut || 'sin RUT')}</span>${it ? ` <span class="badge">${esc(it)}</span>` : ''} ${conf}</div>
      ${b.comentarios ? `<div class="mv-com">${esc(b.comentarios)}</div>` : ''}
      <div class="mv-btns">${btn('APROBADO', 'mv-a')}${btn('REPROBADO', 'mv-r')}${btn('NO ASISTIO', 'mv-n')}</div>
      ${tel ? `<div class="mv-contacto">
        <a class="btn mv-link" href="tel:+${esc(tel)}">Llamar</a>
        <a class="btn mv-link" target="_blank" rel="noopener" href="https://wa.me/${esc(tel)}?text=${encodeURIComponent(mensajeWaCita(b, examNombre))}">WhatsApp</a>
      </div>` : ''}
    </div>`;
  }

  function progreso(cont) {
    const cards = [...cont.querySelectorAll('.mv-card[data-id]')];
    const hechas = cards.filter((c) => c.querySelector('.mv-res.on')).length;
    const el = document.getElementById('mv-prog');
    if (el) el.textContent = cards.length ? `${hechas} de ${cards.length} con resultado` : '';
  }

  async function cargar() {
    const cont = document.getElementById('mv-lista');
    const exId = document.getElementById('mv-ex').value;
    document.getElementById('mv-fecha').value = estado.fecha;
    document.getElementById('mv-dia').textContent = fFecha(estado.fecha);
    if (!exId) { cont.innerHTML = '<p class="mv-vacio">Elige un examinador.</p>'; progreso(cont); return; }
    cont.innerHTML = '<p class="mv-vacio">Cargando…</p>';
    const exNombre = (META.examinadores.find((e) => String(e.id) === exId) || {}).nombre || '';
    try {
      const filas = await api(`/agenda?fecha=${encodeURIComponent(estado.fecha)}&examinador_id=${encodeURIComponent(exId)}`);
      const visibles = (filas || []).filter((b) => b.bloqueado || ocupada(b));
      cont.innerHTML = visibles.length ? visibles.map((b) => tarjeta(b, exNombre)).join('') : '<p class="mv-vacio">Sin citas este día.</p>';
    } catch (e) {
      cont.innerHTML = `<p class="mv-vacio">${esc(e.message)}</p>`;
    }
    progreso(cont);
  }

  async function alPulsar(btn) {
    const card = btn.closest('.mv-card');
    const cont = document.getElementById('mv-lista');
    const id = Number(card.dataset.id);
    const quitar = btn.classList.contains('on');
    const antes = [...card.querySelectorAll('.mv-res.on')];
    const pintar = (activos) => {
      card.querySelectorAll('.mv-res').forEach((s) => { const on = activos.includes(s); s.classList.toggle('on', on); s.setAttribute('aria-pressed', String(on)); });
      card.classList.toggle('mv-hecha', activos.length > 0);
      progreso(cont);
    };
    pintar(quitar ? [] : [btn]);
    try {
      await marcarResultado(id, quitar ? null : btn.dataset.r);
      toast(quitar ? 'Resultado borrado' : `Marcado: ${ETIQ[btn.dataset.r]}`);
    } catch (e) {
      pintar(antes);
      toast(e.message, 'err');
    }
  }

  function renderExaminador() {
    if (!estado.fecha) estado.fecha = hoy();
    const guardado = lsGet(LS_EXAM) || '';
    const activos = META.examinadores.filter((e) => e.activo);
    view.innerHTML = `<section class="mv">
      <div class="mv-cab">
        <label class="mv-lbl">Examinador
          <select id="mv-ex"><option value="">-- elegir --</option>${activos.map((e) => `<option value="${Number(e.id)}" ${String(e.id) === guardado ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select>
        </label>
        <div class="mv-fechas">
          <button type="button" class="btn mv-nav" id="mv-prev" aria-label="Día anterior">‹</button>
          <input type="date" id="mv-fecha" aria-label="Fecha">
          <button type="button" class="btn mv-nav" id="mv-next" aria-label="Día siguiente">›</button>
        </div>
        <div class="mv-meta"><span id="mv-dia"></span> · <span id="mv-prog" aria-live="polite"></span></div>
      </div>
      <div id="mv-lista"></div>
    </section>`;
    const sel = document.getElementById('mv-ex');
    sel.onchange = () => { lsSet(LS_EXAM, sel.value); cargar(); };
    document.getElementById('mv-prev').onclick = () => { estado.fecha = sumarDias(estado.fecha, -1); cargar(); };
    document.getElementById('mv-next').onclick = () => { estado.fecha = sumarDias(estado.fecha, 1); cargar(); };
    document.getElementById('mv-fecha').onchange = (ev) => { if (ev.target.value) { estado.fecha = ev.target.value; cargar(); } };
    document.getElementById('mv-lista').addEventListener('click', (ev) => {
      const b = ev.target.closest('.mv-res');
      if (b) alPulsar(b);
    });
    cargar();
  }

  // Aviso en Agenda para pantallas chicas (se puede cerrar y no vuelve a salir).
  function trasRuta(tab) {
    document.body.classList.toggle('vista-movil', tab === 'examinador');
    document.getElementById('mv-aviso')?.remove();
    if (tab !== 'agenda' || window.innerWidth >= 600 || lsGet(LS_AVISO)) return;
    const av = document.createElement('div');
    av.id = 'mv-aviso';
    av.className = 'mv-aviso';
    av.innerHTML = '<span>¿Estás en terreno? Usa la vista para examinadores.</span> <a href="#examinador" class="btn">Abrir</a> <button type="button" class="btn" aria-label="Cerrar aviso">×</button>';
    av.querySelector('button').onclick = () => { lsSet(LS_AVISO, '1'); av.remove(); };
    view.prepend(av);
  }

  window.renderExaminador = renderExaminador;
  window.Movil = { trasRuta };
})();
