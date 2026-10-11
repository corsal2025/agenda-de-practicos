/* Control de tamaño de letra (accesibilidad). Escala toda la interfaz en proporción con CSS zoom,
   así letras, botones, íconos y espacios crecen juntos y el diseño se reacomoda solo.
   La preferencia queda en este equipo (localStorage). Se carga en <head> para evitar parpadeo. */
(function () {
  var NIVELES = [100, 115, 130, 150];
  var CLAVE = 'agenda-tamano-letra';
  function leer() {
    try { var v = Number(localStorage.getItem(CLAVE)); return NIVELES.indexOf(v) >= 0 ? v : 100; } catch (_) { return 100; }
  }
  function aplicar(v) {
    document.documentElement.setAttribute('data-escala', String(v));
    try { localStorage.setItem(CLAVE, String(v)); } catch (_) { /* sin almacenamiento: solo esta sesion */ }
    var etiqueta = document.getElementById('letra-nivel');
    if (etiqueta) etiqueta.textContent = v + '%';
    var menos = document.getElementById('letra-menos');
    var mas = document.getElementById('letra-mas');
    if (menos) menos.disabled = v === NIVELES[0];
    if (mas) mas.disabled = v === NIVELES[NIVELES.length - 1];
    window.dispatchEvent(new Event('resize')); // recalcula offsets fijos y posiciones (guia, menus)
  }
  function cambiar(paso) {
    var i = NIVELES.indexOf(leer()) + paso;
    if (i < 0 || i >= NIVELES.length) return;
    aplicar(NIVELES[i]);
  }
  document.documentElement.setAttribute('data-escala', String(leer()));
  document.addEventListener('DOMContentLoaded', function () {
    aplicar(leer());
    var menos = document.getElementById('letra-menos');
    var mas = document.getElementById('letra-mas');
    var nivel = document.getElementById('letra-nivel');
    if (menos) menos.onclick = function () { cambiar(-1); };
    if (mas) mas.onclick = function () { cambiar(1); };
    if (nivel) nivel.onclick = function () { aplicar(100); };
  });
  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey || !e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); cambiar(1); }
    else if (e.key === '-') { e.preventDefault(); cambiar(-1); }
    else if (e.key === '0') { e.preventDefault(); aplicar(100); }
  });
  window.TamanoLetra = { cambiar: cambiar, aplicar: aplicar, NIVELES: NIVELES };
}());
