'use strict';
// Pantalla de sala de espera (TV). Solo muestra datos minimos: hora, iniciales, clase, examinador.
(function () {
  const REFRESCO_MS = 30000;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dos = (n) => String(n).padStart(2, '0');

  function reloj() {
    const d = new Date();
    $('#s-reloj').textContent = `${dos(d.getHours())}:${dos(d.getMinutes())}`;
    $('#s-fecha').textContent = `${dos(d.getDate())}/${dos(d.getMonth() + 1)}`;
  }
  const cuerpo = (c) => c
    ? `${esc(c.hora)} · ${esc(c.iniciales || '—')}<small>Clase ${esc(c.clase || '—')} · ${esc(c.examinador)}</small>`
    : '—';

  async function cargar() {
    try {
      const r = await fetch('/api/sala', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const { citas = [] } = await r.json();
      const ahora = citas.filter((c) => c.estado === 'en curso');
      const sig = citas.filter((c) => c.estado === 'siguiente');
      $('#s-ahora .s-cuerpo').innerHTML = ahora.length ? ahora.map(cuerpo).join('<hr style="border:0;border-top:1px solid #2a3466;margin:1vh 0">') : '—';
      $('#s-sig .s-cuerpo').innerHTML = sig.length ? sig.map(cuerpo).join('<hr style="border:0;border-top:1px solid #2a3466;margin:1vh 0">') : '—';
      const resto = citas.filter((c) => c.estado === 'pendiente' || c.estado === 'finalizado');
      $('#s-lista').innerHTML = resto.length
        ? resto.map((c) => `<li class="${c.estado === 'finalizado' ? 'finalizado' : ''}"><span class="hora">${esc(c.hora)}</span>
            <span>${esc(c.iniciales || '—')} <span class="ex">· Clase ${esc(c.clase || '—')}</span></span><span class="ex">${esc(c.examinador)}</span></li>`).join('')
        : '<li><span></span><span class="ex">Sin más citas por hoy</span><span></span></li>';
      $('#s-pie').textContent = `Actualizado ${new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      $('#s-pie').textContent = 'Sin conexión con el servidor. Reintentando…';
    }
  }

  reloj(); cargar();
  setInterval(() => { if (!document.hidden) { reloj(); cargar(); } }, REFRESCO_MS);
  setInterval(() => { if (!document.hidden) reloj(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { reloj(); cargar(); } });
}());
