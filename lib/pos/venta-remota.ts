import { supabase } from "@/lib/supabase";
import type { ItemDevolvible } from "./devolucion";
import type { ItemVenta, Medio, PagoVenta } from "@/lib/caja";

// Carga una venta completa (de cualquier turno) con lo ya devuelto. Lee tablas con RLS: solo ve las del dueño.
export type VentaCompleta = {
  id: string; numero: number; subtotal: number; descuento: number; total: number; vuelto: number; anulada: boolean; created_at: string;
  pagos: PagoVenta[]; itemsDevolver: ItemDevolvible[]; itemsTicket: ItemVenta[];
};

export async function cargarVentaCompleta(ventaId: string): Promise<VentaCompleta> {
  const [v, it, pg] = await Promise.all([
    supabase.from("ventas_mostrador").select("id,numero,subtotal,descuento,total,vuelto,anulada,created_at").eq("id", ventaId).single(),
    supabase.from("ventas_mostrador_items").select("id,nombre,cantidad,precio_unit,por_peso,bruto,neto,seq").eq("venta_id", ventaId).order("seq"),
    supabase.from("ventas_mostrador_pagos").select("medio,monto").eq("venta_id", ventaId),
  ]);
  if (v.error || !v.data) throw new Error("No encontramos esa venta.");
  if (it.error) throw new Error("No pudimos cargar los productos de la venta.");
  const ids = (it.data ?? []).map((x) => x.id as string);
  const dv = ids.length ? await supabase.from("devoluciones_mostrador_items").select("item_id,cantidad,monto").in("item_id", ids) : { data: [], error: null };
  if (dv.error) throw new Error("No pudimos cargar las devoluciones anteriores.");
  const ya = new Map<string, { c: number; m: number }>();
  for (const d of dv.data ?? []) { const a = ya.get(d.item_id as string) ?? { c: 0, m: 0 }; a.c += Number(d.cantidad); a.m += Number(d.monto); ya.set(d.item_id as string, a); }
  const items = it.data ?? [];
  return {
    id: v.data.id as string, numero: Number(v.data.numero), subtotal: Number(v.data.subtotal), descuento: Number(v.data.descuento), total: Number(v.data.total),
    vuelto: Number(v.data.vuelto), anulada: !!v.data.anulada, created_at: v.data.created_at as string,
    pagos: (pg.data ?? []).map((p) => ({ medio: p.medio as Medio, monto: Number(p.monto) })),
    itemsDevolver: items.map((x) => ({
      id: x.id as string, nombre: x.nombre as string, cantidad: Number(x.cantidad), por_peso: !!x.por_peso, neto: Number(x.neto),
      devuelto: ya.get(x.id as string)?.c ?? 0, devuelto_monto: Math.round((ya.get(x.id as string)?.m ?? 0) * 100) / 100,
    })),
    itemsTicket: items.map((x) => ({ nombre: x.nombre as string, cantidad: Number(x.cantidad), precio_unit: Number(x.precio_unit), por_peso: !!x.por_peso, importe: Number(x.bruto) })),
  };
}
