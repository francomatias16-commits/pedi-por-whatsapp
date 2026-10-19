// Recibe el INSERT de `pedidos` desde un Database Webhook de Supabase y avisa a los celulares del kiosco.
// Los pedidos que esperan pago online NO avisan acá: avisan cuando el pago se aprueba (webhook de Mercado Pago).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { armarAvisoPedido } from "@/lib/push";
import { avisarKiosco } from "@/lib/push-envio";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secreto = process.env.PUSH_WEBHOOK_SECRET;
  if (!secreto || req.headers.get("x-webhook-secret") !== secreto) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }
  const payload = await req.json().catch(() => null);
  const pedido = payload?.record;
  if (payload?.type !== "INSERT" || payload?.table !== "pedidos" || !pedido?.kiosco_id) {
    return NextResponse.json({ ok: true, ignorado: true });
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // El pedido online nace esperando pago (pago_estado = pendiente): el aviso sale cuando se aprueba el pago.
  // Se vuelve a leer el estado real por si cambió entre el INSERT y este llamado.
  const { data: actual, error: errLeer } = await admin.from("pedidos").select("pago_estado").eq("id", pedido.id).maybeSingle();
  if (errLeer) return NextResponse.json({ error: "db" }, { status: 500 });
  if (actual?.pago_estado === "pendiente") return NextResponse.json({ ok: true, esperando_pago: true });

  try {
    return NextResponse.json({ enviados: await avisarKiosco(admin, pedido.kiosco_id, armarAvisoPedido(pedido)) });
  } catch {
    return NextResponse.json({ error: "db" }, { status: 500 });
  }
}
