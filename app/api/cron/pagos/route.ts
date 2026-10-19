// Reconcilia pagos pendientes (por si un aviso no llegó) y vence los que esperaron demasiado, liberando su stock.
// Vercel Cron manda "Authorization: Bearer <CRON_SECRET>". Es idempotente.
import { NextResponse } from "next/server";
import { crearAdmin, reconciliarCobroQR, reconciliarPedido } from "@/lib/pagos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  const admin = crearAdmin();
  const hace = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data: pend, error } = await admin.from("pedidos").select("id").eq("pago_estado", "pendiente").lt("created_at", hace).order("created_at").limit(100);
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });
  const resultados: Record<string, number> = {};
  for (const p of pend ?? []) {
    const r = (await reconciliarPedido(admin, p.id, true).catch(() => "error")) ?? "sin_pago";
    resultados[r] = (resultados[r] ?? 0) + 1;
  }
  const { data: venc, error: errV } = await admin.rpc("pago_vencer_pendientes"); // usa pago_horas_vencimiento()
  if (errV) return NextResponse.json({ error: "db", reconciliados: resultados }, { status: 500 });

  // Cobros QR del mostrador: los pendientes o vencidos de las últimas horas se reconcilian (un pago tardío tiene que aparecer) y los vencidos se cierran.
  const haceHoras = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const { data: qrs } = await admin.from("cobros_qr_pos").select("id").in("estado", ["pendiente", "vencido", "cancelado"]).gt("created_at", haceHoras).order("created_at").limit(100);
  const resultadosQR: Record<string, number> = {};
  for (const c of qrs ?? []) {
    const r = (await reconciliarCobroQR(admin, c.id, true).catch(() => "error")) ?? "sin_pago";
    resultadosQR[r] = (resultadosQR[r] ?? 0) + 1;
  }
  const { data: qrVencidos } = await admin.rpc("qr_vencer_pendientes");
  return NextResponse.json({ revisados: pend?.length ?? 0, resultados, vencidos: (venc?.vencidos ?? []).length, qr: { revisados: qrs?.length ?? 0, resultados: resultadosQR, vencidos: qrVencidos ?? 0 } });
}
