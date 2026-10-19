// Estado del pago de un pedido (pantalla de retorno). Si sigue pendiente, consulta a Mercado Pago por si el aviso se demora
// (con un límite por pedido). No devuelve datos personales.
import { NextResponse } from "next/server";
import { UUID } from "@/lib/pagos/mp";
import { crearAdmin, reconciliarPedido } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pedido = new URL(req.url).searchParams.get("pedido") ?? "";
  if (!UUID.test(pedido)) return NextResponse.json({ error: "pedido_invalido" }, { status: 400 });
  const admin = crearAdmin();
  let { data, error } = await admin.rpc("pago_estado_pedido", { p_pedido: pedido });
  if (error) return NextResponse.json({ error: "pedido_no_encontrado" }, { status: 404 });
  if (data.pago_estado === "pendiente") {
    await reconciliarPedido(admin, pedido);
    ({ data, error } = await admin.rpc("pago_estado_pedido", { p_pedido: pedido }));
    if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
