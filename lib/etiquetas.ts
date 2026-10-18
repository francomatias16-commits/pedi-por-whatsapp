import { esCodigoValido } from "./ean";
import { calcularLinea, hoyAR, type Promo } from "./pos/promos";

export type Simbologia = "auto" | "ean13" | "code128";
export type ConfigEtiquetas = {
  ancho_mm: number; alto_mm: number; columnas: number; margen_mm: number;
  simbologia: Simbologia; mostrar_codigo: boolean; mostrar_promos: boolean;
};
export const CONFIG_DEFECTO: ConfigEtiquetas = { ancho_mm: 50, alto_mm: 25, columnas: 3, margen_mm: 2, simbologia: "auto", mostrar_codigo: true, mostrar_promos: true };

export type ProductoEtiqueta = {
  id: string; nombre: string; categoria: string; precio: number; barcode: string | null; plu: string | null; vendido_por_peso: boolean;
};
export type Seleccion = { producto_id: string; copias: number };
export type CodigoEtiqueta = { valor: string; formato: "EAN13" | "EAN8" | "CODE128" } | null;
export type PrecioEtiqueta = { regular: number; promo: number | null; leyenda: string | null; promo_nombre: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Dígito verificador EAN-13 a partir de los 12 primeros dígitos. */
export function digitoEan13(doce: string): string {
  const suma = [...doce].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (suma % 10)) % 10);
}

/**
 * Código a imprimir. Por peso: EAN-13 de balanza con el mismo layout que lee el POS (lib/pos/balanza.ts):
 * "2" + PLU(5) + control(0) + peso(00000) + dígito EAN. El peso va en cero porque la etiqueta de góndola es previa al
 * pesaje; el POS no lo toma como una pesada y busca el producto por PLU. Sin PLU válido no se imprime código
 * (mejor sin código que uno que coincida con otro producto).
 */
export function resolverCodigo(p: Pick<ProductoEtiqueta, "barcode" | "plu" | "vendido_por_peso">, simbologia: Simbologia = "auto"): CodigoEtiqueta {
  if (p.vendido_por_peso) {
    const plu = String(p.plu ?? "").trim();
    if (!/^\d{1,5}$/.test(plu)) return null;
    const doce = "2" + plu.padStart(5, "0") + "0" + "00000";
    return { valor: doce + digitoEan13(doce), formato: "EAN13" };
  }
  const cod = String(p.barcode ?? "").trim();
  if (!cod) return null;
  if (simbologia !== "code128") {
    if (/^\d{13}$/.test(cod) && esCodigoValido(cod)) return { valor: cod, formato: "EAN13" };
    if (simbologia === "auto" && /^\d{8}$/.test(cod) && esCodigoValido(cod)) return { valor: cod, formato: "EAN8" };
  }
  return { valor: cod, formato: "CODE128" }; // alfanumérico, UPC-A o EAN mal cargado: CODE128 lo acepta siempre
}

/**
 * Precio de la etiqueta. Por peso se muestra $/kg (el precio del producto ya es por kg).
 * Usa las mismas reglas que el POS: un % por producto o categoría rebaja el precio de una unidad (o de 1 kg);
 * un NxM no cambia el precio unitario, así que sale como leyenda ("Llevando 3 pagás 2").
 */
export function precioEtiqueta(p: ProductoEtiqueta, promos: Promo[], hoy = hoyAR()): PrecioEtiqueta {
  const base: PrecioEtiqueta = { regular: r2(p.precio), promo: null, leyenda: null, promo_nombre: null };
  const r = calcularLinea({ producto_id: p.id, categoria: p.categoria, precio: p.precio, cantidad: p.vendido_por_peso ? 1000 : 1, por_peso: p.vendido_por_peso, descuento_pct: 0 }, promos, hoy);
  if (r.promo > 0) {
    base.promo = r2((r.bruto - r.promo) / 100); // calcularLinea trabaja en centavos
    base.promo_nombre = r.promo_nombre;
    return base;
  }
  if (!p.vendido_por_peso) {
    const nxm = promos
      .filter((x) => x.activa && x.tipo === "nxm" && x.producto_id === p.id && x.lleva && x.paga && !(x.desde && x.desde > hoy) && !(x.hasta && x.hasta < hoy))
      .sort((a, b) => ((b.lleva! - b.paga!) / b.lleva!) - ((a.lleva! - a.paga!) / a.lleva!))[0];
    if (nxm) { base.leyenda = `Llevando ${nxm.lleva} pagás ${nxm.paga}`; base.promo_nombre = nxm.nombre; }
  }
  return base;
}

export const anchoHojaMm = (c: Pick<ConfigEtiquetas, "ancho_mm" | "columnas" | "margen_mm">) => c.ancho_mm * c.columnas + c.margen_mm * (c.columnas + 1);

export const totalEtiquetas = (sel: Seleccion[]) => sel.reduce((s, x) => s + Math.max(0, Math.floor(x.copias) || 0), 0);

/** Lista plana de productos, repetido cada uno tantas veces como copias. Los que no están en el catálogo se saltean. */
export function expandir(sel: Seleccion[], productos: ProductoEtiqueta[]): ProductoEtiqueta[] {
  const por = new Map(productos.map((p) => [p.id, p]));
  const out: ProductoEtiqueta[] = [];
  for (const s of sel) {
    const p = por.get(s.producto_id);
    const n = Math.max(0, Math.floor(s.copias) || 0);
    if (p) for (let i = 0; i < n; i++) out.push(p);
  }
  return out;
}

/** Mensaje de error para mostrar, o null si la configuración es válida (mismos límites que los checks de la tabla). */
export function validarConfig(c: ConfigEtiquetas): string | null {
  const en = (v: number, a: number, b: number) => Number.isFinite(v) && v >= a && v <= b;
  if (!en(c.ancho_mm, 20, 120)) return "El ancho de la etiqueta tiene que estar entre 20 y 120 mm.";
  if (!en(c.alto_mm, 15, 100)) return "El alto de la etiqueta tiene que estar entre 15 y 100 mm.";
  if (!Number.isInteger(c.columnas) || c.columnas < 1 || c.columnas > 6) return "Las columnas tienen que ser de 1 a 6.";
  if (!en(c.margen_mm, 0, 10)) return "El margen tiene que estar entre 0 y 10 mm.";
  return null;
}
