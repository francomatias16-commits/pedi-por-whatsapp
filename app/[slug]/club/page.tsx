import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import ClubUnirse from "@/components/ClubUnirse";
import { normalizarRef, type DatosClub } from "@/lib/club";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu tarjeta de sellos", robots: { index: false, follow: false } };

// Es la página del QR único del local. Si el cliente ya tiene tarjeta en este celular, el componente lo lleva directo a ella.
// Si el club está apagado pero hay tienda, el QR lleva directo al catálogo; el acceso al catálogo desde el club solo aparece si la tienda está disponible.
export default async function ClubPage({ params: parametros, searchParams: busqueda }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const params = await parametros, searchParams = await busqueda;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.rpc("club_datos", { p_slug: params.slug });
  const datos = (data as DatosClub | null) ?? null;
  if (!datos) {
    const { data: hayTienda } = await sb.rpc("tienda_disponible_slug", { p_slug: params.slug });
    if (hayTienda === true) redirect(`/${params.slug}`);
  }
  return <ClubUnirse slug={params.slug} datos={datos} refAmigo={normalizarRef(searchParams.ref)} />;
}
