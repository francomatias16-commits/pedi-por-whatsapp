// Chequeo de salud para monitores externos (UptimeRobot, Better Stack, etc.).
// Público: solo dice si la base responde. Con "Authorization: Bearer <CRON_SECRET>" agrega qué variables del servidor faltan.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { armarSalud, variablesFaltantes } from "@/lib/salud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t0 = Date.now();
  let ok = false;
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    // Lectura mínima y pública (la misma que hace la tienda).
    const { error } = await sb.from("kioscos").select("id", { head: true, count: "exact" }).limit(1).abortSignal(AbortSignal.timeout(4000));
    ok = !error;
  } catch {
    ok = false;
  }
  const salud = armarSalud({ ok, ms: Date.now() - t0 }, process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local");
  const secreto = process.env.CRON_SECRET;
  const interno = !!secreto && req.headers.get("authorization") === `Bearer ${secreto}`;
  const cuerpo = interno ? { ...salud, variables_faltantes: variablesFaltantes(process.env) } : { estado: salud.estado };
  return NextResponse.json(cuerpo, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
