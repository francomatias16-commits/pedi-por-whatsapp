// Prueba de lib/compras.ts: node tests/compras.test.mjs  (o: npm run test:compras)
import ts from "typescript";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../lib/compras.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const C = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };

eq("total por unidad", C.totalLinea({ por_peso: false, cantidad: 12, costo: 700 }), 8400);
eq("total por peso: 500 g a $6000/kg", C.totalLinea({ por_peso: true, cantidad: 500, costo: 6000 }), 3000);
eq("total por peso con redondeo", C.totalLinea({ por_peso: true, cantidad: 333, costo: 1000 }), 333);
eq("total de la compra (mismo caso que la prueba de base: 14400)", C.totalCompra([
  { producto_id: "a", nombre: "a", por_peso: false, cantidad: 12, costo: 700 },
  { producto_id: "b", nombre: "b", por_peso: true, cantidad: 500, costo: 6000 },
  { producto_id: "c", nombre: "c", por_peso: false, cantidad: 10, costo: 300 }]), 14400);
eq("kg → gramos", [C.cantidadDesdeTexto("2,5", true), C.cantidadDesdeTexto("0.25", true), C.cantidadDesdeTexto("1", true)], [2500, 250, 1000]);
eq("unidades enteras", [C.cantidadDesdeTexto("12", false), C.cantidadDesdeTexto("1,5", false), C.cantidadDesdeTexto("0", false), C.cantidadDesdeTexto("", false), C.cantidadDesdeTexto("abc", false)], [12, null, null, null, null]);
eq("más de 3 decimales en kg se rechaza", C.cantidadDesdeTexto("0.0004", true), null);
eq("tope", [C.cantidadDesdeTexto("9999999", false), C.cantidadDesdeTexto("10000000", false)], [9999999, null]);
eq("texto de cantidad", [C.cantidadTexto(2500, true), C.cantidadTexto(7, false)], ["2,5 kg", "7"]);
eq("mensaje de error conocido y desconocido", [C.mensajeCompras("stock_insuficiente").includes("ya se vendió"), C.mensajeCompras("xyz")], [true, "No se pudo completar la operación."]);
console.log(fallos ? `\n${fallos} FALLAS` : "\ncompras: todo OK");
process.exit(fallos ? 1 : 0);
