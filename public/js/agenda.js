/* ================= tab: AGENDA ================= */
let estadoAgenda = { fecha: null, examinador_id: '', filtro: '' };
async function renderAgenda() {
  if (!estadoAgenda.fecha) estadoAgenda.fecha = await fechaInicialAgenda();
  view.innerHTML = `
    <div class="panel no-print panel-fijo">
      <div class="fila" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:flex-end;gap:6px">
          <button class="btn sec" id="dia-prev" style="padding:.45rem .65rem" title="Día anterior">&#8592;</button>
          <div class="campo"><label>Fecha</label><input type="date" id="a-fecha" value="${estadoAgenda.fecha}"></div>
          <button class="btn sec" id="dia-next" style="padding:.45rem .65rem" title="Día siguiente">&#8594;</button>
          <button class="btn sec" id="a-hoy">Hoy</button>
          <div class="campo"><label>Examinador</label>
            <select id="a-exam"><option value="">Todos</option>
              ${META.examinadores.filter((e) => e.activo).map((e) => `<option value="${e.id}" ${String(e.id) === String(estadoAgenda.examinador_id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="pastilla" id="a-libres" data-tooltip="Total de horas disponibles para agendar en la fecha seleccionada">— bloques libres</span>
          <div class="vista-selector" title="Elegir modalidad de visualización de la Agenda">
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'tabla') === 'tabla' ? 'activo' : ''}" id="btn-vista-tabla" title="Vista en tabla con columnas (distribución corporativa en columnas)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm1 2v2h14V4H1zm0 3v2h14V7H1zm0 3v2h14v-2H1zm0 3v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1H1z"/></svg>
              <span>Tabla</span>
            </button>
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'tabla') === 'vertical' ? 'activo' : ''}" id="btn-vista-vertical" title="Vista vertical por examinador">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2zm7 0a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V2z"/></svg>
              <span>Vertical</span>
            </button>
            <button type="button" class="btn-vista ${(estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'tabla') === 'horizontal' ? 'activo' : ''}" id="btn-vista-horizontal" title="Vista horizontal continua (Línea de tiempo hacia el lado)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm0 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3z"/></svg>
              <span>Horizontal</span>
            </button>
          </div>
          
          <button class="btn btn-bloq-accion" id="a-bloqdia" data-tooltip="Inhabilita franjas horarias por licencias, feriados, capacitaciones o terreno (envía citas a Reagendar)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Bloquear
          </button>
          <button class="btn btn-desbloq-accion" id="a-desbloqdia" data-tooltip="Libera y reactiva bloques previamente bloqueados para volver a citar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
            Desbloquear
          </button>
          <span class="agenda-acciones-dia" id="a-acciones-dia" style="display:inline-flex;gap:6px;flex-wrap:wrap">
            <button class="btn sec" id="a-imprimir" type="button" data-tooltip="Imprime la agenda de la fecha y examinador seleccionados, ordenada por hora">🖨 Imprimir día</button>
          </span>
        </div>
      </div>
    </div>
    <div class="panel"><div id="a-grid">Cargando...</div></div>`;

  $('#a-fecha').onchange = (e) => { estadoAgenda.fecha = e.target.value; renderAgenda(); };
  $('#a-exam').onchange = (e) => { estadoAgenda.examinador_id = e.target.value; renderAgenda(); };
  $('#dia-prev').onclick = async () => { estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, -1); renderAgenda(); };
  $('#dia-next').onclick = async () => { estadoAgenda.fecha = await proximoDiaConAgenda(estadoAgenda.fecha, 1); renderAgenda(); };
  $('#a-hoy').onclick = async () => { estadoAgenda.fecha = await fechaInicialAgenda(); renderAgenda(); };
  $('#a-bloqdia').onclick = () => dialogoBloquearDia();
  $('#a-desbloqdia').onclick = () => dialogoDesbloquearDia();
  $('#a-imprimir').onclick = () => dialogoImprimirDia(estadoAgenda.fecha, estadoAgenda.examinador_id);
  if ($('#a-porconfirmar')) $('#a-porconfirmar').onclick = () => irA('porconfirmar');
  const btnT = $('#btn-vista-tabla');
  const btnV = $('#btn-vista-vertical');
  const btnH = $('#btn-vista-horizontal');
  if (btnT) {
    btnT.onclick = () => {
      estadoAgenda.modoVista = 'tabla';
      localStorage.setItem('agenda_modo_vista', 'tabla');
      renderAgenda();
    };
  }
  if (btnV) {
    btnV.onclick = () => {
      estadoAgenda.modoVista = 'vertical';
      localStorage.setItem('agenda_modo_vista', 'vertical');
      renderAgenda();
    };
  }
  if (btnH) {
    btnH.onclick = () => {
      estadoAgenda.modoVista = 'horizontal';
      localStorage.setItem('agenda_modo_vista', 'horizontal');
      renderAgenda();
    };
  }


  const q = new URLSearchParams({ fecha: estadoAgenda.fecha });
  if (estadoAgenda.examinador_id) q.set('examinador_id', estadoAgenda.examinador_id);
  const fecha = estadoAgenda.fecha;
  await cargarVista('agenda', `/agenda?${q}`, (filas) => {
    const libres = filas.filter((f) => !f.rut && !f.nombre && !f.bloqueado).length;
    $('#a-libres').textContent = `${libres} ${libres === 1 ? 'bloque libre' : 'bloques libres'}`;
    pintarGrilla($('#a-grid'), filas, fecha);
    restaurarScroll();
    setTimeout(ajustarOffsetsFijos, 0);
  });
  actualizarBadgePapelera();
  if (window.ListaEspera) window.ListaEspera.badge();
  actualizarBadgeErrores();
  actualizarBadgeReagendar();
  actualizarBadgePorConfirmar();
}

async function dialogoPorConfirmar() { irA('porconfirmar'); return;

  const hasta = sumarDias(hoy(), 7);
  const rows = (await api('/agenda?estado=porconfirmar'))
    .filter((r) => r.fecha <= hasta);
  modal('Citas por confirmar (proximos 7 dias)', `
    <div class="ancho tabla-scroll"><table><thead><tr><th class="c">Fecha</th><th class="c">Hora</th><th>Nombre</th><th>Teléfono</th><th>Correo</th><th class="c"></th></tr></thead>
    <tbody id="pc-body">${rows.length ? rows.map((r) => `<tr data-id="${r.id}">
      <td class="c">${esc(fFecha(r.fecha))}</td><td class="c">${esc(r.hora)}</td><td>${esc(nom(r.nombre))}</td>
      <td class="c num">${esc(fTel(r.contacto))}</td><td>${esc(r.correo)}</td>
      <td><button class="btn chico" data-si="${r.id}">Confirmo</button>
          <button class="btn chico sec" data-no="${r.id}">No</button></td></tr>`).join('')
      : licoVacioFila(6, 'celebra', '¡Nada por confirmar!', 'Todo en orden por aquí.')}</tbody></table></div>
  `, `<button class="btn sec" id="pc-cerrar">Cerrar</button>`);
  $('#pc-cerrar').onclick = () => { cerrarModal(); recargar(renderAgenda)(); };
  const marcar = async (id, val) => {
    const b = await api(`/agenda/${id}`);
    await api(`/agenda/${id}`, { method: 'PUT', body: {
      visto_en: b.actualizado_en, rut: b.rut, nombre: b.nombre, clase: b.clase,
      contacto: b.contacto, correo: b.correo, tipo_cita: b.tipo_cita,
      motivo_reagendamiento: b.motivo_reagendamiento, lista_espera: b.lista_espera,
      intento: b.intento, funcionario_id: b.funcionario_id, fecha_inicio_tramite: b.fecha_inicio_tramite,
      resultado: b.resultado, comentarios: b.comentarios, confirmo_asistencia: val,
      // El servidor los reinicia si faltan: se reenvian para no perder la marca de "pendiente de reagendar".
      pendiente_reagendar: b.pendiente_reagendar, pendiente_nota: b.pendiente_nota,
    } });
    const tr = $(`#pc-body tr[data-id="${id}"]`);
    if (tr) tr.remove();
    toast(val ? 'Confirmada' : 'Marcada como no confirma');
  };
  $('#pc-body').querySelectorAll('button[data-si]').forEach((el) => { el.onclick = () => marcar(Number(el.dataset.si), 1); });
  $('#pc-body').querySelectorAll('button[data-no]').forEach((el) => { el.onclick = () => marcar(Number(el.dataset.no), 0); });
}

// Bloquea todos los bloques de un examinador (o de todos) en un rango de fechas:
// permisos administrativos, licencias, feriado legal, compensatorios, etc.
