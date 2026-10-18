// Cálculo de la venta idéntico al de registrar_venta_mostrador (migración 0013), en centavos enteros para no
// arrastrar errores de punto flotante. Redondeo "mitad hacia arriba", igual que numeric de Postgres.
export type Promo = {
  id: string; nombre: string; tipo: "nxm" | "pct"; producto_id: string | null; categoria: string | null;
  lleva: number | null; paga: number | null; pct: number | null; desde: string | null; hasta: string | null; activa: boolean;
};
export type LineaCalc = { producto_id: string; categoria: string; precio: number; cantidad: number; por_peso: boolean; descuento_pct: number };
export type ResultadoLinea = { bruto: number; promo: number; promo_id: string | null; promo_nombre: string | null; linea: number; neto: number };
export type ResultadoVenta = {
  lineas: ResultadoLinea[]; subtotal: number; descPromos: number; descLineas: number; descGlobal: number; descuento: number; total: number;
};

const dividir = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b)); // a/b redondeado (a>=0)
const aCent = (n: number) => Math.round(n * 100);
const dePesos = (c: number) => c / 100;
const pct100 = (p: number) => Math.round(Math.min(100, Math.max(0, p || 0)) * 100);

/** Fecha de hoy en Argentina (YYYY-MM-DD) para vigencia de promos. */
export const hoyAR = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export function calcularLinea(l: LineaCalc, promos: Promo[], hoy: string): { bruto: number; promo: number; promo_id: string | null; promo_nombre: string | null; man: number; linea: number } {
  const precioC = aCent(l.precio);
  const bruto = l.por_peso ? dividir(precioC * l.cantidad, 1000) : precioC * l.cantidad;
  let mejor = 0; let mejorId: string | null = null; let mejorNombre: string | null = null;
  for (const p of promos) {
    if (!p.activa) continue;
    if (!(p.producto_id === l.producto_id || (p.categoria != null && p.categoria === l.categoria))) continue;
    if ((p.desde && p.desde > hoy) || (p.hasta && p.hasta < hoy)) continue;
    let d = 0;
    if (p.tipo === "pct") d = dividir(bruto * pct100(p.pct ?? 0), 10000);
    else if (!l.por_peso && p.lleva && p.paga) d = Math.floor(l.cantidad / p.lleva) * (p.lleva - p.paga) * precioC;
    if (d > mejor || (d === mejor && d > 0 && mejorId !== null && p.id < mejorId)) { mejor = d; mejorId = p.id; mejorNombre = p.nombre; }
  }
  const promo = Math.min(mejor, bruto);
  const man = dividir((bruto - promo) * pct100(l.descuento_pct), 10000);
  return { bruto, promo, promo_id: promo > 0 ? mejorId : null, promo_nombre: promo > 0 ? mejorNombre : null, man, linea: bruto - promo - man };
}

export function calcularVenta(lineas: LineaCalc[], promos: Promo[], descGlobalPct: number, hoy = hoyAR()): ResultadoVenta {
  const calc = lineas.map((l) => calcularLinea(l, promos, hoy));
  const sumLinea = calc.reduce((s, c) => s + c.linea, 0);
  const descG = dividir(sumLinea * pct100(descGlobalPct), 10000);
  let resto = descG;
  const netos = calc.map((c, i) => {
    if (descG === 0 || sumLinea === 0) return c.linea;
    const asig = Math.min(i === calc.length - 1 ? resto : dividir(descG * c.linea, sumLinea), c.linea);
    resto -= asig;
    return c.linea - asig;
  });
  const subtotal = calc.reduce((s, c) => s + c.bruto, 0);
  const descPromos = calc.reduce((s, c) => s + c.promo, 0);
  const descLineas = calc.reduce((s, c) => s + c.man, 0);
  return {
    lineas: calc.map((c, i) => ({ bruto: dePesos(c.bruto), promo: dePesos(c.promo), promo_id: c.promo_id, promo_nombre: c.promo_nombre, linea: dePesos(c.linea), neto: dePesos(netos[i]) })),
    subtotal: dePesos(subtotal), descPromos: dePesos(descPromos), descLineas: dePesos(descLineas), descGlobal: dePesos(descG),
    descuento: dePesos(descPromos + descLineas + descG), total: dePesos(sumLinea - descG),
  };
}

// ── Alta y edición de promociones (pantalla Promos). Las mismas reglas que los checks de la tabla pos_promos. ──
export type FormPromo = {
  nombre: string; tipo: "nxm" | "pct"; alcance: "producto" | "categoria"; producto_id: string; categoria: string;
  lleva: string; paga: string; pct: string; desde: string; hasta: string;
};
export const PROMO_VACIA: FormPromo = { nombre: "", tipo: "nxm", alcance: "producto", producto_id: "", categoria: "", lleva: "2", paga: "1", pct: "", desde: "", hasta: "" };

const aNumero = (s: string) => Number(String(s).trim().replace(",", "."));

/** Devuelve el mensaje de error para mostrar, o null si el formulario es válido. */
export function validarPromo(f: FormPromo): string | null {
  const nombre = f.nombre.trim();
  if (nombre.length < 1 || nombre.length > 80) return "Poné un nombre de hasta 80 letras.";
  if (f.alcance === "producto" && !f.producto_id) return "Elegí el producto de la promoción.";
  if (f.alcance === "categoria" && !f.categoria.trim()) return "Elegí la categoría de la promoción.";
  if (f.tipo === "nxm") {
    if (f.alcance !== "producto") return "El NxM se arma sobre un producto, no sobre una categoría.";
    const lleva = aNumero(f.lleva); const paga = aNumero(f.paga);
    if (!Number.isInteger(lleva) || lleva < 2 || lleva > 99) return "“Lleva” tiene que ser un entero entre 2 y 99.";
    if (!Number.isInteger(paga) || paga < 1) return "“Paga” tiene que ser un entero de 1 o más.";
    if (paga >= lleva) return "“Paga” tiene que ser menor que “Lleva” (ej: lleva 3, paga 2).";
  } else {
    const p = aNumero(f.pct);
    if (!f.pct.trim() || !Number.isFinite(p) || p <= 0 || p > 100) return "El porcentaje tiene que ser mayor a 0 y hasta 100.";
  }
  if (f.desde && f.hasta && f.desde > f.hasta) return "La fecha “desde” no puede ser posterior a “hasta”.";
  return null;
}

/** Fila lista para insertar/actualizar en pos_promos (sin kiosco_id). */
export function filaPromo(f: FormPromo) {
  const nxm = f.tipo === "nxm";
  return {
    nombre: f.nombre.trim(), tipo: f.tipo,
    producto_id: f.alcance === "producto" ? f.producto_id : null,
    categoria: f.alcance === "categoria" ? f.categoria.trim() : null,
    lleva: nxm ? aNumero(f.lleva) : null, paga: nxm ? aNumero(f.paga) : null,
    pct: nxm ? null : Math.round(aNumero(f.pct) * 100) / 100,
    desde: f.desde || null, hasta: f.hasta || null,
  };
}

export function formDePromo(p: Promo): FormPromo {
  return {
    nombre: p.nombre, tipo: p.tipo, alcance: p.producto_id ? "producto" : "categoria", producto_id: p.producto_id ?? "", categoria: p.categoria ?? "",
    lleva: p.lleva != null ? String(p.lleva) : "2", paga: p.paga != null ? String(p.paga) : "1", pct: p.pct != null ? String(p.pct).replace(".", ",") : "",
    desde: p.desde ?? "", hasta: p.hasta ?? "",
  };
}

/** Texto corto: "Lleva 3 paga 2 · Coca 500" / "15% · categoría Golosinas". */
export function describirPromo(p: Promo, nombreProducto: (id: string) => string | undefined): string {
  const donde = p.producto_id ? (nombreProducto(p.producto_id) ?? "producto eliminado") : `categoría ${p.categoria}`;
  const que = p.tipo === "nxm" ? `Lleva ${p.lleva} paga ${p.paga}` : `${String(p.pct).replace(".", ",")}% de descuento`;
  return `${que} · ${donde}`;
}

/** Estado según vigencia: "vigente", "programada" o "vencida" (la pausa manual se muestra aparte). */
export function vigenciaPromo(p: Promo, hoy = hoyAR()): "vigente" | "programada" | "vencida" {
  if (p.desde && p.desde > hoy) return "programada";
  if (p.hasta && p.hasta < hoy) return "vencida";
  return "vigente";
}
