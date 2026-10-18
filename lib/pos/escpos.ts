// Ticket térmico en ESC/POS (impresoras de 58 y 80 mm) y pulso para el cajón de dinero.
// El texto se pasa a ASCII (sin tildes): es lo único que imprimen bien TODAS las térmicas sin configurar tabla de caracteres.
import { ETIQUETA_MEDIO, cantidadTexto, type ItemVenta, type PagoVenta } from "../caja";
import { peso } from "../whatsapp";

export type DatosTicket = {
  numero: number; fecha: string; kioscoNombre: string; cliente: string | null; items: ItemVenta[];
  subtotal: number; descuento: number; descuentoPct?: number; total: number; pagos: PagoVenta[]; vuelto: number;
  anulada?: boolean; pendiente?: boolean; encabezado?: string | null; pie?: string | null;
};

export const COLUMNAS: Record<58 | 80, number> = { 58: 32, 80: 48 };
const ESC = 0x1b; const GS = 0x1d;

/** Pasa a ASCII imprimible: saca tildes y reemplaza símbolos raros (espacio duro, signo menos, comillas, €). */
export function aAscii(s: string): string {
  return String(s ?? "")
    .replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[\u2212\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00d1/g, "N").replace(/\u00f1/g, "n").replace(/\u20ac/g, "EUR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

/** Parte un texto en renglones de hasta `cols` letras, sin cortar palabras si se puede. */
export function envolver(texto: string, cols: number): string[] {
  const out: string[] = [];
  for (const parrafo of aAscii(texto).split(/\r?\n/)) {
    let l = "";
    for (const palabra of parrafo.split(" ")) {
      let p = palabra;
      while (p.length > cols) { if (l) { out.push(l); l = ""; } out.push(p.slice(0, cols)); p = p.slice(cols); }
      if (!l) l = p; else if ((l + " " + p).length <= cols) l += " " + p; else { out.push(l); l = p; }
    }
    out.push(l);
  }
  return out;
}

/** "izquierda ........ derecha" en un renglón de `cols`; si no entra, el texto largo pasa a renglones previos. */
export function izqDer(izq: string, der: string, cols: number): string[] {
  const d = aAscii(der);
  const ancho = Math.max(1, cols - d.length - 1);
  const partes = envolver(izq, ancho);
  const ultimo = partes.pop() ?? "";
  return [...partes, ultimo + " ".repeat(Math.max(1, cols - ultimo.length - d.length)) + d];
}

class Buf {
  b: number[] = [];
  raw(...x: number[]) { this.b.push(...x); return this; }
  text(s: string) { for (const ch of aAscii(s)) this.b.push(ch.charCodeAt(0)); return this; }
  line(s = "") { return this.text(s).raw(0x0a); }
  align(n: 0 | 1 | 2) { return this.raw(ESC, 0x61, n); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(n: number) { return this.raw(GS, 0x21, n); }
}

/** Pulso al cajón conectado a la impresora (pin 2). Dura ~50 ms: alcanza para los cajones de 12/24 V habituales. */
export const pulsoCajon = (): Uint8Array => Uint8Array.from([ESC, 0x70, 0x00, 0x19, 0xfa]);

export function ticketEscPos(t: DatosTicket, ancho: 58 | 80 = 58, opts: { cajon?: boolean; cortar?: boolean } = {}): Uint8Array {
  const cols = COLUMNAS[ancho]; const sep = "-".repeat(cols);
  const o = new Buf().raw(ESC, 0x40);
  // Nombre en doble ancho y alto: entran la mitad de las letras, así que se parte a mano para no depender del corte de la impresora.
  o.align(1).bold(true).size(0x11);
  for (const l of envolver(t.kioscoNombre, Math.floor(cols / 2))) o.line(l);
  o.size(0).bold(false);
  if (t.encabezado) for (const l of envolver(t.encabezado, cols)) o.line(l);
  o.line(t.pendiente ? "Venta sin conexion" : `Ticket N ${t.numero}`).line(t.fecha).line(`Cliente: ${t.cliente ?? "Consumidor final"}`);
  if (t.anulada) o.bold(true).line("*** ANULADO ***").bold(false);
  o.align(0).line(sep);
  for (const i of t.items) {
    const imp = i.importe ?? (i.por_peso ? (i.cantidad * i.precio_unit) / 1000 : i.cantidad * i.precio_unit);
    for (const l of izqDer(`${cantidadTexto(i.cantidad, i.por_peso)} x ${i.nombre}`, peso(imp), cols)) o.line(l);
  }
  o.line(sep);
  for (const l of izqDer("Subtotal", peso(t.subtotal), cols)) o.line(l);
  if (t.descuento > 0) for (const l of izqDer(`Descuento${t.descuentoPct ? ` ${t.descuentoPct}%` : ""}`, `-${peso(t.descuento)}`, cols)) o.line(l);
  o.bold(true).size(0x01); // doble alto (el ancho no cambia)
  for (const l of izqDer("TOTAL", peso(t.total), cols)) o.line(l);
  o.size(0).bold(false).line(sep);
  for (const p of t.pagos) for (const l of izqDer(ETIQUETA_MEDIO[p.medio], peso(p.monto), cols)) o.line(l);
  if (t.vuelto > 0) for (const l of izqDer("Vuelto", peso(t.vuelto), cols)) o.line(l);
  o.align(1).line();
  for (const l of envolver(t.pie || "Gracias por su compra!", cols)) o.line(l);
  o.raw(ESC, 0x64, 4);
  if (opts.cortar !== false) o.raw(GS, 0x56, 0x42, 0x00);
  if (opts.cajon) o.raw(...pulsoCajon());
  return Uint8Array.from(o.b);
}

/** Página de prueba corta (para verificar ancho y conexión). */
export function paginaDePrueba(ancho: 58 | 80, cajon = false): Uint8Array {
  const cols = COLUMNAS[ancho];
  const o = new Buf().raw(ESC, 0x40).align(1).bold(true).line("PRUEBA DE IMPRESION").bold(false).align(0).line("-".repeat(cols));
  o.line(`Papel ${ancho} mm - ${cols} columnas`).line("0123456789".repeat(5).slice(0, cols)).line("Acentos: a e i o u n -> ok").line("-".repeat(cols)).align(1).line("Si lees esto, anda!").raw(ESC, 0x64, 4);
  o.raw(GS, 0x56, 0x42, 0x00);
  if (cajon) o.raw(...pulsoCajon());
  return Uint8Array.from(o.b);
}
