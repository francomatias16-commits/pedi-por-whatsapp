// Aviso semanal de fiado vencido (Vercel Cron, lunes 09:00 hora Argentina). Solo avisa al dueño.
import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { armarAvisoFiado } from "@/lib/fiado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Aviso = { kiosco: string; n_clientes: number; monto: number };

export async function GET(req: Request) {
  // Secreto propio (no x-vercel-cron, que cualquiera puede mandar).
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  // Idempotente por kiosco y semana: si se dispara dos veces, no repite el aviso.
  const { data, error } = await admin.rpc("fiado_avisos_semanales", { p_dias: 30 });
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hola@pedi.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  let enviados = 0, fallos = 0;
  for (const a of (data ?? []) as Aviso[]) {
    try {
      const { data: subs } = await admin.from("push_suscripciones").select("id,endpoint,p256dh,auth_secret").eq("kiosco_id", a.kiosco);
      const aviso = JSON.stringify(armarAvisoFiado({ clientes: a.n_clientes, monto: Number(a.monto), dias: 30 }));
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
  return NextResponse.json({ kioscos_avisados: (data ?? []).length, enviados, fallos });
}
