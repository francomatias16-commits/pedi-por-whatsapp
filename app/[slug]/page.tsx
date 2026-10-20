import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import Tienda from "@/components/Tienda";
import TiendaApagada from "@/components/TiendaApagada";
import type { Kiosco, Producto } from "@/lib/supabase";
import { traerTodo } from "@/lib/paginar";

export const revalidate = 30;

const cliente = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

// Título y descripción propios: así el link se ve bien al compartirlo por WhatsApp.
export async function generateMetadata({ params: parametros }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await parametros;
  const { data } = await cliente().from("kioscos").select("nombre,direccion").eq("slug", params.slug).maybeSingle();
  if (!data) return { title: "Local no encontrado" };
  const desc = `Hacé tu pedido a ${data.nombre} por WhatsApp${data.direccion ? ` · ${data.direccion}` : ""}`;
  return { title: `${data.nombre} · Go Fluxo`, description: desc, openGraph: { title: data.nombre, description: desc, type: "website", locale: "es_AR" } };
}

export default async function TiendaPage({ params: parametros }: { params: Promise<{ slug: string }> }) {
  const params = await parametros;
  const sb = cliente();
  const { data: kiosco } = await sb.from("kioscos").select("id,nombre,slug,whatsapp,direccion,acepta_envio,abierto,horario,pedido_minimo,costo_envio,medios_pago,horario_auto,horarios,baja_solicitada_at,cobro_online_activo,zonas_envio_activo,franjas_entrega_activo,tienda_activa").eq("slug", params.slug).maybeSingle();
  if (!kiosco || kiosco.baja_solicitada_at) notFound(); // un local dado de baja deja de mostrarse
  if (kiosco.tienda_activa === false) {
    const { data: club } = await sb.rpc("club_datos", { p_slug: params.slug });
    return <TiendaApagada nombre={kiosco.nombre} slug={params.slug} whatsapp={kiosco.whatsapp} hayClub={!!club} />;
  }
  const { data: productos } = await traerTodo((d, h) => sb.from("productos").select("id,kiosco_id,barcode,nombre,categoria,precio,disponible,imagen_url").eq("kiosco_id", kiosco.id).eq("disponible", true).eq("visible_tienda", true).order("categoria").order("nombre").order("id").range(d, h));
  return <Tienda kiosco={kiosco as Kiosco} productos={(productos ?? []) as Producto[]} />;
}
