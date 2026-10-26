/* ================= almacenamiento del navegador que nunca falla =================
   Dentro de un iframe de otro dominio el navegador puede bloquear el almacenamiento: incluso
   solo acceder a la propiedad lanza SecurityError. Este ayudante envuelve cada operacion en
   try/catch y, tras el primer fallo, guarda en memoria durante esa carga de pagina.
   Uso: AlmacenSeguro.local / AlmacenSeguro.sesion con leer(clave), guardar(clave, valor), quitar(clave). */
(function () {
  function crear(nombre) {
    const memoria = new Map();
    let enMemoria = false;

    // La propiedad se toma dentro del try: el solo acceso puede lanzar.
    const almacen = () => globalThis[nombre];

    function leer(clave) {
      if (!enMemoria) {
        try {
          const v = almacen().getItem(clave);
          return v === undefined ? null : v;
        } catch (_) { enMemoria = true; }
      }
      return memoria.has(clave) ? memoria.get(clave) : null;
    }

    function guardar(clave, valor) {
      const texto = String(valor);
      if (!enMemoria) {
        try { almacen().setItem(clave, texto); return; } catch (_) { enMemoria = true; }
      }
      memoria.set(clave, texto);
    }

    function quitar(clave) {
      memoria.delete(clave);
      if (enMemoria) return;
      try { almacen().removeItem(clave); } catch (_) { enMemoria = true; }
    }

    return { leer, guardar, quitar };
  }

  globalThis.AlmacenSeguro = { local: crear('localStorage'), sesion: crear('sessionStorage') };
})();
