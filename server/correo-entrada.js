'use strict';
// Lectura de respuestas a los correos del sistema (Outlook clasico via COM/PowerShell).
// - Logica pura (extraerId, limpiarRespuesta, clasificar, elegirCitaPorRemitente): test/correo-entrada.test.js.
// - Lectura/marcado: server/outlook-leer.ps1. Los datos viajan en un JSON temporal;
//   nunca se interpolan en la linea de comandos. Bajo node --test o fuera de Windows no hace nada.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SCRIPT = path.join(__dirname, 'outlook-leer.ps1');
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const TIMEOUT_MS = 120000;
const DIAS_LEER = 14;
const CATEGORIA_PROCESADO = 'Agenda-procesado';
const CATEGORIA_REVISAR = 'Agenda-revisar';

// ================= logica pura =================
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function extraerId(asunto) {
  const m = String(asunto || '').match(/\[\s*cita\s+(\d+)\s*\]/i);
  return m ? Number(m[1]) : null;
}

// Separadores tras los cuales empieza el historial citado.
const CORTES = [
  /^-{2,}\s*(original message|mensaje original)\s*-{2,}/i,
  /^_{8,}\s*$/,
  /^(from|de|sent|enviado|enviado el|para|to)\s*:/i,
  /^(el|on)\s.*(escribi[oó]|wrote)\s*:?\s*$/i,
  /(escribi[oó]|wrote)\s*:\s*$/i,
  /^--\s*$/,
  /^enviado desde mi /i,
  /^sent from my /i,
];
const FIRMA = /^(saludos|saludos cordiales|un saludo|atte\.?|atentamente|cordialmente|slds)\b/i;

function limpiarRespuesta(cuerpo) {
  const lineas = String(cuerpo || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const cruda of lineas) {
    const l = cruda.trim();
    if (CORTES.some((re) => re.test(l))) break;
    if (out.some((x) => x) && FIRMA.test(l)) break;
    if (l.startsWith('>')) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

const NEGADAS = /\bno\s+(puedo|podre|podria|asistire|asistir|voy(\s+a\s+ir)?|ire|alcanzo|llego|confirmo|estare)\b/g;
const REAGENDAR = /\b(cambiar|cambio de (hora|fecha|dia)|otra hora|otra fecha|otro dia|reagendar|reagendo|reprogramar)\b/;
const CONFIRMA = /\b(si|confirmo|confirmado|confirmada|asistire|voy a ir|ahi estare|alli estare|ok|okay|de acuerdo)\b/;

// 'confirma' | 'no_asiste' | 'reagendar' | 'revisar'
function clasificar(texto) {
  const t = normalizar(texto).replace(/\s+/g, ' ').trim();
  if (!t || /[?¿]/.test(t)) return 'revisar';
  const noAsiste = NEGADAS.test(t);
  NEGADAS.lastIndex = 0;
  const resto = t.replace(NEGADAS, ' ');
  const reagendar = REAGENDAR.test(resto);
  const confirma = CONFIRMA.test(resto);
  if (reagendar && !confirma) return 'reagendar';
  if (reagendar && confirma) return 'revisar';
  if (noAsiste && confirma) return 'revisar';
  if (noAsiste) return 'no_asiste';
  if (confirma) return 'confirma';
  return 'revisar';
}

// Citas del remitente: solo si hay exactamente una proxima (fecha >= hoy).
function elegirCitaPorRemitente(citas, hoy) {
  const prox = (citas || []).filter((c) => String(c.fecha) >= hoy);
  return prox.length === 1 ? prox[0] : null;
}

// ================= Outlook (PowerShell) =================
function soportado() {
  return process.platform === 'win32' && process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT;
}
function cuenta() { return process.env.OUTLOOK_CUENTA || process.env.SMTP_USER || null; }

function escribirTemp(datos) {
  const ruta = path.join(os.tmpdir(), `agenda-outlook-leer-${crypto.randomBytes(12).toString('hex')}.json`);
  fs.writeFileSync(ruta, JSON.stringify(datos), { encoding: 'utf8', mode: 0o600 });
  return ruta;
}
const argsLeer = (ruta) => [...PS_ARGS, '-File', SCRIPT, '-Payload', ruta];
const argsMarcar = (ruta) => [...PS_ARGS, '-File', SCRIPT, '-Marcar', ruta];

function correrPs(args, ruta) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        fs.rm(ruta, { force: true }, () => {});
        if (err) return reject(new Error(String(stderr || err.message).trim() || 'Error leyendo Outlook'));
        resolve(String(stdout || ''));
      });
  });
}

// Comparte la cola COM con el envio para no abrir Outlook en paralelo.
function enCola(fn) {
  const outlook = require('./correo-outlook');
  return outlook.enCola ? outlook.enCola(fn) : fn();
}

async function leer() {
  if (!soportado()) return [];
  const c = cuenta();
  if (!c) throw new Error('Falta OUTLOOK_CUENTA/SMTP_USER para leer respuestas.');
  return enCola(async () => {
    const ruta = escribirTemp({ cuenta: c, dias: DIAS_LEER, excluir: CATEGORIA_PROCESADO });
    const out = (await correrPs(argsLeer(ruta), ruta)).replace(/^﻿/, '').trim();
    if (!out) return [];
    const datos = JSON.parse(out);
    return Array.isArray(datos) ? datos : [datos];
  });
}

// items: [{ entryId, categoria }] (una categoria por item; se agregan, no reemplazan).
async function marcar(items) {
  if (!soportado() || !items || !items.length) return false;
  return enCola(async () => {
    const ruta = escribirTemp({ cuenta: cuenta(), items });
    await correrPs(argsMarcar(ruta), ruta);
    return true;
  });
}

module.exports = {
  normalizar, extraerId, limpiarRespuesta, clasificar, elegirCitaPorRemitente,
  soportado, leer, marcar, argsLeer, argsMarcar, SCRIPT,
  CATEGORIA_PROCESADO, CATEGORIA_REVISAR,
};
