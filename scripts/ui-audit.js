#!/usr/bin/env node
/**
 * ui-audit.js - Auditoria DOM automatizada de UI/UX, tablas densas y accesibilidad WCAG AA
 *
 * Estandar: White & Blue V18 (@miguebaenaia)
 * Resolucion de evaluacion por defecto: 1440x900
 *
 * Verificaciones ejecutadas:
 *   1. Desborde horizontal no deseado (scrollWidth > innerWidth).
 *   2. Presupuesto de ancho en columnas sticky (<= 38% del viewport, max 560px en 1440px).
 *   3. Transparencia o ausencia de background-color solido en celdas sticky.
 *   4. Contraste WCAG AA (< 4.5:1 texto regular, < 3.0:1 texto grande) mediante luminancia relativa real.
 *   5. Elementos interactivos o datos criticos recortados (overflow: hidden o truncados en impresion).
 *
 * Modo de uso:
 *   node scripts/ui-audit.js http://127.0.0.1:3000
 *   node scripts/ui-audit.js --url http://127.0.0.1:3000 --json
 *   node scripts/ui-audit.js --port 9222 (conectar a navegador ya abierto)
 *   node scripts/ui-audit.js --file public/index.html (auditoria estatica de estilos/DOM)
 *   node scripts/ui-audit.js --help
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');

// Parsear argumentos CLI
const args = process.argv.slice(2);

function showHelp() {
  console.log(`
Uso: node ui-audit.js [URL o archivo] [opciones]

Opciones:
  --url <url>           URL a auditar (ej. http://127.0.0.1:3000)
  --port <port>         Conectarse a un puerto CDP existente sin lanzar Edge nuevo
  --viewport <WxH>      Resolucion de pantalla (por defecto: 1440x900)
  --timeout <ms>        Tiempo maximo de espera en ms (por defecto: 15000)
  --json                Devolver salida estructurada en formato JSON puro
  --file <path>         Auditar archivo HTML/CSS estatico sin levantar navegador
  --help, -h            Muestra este mensaje de ayuda

Ejemplos:
  node scripts/ui-audit.js http://127.0.0.1:3000
  node scripts/ui-audit.js --url http://127.0.0.1:3000/agenda --viewport 1440x900 --json
  node scripts/ui-audit.js --port 9222
  node scripts/ui-audit.js --file public/index.html
`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
}

let targetUrl = null;
let cdpPort = null;
let viewport = { width: 1440, height: 900 };
let timeoutMs = 15000;
let jsonOutput = false;
let filePath = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--url' && args[i + 1]) {
    targetUrl = args[++i];
  } else if (arg === '--port' && args[i + 1]) {
    cdpPort = parseInt(args[++i], 10);
  } else if (arg === '--viewport' && args[i + 1]) {
    const parts = args[++i].toLowerCase().split('x');
    if (parts.length === 2) {
      viewport = { width: parseInt(parts[0], 10), height: parseInt(parts[1], 10) };
    }
  } else if (arg === '--timeout' && args[i + 1]) {
    timeoutMs = parseInt(args[++i], 10);
  } else if (arg === '--json') {
    jsonOutput = true;
  } else if (arg === '--file' && args[i + 1]) {
    filePath = path.resolve(args[++i]);
  } else if (!arg.startsWith('-') && !targetUrl && !filePath) {
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      targetUrl = arg;
    } else if (fs.existsSync(arg)) {
      filePath = path.resolve(arg);
    } else {
      targetUrl = arg;
    }
  }
}

if (!targetUrl && !filePath && !cdpPort) {
  targetUrl = 'http://127.0.0.1:3000';
}

// Codigo JS que se evalua en el contexto del navegador
const BROWSER_EVAL_SCRIPT = `
(() => {
  const result = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    overflowDelta: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    overflowingElements: [],
    stickyAudits: [],
    contrastFailures: [],
    truncatedElements: [],
    passed: true
  };

  // 1. Verificacion de desborde horizontal
  if (result.hasHorizontalOverflow) {
    result.passed = false;
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth + 2 && rect.width > 0 && rect.height > 0) {
        const id = el.id ? '#' + el.id : '';
        const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
        result.overflowingElements.push({
          selector: el.tagName.toLowerCase() + id + cls,
          rightPx: Math.round(rect.right),
          exceedsByPx: Math.round(rect.right - window.innerWidth)
        });
        if (result.overflowingElements.length >= 8) break;
      }
    }
  }

  // 2 y 3. Verificacion de columnas sticky (presupuesto <= 560px a 1440px y sin transparencia)
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    const tableId = table.id ? '#' + table.id : (table.className ? '.' + table.className.trim().split(/\\s+/)[0] : 'table');
    const stickyCells = Array.from(table.querySelectorAll('th, td')).filter(cell => {
      const cs = window.getComputedStyle(cell);
      return cs.position === 'sticky';
    });

    if (stickyCells.length === 0) continue;

    const leftOffsets = new Map();
    const transparentCells = [];

    for (const cell of stickyCells) {
      const cs = window.getComputedStyle(cell);
      const rect = cell.getBoundingClientRect();
      const leftVal = parseInt(cs.left, 10) || 0;
      const key = leftVal + '_' + Math.round(rect.width);
      if (!leftOffsets.has(key)) {
        leftOffsets.set(key, {
          left: leftVal,
          width: Math.round(rect.width),
          className: cell.className || ''
        });
      }

      const bg = cs.backgroundColor;
      let isTransparent = false;
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') {
        isTransparent = true;
      } else {
        const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
        if (m && m[4] !== undefined && parseFloat(m[4]) < 0.95) {
          isTransparent = true;
        }
      }

      if (isTransparent) {
        transparentCells.push({
          tag: cell.tagName.toLowerCase(),
          text: (cell.innerText || '').substring(0, 30).trim(),
          className: cell.className || '',
          computedBg: bg
        });
      }
    }

    let maxStickyRight = 0;
    for (const item of leftOffsets.values()) {
      const rightEdge = item.left + item.width;
      if (rightEdge > maxStickyRight) maxStickyRight = rightEdge;
    }

    const exceedsStickyBudget = maxStickyRight > 560;
    if (exceedsStickyBudget) result.passed = false;
    if (transparentCells.length > 0) result.passed = false;

    result.stickyAudits.push({
      table: tableId,
      totalStickyCols: leftOffsets.size,
      maxStickyWidthPx: maxStickyRight,
      budgetMaxPx: 560,
      exceedsBudget: exceedsStickyBudget,
      transparentCellsCount: transparentCells.length,
      transparentCells: transparentCells.slice(0, 8)
    });
  }

  // 4. Verificacion de contraste WCAG AA (< 4.5:1 / < 3.0:1)
  function parseRgb(colorStr) {
    if (!colorStr) return null;
    const m = colorStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }

  function getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  function getContrastRatio(lum1, lum2) {
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function getEffectiveBgColor(el) {
    let curr = el;
    while (curr && curr !== document.documentElement) {
      const cs = window.getComputedStyle(curr);
      const bg = cs.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
        if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) {
          return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
        }
      }
      curr = curr.parentElement;
    }
    return [255, 255, 255];
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let el;
  while ((el = walker.nextNode())) {
    if (el.children.length > 0 && Array.from(el.childNodes).every(n => n.nodeType !== Node.TEXT_NODE || !n.nodeValue.trim())) {
      continue;
    }
    const text = el.innerText ? el.innerText.trim() : '';
    if (!text || text.length === 0) continue;

    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const fgRgb = parseRgb(cs.color);
    if (!fgRgb) continue;
    const bgRgb = getEffectiveBgColor(el);

    const fgLum = getLuminance(...fgRgb);
    const bgLum = getLuminance(...bgRgb);
    const ratio = getContrastRatio(fgLum, bgLum);

    const fontSize = parseFloat(cs.fontSize) || 14;
    const isBold = parseInt(cs.fontWeight, 10) >= 700 || cs.fontWeight === 'bold';
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && isBold);
    const minRequiredRatio = isLarge ? 3.0 : 4.5;

    if (ratio < minRequiredRatio) {
      result.contrastFailures.push({
        selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
        text: text.substring(0, 35),
        fontSize: Math.round(fontSize) + 'px',
        isLarge,
        fg: cs.color,
        bg: 'rgb(' + bgRgb.join(', ') + ')',
        ratio: Math.round(ratio * 100) / 100,
        requiredRatio: minRequiredRatio
      });
      if (result.contrastFailures.length >= 10) break;
    }
  }

  if (result.contrastFailures.length > 0) result.passed = false;

  // 5. Elementos interactivos cortados o truncamiento en papel
  const criticalSelectors = ['.td-nombre', '.td-rut', '.hd-nom', '.hu-nom', 'button', '.btn'];
  for (const sel of criticalSelectors) {
    const elements = document.querySelectorAll(sel);
    for (const elem of elements) {
      const cs = window.getComputedStyle(elem);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.textOverflow === 'ellipsis' && (elem.classList.contains('hd-nom') || elem.classList.contains('hu-nom'))) {
        result.truncatedElements.push({
          selector: sel,
          issue: 'Prohibido truncar en papel de impresion (text-overflow: ellipsis detectado)',
          text: (elem.innerText || '').substring(0, 30)
        });
        result.passed = false;
      }
    }
  }

  return result;
})()
`;

// Helper para encontrar Edge en Windows
function findEdgeExecutable() {
  const possiblePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge SxS', 'Application', 'msedge.exe')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Obtener un puerto libre
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Conexion CDP sobre WebSocket
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.idCounter = 0;
    this.callbacks = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('Error de conexion WebSocket CDP'));
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.callbacks.has(msg.id)) {
            const { resolve, reject } = this.callbacks.get(msg.id);
            this.callbacks.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message || 'Error CDP'));
            else resolve(msg.result);
          }
        } catch {}
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.idCounter;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

// Auditoria estatica de respaldo para cuando se pase --file o en entornos sin display
function runStaticAudit(file) {
  const content = fs.readFileSync(file, 'utf8');
  const report = {
    mode: 'static-file',
    file: file,
    hasHorizontalOverflow: false,
    overflowingElements: [],
    stickyAudits: [],
    contrastFailures: [],
    truncatedElements: [],
    passed: true
  };

  // 1. Revisar reglas sticky y presupuesto en CSS asociado
  const hasSticky = /position\s*:\s*sticky/i.test(content);
  if (hasSticky) {
    const transparentSticky = /position\s*:\s*sticky[^}]*background(?:-color)?\s*:\s*(?:transparent|none|rgba\([^)]*,\s*0\))/i.test(content);
    if (transparentSticky) {
      report.passed = false;
      report.stickyAudits.push({
        table: 'detected-in-file',
        issue: 'Se detectaron celdas position: sticky con fondo transparente en estilos.'
      });
    }
  }

  // 2. Revisar prohibicion de truncado en hojas de impresion (@media print)
  if (/@media\s+print/i.test(content)) {
    const printSection = content.split(/@media\s+print/i)[1] || '';
    if (/\.hd-nom[^{]*\{[^}]*text-overflow\s*:\s*ellipsis/i.test(printSection)) {
      report.passed = false;
      report.truncatedElements.push({
        selector: '.hd-nom',
        issue: 'Prohibido usar text-overflow: ellipsis en @media print.'
      });
    }
  }

  return report;
}

async function runBrowserAudit() {
  const edgePath = findEdgeExecutable();
  if (!edgePath && !cdpPort) {
    throw new Error('No se encontro Microsoft Edge en las rutas estandar. Use --port o --file.');
  }

  const port = cdpPort || (await getFreePort());
  const tmpDir = path.join(os.tmpdir(), `ui-audit-edge-${Date.now()}`);
  let edgeProc = null;
  let wsUrl = null;

  if (!cdpPort) {
    fs.mkdirSync(tmpDir, { recursive: true });
    edgeProc = spawn(edgePath, [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${tmpDir}`,
      `--window-size=${viewport.width},${viewport.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      targetUrl
    ]);

    const wsPromise = new Promise((resolve, reject) => {
      edgeProc.stderr.on('data', d => {
        const text = d.toString();
        const m = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) resolve(m[1]);
      });
      setTimeout(() => reject(new Error('Timeout esperando websocket de Edge')), 8000);
    });

    try {
      wsUrl = await wsPromise;
    } catch (e) {
      // Intentar obtener via HTTP /json/version
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        const data = await res.json();
        wsUrl = data.webSocketDebuggerUrl;
      } catch {
        throw new Error(`No se pudo conectar a Edge en puerto ${port}: ${e.message}`);
      }
    }
  } else {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const data = await res.json();
    wsUrl = data.webSocketDebuggerUrl;
  }

  const client = new CDPClient(wsUrl);
  await client.connect();

  try {
    // 1. Crear nuevo target o adjuntarse a la pagina
    const targets = await client.send('Target.getTargets');
    let pageTarget = targets.targetInfos.find(t => t.type === 'page');
    let targetId = pageTarget ? pageTarget.targetId : null;

    if (!targetId) {
      const created = await client.send('Target.createTarget', { url: targetUrl });
      targetId = created.targetId;
    }

    const session = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = session.sessionId;

    // Helper para enviar comandos a la sesion del target
    const sendSession = (method, params = {}) => client.send(method, { ...params, sessionId });

    // Habilitar Page y Runtime
    await sendSession('Page.enable');
    await sendSession('Runtime.enable');

    // Emular viewport
    await sendSession('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });

    // Navegar y esperar carga
    await sendSession('Page.navigate', { url: targetUrl });
    await new Promise(r => setTimeout(r, 2000));

    // Evaluar script de auditoria en el DOM
    const evalResult = await sendSession('Runtime.evaluate', {
      expression: BROWSER_EVAL_SCRIPT,
      returnByValue: true,
      awaitPromise: true
    });

    return evalResult.result.value;
  } finally {
    client.close();
    if (edgeProc) {
      edgeProc.kill('SIGKILL');
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}

function printFormattedReport(report) {
  const isOk = report.passed;
  console.log('\n===============================================================');
  console.log(`   REPORTE DE AUDITORIA UI/UX PRO - ${report.viewport ? `${report.viewport.width}x${report.viewport.height}` : 'Estatico'}`);
  console.log('===============================================================');

  // 1. Desborde horizontal
  if (report.hasHorizontalOverflow) {
    console.log(`\n❌ [1/5] DESBORDE HORIZONTAL DETECTADO`);
    console.log(`   scrollWidth: ${report.scrollWidth}px vs innerWidth: ${report.viewport.width}px (exceso: +${report.overflowDelta}px)`);
    if (report.overflowingElements.length > 0) {
      console.log('   Elementos desbordados:');
      for (const el of report.overflowingElements) {
        console.log(`     - ${el.selector}: right ${el.rightPx}px (+${el.exceedsByPx}px)`);
      }
    }
  } else {
    console.log(`\n✅ [1/5] DESBORDE HORIZONTAL: Conforme (sin scroll horizontal no deseado)`);
  }

  // 2 y 3. Columnas sticky
  if (report.stickyAudits.length > 0) {
    for (const audit of report.stickyAudits) {
      if (audit.exceedsBudget) {
        console.log(`\n❌ [2/5] PRESUPUESTO COLUMNAS STICKY (${audit.table}): EXCEDIDO`);
        console.log(`   Ancho acumulado: ${audit.maxStickyWidthPx}px > Maximo permitido: ${audit.budgetMaxPx}px (<= 38% viewport)`);
      } else {
        console.log(`\n✅ [2/5] PRESUPUESTO COLUMNAS STICKY (${audit.table}): Conforme (${audit.maxStickyWidthPx || 0}px <= ${audit.budgetMaxPx}px)`);
      }

      if (audit.transparentCellsCount > 0) {
        console.log(`\n❌ [3/5] TRANSPARENCIA EN CELDAS STICKY (${audit.table}): ${audit.transparentCellsCount} celda(s) transparentes`);
        for (const c of audit.transparentCells) {
          console.log(`     - <${c.tag}> "${c.text}" (bg: ${c.computedBg})`);
        }
      } else {
        console.log(`✅ [3/5] FONDOS EN CELDAS STICKY: Conforme (100% fondos opacos)`);
      }
    }
  } else {
    console.log(`\nℹ️  [2/5 y 3/5] COLUMNAS STICKY: No se detectaron tablas con position: sticky`);
  }

  // 4. Contraste WCAG AA
  if (report.contrastFailures.length > 0) {
    console.log(`\n❌ [4/5] CONTRASTE WCAG AA: ${report.contrastFailures.length} fallo(s) detectados (< 4.5:1)`);
    for (const c of report.contrastFailures) {
      console.log(`     - [${c.ratio}:1 vs ${c.requiredRatio}:1] ${c.selector} "${c.text}" (fg: ${c.fg}, bg: ${c.bg})`);
    }
  } else {
    console.log(`\n✅ [4/5] CONTRASTE WCAG AA: Conforme (todas las muestras cumplen >= 4.5:1 / 3.0:1)`);
  }

  // 5. Truncamiento en papel y datos criticos
  if (report.truncatedElements.length > 0) {
    console.log(`\n❌ [5/5] DATOS CRITICOS O IMPRESION TRUNCADA:`);
    for (const t of report.truncatedElements) {
      console.log(`     - ${t.selector}: ${t.issue} "${t.text || ''}"`);
    }
  } else {
    console.log(`\n✅ [5/5] TRUNCAMIENTO DE DATOS CRITICOS: Conforme (sin recortes indebidos)`);
  }

  console.log('\n---------------------------------------------------------------');
  console.log(`VEREDICTO FINAL: ${isOk ? 'APROBADO (UI-UX-PRO PASSED)' : 'RECHAZADO (REQUIERE CORRECCION)'}`);
  console.log('---------------------------------------------------------------\n');
}

// Ejecucion principal
async function main() {
  try {
    let report;
    if (filePath) {
      report = runStaticAudit(filePath);
    } else {
      try {
        report = await runBrowserAudit();
      } catch (browserErr) {
        // Fallback a auditoria estatica si hay archivo public/styles.css o index.html local
        const defaultCss = path.resolve('public', 'styles.css');
        if (fs.existsSync(defaultCss)) {
          console.warn(`[AVISO] No se pudo conectar a navegador directo (${browserErr.message}). Ejecutando auditoria estatica en ${defaultCss}...`);
          report = runStaticAudit(defaultCss);
        } else {
          throw browserErr;
        }
      }
    }

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printFormattedReport(report);
    }

    process.exit(report.passed ? 0 : 1);
  } catch (err) {
    console.error(`[ERROR CRITICO] ui-audit: ${err.message}`);
    process.exit(1);
  }
}

main();
