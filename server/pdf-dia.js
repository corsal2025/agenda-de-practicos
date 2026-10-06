'use strict';
// PDF de la agenda diaria generado en el servidor: una hoja por examinador, sin depender
// del dialogo de impresion del navegador.
const PDFDocument = require('pdfkit');
const { db } = require('./db');

const SELECT = `
  SELECT a.*, e.nombre AS examinador
  FROM agenda a JOIN examinadores e ON e.id = a.examinador_id
  WHERE a.fecha = ?
  ORDER BY e.nombre, a.hora
`;

// Mismas columnas que la hoja por examinador de la vista imprimible. Observaciones se estira.
const COLUMNAS = [
  { titulo: 'N°', ancho: 28 },
  { titulo: 'Hora', ancho: 42 },
  { titulo: 'RUT', ancho: 78 },
  { titulo: 'Nombre', ancho: 250 },
  { titulo: 'Clase', ancho: 40 },
  { titulo: 'Observaciones', ancho: 0 },
];

function fFecha(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || '');
}

function generarPdfDia(fecha, organismo, unidad) {
  const filas = db.prepare(SELECT).all(fecha);
  const porExaminador = {};
  for (const r of filas) (porExaminador[r.examinador] ||= []).push(r);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const util = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = COLUMNAS.map((c) => ({ ...c }));
  const fijo = cols.reduce((s, c) => s + c.ancho, 0);
  cols[cols.length - 1].ancho = Math.max(60, util - fijo);

  const examinadores = Object.keys(porExaminador);
  if (!examinadores.length) {
    doc.fontSize(12).text(`Sin bloques para ${fFecha(fecha)}.`, doc.page.margins.left, doc.page.margins.top);
    return doc;
  }
  examinadores.forEach((ex, i) => {
    if (i > 0) doc.addPage();
    dibujarHoja(doc, cols, ex, porExaminador[ex], fecha, organismo, unidad);
  });
  return doc;
}

function fila(doc, cols, x0, y, valores, negrita) {
  doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica');
  let x = x0;
  valores.forEach((v, i) => {
    doc.text(String(v || ''), x + 3, y, { width: cols[i].ancho - 6, lineBreak: false, ellipsis: true });
    x += cols[i].ancho;
  });
}

function encabezado(doc, cols, x0, y, titulo, subtitulo) {
  doc.fontSize(13).font('Helvetica-Bold').text(titulo, x0, y, { lineBreak: false });
  y += 18;
  doc.fontSize(11).font('Helvetica').text(subtitulo, x0, y, { lineBreak: false });
  y += 22;
  doc.fontSize(9);
  fila(doc, cols, x0, y, cols.map((c) => c.titulo), true);
  y += 14;
  doc.moveTo(x0, y).lineTo(x0 + cols.reduce((s, c) => s + c.ancho, 0), y).stroke();
  return y + 4;
}

function dibujarHoja(doc, cols, examinador, filas, fecha, organismo, unidad) {
  const x0 = doc.page.margins.left;
  const titulo = `${organismo} — ${unidad}`;
  const subtitulo = `Agenda del día ${fFecha(fecha)} — ${examinador}`;
  let y = encabezado(doc, cols, x0, doc.page.margins.top, titulo, subtitulo);

  doc.fontSize(8);
  let n = 0;
  for (const r of filas) {
    if (y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = encabezado(doc, cols, x0, doc.page.margins.top, titulo, `${subtitulo} (cont.)`);
      doc.fontSize(8);
    }
    if (r.bloqueado) {
      fila(doc, cols, x0, y, ['', r.hora, '', `NO DISPONIBLE — ${r.bloqueo_motivo || 'BLOQUEADO'}`]);
    } else if (!r.rut && !r.nombre) {
      fila(doc, cols, x0, y, ['', r.hora, '', 'Disponible']);
    } else {
      n += 1;
      fila(doc, cols, x0, y, [String(n), r.hora, r.rut, String(r.nombre || '').trim(), r.clase, r.comentarios]);
    }
    y += 14;
  }
}

module.exports = { generarPdfDia };
