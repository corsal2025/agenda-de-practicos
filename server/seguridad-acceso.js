'use strict';
// Control de acceso del servidor (sin rutas): protege contra DNS rebinding (cabecera Host) y
// CSRF (cabecera Origin / Sec-Fetch-Site), agrega cabeceras minimas a toda respuesta y fija el
// limite del cuerpo JSON. No hay cookies ni sesion, asi que el vector es el navegador del usuario
// llamando a 127.0.0.1:4900 desde otra pagina.
const net = require('node:net');
const express = require('express');

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HOSTS_LOCALES = ['localhost', '127.0.0.1', '[::1]'];
const RUTAS_SIN_IFRAME = new Set(['confirmar', 'rechazar', 'reagendar']);
// Esquema + host (nombre, IPv4 o IPv6 entre corchetes) + puerto opcional: nada que pueda colarse en una CSP.
const ORIGEN_SIMPLE = /^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:\d{1,5})?$/i;
const RUTA_IMPORT = '/api/import';
const LIMITE_JSON = '1mb';
const LIMITE_IMPORT = '25mb'; // mismo tope que multer: el navegador manda las hojas del Excel como JSON
const MAX_LOG = 100;

// Host de la cabecera sin el puerto: "localhost:4900" -> "localhost", "[::1]:4900" -> "[::1]".
function hostSinPuerto(host) {
  const h = String(host || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

// Normaliza un origen (esquema + host + puerto) o falla nombrando la variable de entorno.
function normalizarOrigen(texto, variable, { admiteRuta }) {
  let u;
  try { u = new URL(texto); } catch (_) {
    throw new Error(`${variable}: "${texto}" no es una URL valida (ejemplo: https://dominio.ejemplo.cl).`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`${variable}: "${texto}" debe usar http o https.`);
  }
  if (!admiteRuta && (u.pathname !== '/' || u.search || u.hash)) {
    throw new Error(`${variable}: "${texto}" debe ser solo el origen, sin ruta (ejemplo: https://dominio.ejemplo.cl).`);
  }
  // Lo escrito debe ser el origen normalizado (salvo barra final y mayusculas): `URL` tolera
  // basura como ";script-src" en el host, que luego quedaria pegada dentro de frame-ancestors.
  const escrito = texto.replace(/\/$/, '').toLowerCase();
  if (!admiteRuta && (!ORIGEN_SIMPLE.test(u.origin) || escrito !== u.origin.toLowerCase())) {
    throw new Error(`${variable}: "${paraLog(texto)}" contiene caracteres que no pertenecen a un origen (ejemplo: https://dominio.ejemplo.cl).`);
  }
  return u.origin;
}

function listaDeOrigenes(cruda) {
  return String(cruda || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => normalizarOrigen(s, 'AGENDA_ORIGENES_PERMITIDOS', { admiteRuta: false }));
}

// Texto seguro para el registro: sin saltos de linea (el valor lo controla quien ataca) y acotado.
const paraLog = (v) => String(v ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, MAX_LOG);

// opciones: { host: AGENDA_HOST, urlPublica: AGENDA_URL_PUBLICA, origenes: AGENDA_ORIGENES_PERMITIDOS (texto crudo) }
function crear({ host = null, urlPublica = null, origenes = null } = {}) {
  const origenesPadre = [...new Set(listaDeOrigenes(origenes))];
  const urlPub = urlPublica ? new URL(normalizarOrigen(urlPublica, 'AGENDA_URL_PUBLICA', { admiteRuta: true })) : null;

  const hostsPermitidos = new Set(HOSTS_LOCALES);
  if (urlPub) hostsPermitidos.add(hostSinPuerto(urlPub.host));
  if (host && net.isIP(host) && host !== '0.0.0.0' && host !== '::') {
    hostsPermitidos.add(net.isIPv6(host) ? `[${host.toLowerCase()}]` : host);
  }
  const origenesPermitidos = new Set(origenesPadre);
  if (urlPub) origenesPermitidos.add(urlPub.origin);
  const frameAncestors = ['\'self\'', ...origenesPadre].join(' ');

  function origenValido(origin, hostPeticion) {
    if (origin === 'null') return false;
    let u;
    try { u = new URL(origin); } catch (_) { return false; }
    return u.host === String(hostPeticion).toLowerCase() || origenesPermitidos.has(u.origin);
  }

  // Decide si una peticion pasa. Devuelve null o { status, motivo, valor, mensaje }.
  function decidir({ metodo, host: hostPeticion, origin, secFetchSite }) {
    if (!hostPeticion || !hostsPermitidos.has(hostSinPuerto(hostPeticion))) {
      return { status: 421, motivo: 'host', valor: hostPeticion, mensaje: 'Host no permitido.' };
    }
    if (METODOS_SEGUROS.has(String(metodo).toUpperCase())) return null;
    const rechazo = { status: 403, mensaje: 'Origen no permitido.' };
    if (origin !== undefined) {
      return origenValido(origin, hostPeticion) ? null : { ...rechazo, motivo: 'origin', valor: origin };
    }
    if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
      return { ...rechazo, motivo: 'sec-fetch-site', valor: secFetchSite };
    }
    return null; // same-origin, none o sin cabeceras de navegador (curl, scripts, tests)
  }

  // En minusculas: Express enruta sin distinguir mayusculas, asi que /CONFIRMAR llega al mismo handler.
  const primerSegmento = (url) => (String(url || '').split('?')[0].split('/')[1] || '').toLowerCase();

  function acceso(req, res, next) {
    const rechazo = decidir({
      metodo: req.method, host: req.headers.host, origin: req.headers.origin,
      secFetchSite: req.headers['sec-fetch-site'],
    });
    if (!rechazo) return next();
    // Solo el primer segmento de la ruta: el resto puede contener un token de enlace publico.
    console.warn(`[ACCESO] ${rechazo.status} ${req.method} /${paraLog(primerSegmento(req.originalUrl))} ${rechazo.motivo}=${paraLog(rechazo.valor)}`);
    if (req.originalUrl.startsWith('/api/')) return res.status(rechazo.status).json({ error: rechazo.mensaje });
    return res.status(rechazo.status).type('text/plain').send(rechazo.mensaje);
  }

  function cabeceras(req, res, next) {
    const sinIframe = RUTAS_SIN_IFRAME.has(primerSegmento(req.originalUrl));
    const csp = `frame-ancestors ${sinIframe ? "'none'" : frameAncestors}`;
    const poner = () => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', csp);
      if (sinIframe) res.setHeader('X-Frame-Options', 'DENY');
    };
    poner();
    // El 404 por defecto de Express pone su propia CSP ("default-src 'none'"): se reafirma al escribir la cabecera.
    const writeHead = res.writeHead;
    res.writeHead = function conCabeceras(...args) { poner(); return writeHead.apply(this, args); };
    next();
  }

  // Un 413 responde en espanol (el mensaje por defecto del parser va en ingles) y no llega a las rutas.
  const conMensaje413 = (parser) => (req, res, next) => parser(req, res, (err) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'El envío es demasiado grande. Reduce el tamaño e inténtalo de nuevo.' });
    }
    return next(err);
  });
  const jsonChico = conMensaje413(express.json({ limit: LIMITE_JSON }));
  const jsonImport = conMensaje413(express.json({ limit: LIMITE_IMPORT }));
  const json = (req, res, next) => (req.path === RUTA_IMPORT ? jsonImport : jsonChico)(req, res, next);

  return { acceso, cabeceras, json, decidir, frameAncestors };
}

function desdeEntorno() {
  const { HOST, URL_PUBLICA, ORIGENES_PERMITIDOS } = require('./config');
  return crear({ host: HOST, urlPublica: URL_PUBLICA, origenes: ORIGENES_PERMITIDOS });
}

module.exports = { crear, desdeEntorno };
