// Reembolsa a Mercado Pago el cobro QR de una venta devuelta en la caja. Se llama después de registrar
// la devolución. Si Mercado Pago rechaza o se corta, queda el error en el cobro y se puede reintentar.
import { NextResponse } from "next/server";
import { ErrorMP, UUID, mpOrden, mpReembolsarOrden, type OrdenMP } from "@/lib/pagos/mp";
import { credenciales, crearAdmin, rolDe } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const venta = String(body?.venta ?? "");
  const monto = Number(body?.monto);
  if (!UUID.test(venta) || !Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: "monto_invalido" }, { status: 400 });

  const admin = crearAdmin();
  const { data: cobro } = await admin.from("cobros_qr_pos")
    .select("id, kiosco_id, monto, estado, mp_order_id").eq("venta_id", venta).maybeSingle();
  // La venta no se cobró por QR: no hay nada que devolver a Mercado Pago.
  if (!cobro) return NextResponse.json({ estado: "sin_cobro_mp" });

  if (!(await rolDe(req, admin, cobro.kiosco_id, ["encargado", "dueno"]))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  const cred = await credenciales(admin, cobro.kiosco_id).catch(() => null);
  if (!cred?.activa) return NextResponse.json({ error: "mp_desconectado" }, { status: 409 });
  if (!cobro.mp_order_id) return NextResponse.json({ error: "cobro_sin_orden" }, { status: 409 });

  const { data: res, error: errRes } = await admin.rpc("qr_reservar_reembolso", { p_cobro: cobro.id, p_monto: monto });
  if (errRes) return NextResponse.json({ error: errRes.message.includes("reembolso_en_curso") ? "reembolso_en_curso" : "reembolso_rechazado" }, { status: 409 });

  const antes = Number((res as { reembolsado_antes: number }).reembolsado_antes);
  const esTotal = Math.abs(antes + monto - Number(cobro.monto)) < 0.005;
  // Clave fija por cobro, reembolso acumulado y monto: reintentar no duplica el reembolso.
  const clave = `${cobro.id}-r${antes.toFixed(2)}-${monto.toFixed(2)}`;
  try {
    let cuerpo: unknown = undefined;
    if (!esTotal) {
      const orden = (await mpOrden(cred.token, cobro.mp_order_id)) as OrdenMP;
      const pagoId = orden.transactions?.payments?.[0]?.id;
      if (!pagoId) throw new Error("sin_pago_en_orden");
      cuerpo = { transactions: [{ id: pagoId, amount: monto.toFixed(2) }] };
    }
    const r = await mpReembolsarOrden(cred.token, cobro.mp_order_id, cuerpo, clave);
    const ref = r.transactions?.refunds?.[0]?.id ?? null;
    await admin.rpc("qr_confirmar_reembolso", { p_cobro: cobro.id, p_ok: true, p_ref: ref, p_error: null });
    return NextResponse.json({ estado: "reembolso_enviado", monto, total: esTotal });
  } catch (e) {
    const codigo = e instanceof ErrorMP ? `mp_${e.status}` : (e instanceof Error && e.message === "sin_pago_en_orden" ? "sin_pago_en_orden" : "error_reembolso");
    await admin.rpc("qr_confirmar_reembolso", { p_cobro: cobro.id, p_ok: false, p_ref: null, p_error: codigo });
    return NextResponse.json({ estado: "error", error: codigo }, { status: 502 });
  }
}
