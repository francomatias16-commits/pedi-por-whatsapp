import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import PagoRetorno from "@/components/PagoRetorno";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu pago", robots: { index: false, follow: false } };

// Pantalla de retorno de Mercado Pago: /<slug>/pago?pedido=<id>. Mercado Pago agrega sus propios parámetros, que se ignoran:
// el estado real se consulta al servidor.
export default async function PagoPage({ params: parametros, searchParams: busqueda }: { params: Promise<{ slug: string }>; searchParams: Promise<{ pedido?: string }> }) {
  const params = await parametros, searchParams = await busqueda;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: k } = await sb.from("kioscos").select("nombre,whatsapp,baja_solicitada_at").eq("slug", params.slug).maybeSingle();
  if (!k || k.baja_solicitada_at) notFound();
  const pedido = typeof searchParams.pedido === "string" ? searchParams.pedido : null;
  return <PagoRetorno slug={params.slug} nombre={k.nombre} whatsapp={k.whatsapp} pedido={pedido} />;
}
