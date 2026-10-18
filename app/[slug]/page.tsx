import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import Tienda from "@/components/Tienda";
import type { Kiosco, Producto } from "@/lib/supabase";

export const revalidate = 30;

const cliente = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

// Título y descripción propios: así el link se ve bien al compartirlo por WhatsApp.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { data } = await cliente().from("kioscos").select("nombre,direccion").eq("slug", params.slug).maybeSingle();
  if (!data) return { title: "Local no encontrado" };
  const desc = `Hacé tu pedido a ${data.nombre} por WhatsApp${data.direccion ? ` · ${data.direccion}` : ""}`;
  return { title: `${data.nombre} · Pedí por WhatsApp`, description: desc, openGraph: { title: data.nombre, description: desc, type: "website", locale: "es_AR" } };
}

export default async function TiendaPage({ params }: { params: { slug: string } }) {
  const sb = cliente();
  const { data: kiosco } = await sb.from("kioscos").select("id,nombre,slug,whatsapp,direccion,acepta_envio,abierto,horario,pedido_minimo,costo_envio,medios_pago,horario_auto,horarios").eq("slug", params.slug).maybeSingle();
  if (!kiosco) notFound();
  const { data: productos } = await sb.from("productos").select("id,kiosco_id,barcode,nombre,categoria,precio,disponible,imagen_url").eq("kiosco_id", kiosco.id).eq("disponible", true).order("categoria").order("nombre").limit(2000);
  return <Tienda kiosco={kiosco as Kiosco} productos={(productos ?? []) as Producto[]} />;
}
