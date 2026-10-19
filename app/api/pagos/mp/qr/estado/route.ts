// Estado de un cobro QR para la caja. Si sigue pendiente (o venció hace instantes), consulta a Mercado Pago por si el aviso se demora,
// con un límite por cobro. Solo miembros del local. Devuelve solo lo que la caja necesita.
import { NextResponse } from "next/server";
import { UUID } from "@/lib/pagos/mp";
import { crearAdmin, reconciliarCobroQR, rolDe } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Estado = { kiosco_id: string; estado: string; monto: number; venta_id: string | null; detalle: string | null; expira_at: string; cobro_id: string };

export async function GET(req: Request) {
  const cobro = new URL(req.url).searchParams.get("cobro") ?? "";
  if (!UUID.test(cobro)) return NextResponse.json({ error: "cobro_invalido" }, { status: 400 });
  const admin = crearAdmin();
  let { data, error } = await admin.rpc("qr_estado_cobro", { p_cobro: cobro });
  if (error) return NextResponse.json({ error: "cobro_no_encontrado" }, { status: 404 });
  let e = data as Estado;
  if (!(await rolDe(req, admin, e.kiosco_id))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 }); // se valida después de leer: el id del cobro no revela nada
  if (e.estado === "pendiente" || e.estado === "vencido" || e.estado === "cancelado") {
    await reconciliarCobroQR(admin, cobro);
    ({ data, error } = await admin.rpc("qr_estado_cobro", { p_cobro: cobro }));
    if (error) return NextResponse.json({ error: "db" }, { status: 500 });
    e = data as Estado;
  }
  return NextResponse.json({ estado: e.estado, monto: Number(e.monto), venta_id: e.venta_id, detalle: e.detalle, expira_at: e.expira_at }, { headers: { "Cache-Control": "no-store" } });
}
