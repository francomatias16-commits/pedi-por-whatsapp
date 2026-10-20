// PDF de un comprobante emitido (Factura C o Nota de crédito C). POST con el token de sesión: se abre desde el navegador como blob.
import { NextResponse } from "next/server";
import { contexto, uuidDe } from "@/lib/arca/rutas";
import { configLocal } from "@/lib/arca/servidor";
import { generarPdf, type DatosPdf } from "@/lib/arca/pdf";
import { formatoNumero } from "@/lib/arca/comun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const c = await contexto(req, ["cajero", "encargado", "dueno"]);
  if (c instanceof NextResponse) return c;
  const id = uuidDe(c.body.comprobante);
  if (!id) return NextResponse.json({ error: "no_encontrado" }, { status: 400 });
  const { data: f } = await c.admin.from("comprobantes_arca").select("*").eq("id", id).eq("kiosco_id", c.kiosco).maybeSingle();
  if (!f || f.estado !== "emitido" || !f.numero || !f.cae || !f.cae_vto) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  const cfg = await configLocal(c.admin, c.kiosco);
  const { data: k } = await c.admin.from("kioscos").select("nombre").eq("id", c.kiosco).maybeSingle();
  const { data: v } = await c.admin.from("ventas_mostrador").select("numero,total").eq("id", f.venta_id).maybeSingle();
  if (!cfg || !v) return NextResponse.json({ error: "no_encontrado" }, { status: 404 });

  let items: DatosPdf["items"] = [];
  let asociado: DatosPdf["asociado"];
  if (f.tipo_cbte === 11) {
    const { data: its } = await c.admin.from("ventas_mostrador_items").select("nombre,cantidad,precio_unit,por_peso,neto,seq").eq("venta_id", f.venta_id).order("seq");
    items = (its ?? []).map((i: { nombre: string; cantidad: number; precio_unit: number; por_peso: boolean; neto: number }) => ({
      nombre: i.nombre, cantidad: i.por_peso ? String(Number(i.cantidad)).replace(".", ",") : String(Number(i.cantidad)), unitario: Number(i.precio_unit), importe: Number(i.neto),
    }));
    const suma = items.reduce((s, i) => s + i.importe, 0);
    if (Math.abs(suma - Number(f.total)) >= 0.005) items.push({ nombre: "Ajuste / descuento", cantidad: "1", unitario: Math.round((Number(f.total) - suma) * 100) / 100, importe: Math.round((Number(f.total) - suma) * 100) / 100 });
  } else {
    items = [{ nombre: f.devolucion_id ? `Devolución de la venta #${v.numero}` : `Anulación de la venta #${v.numero}`, cantidad: "1", unitario: Number(f.total), importe: Number(f.total) }];
    const { data: fa } = await c.admin.from("comprobantes_arca").select("punto_venta,numero,fecha").eq("id", f.asociado_id).maybeSingle();
    if (fa?.numero) asociado = { numero: formatoNumero(fa.punto_venta, fa.numero), fecha: fa.fecha };
  }
  const pdf = await generarPdf({
    emisor: { razon: cfg.razon_social, cuit: f.cuit_emisor, domicilio: cfg.domicilio, condicion: cfg.condicion_iva === "exento" ? "IVA Exento" : "Responsable Monotributo", inicio: cfg.inicio_actividades, nombreFantasia: k?.nombre ?? "" },
    comprobante: { tipo: f.tipo_cbte, pto: f.punto_venta, numero: Number(f.numero), fecha: f.fecha, cae: f.cae, caeVto: f.cae_vto, total: Number(f.total), homologacion: f.homologacion },
    receptor: { docTipo: f.receptor_doc_tipo, docNro: f.receptor_doc_nro, nombre: f.receptor_nombre },
    ventaNumero: Number(v.numero), items, asociado,
  });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${f.tipo_cbte === 11 ? "factura" : "nota-credito"}-${formatoNumero(f.punto_venta, f.numero)}.pdf"`, "Cache-Control": "no-store" } });
}
