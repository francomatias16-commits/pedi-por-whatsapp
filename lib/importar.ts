import { esCodigoValido } from "./ean";

// stock, mínimo, objetivo, días y proveedor: opcionales. Si hay stock, el producto queda con control de stock (unidades enteras).
export type FilaImport = {
  nombre: string; precio: number; categoria: string; barcode: string | null;
  stock?: number | null; minimo?: number | null; objetivo?: number | null; dias?: number | null; proveedorNombre?: string | null;
};
export type ResultadoPlanilla = { filas: FilaImport[]; errores: { linea: number; texto: string; motivo: string }[]; duplicados: number };

export const MAX_FILAS = 500;
export const MAX_DIAS_ENTREGA = 60; // mismo tope que lead_time_dias en la base
export const normNombre = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export const capitalizar = (s: string) => { const t = s.trim().replace(/\s+/g, " "); return t ? t[0].toUpperCase() + t.slice(1) : t; };

/** Precio en formato argentino: "2.485", "2485,50", "$ 1.250,5", "12.5". Devuelve null si no es un número válido. */
export function parsePrecio(raw: string): number | null {
  let s = raw.replace(/[$\s]/g, "");
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  const punto = s.includes("."), coma = s.includes(",");
  if (punto && coma) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (coma) s = s.replace(",", ".");
  else if (punto && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e8 ? n : null;
}

/** Entero opcional: "" → null; "12" → 12; cualquier otra cosa (o fuera de rango) → NaN. */
const entero = (txt: string, max = 9_999_999) => (txt === "" ? null : /^\d{1,7}$/.test(txt) && Number(txt) <= max ? Number(txt) : NaN);

/**
 * Columnas: nombre ; precio ; categoría (opc.) ; código de barras (opc.) ; stock (opc.) ; stock mínimo (opc.)
 *           ; stock objetivo (opc.) ; días de entrega (opc.) ; proveedor (opc.).
 * Separador: tab (Excel), ";" o ",". `proveedores` son los nombres (normalizados con normNombre) que ya existen en el kiosco.
 */
export function parsePlanilla(texto: string, nombres: Set<string>, barcodes: Set<string>, proveedores: Set<string> = new Set()): ResultadoPlanilla {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ResultadoPlanilla = { filas: [], errores: [], duplicados: 0 };
  const vistosN = new Set(nombres), vistosB = new Set(barcodes);
  let excedido = false;
  lineas.forEach((l, i) => {
    if (excedido) return;
    if (out.filas.length >= MAX_FILAS) { excedido = true; return; }
    const delim = l.includes("\t") ? "\t" : l.includes(";") ? ";" : ",";
    const c = l.split(delim).map((x) => x.trim());
    if (i === 0 && /^(nombre|producto|descripci|art)/i.test(c[0]) && parsePrecio(c[1] ?? "") === null) return; // encabezado
    const nombre = capitalizar(c[0] ?? "");
    const precio = parsePrecio(c[1] ?? "");
    if (nombre.length < 2) { out.errores.push({ linea: i + 1, texto: l, motivo: "falta el nombre" }); return; }
    if (precio === null) { out.errores.push({ linea: i + 1, texto: l, motivo: "precio inválido" }); return; }
    const cod = (c[3] ?? "").replace(/\D/g, "");
    const barcode = esCodigoValido(cod) ? cod : null;
    const nn = normNombre(nombre);
    if ((barcode && vistosB.has(barcode)) || vistosN.has(nn)) { out.duplicados++; return; }
    const stock = entero(c[4] ?? ""), minimo = entero(c[5] ?? ""), objetivo = entero(c[6] ?? "");
    const dias = entero(c[7] ?? "", MAX_DIAS_ENTREGA);
    const provTxt = (c[8] ?? "").trim();
    if (Number.isNaN(stock) || Number.isNaN(minimo) || Number.isNaN(objetivo)) { out.errores.push({ linea: i + 1, texto: l, motivo: "stock, mínimo u objetivo inválido (enteros)" }); return; }
    if (Number.isNaN(dias)) { out.errores.push({ linea: i + 1, texto: l, motivo: `días de entrega inválidos (0 a ${MAX_DIAS_ENTREGA})` }); return; }
    if (stock === null && minimo !== null) { out.errores.push({ linea: i + 1, texto: l, motivo: "el mínimo necesita un stock" }); return; }
    if (stock === null && objetivo !== null) { out.errores.push({ linea: i + 1, texto: l, motivo: "el objetivo necesita un stock" }); return; }
    if (objetivo !== null && objetivo < (minimo ?? 0)) { out.errores.push({ linea: i + 1, texto: l, motivo: "el objetivo tiene que ser mayor o igual al mínimo" }); return; }
    if (provTxt && !proveedores.has(normNombre(provTxt))) { out.errores.push({ linea: i + 1, texto: l, motivo: `no existe el proveedor "${provTxt}" (cargalo antes en Proveedores)` }); return; }
    vistosN.add(nn); if (barcode) vistosB.add(barcode);
    out.filas.push({
      nombre, precio, categoria: capitalizar(c[2] ?? "") || "General", barcode,
      stock, minimo, objetivo, dias, proveedorNombre: provTxt ? capitalizar(provTxt) : null,
    });
  });
  if (excedido) out.errores.push({ linea: 0, texto: "", motivo: `se importan hasta ${MAX_FILAS} productos por vez; cargá el resto en otra tanda` });
  return out;
}
