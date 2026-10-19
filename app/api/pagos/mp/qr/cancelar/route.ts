// Cancela un cobro QR pendiente (el cajero se arrepintió o el cliente no paga). Libera el QR del local para el próximo cobro.
// Si el cobro ya se aprobó, no lo toca y devuelve su estado. Si el cliente paga justo ahora, la plata no se pierde:
// llega como "aprobado_tarde" y queda en la lista de cobros sin venta.
import { NextResponse } from "next/server";
import { UUID, mpCancelarOrdenQR } from "@/lib/pagos/mp";
import { credenciales, crearAdmin, reconciliarCobroQR, rolDe } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const cobro = String(body?.cobro ?? "");
  if (!UUID.test(cobro)) return NextResponse.json({ error: "cobro_invalido" }, { status: 400 });
  const admin = crearAdmin();
  const { data: previo, error: errPrevio } = await admin.rpc("qr_estado_cobro", { p_cobro: cobro });
  if (errPrevio) return NextResponse.json({ error: "cobro_no_encontrado" }, { status: 404 });
  const kiosco = (previo as { kiosco_id: string }).kiosco_id;
  if (!(await rolDe(req, admin, kiosco))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  // Antes de cancelar, una última mirada a Mercado Pago: si ya pagó, no se cancela.
  await reconciliarCobroQR(admin, cobro, true);
  const { data, error } = await admin.rpc("qr_cancelar_cobro", { p_cobro: cobro });
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  const estado = (data as { estado: string }).estado;
  if (estado === "cancelado") {
    // Se cancela la orden en Mercado Pago para que el QR fijo quede libre. Si falla (o ya se pagó), la orden vence sola o el pago se reconcilia como tardío.
    const cred = await credenciales(admin, kiosco).catch(() => null);
    const { data: c } = await admin.from("cobros_qr_pos").select("mp_order_id").eq("id", cobro).maybeSingle();
    if (cred?.activa && c?.mp_order_id) await mpCancelarOrdenQR(cred.token, c.mp_order_id, `${cobro}-c`).catch(() => null);
  }
  return NextResponse.json({ estado });
}
