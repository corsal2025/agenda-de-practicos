'use strict';
const PDFDocument = require('pdfkit');
const { db } = require('./db');

const SELECT = `
  SELECT a.*, e.nombre AS examinador
  FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.fecha = ?
  ORDER BY e.nombre, a.hora
`;

// Anchos fijos; la ultima columna (Observaciones) se estira con lo que sobre de la hoja.
const COLS = [
  { titulo: 'N°', ancho: 25 },
  { titulo: 'Hora', ancho: 40 },
  { titulo: 'RUT', ancho: 70 },
  { titulo: 'Nombre', ancho: 130 },
  { titulo: 'Clase', ancho: 35 },
  { titulo: 'Teléfono', ancho: 70 },
  { titulo: 'Tipo', ancho: 65 },
  { titulo: 'Resultado', ancho: 75 },
  { titulo: 'Observaciones', ancho: 80 },
];

// Genera el PDF de la agenda diaria, una pagina por examinador (mismo contenido que
// la vista imprimible de "Agenda del dia", pero generado en el servidor: no depende
// del dialogo de impresion del navegador).
function generarPdfDia(fecha, organismo, unidad) {
  const filas = db.prepare(SELECT).all(fecha);
  const porExaminador = {};
  for (const r of filas) (porExaminador[r.examinador] ||= []).push(r);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const anchoFijo = COLS.reduce((s, c) => s + c.ancho, 0);
  COLS[COLS.length - 1].ancho += Math.max(0, anchoUtil - anchoFijo);

  const examinadores = Object.keys(porExaminador);
  if (!examinadores.length) {
    doc.fontSize(12).text(`Sin bloques para ${fecha}.`, doc.page.margins.left, doc.page.margins.top);
    return doc;
  }
  examinadores.forEach((ex, i) => {
    if (i > 0) doc.addPage();
    dibujarPagina(doc, ex, porExaminador[ex], fecha, organismo, unidad);
  });
  return doc;
}

function fila(doc, x0, y, valores, negrita) {
  doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica');
  let x = x0;
  valores.forEach((v, i) => {
    doc.text(v || '', x + 3, y, { width: COLS[i].ancho - 6 });
    x += COLS[i].ancho;
  });
}

function dibujarPagina(doc, examinador, filas, fecha, organismo, unidad) {
  const x0 = doc.page.margins.left;
  const anchoTabla = COLS.reduce((s, c) => s + c.ancho, 0);
  let y = doc.page.margins.top;

  doc.fontSize(13).font('Helvetica-Bold').text(`${organismo} — ${unidad}`, x0, y);
  y += 18;
  doc.fontSize(11).font('Helvetica').text(`Agenda del día ${fecha} — ${examinador}`, x0, y);
  y += 22;

  doc.fontSize(9);
  fila(doc, x0, y, COLS.map((c) => c.titulo), true);
  y += 14;
  doc.moveTo(x0, y).lineTo(x0 + anchoTabla, y).stroke();
  y += 4;

  doc.fontSize(8);
  let n = 0;
  for (const r of filas) {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    if (r.bloqueado) {
      fila(doc, x0, y, ['', r.hora, '', `NO DISPONIBLE — ${r.bloqueo_motivo || 'BLOQUEADO'}`]);
    } else if (!r.rut && !r.nombre) {
      fila(doc, x0, y, ['', r.hora, '', 'Disponible']);
    } else {
      n += 1;
      fila(doc, x0, y, [
        String(n), r.hora, r.rut || '', (r.nombre || '').trim(), r.clase || '',
        r.contacto || '',
        r.tipo_cita === 'REAGENDADO' ? 'Reagendado' : r.tipo_cita === 'TRASLADO EN TERRENO' ? 'Terreno' : '',
        r.resultado || '',
      ]);
    }
    y += 14;
  }
}

module.exports = { generarPdfDia };
