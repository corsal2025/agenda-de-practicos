/* ================= Calendario mensual ================= */
let estadoCalendario = { mes: null };
const MESES_CAL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS_CAL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function moverMesCal(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Nivel de color por ocupacion: libre (verde) -> medio (amarillo) -> lleno (rojo); gris si no se atiende.
function nivelCal(d) {
  if (!d.es_habil || d.feriado || !d.total_bloques) return 'gris';
  const atendibles = d.ocupados + d.libres;
  if (!atendibles) return 'gris';
  const pct = d.ocupados / atendibles;
  if (pct >= 0.85) return 'rojo';
  if (pct >= 0.5) return 'amarillo';
  return 'verde';
}
function celdaCal(d, hoyIso) {
  const nivel = nivelCal(d);
  const num = Number(d.fecha.slice(8));
  const detalle = d.feriado ? esc(d.feriado)
    : !d.es_habil ? 'No hábil'
      : d.total_bloques ? `${d.libres} libre${d.libres === 1 ? '' : 's'}` : 'Sin bloques';
  const pesada = d.libres_pesada > 0 ? '<span class="cal-pesada" title="Hay 12:30 libre (apto D/A5)">12:30 libre</span>' : '';
  const titulo = `${fFechaDia(d.fecha)}: ${d.ocupados} ocupados, ${d.libres} libres, ${d.bloqueados} bloqueados`;
  return `<button type="button" class="cal-dia cal-${nivel}${d.fecha === hoyIso ? ' cal-hoy' : ''}${d.es_habil ? '' : ' cal-nohabil'}"
    data-fecha="${esc(d.fecha)}" title="${esc(titulo)}">
    <span class="cal-num">${num}</span><span class="cal-dow">${DIAS_CAL[(new Date(`${d.fecha}T12:00:00`).getDay() + 6) % 7]}</span>
    <span class="cal-det">${detalle}</span>${pesada}</button>`;
}
async function renderCalendario() {
  const hoyIso = hoy();
  if (!estadoCalendario.mes) estadoCalendario.mes = (estadoAgenda.fecha || hoyIso).slice(0, 7);
  const mes = estadoCalendario.mes;
  const [y, m] = mes.split('-').map(Number);
  view.innerHTML = `
    <div class="panel"><div class="fila cal-barra">
      <button class="btn sec" id="cal-prev" aria-label="Mes anterior">‹</button>
      <h2 class="cal-titulo">${MESES_CAL[m - 1]} ${y}</h2>
      <button class="btn sec" id="cal-next" aria-label="Mes siguiente">›</button>
      <button class="btn sec" id="cal-hoy">Hoy</button>
      <span class="cal-resumen" id="cal-resumen"></span>
    </div>
    <div class="cal-leyenda" aria-label="Leyenda">
      <span><i class="cal-sw cal-verde"></i>Mucho libre</span><span><i class="cal-sw cal-amarillo"></i>Medio</span>
      <span><i class="cal-sw cal-rojo"></i>Lleno</span><span><i class="cal-sw cal-gris"></i>Bloqueado / feriado / fin de semana</span>
      <span><span class="cal-pesada">12:30 libre</span> apto D/A5</span>
    </div></div>
    <div id="cal-cont" class="panel">Cargando...</div>`;
  const cambiar = (n) => { estadoCalendario.mes = n === 0 ? hoyIso.slice(0, 7) : moverMesCal(mes, n); renderCalendario(); };
  $('#cal-prev').onclick = () => cambiar(-1);
  $('#cal-next').onclick = () => cambiar(1);
  $('#cal-hoy').onclick = () => cambiar(0);
  await cargarVista('calendario', `/calendario?mes=${mes}`, (data) => {
    const dias = data.dias || [];
    const libres = dias.reduce((s, d) => s + (d.es_habil ? d.libres : 0), 0);
    const ocup = dias.reduce((s, d) => s + (d.es_habil ? d.ocupados : 0), 0);
    const pct = libres + ocup ? Math.round((ocup / (libres + ocup)) * 100) : 0;
    $('#cal-resumen').textContent = `${libres} cupos libres · ${pct}% de ocupación`;
    const offset = dias.length ? (new Date(`${dias[0].fecha}T12:00:00`).getDay() + 6) % 7 : 0;
    $('#cal-cont').innerHTML = `
      <div class="cal-grilla" role="grid">
        ${DIAS_CAL.map((n) => `<div class="cal-cab">${n}</div>`).join('')}
        ${'<div class="cal-vacio"></div>'.repeat(offset)}
        ${dias.map((d) => celdaCal(d, hoyIso)).join('')}
      </div>`;
    $('#cal-cont').onclick = (e) => {
      const b = e.target.closest('.cal-dia');
      if (!b) return;
      estadoAgenda.fecha = b.dataset.fecha;
      irA('agenda');
    };
  });
}
