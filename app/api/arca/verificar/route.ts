// "Verificar conexión": comprueba contra ARCA que el local delegó el servicio a la CUIT del proveedor, y si es así activa la facturación. Solo dueño.
import { NextResponse } from "next/server";
import { contexto, respuestaError } from "@/lib/arca/rutas";
import { verificarDelegacion } from "@/lib/arca/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const c = await contexto(req, ["dueno"]);
  if (c instanceof NextResponse) return c;
  try { return NextResponse.json(await verificarDelegacion(c.admin, c.kiosco)); }
  catch (e) { return respuestaError(e); }
}
