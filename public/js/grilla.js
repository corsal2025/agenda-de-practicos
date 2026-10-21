function problemaDatos(b) {
  if (b.rut && !rutEsValido(b.rut)) return 'RUT con dígito verificador inválido';
  if (!b.contacto && !b.correo) return 'Sin teléfono ni correo: no se puede avisar ni confirmar';
  if (b.contacto && b.contacto.replace(/\D/g, '').length !== 9) return 'Teléfono incompleto';
  return null;
}
// Historial del solicitante dentro del panel lateral de la ficha. Cada cita se puede abrir.
async function cargarHistorialCita(b, alGuardar) {
  const cont = $('#zona-hist-cita .hist-lista');
  if (!cont) return;
  const params = new URLSearchParams();
  if (b.rut) params.set('rut', b.rut);
  if (b.nombre) params.set('nombre', b.nombre);
  try {
    const rows = await api(`/buscar-historial?${params.toString()}`);
    if (!document.body.contains(cont)) return;
    if (!Array.isArray(rows) || !rows.length) { cont.textContent = 'Sin citas registradas'; return; }
    pintarAvisoIntento(b, rows);
    cont.innerHTML = rows.map((r) => {
      const actual = r.id === b.id;
      return `<div class="hist-item ${actual ? 'actual' : ''}" ${actual ? '' : `role="button" tabindex="0" data-id="${r.id}"`}>
        <div class="hist-fila"><b>${esc(fFecha(r.fecha))}</b> · ${esc(r.hora)} hrs${actual ? '<span class="badge reag">Cita actual</span>' : ''}<span class="hist-clase">${esc(r.clase || '-')}</span></div>
        <div class="hist-sub">Examinador: ${esc(r.examinador || '-')}</div>
        <div class="hist-sub">Resultado: <b>${esc(r.resultado || 'Sin resultado')}</b></div>
        <div class="hist-sub">Inicio trámite: <b>${r.fecha_inicio_tramite ? esc(fFecha(r.fecha_inicio_tramite)) : 'Sin registrar'}</b>${r.fecha_vencimiento_tramite ? ` · Vence: <b>${esc(fFecha(r.fecha_vencimiento_tramite))}</b>` : ''}</div>
        ${r.dias_restantes_tramite != null ? `<div class="hist-sub">${cuentaRegresivaHtml(r.dias_restantes_tramite, r.fecha_vencimiento_tramite)}</div>` : ''}
        ${r.escuela_conductores ? `<div class="hist-sub">Escuela: ${esc(r.escuela_conductores)}</div>` : ''}
        ${r.tipo_reagendamiento ? `<div class="hist-sub">Reagendamiento: ${esc(r.tipo_reagendamiento)}</div>` : ''}
        ${(r.alerts || []).length ? `<div class="hist-sub">${alertasHtml(r)}</div>` : ''}
      </div>`;
    }).join('');
    cont.querySelectorAll('.hist-item[data-id]').forEach((el) => {
      const abrir = () => abrirSlotPorId(Number(el.dataset.id), alGuardar).catch((e) => toast(e.message, 'err'));
      el.onclick = abrir;
      el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } };
    });
  } catch (e) {
    if (document.body.contains(cont)) cont.textContent = 'No se pudo cargar el historial';
  }
}

// Reprobaciones previas (mismo RUT, alguna clase en comun) antes de esta cita.
// Casillas "Avisado por": medios por los que se aviso al postulante (telefono, whatsapp, correo).
const MEDIOS_AVISO = [['telefono', 'Teléfono'], ['whatsapp', 'WhatsApp'], ['correo', 'Correo']];
function avisosHtml(b) {
  const on = new Set(String(b.avisado_por || '').split(',').filter(Boolean));
  const hay = { telefono: !!b.contacto, whatsapp: !!b.contacto, correo: !!b.correo };
  const disp = MEDIOS_AVISO.filter(([m]) => hay[m]);
  const todos = disp.length > 0 && disp.every(([m]) => on.has(m));
  const casilla = ([m, etq]) => `<label class="aviso-chk${hay[m] ? '' : ' sin'}" title="${hay[m] ? 'Marcar si se avisó por ' + etq : 'Sin ' + (m === 'correo' ? 'correo' : 'teléfono') + ' registrado'}">
      <input type="checkbox" data-aviso="${m}" ${on.has(m) ? 'checked' : ''} ${hay[m] ? '' : 'disabled'}>${etq}</label>`;
  return `<div class="slot-avisos" data-id="${b.id}" onclick="event.stopPropagation()"><span class="aviso-tit">Avisado:</span>
    ${MEDIOS_AVISO.map(casilla).join('')}
    <label class="aviso-chk aviso-todos" title="Marcar o desmarcar todos los medios disponibles"><input type="checkbox" data-aviso="todos" ${todos ? 'checked' : ''} ${disp.length ? '' : 'disabled'}>Todos</label></div>`;
}

const RESULTADOS_REPROBADO = ['REPROBADO', 'REPROBADO INASISTENCIA'];
function reprobacionesPrevias(b, rows) {
  if (!b.rut) return 0;
  const clases = clasesDe(b.clase);
  return rows.filter((r) => r.id !== b.id && r.fecha <= b.fecha
    && RESULTADOS_REPROBADO.includes(r.resultado)
    && clasesDe(r.clase).some((c) => clases.includes(c))).length;
}
const ordinalIntento = (n) => (n === 3 ? '3er' : `${n}°`);
// Aviso (no bloquea): con 2+ reprobaciones previas en la misma clase, este es el 3er intento o mas.
function pintarAvisoIntento(b, rows) {
  const zona = $('#f-intento-aviso');
  const previas = reprobacionesPrevias(b, rows);
  if (!zona || previas < 2) return;
  zona.innerHTML = `<span class="badge reprob" title="${previas} reprobaciones previas en la misma clase">⚠ ${ordinalIntento(previas + 1)} intento</span>`;
  zona.hidden = false;
}

// Ficha imprimible: documento municipal con datos del postulante + historial, en una ventana aparte.
const siNo = (v) => (v === 1 ? 'SÍ' : v === 0 ? 'NO' : '');
function estadoTramiteTxt(b) {
  const d = b.dias_restantes_tramite;
  if (d == null) return b.fecha_inicio_tramite ? '' : 'Sin fecha de inicio registrada';
  return d <= 0 ? `VENCIDO (hace ${diasTxt(-d)})` : `Vigente · quedan ${diasTxt(d)}`;
}
const FICHA_SECCIONES = [
  ['Datos personales', [
    ['Nombre', (b) => nom(b.nombre)], ['RUT', (b) => b.rut],
    ['Teléfono', (b) => fTel(b.contacto)], ['Correo', (b) => b.correo],
  ]],
  ['Trámite', [
    ['Clase(s)', (b) => b.clase], ['Escuela de conductores', (b) => b.escuela_conductores],
    ['Fecha de inicio', (b) => (b.fecha_inicio_tramite ? fFecha(b.fecha_inicio_tramite) : '')],
    ['Fecha de vencimiento', (b) => (b.fecha_vencimiento_tramite ? fFecha(b.fecha_vencimiento_tramite) : '')],
    ['Estado / días restantes', estadoTramiteTxt], ['Intento', (b) => b.intento],
    ['Tipo de cita', (b) => b.tipo_cita], ['Tipo de reagendamiento', (b) => b.tipo_reagendamiento],
  ]],
  ['Resultado', [
    ['Confirmó asistencia', (b) => siNo(b.confirmo_asistencia)], ['Resultado', (b) => b.resultado],
    ['Comentarios', (b) => b.comentarios, true],
  ]],
];
const FICHA_CSS = `@page{size:A4;margin:16mm 15mm 18mm}
*{box-sizing:border-box}body{font:10.5pt/1.4 "Segoe UI",Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:0}
.doc-hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:10px}
.doc-hd img{height:64px;width:auto}.doc-hd .org{flex:1}.doc-hd .org b{display:block;font-size:11pt;letter-spacing:.02em}
.doc-hd .org span{font-size:9pt;color:#333}.doc-hd .emi{font-size:8.5pt;text-align:right;color:#333;white-space:nowrap}
h1{font:700 15pt/1.25 Georgia,"Times New Roman",serif;text-align:center;margin:16px 0 2px}
.sub{text-align:center;font-size:9pt;color:#333;margin:0 0 14px}
.cita{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #000;margin-bottom:12px}
.cita div{padding:6px 8px;border-right:1px solid #999}.cita div:last-child{border-right:0}
.lbl{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;color:#444}
.val{font-weight:600}h2{font:700 11pt Georgia,"Times New Roman",serif;border-bottom:1px solid #000;margin:14px 0 6px;padding-bottom:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #bbb;border-left:1px solid #bbb}
.grid div{padding:5px 8px;border-right:1px solid #bbb;border-bottom:1px solid #bbb;break-inside:avoid}.grid .ancho{grid-column:1/-1}
table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#e9e9e9;font-size:8pt;text-transform:uppercase;letter-spacing:.03em}tbody tr:nth-child(even) td{background:#f5f5f5}
tr{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}
.firmas{display:flex;gap:60px;margin-top:60px;break-inside:avoid}.firmas div{flex:1;border-top:1px solid #000;text-align:center;padding-top:4px;font-size:9pt}
.pie{margin-top:24px;border-top:1px solid #999;padding-top:4px;font-size:8pt;color:#444;display:flex;justify-content:space-between}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
function fichaImprimibleHtml(b, rows, logoUrl) {
  const ahora = new Date();
  const emitido = `${fFecha(hoy())} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')} hrs`;
  const celda = (t, v, ancho) => `<div${ancho ? ' class="ancho"' : ''}><span class="lbl">${esc(t)}</span><span class="val">${esc(v || '—')}</span></div>`;
  const cita = [['Fecha', fFecha(b.fecha)], ['Hora', b.hora ? `${b.hora} hrs` : ''], ['Examinador/a', b.examinador], ['Funcionario/a', b.funcionario]]
    .map(([t, v]) => celda(t, v)).join('');
  const secciones = FICHA_SECCIONES.map(([titulo, campos]) => `<h2>${esc(titulo)}</h2>
    <div class="grid">${campos.map(([t, f, ancho]) => celda(t, f(b), ancho)).join('')}</div>`).join('');
  const hist = rows.length ? rows.map((r) => `<tr>
    <td>${esc(fFecha(r.fecha))} ${esc(r.hora || '')}</td><td>${esc(r.clase || '—')}</td><td>${r.fecha_inicio_tramite ? esc(fFecha(r.fecha_inicio_tramite)) : '—'}</td><td>${r.fecha_vencimiento_tramite ? esc(fFecha(r.fecha_vencimiento_tramite)) : '—'}</td><td>${esc(r.examinador || '—')}</td>
    <td>${esc(r.resultado || 'Sin resultado')}</td><td>${esc(r.escuela_conductores || '—')}</td><td>${esc(r.comentarios || '')}</td></tr>`).join('')
    : '<tr><td colspan="8">Sin citas registradas</td></tr>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha ${esc(nom(b.nombre))}</title>
    <style>${FICHA_CSS}</style></head><body>
    <header class="doc-hd"><img id="ficha-logo" src="${esc(logoUrl)}" alt="${esc(MARCA.organismo)}">
      <div class="org"><b>Ilustre ${esc(MARCA.organismo)}</b><span>Dirección de Tránsito y Transporte Público · ${esc(MARCA.unidad)}</span></div>
      <div class="emi">Emitido el<br>${esc(emitido)}</div></header>
    <h1>Ficha del Postulante — Examen Práctico de Conducir</h1>
    <p class="sub">Dirección de Tránsito y Transporte Público — Ilustre ${esc(MARCA.organismo)}</p>
    <div class="cita">${cita}</div>
    ${secciones}
    <h2>Historial de citas</h2>
    <table><thead><tr><th>Fecha</th><th>Clase</th><th>Inicio trámite</th><th>Término trámite</th><th>Examinador/a</th><th>Resultado</th><th>Escuela</th><th>Comentarios</th></tr></thead>
    <tbody>${hist}</tbody></table>
    <div class="firmas"><div>Firma funcionario/a</div><div>Firma postulante</div></div>
    <footer class="pie"><span>Documento generado por Agenda de Prácticos</span></footer>
    </body></html>`;
}
async function imprimirFicha(b) {
  const params = new URLSearchParams();
  if (b.rut) params.set('rut', b.rut);
  if (b.nombre) params.set('nombre', b.nombre);
  const rows = await api(`/buscar-historial?${params.toString()}`);
  const w = window.open('', '_blank');
  if (!w) { toast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(fichaImprimibleHtml(b, Array.isArray(rows) ? rows : [], `${location.origin}/logo.png`));
  w.document.close();
  w.focus();
  // Espera a que cargue el logo (o falle) antes de imprimir, con tope de 3 s.
  const img = w.document.getElementById('ficha-logo');
  let impreso = false;
  const imprimir = () => { if (!impreso) { impreso = true; w.print(); } };
  if (!img || img.complete) { imprimir(); return; }
  img.addEventListener('load', imprimir);
  img.addEventListener('error', () => { img.remove(); imprimir(); });
  setTimeout(imprimir, 3000);
}

// Esc cierra el panel lateral de la ficha.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('#modal-root .modal.lateral')) cerrarModal();
});

// Boton "Historial" en las tarjetas de la cuadricula: abre la ficha editable en el panel lateral.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-hist');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  abrirSlotPorId(Number(btn.dataset.id), () => { if ($('#a-grid')) renderAgenda(); })
    .catch((err) => toast(err.message, 'err'));
}, true);

function slotCard(b) {
  if (!b) return '<div class="slot libre">—</div>';
  if (b.bloqueado) {
    return `<div class="slot bloqueado" role="button" tabindex="0" data-id="${b.id}">
      <span class="nombre">&#128274; ${esc(b.bloqueo_motivo || 'BLOQUEADO')}</span>
      <span class="sub">No disponible</span></div>`;
  }
  const ocupada = b.rut || b.nombre;
  const res = b.resultado === 'APROBADO' ? 'res-aprob'
    : (b.resultado === 'REPROBADO' || b.resultado === 'REPROBADO INASISTENCIA') ? 'res-reprob' : '';
  const cls = ['slot', ocupada ? 'ocupada' : 'libre', b.hora === META.hora_d_a5 ? 'pesada' : '', res]
    .filter(Boolean).join(' ');

  if (!ocupada) {
    return `<div class="${cls}" style="cursor:default">
      <span class="sub" style="color:var(--tinta-3);font-size:11px">—</span>
      ${b.hora === META.hora_d_a5 ? '<span class="badges"><span class="badge dpesada">Bloque para D y A5</span></span>' : ''}
      ${b.fecha >= META.hoy ? `<button type="button" class="btn-sugerir" data-id="${b.id}" title="Sugerir postulantes de la cola o lista de espera">Sugerir</button>` : ''}
    </div>`;
  }

  const badges = [];
  if (b.intento) {
    const int = String(b.intento).toUpperCase();
    if (int.includes('1') || int.includes('PRIMERA')) badges.push('<span class="badge intento-1">1° vez</span>');
    else if (int.includes('2') || int.includes('SEGUNDA')) badges.push('<span class="badge intento-2">2° vez</span>');
  }
  if (b.tipo_cita === 'REAGENDADO') badges.push('<span class="badge reag">Reagendada</span>');
  if (b.pendiente_reagendar) badges.push('<span class="badge reag">Pendiente de reagendar</span>');
  if (b.confirmo_asistencia === 1) badges.push('<span class="badge aprob">Confirmó asistencia</span>');
  if (b.resultado === 'APROBADO') badges.push('<span class="badge aprob">Aprobó</span>');
  else if (b.resultado === 'REPROBADO') badges.push('<span class="badge reprob">Reprobó</span>');
  else if (b.resultado) badges.push('<span class="badge noasiste">' + esc(b.resultado) + '</span>');

  // Marcado rapido de resultado (solo citas de hoy o pasadas)
  const noAsiste = b.resultado === 'NO ASISTIO' || b.resultado === 'REPROBADO INASISTENCIA';
  const acc = b.fecha <= META.hoy ? `<span class="slot-res" data-id="${b.id}">
    <span class="sr sr-a ${b.resultado === 'APROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="APROBADO">Aprobó</span>
    <span class="sr sr-r ${b.resultado === 'REPROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="REPROBADO">Reprobó</span>
    <span class="sr sr-n ${noAsiste ? 'on' : ''}" role="button" tabindex="0" data-r="NO ASISTIO">No asistió</span>
  </span>` : '';

  const problema = problemaDatos(b);
  const esConfirmado = b.confirmo_asistencia === 1;
  const telWa = telWaDe(b.contacto);
  const examP = b.examinador || (META.examinadores.find((e) => e.id === b.examinador_id) || {}).nombre || 'por asignar';
  const mensajeWa = mensajeWaCita(b, examP);
  const mensajeSms = mensajeSmsCita(b, examP);

  return `<div class="${cls}" data-id="${b.id}">
    ${problema ? `<span class="alerta-dato" title="${esc(problema)}">⚠</span>` : ''}
    <div class="slot-top">${b.dias_restantes_tramite != null ? cuentaRegresivaHtml(b.dias_restantes_tramite, b.fecha_vencimiento_tramite) : SIN_INICIO_HTML}</div>
    ${(b.alerts || []).length ? `<div class="slot-alertas">${alertasHtml(b)}</div>` : ''}
    <span class="nombre">${esc(nom(b.nombre) || '(SIN NOMBRE)')}</span>
    <button type="button" class="btn-hist" data-id="${b.id}" title="Ver ficha e historial del postulante">📋 Historial</button>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
      <span class="sub" style="margin:0">
        ${clasesTagsHtml(b.clase)}
        <span class="cita-rut num">${esc(b.rut || 'sin RUT')}</span>
      </span>
      ${b.funcionario ? `<span class="slot-func" title="Atendido por ${esc(b.funcionario)}"><svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg> ${esc(b.funcionario)}</span>` : ''}
    </div>
    <div class="slot-contacto">
      <div class="slot-contacto-fila">
        <span class="sc-item ${b.contacto ? '' : 'sin'}" title="${b.contacto ? 'Teléfono: ' + esc(fTel(b.contacto)) : 'Sin teléfono registrado'}">
          <svg class="sc-ico" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 0 0 4.168 6.608 17.569 17.569 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.678.678 0 0 0-.58-.122l-2.19.547a1.745 1.745 0 0 1-1.657-.459L5.482 8.06a1.745 1.745 0 0 1-.46-1.657l.548-2.19a.678.678 0 0 0-.122-.58L3.654 1.328z"/></svg>
          <span class="num">${esc(fTel(b.contacto) || 'Sin teléfono')}</span>
        </span>
        ${telWa ? `<a href="sms:+${telWa}?body=${encodeURIComponent(mensajeSms)}" class="btn-sms" title="Enviar mensaje de texto (SMS) con los datos de su cita" onclick="event.stopPropagation()"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:2px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>SMS</a>` : ''}
      </div>
      <span class="sc-item ${b.correo ? 'slot-mail' : 'sin'}" title="${b.correo ? 'Correo: ' + esc(b.correo) : 'Sin correo registrado'}">
        <svg class="sc-ico" viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2zm13 2.383-4.708 2.825L15 11.105V5.383zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741zM1 11.105l4.708-2.897L1 5.383v5.722z"/></svg>
        <span>${esc(b.correo || 'Sin correo')}</span>
      </span>
      ${avisosHtml(b)}
    </div>

    ${badges.length ? `<span class="badges">${badges.join('')}</span>` : ''}
    <div class="slot-acciones" data-id="${b.id}">
      <button type="button" class="btn-slot-act btn-confirmar ${esConfirmado ? 'es-confirmado' : ''}" data-act="confirmar" title="${esConfirmado ? 'Asistencia confirmada. Clic para modificar estado' : 'Confirmar asistencia del postulante'}">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
        <span>${esConfirmado ? 'Confirmado' : 'Confirmar'}</span>
      </button>
      <button type="button" class="btn-slot-act btn-reagendar" data-act="reagendar" ${bloqueoReagendarConfirmada(b) ? `disabled title="${esc(bloqueoReagendarConfirmada(b))}"` : 'title="Derivar directamente a reagendamiento"'}>
        <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
        <span>Reagendar</span>
      </button>
    </div>
    ${acc}
  </div>`;
}
// Familia de la clase de licencia (para el color del recuadro).
function claseFamilia(c) {
  const x = String(c || '').toUpperCase();
  if (x === 'D' || x === 'A5') return 'pesada';
  if (x === 'E') return 'prof';
  if (x.startsWith('A')) return 'moto';
  return 'liviana';
}
// Una cita puede tener varias clases marcadas ("B,A2"): una etiqueta por cada una.
function clasesTagsHtml(clase) {
  const lista = clasesDe(clase);
  if (!lista.length) return '—';
  return lista.map((cl) => `<span class="clase-tag ${claseFamilia(cl)}">${esc(cl)}</span>`).join(' ');
}

function pintarGrilla(cont, filas, fecha) {
  let exs = estadoAgenda.examinador_id
    ? META.examinadores.filter((e) => String(e.id) === String(estadoAgenda.examinador_id))
    : META.examinadores.filter((e) => e.activo);
  // En celular se muestra un examinador a la vez (el selector "Examinador" elige cuál).
  if (!estadoAgenda.examinador_id && exs.length > 1 && window.matchMedia && window.matchMedia('(max-width: 600px)').matches) {
    exs = exs.slice(0, 1);
    const sel = document.getElementById('a-exam');
    if (sel) sel.value = String(exs[0].id);
  }
  if (!filas.length) {
    cont.className = '';
    cont.style.gridTemplateColumns = '';
    cont.innerHTML = licoVacio('explica', 'Sin bloques este día', `No hay bloques para ${fFecha(fecha)}. Puede ser fin de semana o feriado, o falta generar la grilla (pestaña Datos).`);
    return;
  }
  const porKey = {};
  const cuenta = {};
  filas.forEach((f) => {
    porKey[`${f.hora}|${f.examinador_id}`] = f;
    if (f.rut || f.nombre) cuenta[f.examinador_id] = (cuenta[f.examinador_id] || 0) + 1;
  });
  const modo = estadoAgenda.modoVista || localStorage.getItem('agenda_modo_vista') || 'tabla';

  if (modo === 'tabla') {
    pintarTablaAgenda(cont, filas, fecha, exs);
    return;
  }

  if (modo === 'horizontal') {
    cont.className = 'grilla-horizontal-wrap';
    cont.style.gridTemplateColumns = '';
    let html = `<div class="grilla-horizontal" style="grid-template-columns: 200px repeat(${META.horas.length}, 320px)">`;
    html += `<div class="gh-esquina">Examinador \\ Hora</div>`;
    for (const hora of META.horas) {
      const pesada = hora === META.hora_d_a5;
      html += `<div class="gh-hora-head ${pesada ? 'pesada' : ''}">
        <span class="gh-h-txt">${esc(hora)}</span>
        ${pesada ? '<span class="et">D · A5</span>' : ''}
      </div>`;
    }
    for (const e of exs) {
      html += `<div class="gh-exam-col">
        <span class="gh-exam-nombre">${esc(e.nombre)}</span>
        <span class="gh-exam-citas">${cuenta[e.id] || 0} citas</span>
      </div>`;
      for (const hora of META.horas) {
        const pesada = hora === META.hora_d_a5;
        html += `<div class="gh-slot-col ${pesada ? 'fila-pesada' : ''}">${slotCard(porKey[`${hora}|${e.id}`])}</div>`;
      }
    }
    html += `</div>`;
    cont.innerHTML = html;
  } else {
    cont.className = 'grilla';
    cont.style.gridTemplateColumns = `58px repeat(${exs.length}, minmax(0, 1fr))`;
    let html = `<div class="g-esquina"><span class="gh-n">&nbsp;</span><span class="gh-c">Hora</span></div>` + exs.map((e) =>
      `<div class="g-head"><span class="gh-n">${esc(e.nombre)}</span><span class="gh-c">${cuenta[e.id] || 0} citas</span></div>`).join('');
    for (const hora of META.horas) {
      const pesada = hora === META.hora_d_a5;
      html += `<div class="g-hora" data-hora="${esc(hora)}">${esc(hora)}${pesada ? '<span class="et">D · A5</span>' : ''}</div>`;
      for (const e of exs) html += `<div${pesada ? ' class="fila-pesada"' : ''}>${slotCard(porKey[`${hora}|${e.id}`])}</div>`;
    }
    cont.innerHTML = html;
  }
  cont.querySelectorAll('.slot-avisos input[data-aviso]').forEach((chk) => {
    chk.onchange = async () => {
      const box = chk.closest('.slot-avisos');
      const id = Number(box.dataset.id);
      const medios = chk.dataset.aviso === 'todos'
        ? [...box.querySelectorAll('input[data-aviso]:not([data-aviso="todos"]):not(:disabled)')].map((i) => i.dataset.aviso)
        : [chk.dataset.aviso];
      const marcar = chk.checked;
      try {
        let lista = [];
        for (const medio of medios) lista = (await api(`/agenda/${id}/aviso`, { method: 'POST', body: { medio, avisado: marcar } })).avisado_por;
        box.querySelectorAll('input[data-aviso]:not([data-aviso="todos"])').forEach((i) => { i.checked = lista.includes(i.dataset.aviso); });
        const habil = [...box.querySelectorAll('input[data-aviso]:not([data-aviso="todos"]):not(:disabled)')];
        const t = box.querySelector('input[data-aviso="todos"]');
        if (t) t.checked = habil.length > 0 && habil.every((i) => i.checked);
      } catch (e) { chk.checked = !marcar; toast(e.message, 'err'); }
    };
  });
  cont.querySelectorAll('.slot-res .sr').forEach((el) => {
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); } };
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const box = el.closest('.slot-res');
      const card = el.closest('.slot');
      const id = Number(box.dataset.id);
      const quitar = el.classList.contains('on');
      // Se pinta al instante; si el guardado falla se vuelve al estado anterior.
      const antes = { on: [...box.querySelectorAll('.sr.on')], card: card.className };
      box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
      card.classList.remove('res-aprob', 'res-reprob');
      if (!quitar) {
        el.classList.add('on');
        card.classList.add(el.dataset.r === 'APROBADO' ? 'res-aprob' : 'res-reprob');
      }
      try {
        await marcarResultado(id, quitar ? null : el.dataset.r);
        if (!quitar && el.dataset.r === 'APROBADO') licoConfeti(el);
        toast(quitar ? 'Resultado borrado' : `Marcado: ${el.dataset.r === 'NO ASISTIO' ? 'No asistió' : el.dataset.r === 'APROBADO' ? 'Aprobó' : 'Reprobó'}`);
      } catch (e) {
        box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
        antes.on.forEach((s) => s.classList.add('on'));
        card.className = antes.card;
        toast(e.message, 'err');
      }
    };
  });
  cont.querySelectorAll('.slot-acciones button').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.closest('.slot-acciones').dataset.id);
      const act = btn.dataset.act;
      if (act === 'confirmar') {
        const yaConfirmado = btn.classList.contains('es-confirmado');
        if (yaConfirmado) {
          if (!confirm('Esta cita ya figura con asistencia confirmada.\n\n¿Deseas volver a marcarla como pendiente de confirmación?')) return;
        }
        try {
          await api(`/agenda/${id}/confirmar`, { method: 'POST', body: { valor: yaConfirmado ? 0 : 1 } });
          toast(yaConfirmado ? 'Cita marcada como pendiente' : 'Asistencia confirmada exitosamente', 'ok');
          actualizarBadgePorConfirmar();
          renderAgenda();
        } catch (e) { toast(e.message, 'err'); }
      } else if (act === 'reagendar') {
        try {
          await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
          toast('Postulante enviado a Lista de Espera con alta prioridad', 'ok');
          sessionStorage.setItem('le_destacado', String(id));
          actualizarBadgeReagendar();
          irA('espera');
        } catch (e) { toast(e.message, 'err'); }
      }
    };
  });
}
// Marca (o borra, con resultado=null) el resultado de una cita preservando
// el resto de sus datos. Compartido entre la grilla y el check-in del dia.
async function marcarResultado(id, resultado) {
  await api(`/agenda/${id}/resultado`, { method: 'POST', body: { resultado } });
}

function pintarTablaAgenda(cont, filas, fecha, exs) {
  cont.className = 'tabla-agenda-wrap';
  cont.style.gridTemplateColumns = '';

  // Ordenar filas por hora ascendente y luego examinador
  const ordenadas = [...filas].sort((a, b) => {
    if (a.hora !== b.hora) return a.hora.localeCompare(b.hora);
    return Number(a.examinador_id || 0) - Number(b.examinador_id || 0);
  });

  const totalCitas = ordenadas.filter((f) => f.rut || f.nombre).length;
  const totalLibres = ordenadas.filter((f) => !f.rut && !f.nombre && !f.bloqueado).length;
  const totalConfirmadas = ordenadas.filter((f) => f.confirmo_asistencia === 1).length;

  let html = `
    <div class="tabla-agenda-toolbar-exterior">
      <div class="tabla-busc-wrap">
        <svg class="tabla-busc-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5l4.5 4.5"/></svg>
        <input type="search" id="tabla-busc-input" class="tabla-busc-input" placeholder="Buscar RUT o nombre" autocomplete="off">
      </div>
      <div class="tabla-filtros-rapidos">
        <button type="button" class="btn-filtro-pill activo" data-filtro="todos">Todas (${ordenadas.length})</button>
        <button type="button" class="btn-filtro-pill" data-filtro="ocupadas">Citas (${totalCitas})</button>
        <button type="button" class="btn-filtro-pill" data-filtro="libres">Libres (${totalLibres})</button>
        ${totalConfirmadas ? `<button type="button" class="btn-filtro-pill" data-filtro="confirmadas">✓ Confirmadas (${totalConfirmadas})</button>` : ''}
      </div>
    </div>
    <div class="tabla-agenda-card">
      <div class="tabla-agenda-scroll">
        <table class="tabla-agenda-elegante" id="tabla-agenda-main">
          <thead>
            <tr>
              <th class="th-hora">HORA</th>
              <th class="th-nombre">NOMBRE DE CONTRIBUYENTE</th>
              <th class="th-rut">RUT</th>
              <th class="th-sede">SEDE</th>
              <th class="th-clase">CLASE *</th>
              <th class="th-contacto">CONTACTO</th>
              <th class="th-avisos">AVISADO</th>
              <th class="th-confirmar">CONFIRMAR</th>
              <th class="th-resultado">RESULTADO</th>
            </tr>
          </thead>
          <tbody>
  `;

  for (const b of ordenadas) {
    const ocupada = Boolean(b.rut || b.nombre);
    const bloqueada = Boolean(b.bloqueado);
    const examObj = META.examinadores.find((e) => e.id === b.examinador_id);
    const examNombre = b.examinador || (examObj ? examObj.nombre : 'AV. ARGENTINA');
    const pesada = b.hora === META.hora_d_a5;
    const esConfirmado = b.confirmo_asistencia === 1;
    const telWa = telWaDe(b.contacto);
    const mensajeWa = mensajeWaCita(b, examNombre);
    const mensajeSms = mensajeSmsCita(b, examNombre);
    const problema = problemaDatos(b);
    const noAsiste = b.resultado === 'NO ASISTIO' || b.resultado === 'REPROBADO INASISTENCIA';
    const avisadoSet = new Set(String(b.avisado_por || '').split(',').filter(Boolean));

    if (bloqueada) {
      html += `
        <tr class="fila-agenda-tabla fila-bloqueada" data-id="${b.id}" data-tipo="bloqueada" data-examinador="${b.examinador_id}">
          <td class="td-hora">
            <span class="hora-badge ${pesada ? 'hora-pesada' : ''}">
              ${esc(b.hora)}
              ${pesada ? '<span class="et-d">D·A5</span>' : ''}
            </span>
          </td>
          <td class="td-nombre">
            <span class="bloqueado-label">🔒 ${esc(b.bloqueo_motivo || 'BLOQUEADO')}</span>
          </td>
          <td class="td-rut text-muted">—</td>
          <td class="td-sede"><span class="sede-pill-badge">${esc(examNombre)}</span></td>
          <td class="td-clase text-muted">—</td>
          <td class="td-contacto text-muted">—</td>
          <td class="td-avisos text-muted">—</td>
          <td class="td-confirmar text-muted">—</td>
          <td class="td-resultado"><span class="badge-bloq-tag">No disponible</span></td>
        </tr>
      `;
    } else if (!ocupada) {
      html += `
        <tr class="fila-agenda-tabla fila-libre" data-id="${b.id}" data-tipo="libre" data-examinador="${b.examinador_id}">
          <td class="td-hora">
            <span class="hora-badge ${pesada ? 'hora-pesada' : ''}">
              ${esc(b.hora)}
              ${pesada ? '<span class="et-d">D·A5</span>' : ''}
            </span>
          </td>
          <td class="td-nombre">
            <span class="libre-label"><span class="punto-verde"></span> Disponible para agendar</span>
          </td>
          <td class="td-rut text-muted">—</td>
          <td class="td-sede"><span class="sede-pill-badge">${esc(examNombre)}</span></td>
          <td class="td-clase">${pesada ? '<span class="badge dpesada">D y A5</span>' : '<span class="text-muted">—</span>'}</td>
          <td class="td-contacto text-muted">—</td>
          <td class="td-avisos text-muted">—</td>
          <td class="td-confirmar text-muted">—</td>
          <td class="td-resultado">
            <button type="button" class="btn-agendar-tabla" data-id="${b.id}" title="Agendar cita en este bloque">+ Agendar cita</button>
          </td>
        </tr>
      `;
    } else {
      // Cita ocupada
      const resCls = b.resultado === 'APROBADO' ? 'res-aprob' : (b.resultado === 'REPROBADO' || noAsiste) ? 'res-reprob' : '';

      // Cuenta regresiva / plazo trámite
      const plazoHtml = b.dias_restantes_tramite != null
        ? cuentaRegresivaHtml(b.dias_restantes_tramite, b.fecha_vencimiento_tramite)
        : '';

      // Avisos compactos
      const chkTel = `<label class="chk-aviso-mini ${b.contacto ? '' : 'sin'}" title="${b.contacto ? 'Avisado por Teléfono' : 'Sin teléfono'}"><input type="checkbox" data-aviso="telefono" ${avisadoSet.has('telefono') ? 'checked' : ''} ${b.contacto ? '' : 'disabled'}>Tel</label>`;
      const chkWa = `<label class="chk-aviso-mini ${b.contacto ? '' : 'sin'}" title="${b.contacto ? 'Avisado por mensaje de texto (SMS)' : 'Sin teléfono'}"><input type="checkbox" data-aviso="whatsapp" ${avisadoSet.has('whatsapp') ? 'checked' : ''} ${b.contacto ? '' : 'disabled'}>SMS</label>`;
      const chkMail = `<label class="chk-aviso-mini ${b.correo ? '' : 'sin'}" title="${b.correo ? 'Avisado por Correo' : 'Sin correo'}"><input type="checkbox" data-aviso="correo" ${avisadoSet.has('correo') ? 'checked' : ''} ${b.correo ? '' : 'disabled'}>Mail</label>`;

      // Formatear RUT y Teléfono sin posibilidad de salto de línea
      const rutFmt = b.rut ? esc(b.rut).replace(/-/g, '&#8209;') : 'sin RUT';
      const telFmt = b.contacto ? esc(fTel(b.contacto)).replace(/ /g, '&nbsp;') : '';

      html += `
        <tr class="fila-agenda-tabla fila-ocupada ${resCls}" data-id="${b.id}" data-tipo="ocupada" data-examinador="${b.examinador_id}">
          <td class="td-hora">
            <span class="hora-badge ${pesada ? 'hora-pesada' : ''}">
              ${esc(b.hora)}
              ${pesada ? '<span class="et-d">D·A5</span>' : ''}
            </span>
          </td>
          <td class="td-nombre">
            <div class="nombre-cell-box">
              <div class="nombre-cell-top">
                ${problema ? `<span class="alerta-dato" title="${esc(problema)}">⚠</span>` : ''}
                <span class="nombre-contribuyente">${esc(nom(b.nombre) || '(SIN NOMBRE)')}</span>
              </div>
              <div class="nombre-cell-sub">
                ${plazoHtml ? `<span class="plazo-badge-wrap">${plazoHtml}</span>` : ''}
                ${(b.alerts || []).length ? `<span class="slot-alertas-mini">${alertasHtml(b)}</span>` : ''}
                ${b.funcionario ? `<span class="slot-func" title="Atendido por ${esc(b.funcionario)}"><svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg> ${esc(b.funcionario)}</span>` : ''}
              </div>
            </div>
          </td>
          <td class="td-rut">
            <div class="rut-cell-box">
              <span class="rut-txt num">${rutFmt}</span>
            </div>
          </td>
          <td class="td-sede">
            <span class="sede-pill-badge">${esc(examNombre)}</span>
          </td>
          <td class="td-clase">
            <span class="clase-badge-tabla">${esc(b.clase || '—')}</span>
          </td>
          <td class="td-contacto">
            <div class="contacto-col-wrap">
              ${telFmt ? `<span class="tel-txt num">${telFmt}</span>` : '<span class="sin-tel text-muted">—</span>'}
              ${telWa ? `<a href="sms:+${telWa}?body=${encodeURIComponent(mensajeSms)}" class="btn-sms-tabla" onclick="event.stopPropagation()" title="Enviar mensaje de texto (SMS) a este postulante"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:3px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Mensaje de texto</a>` : ''}
            </div>
          </td>
          <td class="td-avisos">
            <div class="slot-avisos-tabla" data-id="${b.id}" onclick="event.stopPropagation()">
              ${chkTel}
              ${chkWa}
              ${chkMail}
            </div>
          </td>
          <td class="td-confirmar">
            <button type="button" class="btn-confirmar-tabla ${esConfirmado ? 'es-confirmado' : ''}" data-act="confirmar" data-id="${b.id}" title="${esConfirmado ? 'Asistencia confirmada. Clic para desmarcar' : 'Confirmar asistencia del postulante'}">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
              <span>${esConfirmado ? 'Confirmado' : 'Confirmar'}</span>
            </button>
          </td>
          <td class="td-resultado">
            <div class="resultado-celda-wrap">
              <div class="slot-res tabla-slot-res" data-id="${b.id}">
                <span class="sr sr-a ${b.resultado === 'APROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="APROBADO" title="Marcar Aprobado">Aprobó</span>
                <span class="sr sr-r ${b.resultado === 'REPROBADO' ? 'on' : ''}" role="button" tabindex="0" data-r="REPROBADO" title="Marcar Reprobado">Reprobó</span>
                <span class="sr sr-n ${noAsiste ? 'on' : ''}" role="button" tabindex="0" data-r="NO ASISTIO" title="Marcar No asistió">No asistió</span>
              </div>
              <button type="button" class="btn-tabla-reagendar" data-id="${b.id}" title="Derivar directamente a Reagendar">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  cont.innerHTML = html;

  const scrollEl = cont.querySelector('.tabla-agenda-scroll');
  if (scrollEl) scrollEl.scrollLeft = 0;

  // 1. Filtro rápido de búsqueda en tiempo real
  const inpBusc = cont.querySelector('#tabla-busc-input');
  if (inpBusc) {
    inpBusc.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      cont.querySelectorAll('.fila-agenda-tabla').forEach((tr) => {
        if (!q) {
          tr.style.display = '';
          return;
        }
        const str = (tr.textContent || '').toLowerCase();
        tr.style.display = str.includes(q) ? '' : 'none';
      });
    };
  }

  // 2. Filtros de píldoras
  cont.querySelectorAll('.btn-filtro-pill').forEach((btn) => {
    btn.onclick = () => {
      cont.querySelectorAll('.btn-filtro-pill').forEach((b) => b.classList.remove('activo'));
      btn.classList.add('activo');
      const filtro = btn.dataset.filtro;
      cont.querySelectorAll('.fila-agenda-tabla').forEach((tr) => {
        if (filtro === 'todos') tr.style.display = '';
        else if (filtro === 'ocupadas') tr.style.display = tr.dataset.tipo === 'ocupada' ? '' : 'none';
        else if (filtro === 'libres') tr.style.display = tr.dataset.tipo === 'libre' ? '' : 'none';
        else if (filtro === 'confirmadas') tr.style.display = tr.querySelector('.btn-confirmar-tabla.es-confirmado') ? '' : 'none';
      });
    };
  });

  // 3. Selección de fila en la tabla
  cont.querySelectorAll('.fila-agenda-tabla').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.sr') || e.target.closest('input') || e.target.closest('label')) return;
      if (tr.classList.contains('fila-bloqueada')) {
        dialogoDesbloquearDia();
        return;
      }
      cont.querySelectorAll('.fila-agenda-tabla').forEach((r) => r.classList.remove('row-activa'));
      tr.classList.add('row-activa');
    };
  });

  cont.querySelectorAll('.btn-agendar-tabla').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      abrirSlotPorId(id, () => { if ($('#a-grid')) renderAgenda(); }).catch((err) => toast(err.message, 'err'));
    };
  });

  // 4. Marcado de resultados interactivo
  cont.querySelectorAll('.tabla-slot-res .sr').forEach((el) => {
    el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); } };
    el.onclick = async (ev) => {
      ev.stopPropagation();
      const box = el.closest('.tabla-slot-res');
      const tr = el.closest('tr');
      const id = Number(box.dataset.id);
      const quitar = el.classList.contains('on');
      const antes = { on: [...box.querySelectorAll('.sr.on')], cls: tr.className };
      box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
      tr.classList.remove('res-aprob', 'res-reprob');
      if (!quitar) {
        el.classList.add('on');
        tr.classList.add(el.dataset.r === 'APROBADO' ? 'res-aprob' : 'res-reprob');
      }
      try {
        await marcarResultado(id, quitar ? null : el.dataset.r);
        if (!quitar && el.dataset.r === 'APROBADO') licoConfeti(el);
        toast(quitar ? 'Resultado borrado' : `Marcado: ${el.dataset.r === 'NO ASISTIO' ? 'No asistió' : el.dataset.r === 'APROBADO' ? 'Aprobó' : 'Reprobó'}`);
      } catch (e) {
        box.querySelectorAll('.sr').forEach((s) => s.classList.remove('on'));
        antes.on.forEach((s) => s.classList.add('on'));
        tr.className = antes.cls;
        toast(e.message, 'err');
      }
    };
  });

  // 5. Botones de confirmar asistencia
  cont.querySelectorAll('.btn-confirmar-tabla').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      const yaConfirmado = btn.classList.contains('es-confirmado');
      if (yaConfirmado) {
        if (!confirm('Esta cita ya figura con asistencia confirmada.\n\n¿Deseas volver a marcarla como pendiente?')) return;
      }
      try {
        await api(`/agenda/${id}/confirmar`, { method: 'POST', body: { valor: yaConfirmado ? 0 : 1 } });
        toast(yaConfirmado ? 'Cita marcada como pendiente' : 'Asistencia confirmada exitosamente', 'ok');
        actualizarBadgePorConfirmar();
        renderAgenda();
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  // 6. Checkboxes de avisos compactos
  cont.querySelectorAll('.slot-avisos-tabla input[data-aviso]').forEach((chk) => {
    chk.onchange = async (ev) => {
      ev.stopPropagation();
      const box = chk.closest('.slot-avisos-tabla');
      const id = Number(box.dataset.id);
      const medio = chk.dataset.aviso;
      const marcar = chk.checked;
      try {
        const res = await api(`/agenda/${id}/aviso`, { method: 'POST', body: { medio, avisado: marcar } });
        const lista = res.avisado_por || [];
        box.querySelectorAll('input[data-aviso]').forEach((i) => {
          i.checked = lista.includes(i.dataset.aviso);
        });
        toast(`Aviso por ${medio === 'telefono' ? 'teléfono' : medio} ${marcar ? 'marcado' : 'desmarcado'}`);
      } catch (e) {
        chk.checked = !marcar;
        toast(e.message, 'err');
      }
    };
  });

  // 7. Botón de reagendar directo desde la fila
  cont.querySelectorAll('.btn-tabla-reagendar').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const id = Number(btn.dataset.id);
      if (!confirm('¿Deseas derivar a este postulante a la Lista de Espera para reagendarle un nuevo cupo?')) return;
      try {
        await api(`/agenda/${id}/reagendar`, { method: 'POST', body: { motivo: 'POSTULANTE SOLICITA CAMBIO' } });
        toast('Postulante enviado a Lista de Espera con alta prioridad', 'ok');
        sessionStorage.setItem('le_destacado', String(id));
        actualizarBadgeReagendar();
        irA('espera');
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}
