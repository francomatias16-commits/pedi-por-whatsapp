// Emite la Nota de crédito C de una devolución (o, sin devolución, por el saldo de la factura para poder anular la venta).
import { NextResponse } from "next/server";
import { contexto, respuestaError, uuidDe } from "@/lib/arca/rutas";
import { emitirReservado, reservarNC } from "@/lib/arca/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const c = await contexto(req, ["cajero", "encargado", "dueno"]);
  if (c instanceof NextResponse) return c;
  const venta = uuidDe(c.body.venta);
  if (!venta) return NextResponse.json({ error: "venta_no_encontrada" }, { status: 400 });
  const devolucion = c.body.devolucion == null ? null : uuidDe(c.body.devolucion);
  if (c.body.devolucion != null && !devolucion) return NextResponse.json({ error: "devolucion_no_encontrada" }, { status: 400 });
  try {
    const id = await reservarNC(c.admin, { kiosco: c.kiosco, venta, devolucion, usuario: c.userId });
    return NextResponse.json(await emitirReservado(c.admin, id));
  } catch (e) { return respuestaError(e); }
}
