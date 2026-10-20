// Entrada a la demo en vivo: inicia sesión en el servidor con la cuenta de la demo y le entrega la sesión al navegador.
// La contraseña vive solo en las variables del servidor (DEMO_EMAIL y DEMO_PASSWORD), nunca en el código que baja el navegador.
// La cuenta es dueña del kiosco demo y la base le rechaza cualquier cambio (migración 0059): se puede mirar todo, no se guarda nada.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const email = process.env.DEMO_EMAIL, password = process.env.DEMO_PASSWORD;
  if (!email || !password) return NextResponse.json({ error: "demo_no_configurada" }, { status: 503 });
  const cliente = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await cliente.auth.signInWithPassword({ email, password });
  if (error || !data.session) return NextResponse.json({ error: "demo_no_disponible" }, { status: 503 });
  return NextResponse.json(
    { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
