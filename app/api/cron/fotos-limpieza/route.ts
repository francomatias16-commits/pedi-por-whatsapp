// Borra del bucket "productos" las fotos reemplazadas hace más de FOTOS_RETENCION_DIAS (30 por defecto), cuando ya no se pueden deshacer.
// Vercel Cron manda "Authorization: Bearer <CRON_SECRET>". Es idempotente: una fila procesada no se vuelve a revisar.
import { NextResponse } from "next/server";
import { crearAdmin } from "@/lib/pagos/servidor";
import { BUCKET } from "@/lib/fotos";
import { diasRetencion, planLimpieza, type FilaLimpieza } from "@/lib/fotos-limpieza";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POR_VUELTA = 200;
const VUELTAS_MAX = 5;   // hasta 1000 filas por corrida; si hay más, sigue la próxima

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  const admin = crearAdmin();
  const dias = diasRetencion(process.env.FOTOS_RETENCION_DIAS);
  let borrados = 0, marcadas = 0, fallidas = 0;

  for (let vuelta = 0; vuelta < VUELTAS_MAX; vuelta++) {
    const { data, error } = await admin.rpc("fotos_limpieza_pendientes", { p_dias: dias, p_limite: POR_VUELTA });
    if (error) return NextResponse.json({ error: "db", borrados, marcadas, fallidas }, { status: 500 });
    const filas = (data ?? []) as FilaLimpieza[];
    if (filas.length === 0) break;

    const { borrar, soloMarcar } = planLimpieza(filas);
    const ok: string[] = [...soloMarcar];
    if (borrar.length > 0) {
      const { error: errB } = await admin.storage.from(BUCKET).remove(borrar.map((b) => b.ruta));   // un archivo que ya no existe no es error
      if (errB) fallidas += borrar.length;                                                             // no se marcan: se reintentan la próxima vez
      else { borrados += borrar.length; ok.push(...borrar.map((b) => b.id)); }
    }
    if (ok.length > 0) {
      const { error: errM } = await admin.rpc("fotos_limpieza_marcar", { p_ids: ok });
      if (errM) return NextResponse.json({ error: "db", borrados, marcadas, fallidas }, { status: 500 });
      marcadas += ok.length;
    }
    if (ok.length === 0) break;   // nada avanzó: evita repetir la misma tanda
    if (filas.length < POR_VUELTA) break;
  }
  return NextResponse.json({ dias, borrados, marcadas, fallidas });
}
