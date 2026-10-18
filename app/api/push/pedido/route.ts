// Recibe el INSERT de `pedidos` desde un Database Webhook de Supabase y avisa a los celulares del kiosco.
import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { armarAvisoPedido } from "@/lib/push";

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

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hola@pedi.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  const { data: subs, error } = await admin
    .from("push_suscripciones").select("id,endpoint,p256dh,auth_secret").eq("kiosco_id", pedido.kiosco_id);
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });

  const aviso = JSON.stringify(armarAvisoPedido(pedido));
  let enviados = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, aviso);
      enviados++;
    } catch (e: unknown) {
      // 404/410: el navegador revocó la suscripción; la borramos para no insistir.
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await admin.from("push_suscripciones").delete().eq("id", s.id);
    }
  }));
  return NextResponse.json({ enviados });
}
