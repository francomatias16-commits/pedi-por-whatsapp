import { mensajeErrorSql } from "./errores";
// Tipos y helpers compartidos del módulo de caja (POS).
export type Medio = "efectivo" | "transferencia" | "mercadopago" | "tarjeta" | "cuenta_corriente";
export const MEDIOS: Medio[] = ["efectivo", "transferencia", "mercadopago", "tarjeta", "cuenta_corriente"];
export const ETIQUETA_MEDIO: Record<Medio, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercadopago: "QR / Mercado Pago",
  tarjeta: "Tarjeta",
  cuenta_corriente: "Cuenta corriente",
};
// Dentro del cobro se usan letras para no pisar los atajos F1-F10 / 1-0 del POS.
export const ATAJO_MEDIO: Record<string, Medio> = { e: "efectivo", t: "transferencia", q: "mercadopago", k: "tarjeta", c: "cuenta_corriente" };
export const LETRA_MEDIO: Record<Medio, string> = { efectivo: "E", transferencia: "T", mercadopago: "Q", tarjeta: "K", cuenta_corriente: "C" };

export type Turno = {
  id: string; estado: "abierto" | "cerrado"; abierto_at: string; cerrado_at: string | null;
  monto_inicial: number; monto_final_declarado: number | null; monto_final_calculado: number | null; diferencia: number | null;
};
export type TipoMov = "sangria" | "refuerzo" | "retiro_final";
export type Mov = { tipo: TipoMov; monto: number; concepto: string | null; created_at: string };
export const ETIQUETA_MOV: Record<TipoMov, string> = { sangria: "Sangría (retiro parcial)", refuerzo: "Refuerzo (agregar efectivo)", retiro_final: "Retiro final (vaciado)" };
export type PagoVenta = { medio: Medio; monto: number };
export type ItemVenta = { nombre: string; cantidad: number; precio_unit: number; por_peso?: boolean; importe?: number };
export type Venta = {
  id: string; numero: number; subtotal: number; descuento: number; total: number; vuelto: number;
  anulada: boolean; anulada_motivo: string | null; cliente_nombre: string | null; created_at: string;
  pagos: PagoVenta[]; items: ItemVenta[];
};
export type DevolucionTurno = { id: string; numero: number; venta_numero: number; total: number; medio: Medio; motivo: string; created_at: string };
export type Resumen = {
  turno_id: string; estado: string; abierto_at: string; cerrado_at: string | null; monto_inicial: number;
  ventas_efectivo: number; neto_movimientos: number; monto_calculado: number; movimientos: Mov[];
  ventas_por_medio: Record<Medio, number>; ventas: Venta[]; devoluciones: DevolucionTurno[];
};
export type ReporteZ = {
  turno_id: string; estado: string; abierto_at: string; cerrado_at: string | null; monto_inicial: number;
  cobros_por_medio: Record<Medio, number>; refuerzos: number; sangrias_y_retiros: number; efectivo_esperado: number;
  monto_declarado: number | null; diferencia: number | null; total_vendido: number; descuentos: number; ventas: number; anuladas: number;
  descuentos_lineas?: number; descuentos_promos?: number; devoluciones_total?: number; devoluciones?: number; total_neto?: number;
};
export type ProductoPos = {
  id: string; nombre: string; categoria: string; precio: number; barcode: string | null; stock: number; stock_controlado: boolean; disponible: boolean;
  vendido_por_peso: boolean; plu: string | null; permite_sin_stock: boolean;
};
export type PosConfig = {
  sonido: boolean; imprimir_auto: boolean; abrir_cajon: boolean; ticket_encabezado: string | null; ticket_pie: string | null; ticket_ancho: 58 | 80;
  tiene_pin: boolean; pin_anular: boolean; pin_devolucion: boolean;
};
export const CONFIG_POR_DEFECTO: PosConfig = {
  sonido: true, imprimir_auto: false, abrir_cajon: false, ticket_encabezado: null, ticket_pie: null, ticket_ancho: 58,
  tiene_pin: false, pin_anular: true, pin_devolucion: true,
};
// ¿Esta acción necesita PIN de supervisor? (el servidor es quien manda; esto solo evita pedirlo de más)
export const necesitaPin = (c: PosConfig, accion: "anular" | "devolucion") => c.tiene_pin && (accion === "anular" ? c.pin_anular : c.pin_devolucion);
export type Cliente = { id: string; nombre: string; telefono: string; saldo: number };
export type LineaCarrito = {
  producto_id: string; nombre: string; categoria: string; precio: number; cantidad: number; stock_controlado: boolean; stock: number;
  por_peso: boolean; descuento_pct: number; permite_sin_stock: boolean;
};

export const mensajeError = (m: string) => mensajeErrorSql(m, "caja");
export const num = (s: string) => { const n = Number(String(s).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
export const fecha = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
export const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const cantidadTexto = (cantidad: number, porPeso?: boolean) => (porPeso ? `${(cantidad / 1000).toFixed(3).replace(".", ",")} kg` : String(cantidad));
export const redondear = (n: number) => Math.round(n * 100) / 100;

export const normalizarResumen = (r: Resumen): Resumen => ({
  ...r,
  monto_inicial: Number(r.monto_inicial), ventas_efectivo: Number(r.ventas_efectivo), neto_movimientos: Number(r.neto_movimientos), monto_calculado: Number(r.monto_calculado),
  movimientos: (r.movimientos ?? []).map((m) => ({ ...m, monto: Number(m.monto) })),
  ventas_por_medio: Object.fromEntries(Object.entries(r.ventas_por_medio ?? {}).map(([k, v]) => [k, Number(v)])) as Record<Medio, number>,
  devoluciones: (r.devoluciones ?? []).map((d) => ({ ...d, total: Number(d.total) })),
  ventas: (r.ventas ?? []).map((v) => ({
    ...v, subtotal: Number(v.subtotal), descuento: Number(v.descuento), total: Number(v.total), vuelto: Number(v.vuelto),
    pagos: v.pagos.map((p) => ({ ...p, monto: Number(p.monto) })),
    items: v.items.map((i) => ({ ...i, cantidad: Number(i.cantidad), precio_unit: Number(i.precio_unit), por_peso: !!i.por_peso })),
  })),
});
export const normalizarZ = (z: ReporteZ): ReporteZ => ({
  ...z,
  monto_inicial: Number(z.monto_inicial), refuerzos: Number(z.refuerzos), sangrias_y_retiros: Number(z.sangrias_y_retiros),
  efectivo_esperado: Number(z.efectivo_esperado), total_vendido: Number(z.total_vendido), descuentos: Number(z.descuentos),
  descuentos_lineas: Number(z.descuentos_lineas ?? 0), descuentos_promos: Number(z.descuentos_promos ?? 0),
  devoluciones_total: Number(z.devoluciones_total ?? 0), devoluciones: Number(z.devoluciones ?? 0), total_neto: Number(z.total_neto ?? z.total_vendido),
  monto_declarado: z.monto_declarado == null ? null : Number(z.monto_declarado), diferencia: z.diferencia == null ? null : Number(z.diferencia),
  cobros_por_medio: Object.fromEntries(Object.entries(z.cobros_por_medio ?? {}).map(([k, v]) => [k, Number(v)])) as Record<Medio, number>,
});
