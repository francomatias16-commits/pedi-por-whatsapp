// Envío de avisos push a los celulares del kiosco (lo comparten el webhook de pedidos y el de pagos).
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function avisarKiosco(admin: SupabaseClient, kioscoId: string, aviso: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  const { data: subs, error } = await admin.from("push_suscripciones").select("id,endpoint,p256dh,auth_secret").eq("kiosco_id", kioscoId);
  if (error) throw new Error("db");
  if (!subs?.length) return 0;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:hola@pedi.app", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const texto = JSON.stringify(aviso);
  let enviados = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, texto);
      enviados++;
    } catch (e: unknown) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await admin.from("push_suscripciones").delete().eq("id", s.id);
    }
  }));
  return enviados;
}
