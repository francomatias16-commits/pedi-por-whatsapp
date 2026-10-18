// Reposición de stock (0018): lógica pura, sin Next ni Supabase, para poder probarla en Node.
import { cantidadTexto } from "./compras";

export type EstadoRepo = "agotado" | "critico" | "bajo";
export type FilaReposicion = {
  producto_id: string; nombre: string; categoria: string; por_peso: boolean;
  stock: number; stock_minimo: number; stock_objetivo: number | null; lead_time_dias: number;
  velocidad_dia: number; dias_restantes: number | null; cantidad_sugerida: number;
  estado: EstadoRepo; sin_datos: boolean;
  proveedor_id: string | null; proveedor_nombre: string | null; proveedor_telefono: string | null; costo: number | null;
};
export type ResumenRepo = { agotados: number; bajos: number; sin_proveedor: number; sin_datos: number; plata_en_stock: number };
export type GrupoProveedor = { proveedor_id: string; nombre: string; telefono: string | null; filas: FilaReposicion[] };
export type Agrupado = { grupos: GrupoProveedor[]; sinProveedor: FilaReposicion[]; sinDatos: FilaReposicion[] };
export type LineaPedido = { producto_id: string; nombre: string; por_peso: boolean; cantidad: number };

// PostgREST puede devolver los numeric como texto: se normalizan una sola vez al cargar.
export function normalizarFila(r: Record<string, unknown>): FilaReposicion {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    producto_id: String(r.producto_id), nombre: String(r.nombre), categoria: String(r.categoria ?? ""), por_peso: !!r.por_peso,
    stock: Number(r.stock), stock_minimo: Number(r.stock_minimo), stock_objetivo: n(r.stock_objetivo), lead_time_dias: Number(r.lead_time_dias),
    velocidad_dia: Number(r.velocidad_dia), dias_restantes: n(r.dias_restantes), cantidad_sugerida: Number(r.cantidad_sugerida),
    estado: r.estado as EstadoRepo, sin_datos: !!r.sin_datos,
    proveedor_id: (r.proveedor_id as string | null) ?? null, proveedor_nombre: (r.proveedor_nombre as string | null) ?? null,
    proveedor_telefono: (r.proveedor_telefono as string | null) ?? null, costo: n(r.costo),
  };
}

// Separa lo que se puede pedir hoy (por proveedor) de lo que falta resolver:
// sin proveedor asignado, o sin datos para calcular cuánto pedir (no se inventan cantidades).
export function agruparPorProveedor(filas: FilaReposicion[]): Agrupado {
  const sinDatos = filas.filter((f) => f.sin_datos);
  const sinProveedor = filas.filter((f) => !f.sin_datos && !f.proveedor_id);
  const mapa = new Map<string, GrupoProveedor>();
  for (const f of filas) {
    if (f.sin_datos || !f.proveedor_id) continue;
    const g = mapa.get(f.proveedor_id) ?? { proveedor_id: f.proveedor_id, nombre: f.proveedor_nombre ?? "Proveedor", telefono: f.proveedor_telefono, filas: [] };
    g.filas.push(f); mapa.set(f.proveedor_id, g);
  }
  const grupos = [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { grupos, sinProveedor, sinDatos };
}

// Lo que escribe la persona en el campo de cantidad (kg si es por peso) ← lo que sugiere la base (gramos).
export function cantidadAInput(cant: number, porPeso: boolean): string {
  if (!porPeso) return String(cant);
  return String(Math.round(cant) / 1000).replace(".", ",");
}

// Texto del pedido para mandar por WhatsApp al proveedor (una línea por producto).
export function mensajePedidoProveedor(kiosco: string, proveedor: string, lineas: Pick<LineaPedido, "nombre" | "por_peso" | "cantidad">[]): string {
  const items = lineas.filter((l) => l.cantidad > 0).map((l) => `• ${l.nombre}: ${cantidadTexto(l.cantidad, l.por_peso)}`);
  return [`Hola ${proveedor}! Te paso el pedido de ${kiosco}:`, ...items, "Gracias!"].join("\n");
}

// Costo estimado del pedido: solo con los productos que tienen último costo (por peso el costo es por kg y la cantidad va en gramos).
export function costoEstimado(lineas: { cantidad: number; por_peso: boolean; costo: number | null }[]): { total: number; sinCosto: number } {
  let total = 0, sinCosto = 0;
  for (const l of lineas) {
    if (l.costo === null || l.costo <= 0) { sinCosto++; continue; }
    total += l.por_peso ? (l.costo * l.cantidad) / 1000 : l.costo * l.cantidad;
  }
  return { total: Math.round((total + Number.EPSILON) * 100) / 100, sinCosto };
}

export const ETIQUETA_ESTADO: Record<EstadoRepo, string> = { agotado: "Se acabó", critico: "Se acaba", bajo: "Queda poco" };

export function textoDias(f: Pick<FilaReposicion, "estado" | "dias_restantes">): string {
  if (f.estado === "agotado") return "Se acabó";
  if (f.dias_restantes === null) return "Bajo el mínimo";
  const d = f.dias_restantes;
  return d < 1 ? "Menos de 1 día" : `Alcanza ${d.toLocaleString("es-AR", { maximumFractionDigits: 1 })} días`;
}

// Aviso push diario (lo manda el cron). Un solo mensaje por kiosco, no uno por producto.
export function armarAvisoStock(a: { agotados: number; bajos: number; sin_proveedor: number }) {
  const partes: string[] = [];
  if (a.agotados > 0) partes.push(a.agotados > 1 ? `${a.agotados} se acabaron` : `${a.agotados} se acabó`);
  if (a.bajos > 0) partes.push(a.bajos > 1 ? `${a.bajos} quedan poco` : `${a.bajos} queda poco`);
  const sp = a.sin_proveedor > 0 ? ` · ${a.sin_proveedor} sin proveedor asignado` : "";
  return { title: "Hay que reponer mercadería", body: partes.join(" · ") + sp, url: "/panel?tab=reponer" };
}

export const ERRORES_REPOSICION: [string, string][] = [
  ["no_autorizado", "No tenés permiso para esta operación."],
  ["proveedor_no_encontrado", "Ese proveedor ya no existe. Actualizá la página."],
  ["stock_no_controlado", "Ese producto no controla stock. Activalo desde Productos."],
  ["cantidad_invalida", "Revisá la cantidad."],
  ["pin_requerido", "Hace falta el PIN de supervisor."],
  ["tipo_ajuste_invalido", "Elegí un motivo de la lista."],
  ["motivo_requerido", "Escribí un motivo de al menos 3 letras."],
];
export const mensajeReposicion = (m: string) => ERRORES_REPOSICION.find(([k]) => m.includes(k))?.[1] ?? "No se pudo completar la operación.";

// Motivos de ajuste de stock (0019). Las pérdidas son merma, rotura y vencimiento; el conteo se informa aparte.
export const MOTIVOS_AJUSTE: [string, string][] = [
  ["manual", "Ajuste manual"], ["conteo_fisico", "Conteo físico"], ["merma", "Merma"], ["rotura", "Rotura"], ["vencimiento", "Vencimiento"],
];
export const ETIQUETA_MOTIVO: Record<string, string> = Object.fromEntries(MOTIVOS_AJUSTE);
export const MOTIVOS_PERDIDA = ["merma", "rotura", "vencimiento"];
export type ReporteMermas = {
  total_perdida: number;
  por_motivo: { motivo: string; unidades: number; costo: number }[];
  top: { nombre: string; por_peso: boolean; unidades: number; costo: number }[];
};

// Nombre de cada tipo de movimiento en el historial (0020 agregó ventas, devoluciones y pedidos).
export const ETIQUETA_TIPO_MOV: Record<string, string> = {
  compra: "Compra", anulacion_compra: "Anulación de compra", ajuste: "Ajuste",
  venta: "Venta", anulacion_venta: "Anulación de venta", devolucion: "Devolución",
  pedido: "Pedido confirmado", cancelacion_pedido: "Pedido cancelado",
};
