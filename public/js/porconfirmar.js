/* ================= tab: POR CONFIRMAR ================= */
async function renderPorConfirmar() {
  view.innerHTML = `
    <div class="panel">
      <div class="fila" style="justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" style="color:#f59e0b">
              <rect x="3" y="3" width="14" height="14" rx="2"/>
              <path d="M6.5 10l2.5 2.5 5-5"/>
            </svg>
            Citas por confirmar asistencia
          </h2>
          <p class="muted" style="margin:0;font-size:13px">
            Postulantes citados en los próximos días que aún no confirman asistencia. Contacta telefónicamente o por correo y registra directamente su respuesta.
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="pastilla" id="pc-total-badge" style="font-weight:700">Cargando...</span>
          <button class="btn sec chico" id="pc-refrescar" title="Actualizar lista">↻ Actualizar</button>
          <button class="btn chico" id="btn-enviar-correos-masivos" title="Enviar enlace de confirmación por correo a todos los pendientes">✉ Enviar correos a pendientes</button>
          <button class="btn chico sec" id="btn-correo-prueba" style="color:var(--azul);font-weight:600" title="Enviar correos de prueba dirigidos a tu correo">🧪 Prueba a mi correo</button>
          <span class="muted" id="pc-correo-modo" style="font-size:12px">${(() => { const m = (META && META.correo && META.correo.modo) || 'ninguno'; return m === 'outlook' ? 'Correo: vía Outlook' : m === 'smtp' ? 'Correo: vía SMTP' : 'Correo: no configurado'; })()}</span>
        </div>
      </div>
      <div class="fila" style="margin-top:1rem;gap:12px;align-items:flex-end">
        <div class="campo" style="flex:1;min-width:240px">
          <label for="pc-q">Buscar en la lista (RUT, nombre o teléfono)</label>
          <input type="search" id="pc-q" placeholder="Escribe para filtrar al instante..." autocomplete="off">
        </div>
        <div class="campo" style="min-width:180px">
          <label for="pc-rango">Rango de fechas</label>
          <select id="pc-rango">
            <option value="7" selected>Próximos 7 días</option>
            <option value="15">Próximos 15 días</option>
            <option value="30">Próximos 30 días</option>
            <option value="todos">Todas las fechas futuras</option>
          </select>
        </div>
      </div>
    </div>

    <div class="panel" id="pc-respuestas" style="margin-top:.75rem">
      <div class="fila" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:15px">✉ Respuestas por correo</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="pastilla" id="pc-resp-aplicadas">Aplicadas hoy: …</span>
          <span class="pastilla" id="pc-resp-revisar">Por revisar: …</span>
        </div>
      </div>
      <p class="muted" id="pc-resp-liberar" style="margin:.5rem 0 0;font-size:12.5px" hidden></p>
      <div id="pc-resp-lista" style="margin-top:.5rem"></div>
    </div>

    <div class="panel" style="margin-top:.75rem">
      <div class="pc-toolbar">
        <span class="pastilla" id="pc-sel-info">0 seleccionados</span>
        <button class="btn chico" id="pc-mail-sel" title="Envía el correo con los enlaces para confirmar, rechazar o reagendar">✉ Enviar correo de confirmación</button>
        <button class="btn chico sec" id="pc-wa-sel" title="Abre una cola para escribir por WhatsApp uno a uno">💬 WhatsApp a seleccionados</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-porconfirmar thead-fijo">
          <thead>
            <tr>
              <th class="c pc-chk"></th>
              <th class="c">Fecha</th>
              <th class="c">Hora</th>
              <th>Postulante</th>
              <th class="c">RUT</th>
              <th class="c">Clase</th>
              <th class="c">Teléfono</th>
              <th>Correo</th>
              <th class="c">Gestión de asistencia</th>
            </tr>
          </thead>
          <tbody id="pc-tbody">
            <tr><td colspan="9" class="c muted" style="padding:2rem">Cargando citas por confirmar...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  let citasCargadas = [];
  let visibles = [];
  const seleccion = new Set();

  // Sin seleccion, las acciones masivas aplican a todas las filas visibles.
  const objetivo = () => (seleccion.size ? visibles.filter((r) => seleccion.has(r.id)) : visibles);
  const pintarSeleccion = () => {
    const n = seleccion.size;
    $('#pc-sel-info').textContent = `${n} ${n === 1 ? 'seleccionado' : 'seleccionados'}`;
    $('#pc-mail-sel').textContent = n ? '✉ Enviar correo de confirmación' : `✉ Enviar correo de confirmación a todos (${visibles.length})`;
    $('#pc-wa-sel').textContent = n ? '💬 WhatsApp a seleccionados' : `💬 WhatsApp a todos (${visibles.length})`;
    $('#pc-mail-sel').disabled = $('#pc-wa-sel').disabled = !visibles.length;
  };

  const pintarLista = () => {
    const q = ($('#pc-q').value || '').trim().toLowerCase();
    const filtradas = citasCargadas.filter((r) => {
      if (!q) return true;
      const nomP = (r.nombre || '').toLowerCase();
      const rutP = (r.rut || '').toLowerCase();
      const telP = (r.contacto || '').toLowerCase();
      return nomP.includes(q) || rutP.includes(q) || telP.includes(q);
    });

    visibles = filtradas;
    for (const id of [...seleccion]) if (!filtradas.some((r) => r.id === id)) seleccion.delete(id);
    pintarSeleccion();
    if (filtradas.length && !q) pcTeniaPendientes = true;
    $('#pc-total-badge').textContent = `${filtradas.length} ${filtradas.length === 1 ? 'cita pendiente' : 'citas pendientes'}`;

    if (!filtradas.length) {
      $('#pc-tbody').innerHTML = q
        ? licoVacioFila(9, 'explica', 'Sin coincidencias', 'No se encontraron postulantes que coincidan con la búsqueda.')
        : licoVacioFila(9, 'celebra', '¡Todo al día!', 'No hay citas pendientes de confirmación en este rango. Lico aprueba esta gestión.');
      if (!q && pcTeniaPendientes) licoConfeti($('#pc-tbody'));
      pcTeniaPendientes = false;
      return;
    }

    $('#pc-tbody').innerHTML = filtradas.map((r) => {
      const telWa = telWaDe(r.contacto);
      const mensajeWa = mensajeWaCita(r, r.examinador, 'Por favor confírmanos si podrás asistir o si necesitas reagendar tu hora para otra fecha.');
      const mensajeSms = mensajeSmsCita(r, r.examinador, 'Por favor confírmanos si podrás asistir o si necesitas reagendar tu hora.');
      const correoTxt = String(r.correo || '').trim();

      return `
      <tr data-id="${r.id}">
        <td class="c pc-chk"><input type="checkbox" data-sel="${r.id}" ${seleccion.has(r.id) ? 'checked' : ''} aria-label="Seleccionar"></td>
        <td class="c nw"><b>${esc(fFecha(r.fecha))}</b></td>
        <td class="c nw"><b>${esc(r.hora)}</b></td>
        <td class="pc-nombre"><b>${esc(nom(r.nombre) || '(Sin nombre)')}</b></td>
        <td class="c num nw" style="font-weight:600">${esc(r.rut || '-')}</td>
        <td class="c">${r.clase ? clasesTagsHtml(r.clase) : '<span class="muted">-</span>'}</td>
        <td class="c num nw">
          ${r.contacto ? `
            <span class="pc-tel">
              <a href="tel:${esc(r.contacto)}" style="text-decoration:none;font-weight:600;color:var(--azul)">📞 ${esc(fTel(r.contacto))}</a>
              ${telWa ? `<a href="sms:+${telWa}?body=${encodeURIComponent(mensajeSms)}" class="btn-sms" title="Enviar mensaje de texto SMS para confirmar o reagendar"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:2px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> SMS</a>` : ''}
            </span>
          ` : '<span class="muted">Sin teléfono</span>'}
        </td>
        <td class="pc-correo">
          ${correoOk(correoTxt)
            ? `<a href="mailto:${esc(correoTxt)}" style="color:var(--azul)" title="${esc(correoTxt)}">${esc(correoTxt)}</a>`
            : (correoTxt ? `<span class="muted" title="Valor registrado: ${esc(correoTxt)}">Correo inválido</span>` : '<span class="muted">Sin correo</span>')}
        </td>
        <td class="c">
          <button class="btn chico" data-si="${r.id}" style="background:#10b981;border-color:#059669;color:#fff;font-weight:700;margin-right:4px">✔ Confirmó</button>
          <button class="btn chico sec" data-no="${r.id}" style="color:#b91c1c;font-weight:600;margin-right:4px">✖ No asiste</button>
          <button class="btn chico sec" data-reag="${r.id}" style="color:var(--azul);font-weight:600;margin-right:4px" title="Derivar a Reagendar">🔄 Reagendar</button>
        </td>
      </tr>
      `;
    }).join('');

    $('#pc-tbody').querySelectorAll('input[data-sel]').forEach((el) => {
      el.onchange = () => {
        const id = Number(el.dataset.sel);
        if (el.checked) seleccion.add(id); else seleccion.delete(id);
        pintarSeleccion();
      };
    });
    $('#pc-tbody').querySelectorAll('button[data-si]').forEach((el) => {
      el.onclick = () => marcarAsistencia(Number(el.dataset.si), 1);
    });
    $('#pc-tbody').querySelectorAll('button[data-no]').forEach((el) => {
      el.onclick = () => marcarAsistencia(Number(el.dataset.no), 0);
    });
    $('#pc-tbody').querySelectorAll('button[data-reag]').forEach((el) => {
      el.onclick = async () => {
        const id = Number(el.dataset.reag);
        try {
          await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
          citasCargadas = citasCargadas.filter((c) => c.id !== id);
          pintarLista();
          actualizarBadgePorConfirmar();
          actualizarBadgeReagendar();
          toast('Postulante derivado a Lista de Espera con alta prioridad', 'ok');
          sessionStorage.setItem('le_destacado', String(id));
          irA('espera');
        } catch (e) {
          toast(e.message, 'err');
        }
      };
    });
  };

  const marcarAsistencia = async (id, val) => {
    try {
      await api(`/agenda/${id}/confirmar`, {
        method: 'POST',
        body: { valor: val }
      });
      const cita = citasCargadas.find((c) => c.id === id);
      citasCargadas = citasCargadas.filter((c) => c.id !== id);
      pintarLista();
      actualizarBadgePorConfirmar();
      toast(val ? 'Asistencia confirmada exitosamente' : 'Registrado: postulante no asiste', val ? 'ok' : 'alerta');
      if (!val && cita) await ofrecerLiberarCupo(cita);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  // Tras "No asiste": ofrece liberar el cupo (misma ruta que "Liberar bloque" del formulario:
  // la cita va a la Papelera) y abre las sugerencias de la lista de espera para ese cupo.
  const ofrecerLiberarCupo = async (cita) => {
    const quien = nom(cita.nombre) || cita.rut || 'el postulante';
    if (!confirm(`¿Liberar el cupo de ${quien} (${fFecha(cita.fecha)} ${cita.hora}) para otra persona? La cita quedará en la papelera y podrás restaurarla.`)) return;
    try {
      await api(`/agenda/${cita.id}/liberar`, { method: 'POST', body: { motivo: 'No asiste (Por confirmar)' } });
      toast('Cupo liberado');
      if (window.SugerenciasCupo) window.SugerenciasCupo.abrir(cita.id, () => cargarDatos());
    } catch (e) { toast(e.message, 'err'); }
  };

  const cargarDatos = async () => {
    const rango = $('#pc-rango').value;
    const h = hoy();
    let hasta = null;
    if (rango === '7') hasta = sumarDias(h, 7);
    else if (rango === '15') hasta = sumarDias(h, 15);
    else if (rango === '30') hasta = sumarDias(h, 30);

    try {
      const todos = await api('/agenda?estado=porconfirmar');
      citasCargadas = todos.filter((r) => {
        if (r.fecha < h) return false;
        if (hasta && r.fecha > hasta) return false;
        return true;
      });
      pintarLista();
      actualizarBadgePorConfirmar();
    } catch (e) {
      $('#pc-tbody').innerHTML = `<tr><td colspan="9" class="c muted" style="color:var(--error);padding:2rem">Error: ${esc(e.message)}</td></tr>`;
    }
  };

  $('#pc-mail-sel').onclick = async () => {
    const filas = objetivo();
    const conCorreo = filas.filter((r) => correoOk(r.correo)).length;
    if (!conCorreo) return toast('Ninguna de las citas elegidas tiene un correo válido.', 'alerta');
    if (!confirm(`¿Enviar el correo de solicitud de confirmación a ${conCorreo} postulante(s)? (${filas.length - conCorreo} sin correo válido)`)) return;
    try {
      toast('Enviando correos...', 'info');
      const r = await api('/correo/confirmacion-masiva', { method: 'POST', body: { ids: filas.map((x) => x.id) } });
      toast(`Correos enviados: ${r.enviados}. Sin correo: ${r.sin_correo}. Fallidos: ${r.fallidos}.`, r.fallidos ? 'alerta' : 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  $('#pc-wa-sel').onclick = () => colaWhatsApp(objetivo());

  $('#pc-q').oninput = pintarLista;
  $('#pc-rango').onchange = cargarDatos;
  $('#pc-refrescar').onclick = () => { cargarDatos(); cargarRespuestasCorreo(); };
  cargarRespuestasCorreo();

  if ($('#btn-enviar-correos-masivos')) {
    $('#btn-enviar-correos-masivos').onclick = async () => {
      if (!confirm('¿Deseas enviar el correo de confirmación de asistencia a todos los postulantes citados que tengan correo registrado?')) return;
      try {
        toast('Enviando correos a postulantes...', 'info');
        const res = await api('/agenda/enviar-correos-pendientes', { method: 'POST', body: {} });
        if (res.enviados > 0) {
          toast(`¡Éxito! Se enviaron ${res.enviados} correos de confirmación.`, 'ok');
        } else if (!res.smtp_habilitado) {
          toast(`Tokens de confirmación generados (${res.tokens_generados}). El servicio de correo (SMTP) no está activo en este entorno.`, 'alerta');
        } else {
          toast(`No se enviaron correos nuevos. Total pendientes: ${res.total_pendientes}.`, 'info');
        }
      } catch (e) {
        toast('Error al enviar correos: ' + e.message, 'err');
      }
    };
  }

  if ($('#btn-correo-prueba')) {
    $('#btn-correo-prueba').onclick = async () => {
      // Sin correo precargado: no se deja datos personales dentro del codigo fuente.
      const email = prompt('Indica el correo donde deseas recibir las pruebas de confirmación:', '');
      if (!email || !email.includes('@')) return;
      try {
        toast('Enviando correos de prueba a ' + email + '...', 'info');
        const res = await api('/agenda/enviar-correos-pendientes', { method: 'POST', body: { correo_prueba: email.trim() } });
        if (res.enviados > 0) {
          toast(`¡Éxito! Se enviaron ${res.enviados} correos de prueba a ${email}.`, 'ok');
        } else if (!res.smtp_habilitado) {
          toast(`Tokens generados. Nota: para envío real hacia ${email} hay que configurar el correo SMTP (SMTP_HOST en el archivo .env).`, 'alerta');
        } else {
          toast('No se encontraron citas pendientes para enviar.', 'info');
        }
      } catch (e) {
        toast('Error en prueba de correo: ' + e.message, 'err');
      }
    };
  }

  await cargarDatos();
  // Atajo de Lico: preselecciona las citas del proximo dia habil y abre la cola de WhatsApp.
  const fechaPend = colaMananaPendiente;
  colaMananaPendiente = null;
  if (fechaPend) {
    $('#pc-rango').value = '7';
    const deManana = visibles.filter((r) => r.fecha === fechaPend);
    deManana.forEach((r) => seleccion.add(r.id));
    $('#pc-tbody').querySelectorAll('input[data-sel]').forEach((el) => { el.checked = seleccion.has(Number(el.dataset.sel)); });
    pintarSeleccion();
    if (deManana.length) colaWhatsApp(deManana);
    else toast('No quedan citas sin confirmar para mañana.', 'info');
  }
}

let colaMananaPendiente = null;
window.PorConfirmar = {
  // fecha = proximo dia habil (YYYY-MM-DD); por defecto, mañana.
  abrirColaManana(fecha) {
    colaMananaPendiente = fecha || sumarDias(hoy(), 1);
    if (location.hash === '#porconfirmar') renderPorConfirmar(); else irA('porconfirmar');
  },
};

// Cola de WhatsApp: una ventana por clic del usuario (asi no la bloquea el navegador).
function colaWhatsApp(filas) {
  const items = filas.map((r) => ({ r, tel: telWaDe(r.contacto), enviado: false }));
  const conTel = items.filter((x) => x.tel);
  const sinTel = items.filter((x) => !x.tel);
  const urlDe = (x) => `https://wa.me/${x.tel}?text=${encodeURIComponent(mensajeWaCita(x.r, x.r.examinador, 'Por favor confírmanos tu asistencia respondiendo a este mensaje.'))}`;
  const cuerpo = `
    <p class="muted" style="margin-top:0">Cada botón abre WhatsApp en una pestaña nueva con el mensaje listo. Envíalo y vuelve aquí para continuar con el siguiente.</p>
    <div class="tabla-scroll" style="max-height:50vh;overflow-y:auto"><table class="tabla-porconfirmar"><thead><tr>
      <th>Postulante</th><th class="c">Cita</th><th class="c">Teléfono</th><th class="c"></th></tr></thead><tbody>
      ${conTel.map((x, i) => `<tr>
        <td class="pc-nombre">${esc(nom(x.r.nombre) || '(Sin nombre)')}</td>
        <td class="c nw">${esc(fFecha(x.r.fecha))} ${esc(x.r.hora || '')}</td>
        <td class="c num nw">${esc(fTel(x.r.contacto))}</td>
        <td class="c nw"><button class="btn chico" data-i="${i}">Abrir WhatsApp</button><span class="wa-ok" data-ok="${i}" hidden>enviado ✓</span></td>
      </tr>`).join('') || '<tr><td colspan="4" class="c muted">Nadie con teléfono válido.</td></tr>'}
    </tbody></table></div>
    ${sinTel.length ? `<p class="muted" style="margin-bottom:0"><b>Sin teléfono (${sinTel.length}):</b> ${sinTel.map((x) => esc(nom(x.r.nombre) || x.r.rut || '(Sin nombre)')).join(', ')}</p>` : ''}`;
  const pie = `<span class="muted" id="wa-progreso" style="margin-right:auto"></span>
    <button class="btn sec" id="wa-cerrar">Cerrar</button>
    <button class="btn" id="wa-siguiente">Siguiente ▶</button>`;
  const ov = modal('Cola de WhatsApp', cuerpo, pie);
  const pintar = () => {
    const hechos = conTel.filter((x) => x.enviado).length;
    ov.querySelector('#wa-progreso').textContent = `${hechos} de ${conTel.length} enviados`;
    ov.querySelector('#wa-siguiente').disabled = hechos === conTel.length;
  };
  const abrir = (i) => {
    window.open(urlDe(conTel[i]), '_blank', 'noopener');
    conTel[i].enviado = true;
    ov.querySelector(`[data-ok="${i}"]`).hidden = false;
    ov.querySelector(`button[data-i="${i}"]`).textContent = 'Reabrir';
    pintar();
  };
  ov.querySelectorAll('button[data-i]').forEach((b) => { b.onclick = () => abrir(Number(b.dataset.i)); });
  ov.querySelector('#wa-siguiente').onclick = () => {
    const i = conTel.findIndex((x) => !x.enviado);
    if (i >= 0) abrir(i);
  };
  ov.querySelector('#wa-cerrar').onclick = cerrarModal;
  pintar();
}

/* ---- Respuestas por correo (leídas automáticamente de Outlook) ---- */
const RESP_ACCIONES = [
  ['confirma', 'Confirmó', ''], ['no_asiste', 'No asiste', 'sec'], ['reagendar', 'Reagendar', 'sec'], ['ignorar', 'Ignorar', 'sec'],
];
async function cargarRespuestasCorreo() {
  const cont = $('#pc-resp-lista');
  if (!cont) return;
  let datos;
  try { datos = await api('/respuestas-correo?estado=revisar'); } catch (e) {
    cont.innerHTML = `<p class="muted" style="font-size:12.5px">No se pudieron cargar las respuestas: ${esc(e.message)}</p>`;
    return;
  }
  const r = datos.resumen || {};
  $('#pc-resp-aplicadas').textContent = `Aplicadas hoy: ${Number(r.aplicadas_hoy) || 0}`;
  $('#pc-resp-revisar').textContent = `Por revisar: ${Number(r.revisar) || 0}`;
  const lib = $('#pc-resp-liberar');
  const nLib = Number(r.por_liberar) || 0;
  lib.hidden = !nLib;
  lib.textContent = nLib ? `${nLib} ${nLib === 1 ? 'cita quedó' : 'citas quedaron'} como "No asiste" por correo: libera la hora desde la agenda si corresponde.` : '';
  const items = datos.items || [];
  if (!items.length) {
    cont.innerHTML = '<p class="muted" style="font-size:12.5px;margin:0">No hay respuestas por revisar.</p>';
    return;
  }
  cont.innerHTML = items.map((it) => {
    const sugerida = it.agenda_id && it.cita_fecha
      ? `Cita sugerida: ${esc(fFecha(it.cita_fecha))} ${esc(it.cita_hora)} — ${esc(it.cita_nombre || it.cita_rut || '')}`
      : 'Sin cita asociada';
    const botones = RESP_ACCIONES.map(([acc, txt, cls]) =>
      `<button class="btn chico ${cls}" data-resp="${Number(it.id)}" data-acc="${acc}" ${acc !== 'ignorar' && !it.agenda_id ? 'disabled title="Sin cita asociada"' : ''}>${esc(txt)}</button>`).join(' ');
    return `<div class="pc-resp-item" style="border-top:1px solid var(--borde, #e2e8f0);padding:.5rem 0">
      <div style="font-size:13px"><b>${esc(it.remitente || 'Remitente desconocido')}</b> · <span class="muted">${esc(it.asunto || '')}</span></div>
      <div style="font-size:12.5px;margin:.25rem 0;white-space:pre-wrap">${esc(it.extracto || '(sin texto)')}</div>
      <div class="muted" style="font-size:12px;margin-bottom:.35rem">${sugerida}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${botones}</div>
    </div>`;
  }).join('');
  cont.querySelectorAll('button[data-resp]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/respuestas-correo/${b.dataset.resp}/resolver`, { method: 'POST', body: { accion: b.dataset.acc } });
        toast('Respuesta registrada.', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      cargarRespuestasCorreo();
    };
  });
}
