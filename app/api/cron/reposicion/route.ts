// Aviso diario de reposición (Vercel Cron, 06:00 hora Argentina). Recorre todos los kioscos con la service role.
import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { armarAvisoStock } from "@/lib/reposicion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Aviso = { kiosco: string; n_agotados: number; n_bajos: number; n_sin_proveedor: number };

export async function GET(req: Request) {
  // No se confía en x-vercel-cron: cualquiera puede mandar ese header. Se exige el secreto propio.
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  // La función ya es idempotente por kiosco y día: si el cron se dispara dos veces, no devuelve avisos repetidos.
  const { data, error } = await admin.rpc("reposicion_avisos_diarios");
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hola@pedi.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  let enviados = 0, fallos = 0;
  for (const a of (data ?? []) as Aviso[]) {
    // Un kiosco que falla no corta a los demás.
    try {
      const { data: subs } = await admin
        .from("push_suscripciones").select("id,endpoint,p256dh,auth_secret").eq("kiosco_id", a.kiosco);
      const aviso = JSON.stringify(armarAvisoStock({ agotados: a.n_agotados, bajos: a.n_bajos, sin_proveedor: a.n_sin_proveedor }));
      await Promise.all((subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, aviso);
          enviados++;
        } catch (e: unknown) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) await admin.from("push_suscripciones").delete().eq("id", s.id);
          else fallos++;
        }
      }));
    } catch {
      fallos++;
    }
  }
  // Avisos "avisame cuando" (0025): una notificación por kiosco con todas las reglas disparadas hoy.
  // Un error acá no corta el aviso de reposición, que ya se mandó arriba.
  let avisosReglas = 0;
  const { data: reglas, error: errReglas } = await admin.rpc("reglas_avisos_diarios");
  if (!errReglas) {
    const porKiosco = new Map<string, string[]>();
    for (const r of (reglas ?? []) as { kiosco: string; mensaje: string }[]) {
      porKiosco.set(r.kiosco, [...(porKiosco.get(r.kiosco) ?? []), r.mensaje]);
    }
    for (const [kioscoId, mensajes] of porKiosco) {
      try {
        const { data: subs } = await admin
          .from("push_suscripciones").select("id,endpoint,p256dh,auth_secret").eq("kiosco_id", kioscoId);
        const payload = JSON.stringify({ title: "Avisos de tu kiosco", body: mensajes.join(" "), url: "/panel?tab=radar" });
        avisosReglas++;
        await Promise.all((subs ?? []).map(async (s) => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, payload);
            enviados++;
          } catch (e: unknown) {
            const code = (e as { statusCode?: number })?.statusCode;
            if (code === 404 || code === 410) await admin.from("push_suscripciones").delete().eq("id", s.id);
            else fallos++;
          }
        }));
      } catch {
        fallos++;
      }
    }
  } else {
    fallos++;
  }
  return NextResponse.json({ kioscos_avisados: (data ?? []).length, avisos_reglas: avisosReglas, enviados, fallos });
}
