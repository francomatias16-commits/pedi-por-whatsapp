// Prueba de lib/etiquetas.ts: node tests/etiquetas.test.mjs  (o: npm run test:etiquetas)
import ts from "typescript";
import { readFileSync } from "node:fs";
const cargar = async (rel, rep = {}) => {
  let src = readFileSync(new URL("../lib/" + rel, import.meta.url), "utf8");
  for (const [a, b] of Object.entries(rep)) src = src.replace(a, b);
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
globalThis.__ean = await cargar("ean.ts");
globalThis.__promos = await cargar("pos/promos.ts");
const E = await cargar("etiquetas.ts", {
  'import { esCodigoValido } from "./ean";': "const { esCodigoValido } = globalThis.__ean;",
  'import { calcularLinea, hoyAR, type Promo } from "./pos/promos";': "const { calcularLinea, hoyAR } = globalThis.__promos;",
});
const B = await cargar("pos/balanza.ts", { 'import { esCodigoValido } from "../ean";': "const esCodigoValido = globalThis.__ean.esCodigoValido;" });
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };
const HOY = "2026-10-17";
const P = (o) => ({ id: "p1", nombre: "Yerba", categoria: "Almacén", precio: 3200, barcode: null, plu: null, vendido_por_peso: false, ...o });
const pr = (o) => ({ id: "x" + Math.random(), nombre: "promo", tipo: "pct", producto_id: null, categoria: null, lleva: null, paga: null, pct: null, desde: null, hasta: null, activa: true, ...o });

// Dígito EAN y códigos
eq("dígito EAN-13", E.digitoEan13("779007041012"), "2");
eq("EAN-13 válido en auto", E.resolverCodigo(P({ barcode: "7790070410122" })), { valor: "7790070410122", formato: "EAN13" });
eq("EAN-13 con control malo cae a CODE128", E.resolverCodigo(P({ barcode: "7790070410123" })), { valor: "7790070410123", formato: "CODE128" });
eq("EAN-8 válido", E.resolverCodigo(P({ barcode: "73513537" })), { valor: "73513537", formato: "EAN8" });
eq("código interno -> CODE128", E.resolverCodigo(P({ barcode: "INT-42" })), { valor: "INT-42", formato: "CODE128" });
eq("forzar CODE128", E.resolverCodigo(P({ barcode: "7790070410122" }), "code128"), { valor: "7790070410122", formato: "CODE128" });
eq("sin código", E.resolverCodigo(P()), null);
// Por peso: lo que imprimo lo tiene que leer el POS
const kg = E.resolverCodigo(P({ vendido_por_peso: true, plu: "123" }));
eq("peso: EAN-13 de balanza", [kg.formato, kg.valor.length, kg.valor.slice(0, 7)], ["EAN13", 13, "2001230"]);
eq("peso: el POS lo lee como PLU sin pesada (null) y el EAN es válido", [B.parsearBalanza(kg.valor), globalThis.__ean.esCodigoValido(kg.valor)], [null, true]);
eq("peso: PLU inválido no imprime código", [E.resolverCodigo(P({ vendido_por_peso: true, plu: "ABC" })), E.resolverCodigo(P({ vendido_por_peso: true, plu: "123456" })), E.resolverCodigo(P({ vendido_por_peso: true }))], [null, null, null]);

// Precios y promos
eq("sin promos", E.precioEtiqueta(P(), [], HOY), { regular: 3200, promo: null, leyenda: null, promo_nombre: null });
eq("20% por producto", E.precioEtiqueta(P(), [pr({ producto_id: "p1", pct: 20 })], HOY).promo, 2560);
eq("10% por categoría con centavos (999 -> 899,10)", E.precioEtiqueta(P({ precio: 999 }), [pr({ categoria: "Almacén", pct: 10 })], HOY).promo, 899.1);
eq("promo vencida o inactiva se ignora", E.precioEtiqueta(P(), [pr({ producto_id: "p1", pct: 20, hasta: "2026-01-01" }), pr({ producto_id: "p1", pct: 50, activa: false })], HOY).promo, null);
eq("promo de otro producto no aplica", E.precioEtiqueta(P(), [pr({ producto_id: "otro", pct: 20 })], HOY).promo, null);
const n3x2 = E.precioEtiqueta(P(), [pr({ tipo: "nxm", producto_id: "p1", lleva: 3, paga: 2 })], HOY);
eq("3x2: precio igual, sale leyenda", [n3x2.promo, n3x2.leyenda], [null, "Llevando 3 pagás 2"]);
eq("por peso: $/kg con promo %", E.precioEtiqueta(P({ vendido_por_peso: true, precio: 9000 }), [pr({ producto_id: "p1", pct: 10 })], HOY), { regular: 9000, promo: 8100, leyenda: null, promo_nombre: "promo" });
eq("por peso: NxM no aplica", E.precioEtiqueta(P({ vendido_por_peso: true }), [pr({ tipo: "nxm", producto_id: "p1", lleva: 2, paga: 1 })], HOY).leyenda, null);

// Hoja y selección
eq("ancho de hoja 3 col de 50 con margen 2", E.anchoHojaMm({ ancho_mm: 50, columnas: 3, margen_mm: 2 }), 158);
eq("expandir copias", E.expandir([{ producto_id: "a", copias: 2 }, { producto_id: "b", copias: 1 }, { producto_id: "zz", copias: 5 }], [P({ id: "a" }), P({ id: "b" })]).map((p) => p.id), ["a", "a", "b"]);
eq("total etiquetas", E.totalEtiquetas([{ producto_id: "a", copias: 2 }, { producto_id: "b", copias: 3.7 }, { producto_id: "c", copias: -1 }]), 5);
eq("config por defecto válida", E.validarConfig(E.CONFIG_DEFECTO), null);
eq("ancho fuera de rango", E.validarConfig({ ...E.CONFIG_DEFECTO, ancho_mm: 10 }) !== null, true);
eq("columnas decimales", E.validarConfig({ ...E.CONFIG_DEFECTO, columnas: 2.5 }) !== null, true);
console.log(fallos ? `\n${fallos} fallos` : "\netiquetas: todo OK");
process.exit(fallos ? 1 : 0);
