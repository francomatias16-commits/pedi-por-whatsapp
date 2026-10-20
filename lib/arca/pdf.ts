// Comprobante en PDF (A4) de una Factura C o Nota de crédito C, con el código QR de ARCA. Solo servidor.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { TIPO_NC_C, codigoTipo, formatoCuit, formatoNumero, nombreTipo, urlQR } from "./comun";

export type DatosPdf = {
  emisor: { razon: string; cuit: string; domicilio: string; condicion: string; inicio: string | null; nombreFantasia: string };
  comprobante: { tipo: number; pto: number; numero: number; fecha: string; cae: string; caeVto: string; total: number; homologacion: boolean };
  receptor: { docTipo: number; docNro: string; nombre: string | null };
  ventaNumero: number;
  items: { nombre: string; cantidad: string; unitario: number; importe: number }[];
  asociado?: { numero: string; fecha: string };
};
const pesos = (n: number) => `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaAR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export async function generarPdf(d: DatosPdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: `${nombreTipo(d.comprobante.tipo)} ${formatoNumero(d.comprobante.pto, d.comprobante.numero)}` } });
  const trozos: Buffer[] = [];
  doc.on("data", (t: Buffer) => trozos.push(t));
  const fin = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(trozos))));
  const L = 36, R = 559, ancho = R - L;
  const esNC = d.comprobante.tipo === TIPO_NC_C;
  const c = d.comprobante;

  if (c.homologacion) doc.font("Helvetica-Bold").fontSize(9).fillColor("#b00020").text("COMPROBANTE DE PRUEBA (HOMOLOGACIÓN) · SIN VALIDEZ FISCAL", L, 20, { width: ancho, align: "center" }).fillColor("black");

  // Encabezado: emisor | letra | datos del comprobante
  doc.rect(L, 36, ancho, 118).stroke();
  doc.moveTo(L + ancho / 2, 36 + 40).lineTo(L + ancho / 2, 154).stroke();
  doc.rect(L + ancho / 2 - 22, 36, 44, 40).fillAndStroke("white", "black");
  doc.fillColor("black").font("Helvetica-Bold").fontSize(26).text("C", L + ancho / 2 - 22, 40, { width: 44, align: "center" });
  doc.fontSize(7).font("Helvetica").text(`COD. ${codigoTipo(c.tipo)}`, L + ancho / 2 - 22, 68, { width: 44, align: "center" });
  doc.font("Helvetica-Bold").fontSize(14).text(d.emisor.razon, L + 8, 46, { width: ancho / 2 - 38 });
  doc.font("Helvetica").fontSize(9)
    .text(`Domicilio: ${d.emisor.domicilio}`, L + 8, 92, { width: ancho / 2 - 16 })
    .text(`Condición frente al IVA: ${d.emisor.condicion}`, L + 8, doc.y + 2, { width: ancho / 2 - 16 });
  const x2 = L + ancho / 2 + 30;
  doc.font("Helvetica-Bold").fontSize(15).text(nombreTipo(c.tipo).toUpperCase(), x2, 46, { width: ancho / 2 - 38 });
  doc.font("Helvetica").fontSize(10)
    .text(`Nº ${formatoNumero(c.pto, c.numero)}`, x2, 70)
    .text(`Fecha de emisión: ${fechaAR(c.fecha)}`, x2, doc.y + 2)
    .text(`CUIT: ${formatoCuit(d.emisor.cuit)}`, x2, doc.y + 2);
  if (d.emisor.inicio) doc.text(`Inicio de actividades: ${fechaAR(d.emisor.inicio)}`, x2, doc.y + 2);

  // Receptor
  doc.rect(L, 162, ancho, 48).stroke();
  const rec = d.receptor.docTipo === 96 ? `DNI ${d.receptor.docNro}` : "Consumidor Final";
  doc.font("Helvetica").fontSize(9.5)
    .text(`Receptor: ${d.receptor.nombre ? `${d.receptor.nombre} · ` : ""}${rec}`, L + 8, 168)
    .text(`Condición frente al IVA: Consumidor Final · Condición de venta: Contado${esNC && d.asociado ? ` · Comprobante asociado: Factura C ${d.asociado.numero} del ${fechaAR(d.asociado.fecha)}` : ""}`, L + 8, 184, { width: ancho - 16 });

  // Detalle
  let y = 220;
  doc.rect(L, y, ancho, 18).fillAndStroke("#eeeeee", "black").fillColor("black");
  doc.font("Helvetica-Bold").fontSize(9).text("Descripción", L + 6, y + 5).text("Cant.", L + 300, y + 5, { width: 50, align: "right" }).text("P. unitario", L + 360, y + 5, { width: 70, align: "right" }).text("Importe", L + 440, y + 5, { width: 76, align: "right" });
  y += 22; doc.font("Helvetica").fontSize(9);
  for (const it of d.items) {
    if (y > 660) { doc.addPage(); y = 50; }
    doc.text(it.nombre, L + 6, y, { width: 285, height: 12, ellipsis: true }).text(it.cantidad, L + 300, y, { width: 50, align: "right" }).text(pesos(it.unitario), L + 360, y, { width: 70, align: "right" }).text(pesos(it.importe), L + 440, y, { width: 76, align: "right" });
    y += 14;
  }
  y = Math.max(y + 10, 640);
  if (y > 700) { doc.addPage(); y = 50; }
  doc.moveTo(L, y).lineTo(R, y).stroke();
  doc.font("Helvetica-Bold").fontSize(12).text(`Importe total: ${pesos(c.total)}`, L, y + 8, { width: ancho - 6, align: "right" });
  if (esNC) doc.font("Helvetica").fontSize(8.5).text(`Por devolución de la venta #${d.ventaNumero}.`, L, y + 10, { width: 300 });

  // Pie: QR + CAE
  const qr = await QRCode.toBuffer(urlQR({ fechaIso: c.fecha, cuit: d.emisor.cuit, pto: c.pto, tipo: c.tipo, nro: c.numero, importe: c.total, docTipo: d.receptor.docTipo, docNro: d.receptor.docNro, cae: c.cae }), { margin: 0, width: 220, errorCorrectionLevel: "M" });
  const py = 735;
  doc.image(qr, L, py, { width: 80 });
  doc.font("Helvetica-Bold").fontSize(10).text(`CAE Nº: ${c.cae}`, L + 96, py + 8).text(`Vencimiento del CAE: ${fechaAR(c.caeVto)}`, L + 96, doc.y + 2);
  doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Comprobante autorizado por ARCA. Verificá su validez escaneando el código QR.", L + 96, doc.y + 6, { width: 380 });
  doc.end();
  return fin;
}
