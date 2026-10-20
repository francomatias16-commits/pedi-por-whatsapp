// Datos fiscales del local (solo dueño). POST con datos: guarda y deja la conexión "pendiente". POST sin datos: devuelve el estado.
import { NextResponse } from "next/server";
import { contexto, respuestaError } from "@/lib/arca/rutas";
import { configLocal, esHomologacion } from "@/lib/arca/servidor";
import { cuitValido, limpiarCuit } from "@/lib/arca/comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const c = await contexto(req, ["dueno"]);
  if (c instanceof NextResponse) return c;
  try {
    const { data: prov } = await c.admin.from("arca_proveedor_config").select("cuit").eq("homologacion", esHomologacion()).eq("activo", true).maybeSingle();
    const base = { proveedor_cuit: prov?.cuit ?? null, ambiente: esHomologacion() ? "homologacion" : "produccion" };
    const b = c.body;
    if (b.apagar === true) { await c.admin.from("facturacion_config").update({ activo: false, updated_at: new Date().toISOString() }).eq("kiosco_id", c.kiosco); return NextResponse.json({ ...base, config: await configLocal(c.admin, c.kiosco) }); }
    if (b.guardar !== true) return NextResponse.json({ ...base, config: await configLocal(c.admin, c.kiosco) });

    const cuit = limpiarCuit(b.cuit), razon = String(b.razon_social ?? "").trim(), dom = String(b.domicilio ?? "").trim();
    const pto = Number(b.punto_venta), cond = b.condicion_iva === "exento" ? "exento" : "monotributo";
    const inicio = typeof b.inicio_actividades === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.inicio_actividades) ? b.inicio_actividades : null;
    if (!cuitValido(cuit)) return NextResponse.json({ error: "cuit_invalido" }, { status: 400 });
    if (razon.length < 2 || razon.length > 120) return NextResponse.json({ error: "razon_invalida" }, { status: 400 });
    if (dom.length < 3 || dom.length > 200) return NextResponse.json({ error: "domicilio_invalido" }, { status: 400 });
    if (!Number.isInteger(pto) || pto < 1 || pto > 99998) return NextResponse.json({ error: "pto_invalido" }, { status: 400 });

    const antes = await configLocal(c.admin, c.kiosco);
    const cambioFiscal = !antes || antes.cuit !== cuit || antes.punto_venta !== pto; // otra CUIT o punto de venta: hay que volver a verificar
    const fila = {
      kiosco_id: c.kiosco, cuit, razon_social: razon, domicilio: dom, punto_venta: pto, condicion_iva: cond, inicio_actividades: inicio, updated_at: new Date().toISOString(),
      ...(cambioFiscal ? { activo: false, estado_delegacion: "pendiente", delegacion_verificada_at: null, delegacion_error: null } : {}),
    };
    const { error } = await c.admin.from("facturacion_config").upsert(fila, { onConflict: "kiosco_id" });
    if (error) return NextResponse.json({ error: "db" }, { status: 500 });
    return NextResponse.json({ ...base, config: await configLocal(c.admin, c.kiosco) });
  } catch (e) { return respuestaError(e); }
}
