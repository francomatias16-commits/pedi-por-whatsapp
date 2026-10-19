import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import SeguimientoPedido from "@/components/SeguimientoPedido";
import { TOKEN_RE, type Seguimiento } from "@/lib/seguimiento";

export const dynamic = "force-dynamic";
// Sin indexar y sin mandar el link a otros sitios: el token es la llave del pedido.
export const metadata: Metadata = { title: "Seguí tu pedido", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SeguimientoPage({ params }: { params: { token: string } }) {
  let inicial: Seguimiento | null = null;
  if (TOKEN_RE.test(params.token)) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data } = await sb.rpc("seguimiento_pedido", { p_token: params.token });
    inicial = (data as Seguimiento | null) ?? null;
  }
  return <SeguimientoPedido token={params.token} inicial={inicial} />;
}
