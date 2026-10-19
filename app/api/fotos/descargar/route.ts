// Trae los bytes de una foto sugerida para que el navegador la comprima y la suba al bucket del local (así no hay problemas de CORS
// y no se guarda ningún enlace externo). La validación de seguridad de la descarga vive en lib/fotos-descarga.ts.
import { NextResponse } from "next/server";
import { UUID } from "@/lib/pagos/mp";
import { crearAdmin, rolDe } from "@/lib/pagos/servidor";
import { urlImagenSegura } from "@/lib/fotos-sugerencias";
import { descargarImagen } from "@/lib/fotos-descarga";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kiosco = String(body?.kiosco ?? ""), url = String(body?.url ?? "");
  if (!UUID.test(kiosco) || !urlImagenSegura(url)) return NextResponse.json({ error: "datos_invalidos" }, { status: 400 });
  const admin = crearAdmin();
  if (!(await rolDe(req, admin, kiosco, ["encargado", "dueno"]))) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  const { data: k } = await admin.from("kioscos").select("fotos_auto_activo").eq("id", kiosco).maybeSingle();
  if (!k?.fotos_auto_activo) return NextResponse.json({ error: "fotos_inactivo" }, { status: 409 });

  const r = await descargarImagen(url);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return new NextResponse(new Uint8Array(r.bytes), { headers: { "Content-Type": r.tipo, "Cache-Control": "no-store" } });
}
