import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import ClubTarjeta from "@/components/ClubTarjeta";
import { CLUB_TOKEN_RE, type Tarjeta } from "@/lib/club";

export const dynamic = "force-dynamic";

// El token es la llave de la tarjeta: sin indexar y sin mandar el link a otros sitios.
// El manifest propio hace que "Instalar" / "Agregar a inicio" abra ESTA tarjeta y no el panel del kiosquero.
export async function generateMetadata({ params: parametros }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const params = await parametros;
  return { title: "Mi tarjeta de sellos", robots: { index: false, follow: false }, referrer: "no-referrer", manifest: `/tarjeta/${params.token}/manifest.webmanifest` };
}

export default async function TarjetaPage({ params: parametros }: { params: Promise<{ token: string }> }) {
  const params = await parametros;
  let inicial: Tarjeta | null = null;
  if (CLUB_TOKEN_RE.test(params.token)) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data } = await sb.rpc("club_tarjeta", { p_token: params.token });
    inicial = (data as Tarjeta | null) ?? null;
  }
  return <ClubTarjeta token={params.token} inicial={inicial} />;
}
