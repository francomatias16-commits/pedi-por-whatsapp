// Emite la Factura C de una venta del mostrador. Cajero, encargado y dueño. El importe sale de la venta, no del navegador.
import { NextResponse } from "next/server";
import { contexto, respuestaError, uuidDe } from "@/lib/arca/rutas";
import { emitirReservado, reservarFactura } from "@/lib/arca/servidor";
import { limpiarCuit } from "@/lib/arca/comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const c = await contexto(req, ["cajero", "encargado", "dueno"]);
  if (c instanceof NextResponse) return c;
  const venta = uuidDe(c.body.venta);
  if (!venta) return NextResponse.json({ error: "venta_no_encontrada" }, { status: 400 });

  // Receptor: consumidor final (por defecto) o, si el cliente lo pide, con su DNI.
  let docTipo = 99, docNro = "0";
  const tipoPedido = Number(c.body.doc_tipo), nroPedido = limpiarCuit(c.body.doc_nro);
  if (tipoPedido === 96) {
    if (!/^\d{7,8}$/.test(nroPedido)) return NextResponse.json({ error: "doc_invalido" }, { status: 400 });
    docTipo = 96; docNro = nroPedido;
  }
  const nombre = typeof c.body.nombre === "string" ? c.body.nombre.trim().slice(0, 120) || null : null;
  try {
    const id = await reservarFactura(c.admin, { kiosco: c.kiosco, venta, usuario: c.userId, docTipo, docNro, nombre });
    return NextResponse.json(await emitirReservado(c.admin, id));
  } catch (e) { return respuestaError(e); }
}
