// Exportación de los datos del kiosco (etapa 0). El dueño los baja en un solo archivo JSON.
// Las secciones tienen que coincidir con las que acepta la función SQL kiosco_exportar_seccion (lo verifica tests/exportar.test.mjs).
export const SECCIONES_EXPORTABLES = [
  "kiosco", "productos", "clientes", "pedidos", "pedido_items", "fiado_movimientos", "sellos", "canjes",
  "proveedores", "compras", "compra_items", "proveedor_movimientos", "stock_movimientos", "lotes_stock",
  "ventas_mostrador", "ventas_mostrador_items", "ventas_mostrador_pagos", "devoluciones_mostrador", "devoluciones_mostrador_items",
  "turnos_caja", "movimientos_caja", "fidelidad_campanas", "fidelidad_premios", "pos_promos",
  "pedidos_proveedor", "pedido_proveedor_items", "ajustes_precios", "historial_precios",
] as const;

export type Seccion = (typeof SECCIONES_EXPORTABLES)[number];

export function armarExportacion(datos: Record<string, unknown>, ahora = new Date()) {
  return { generado: ahora.toISOString(), formato: 1, ...datos };
}

export function nombreArchivo(slug: string, ahora = new Date()) {
  const limpio = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return `datos-${limpio || "kiosco"}-${ahora.toISOString().slice(0, 10)}.json`;
}

// Fecha desde la cual se borran los datos de una baja (30 días, igual que kioscos_purgar_bajas).
export const DIAS_ANTES_DE_BORRAR = 30;
export function fechaDeBorrado(bajaISO: string): Date {
  const d = new Date(bajaISO);
  d.setDate(d.getDate() + DIAS_ANTES_DE_BORRAR);
  return d;
}
