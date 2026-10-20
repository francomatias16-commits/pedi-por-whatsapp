// Reinicio diario de la demo en vivo (Vercel Cron, 03:00 hora Argentina): borra el kiosco demo y lo vuelve a armar con los datos
// ficticios, y restablece la contraseña de la cuenta por si alguien la cambió desde el navegador.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Secreto propio (no x-vercel-cron, que cualquiera puede mandar).
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: demo } = await admin.from("kioscos").select("owner_id").eq("es_demo", true).maybeSingle();
  if (!demo) return NextResponse.json({ error: "sin_demo" }, { status: 404 });

  const { error } = await admin.rpc("demo_reiniciar");
  if (error) return NextResponse.json({ error: "db" }, { status: 500 });

  const email = process.env.DEMO_EMAIL, password = process.env.DEMO_PASSWORD;
  if (email && password) {
    const { error: e } = await admin.auth.admin.updateUserById(demo.owner_id, { email, password, email_confirm: true });
    if (e) return NextResponse.json({ reiniciada: true, cuenta: "no_restablecida" }, { status: 500 });
  }
  return NextResponse.json({ reiniciada: true });
}
