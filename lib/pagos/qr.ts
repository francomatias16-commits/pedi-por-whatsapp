// QR de Mercado Pago en la caja: constantes, validaciones y armado de lo que se le manda a Mercado Pago.
// Sin imports relativos: se prueba directo con `npm test`.

// Minutos que espera un cobro QR antes de vencer. Tiene que coincidir con qr_minutos_vencimiento() de la base (lo verifica tests/qr.test.mjs).
export const QR_MINUTOS = 5;
// Mínimo de Mercado Pago para un cobro con QR y tope razonable para un kiosco (la base usa los mismos valores).
export const QR_MONTO_MIN = 15;
export const QR_MONTO_MAX = 5_000_000;

export const PROVINCIAS = [
  "Buenos Aires", "Capital Federal", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
] as const;

const soloLetrasYNumeros = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "");
// Mercado Pago pide identificadores externos alfanuméricos (hasta 40). Salen del id del local, así el alta se puede repetir sin duplicar.
export const idExternoTienda = (kioscoId: string) => `T${soloLetrasYNumeros(kioscoId)}`.slice(0, 40);
export const idExternoCaja = (kioscoId: string) => `C${soloLetrasYNumeros(kioscoId)}`.slice(0, 40);

export type Ubicacion = { calle: string; numero: string; ciudad: string; provincia: string; lat: number; lng: number };
// Devuelve un código de error o null si está bien. El sitio es Argentina: latitud y longitud dentro de su territorio.
export function validarUbicacion(u: Partial<Ubicacion>): string | null {
  const t = (x: unknown, max: number) => typeof x === "string" && x.trim().length >= 1 && x.trim().length <= max;
  if (!t(u.calle, 80)) return "calle_invalida";
  if (!t(u.numero, 10)) return "numero_invalido";
  if (!t(u.ciudad, 60)) return "ciudad_invalida";
  if (!(PROVINCIAS as readonly string[]).includes(String(u.provincia))) return "provincia_invalida";
  const lat = Number(u.lat), lng = Number(u.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -56 || lat > -21 || lng < -74 || lng > -53) return "coordenadas_invalidas";
  return null;
}

export function armarTienda(o: { kioscoId: string; nombre: string; ubicacion: Ubicacion }) {
  const u = o.ubicacion;
  return {
    name: o.nombre.slice(0, 60),
    external_id: idExternoTienda(o.kioscoId),
    location: {
      street_name: u.calle.trim(), street_number: u.numero.trim(), city_name: u.ciudad.trim(), state_name: u.provincia,
      latitude: Number(u.lat), longitude: Number(u.lng), reference: "Mostrador",
    },
  };
}

// Caja en modo "pdv": las órdenes las manda el sistema del local (esta app) y el cliente las paga escaneando el QR fijo de la caja.
export const armarCaja = (o: { kioscoId: string; tiendaId: number | string }) => ({
  name: "Caja principal", store_id: String(o.tiendaId), external_store_id: idExternoTienda(o.kioscoId), external_id: idExternoCaja(o.kioscoId),
  config: { qr: { operating_mode: "pdv" } },
});

const decimal = (n: number) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// La orden de un cobro (API de Orders, modo static: queda asociada al QR fijo de la caja). El monto sale de la base (cobros_qr_pos),
// nunca del navegador. Un solo renglón con el total evita diferencias de redondeo. Mercado Pago pide los montos como texto y la
// expiración como duración ISO 8601 (mínimo 30 segundos). Los avisos ya no viajan en la orden: se configuran en el panel de Mercado Pago.
export function armarOrdenQR(o: { cobroId: string; monto: number; kioscoNombre: string; externalPosId: string }) {
  const total = decimal(o.monto);
  const titulo = `Compra en ${o.kioscoNombre}`.slice(0, 60);
  return {
    type: "qr",
    external_reference: o.cobroId,
    description: titulo,
    total_amount: total,
    expiration_time: `PT${QR_MINUTOS}M`,
    config: { qr: { external_pos_id: o.externalPosId, mode: "static" } },
    transactions: { payments: [{ amount: total }] },
    items: [{ title: titulo, unit_price: total, quantity: 1, unit_measure: "unit", external_code: "VENTA" }],
  };
}

// Estado de la orden de Mercado Pago → estado que entiende qr_confirmar. "canceled" no se traduce: las cancelaciones las decide la caja.
export function estadoDesdeOrden(status?: string): "pendiente" | "aprobado" | "rechazado" | "vencido" | "reembolsado" | null {
  switch (status) {
    case "created": case "action_required": case "processing": return "pendiente";
    case "processed": return "aprobado";
    case "failed": return "rechazado";
    case "expired": return "vencido";
    case "refunded": return "reembolsado";
    default: return null;
  }
}

export const montoQRValido = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= QR_MONTO_MIN && n <= QR_MONTO_MAX && Math.round(n * 100) === n * 100;

// Estado de un cobro QR tal como lo ve la caja.
export type EstadoCobroQR = "pendiente" | "aprobado" | "vencido" | "cancelado" | "reembolsado";
export type VistaQR = "esperando" | "cobrado" | "vencido" | "cancelado" | "reembolsado";
export function vistaQR(estado: string, ventaId?: string | null): VistaQR {
  if (estado === "aprobado") return "cobrado";
  if (estado === "reembolsado") return "reembolsado";
  if (estado === "vencido") return "vencido";
  if (estado === "cancelado") return "cancelado";
  void ventaId;
  return "esperando";
}
// Cada cuánto consulta la caja y cuántas veces antes de ofrecer reintentar (5 minutos de vida del QR + margen).
export const QR_CONSULTA_MS = 3000;
export const QR_CONSULTAS_MAX = Math.ceil(((QR_MINUTOS + 1) * 60 * 1000) / QR_CONSULTA_MS);

// ¿Hay un cobro ya aprobado (sin venta) que cubra exactamente este monto? La base los empareja por monto, el más viejo primero.
export function cobroDisponible(sinVenta: { id: string; monto: number; vigente?: boolean }[], monto: number, yaUsados = 0): boolean {
  return sinVenta.filter((c) => c.vigente !== false && Math.abs(Number(c.monto) - monto) < 0.005).length > yaUsados;
}
