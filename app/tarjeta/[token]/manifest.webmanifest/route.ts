// Manifest de cada tarjeta: al instalarla en el celular se abre la tarjeta del cliente, no el panel del local.
import { createClient } from "@supabase/supabase-js";
import { CLUB_TOKEN_RE, type Tarjeta } from "@/lib/club";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params: parametros }: { params: Promise<{ token: string }> }) {
  const params = await parametros;
  let local = "Mi tarjeta";
  if (CLUB_TOKEN_RE.test(params.token)) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data } = await sb.rpc("club_tarjeta", { p_token: params.token });
    if ((data as Tarjeta | null)?.local) local = (data as Tarjeta).local;
  }
  const cuerpo = {
    name: `${local} · Sellos`, short_name: local.slice(0, 12), description: "Tu tarjeta de sellos",
    start_url: `/tarjeta/${params.token}`, scope: `/tarjeta/${params.token}`, display: "standalone", background_color: "#edefee", theme_color: "#14181d", lang: "es-AR",
    icons: [{ src: "/icons/gofluxo-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/gofluxo-512.png", sizes: "512x512", type: "image/png" }],
  };
  return new Response(JSON.stringify(cuerpo), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
}
