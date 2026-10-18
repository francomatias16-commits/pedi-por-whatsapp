// Prueba de lib/conteo.ts: node tests/conteo.test.mjs  (o: npm run test:conteo)
import ts from "typescript";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const cargar = async (rel, reemplazos = {}) => {
  let src = readFileSync(new URL("../lib/" + rel, import.meta.url), "utf8");
  for (const [a, b] of Object.entries(reemplazos)) src = src.replace(a, b);
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
globalThis.__ean = await cargar("ean.ts");
globalThis.__bal = await cargar("pos/balanza.ts", { 'import { esCodigoValido } from "../ean";': "const esCodigoValido = globalThis.__ean.esCodigoValido;" });
globalThis.__compras = await cargar("compras.ts");
globalThis.__repo = await cargar("reposicion.ts", { 'import { cantidadTexto } from "./compras";': "const cantidadTexto = globalThis.__compras.cantidadTexto;" });
const C = await cargar("conteo.ts", {
  'import { cantidadAInput } from "./reposicion";': "const cantidadAInput = globalThis.__repo.cantidadAInput;",
  'import { cantidadDesdeTexto } from "./compras";': "const cantidadDesdeTexto = globalThis.__compras.cantidadDesdeTexto;",
  'import { mismoPlu, parsearBalanza } from "./pos/balanza";': "const { mismoPlu, parsearBalanza } = globalThis.__bal;",
});

// EAN-13 de balanza válido: "2" + PLU 00123 + control + peso 01250 g + control EAN
const ean13 = (base12) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(base12[i]) * (i % 2 ? 3 : 1); return base12 + ((10 - (s % 10)) % 10); };
const etiqueta = ean13("2" + "00123" + "0" + "01250");

const prods = [
  { id: "a", barcode: "7791234567890", plu: null },
  { id: "b", barcode: null, plu: "123" },
  { id: "c", barcode: "7790000000001", plu: null },
];
const items = [{ producto_id: "a", por_peso: false }, { producto_id: "b", por_peso: true }];

// resolverLectura
assert.deepEqual(C.resolverLectura("7791234567890", prods, items), { tipo: "item", producto_id: "a" });
assert.deepEqual(C.resolverLectura("  7791234567890 ", prods, items), { tipo: "item", producto_id: "a" });
assert.deepEqual(C.resolverLectura("7790000000001", prods, items), { tipo: "fuera", producto_id: "c" });
assert.deepEqual(C.resolverLectura("0000", prods, items), { tipo: "nada" });
assert.deepEqual(C.resolverLectura("", prods, items), { tipo: "nada" });
assert.deepEqual(C.resolverLectura(etiqueta, prods, items), { tipo: "item", producto_id: "b", gramos: 1250 });
assert.deepEqual(C.resolverLectura("0123", prods, items), { tipo: "item", producto_id: "b" }); // PLU tipeado

// sumarLectura
assert.equal(C.sumarLectura("", false), "1");
assert.equal(C.sumarLectura("4", false), "5");
assert.equal(C.sumarLectura("x", false), null);          // texto inválido no se pisa
assert.equal(C.sumarLectura("", true), null);            // por peso sin etiqueta: no se suma solo
assert.equal(C.sumarLectura("", true, 1250), "1,25");
assert.equal(C.sumarLectura("0,5", true, 1250), "1,75");
console.log("conteo.test.mjs: OK");
