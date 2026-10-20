import type { Metadata } from "next";
import Unirse from "@/components/panel/Unirse";

// El enlace lleva un secreto de un solo uso: no se indexa y no se manda como referencia a otros sitios.
export const metadata: Metadata = { title: "Invitación al equipo", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PaginaUnirse({ params: parametros }: { params: Promise<{ token: string }> }) {
  const params = await parametros;
  return <Unirse token={params.token} />;
}
