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

export const ERRORES: [string, string][] = [
  ["turno_abierto", "Ya hay una caja abierta."],
  ["turno_cerrado", "La caja está cerrada."],
  ["monto_invalido", "Revisá el monto: tiene que ser un número válido."],
  ["tipo_invalido", "Tipo de movimiento inválido."],
  ["no_autorizado", "No tenés permiso para esta caja."],
  ["sin_stock", "Alguno de los productos no tiene stock suficiente."],
  ["pago_insuficiente", "El pago no alcanza para cubrir el total."],
  ["pago_excede_total", "Lo que no es efectivo no puede pasar el total. El vuelto sale solo de efectivo."],
  ["medio_pago_invalido", "Ese medio de pago no está disponible."],
  ["producto_no_encontrado", "Un producto del carrito ya no existe. Actualizá la página."],
  ["cantidad_invalida", "Revisá las cantidades del carrito (hasta 99 unidades o 99,999 kg)."],
  ["fecha_invalida", "La fecha de la venta no es válida."],
  ["pin_requerido", "Hace falta el PIN de supervisor."],
  ["tiene_devoluciones", "Esa venta ya tiene devoluciones: no se puede anular."],
  ["devolucion_excede_venta", "No se puede devolver más de lo que se vendió."],
  ["efectivo_insuficiente", "No hay tanto efectivo en la caja para devolver."],
  ["sin_turno_abierto", "Abrí la caja para registrar la devolución."],
  ["ya_anulada", "Esa venta ya estaba anulada."],
  ["motivo_requerido", "Indicá el motivo de la anulación (mínimo 3 letras)."],
  ["descuento_invalido", "El descuento tiene que estar entre 0 y 100%."],
  ["cuenta_corriente_sin_cliente", "Para cobrar a cuenta corriente elegí un cliente."],
  ["cliente_no_encontrado", "Ese cliente ya no existe."],
  ["items_invalidos", "Elegí al menos un producto para devolver."],
  ["item_no_encontrado", "Uno de los productos ya no figura en esa venta. Volvé a abrir la devolución."],
  ["venta_sin_cuenta_corriente", "Esa venta no se cobró a cuenta corriente: elegí otro medio para devolver."],
  ["devolucion_excede_cuenta_corriente", "No se puede devolver a cuenta corriente más de lo que se cobró por ahí."],
  ["pin_invalido", "El PIN tiene que ser de 4 a 8 números."],
  ["sangria_excede_efectivo", "No hay tanto efectivo en la caja para retirar."],
];
export const mensajeError = (m: string) => ERRORES.find(([k]) => m.includes(k))?.[1] ?? "No se pudo completar la operación.";
export const num = (s: string) => { const n = Number(String(s).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
export const fecha = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
export const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const cantidadTexto = (cantidad: number, porPeso?: boolean) => (porPeso ? `${(cantidad / 1000).toFixed(3).replace(".", ",")} kg` : String(cantidad));
export const redondear = (n: number) => Math.round(n * 100) / 100;

// Totales del carrito: el descuento global se calcula igual que en la base (redondeo a centavos).
export function totalesCarrito(lineas: LineaCarrito[], descPct: number) {
  const subtotal = redondear(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0));
  const pct = Math.min(100, Math.max(0, descPct || 0));
  const descuento = redondear((subtotal * pct) / 100);
  return { subtotal, descuento, total: redondear(subtotal - descuento), pct };
}

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
