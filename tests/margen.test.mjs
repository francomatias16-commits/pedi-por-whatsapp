// Prueba de lib/margen.ts: node tests/margen.test.mjs  (o: npm run test:margen)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/margen.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const M = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };

eq("margen: coca 1000 con costo 700 = 30%", M.margenPct(1000, 700), 30);
eq("margen: 800 con costo 500 = 37,5%", M.margenPct(800, 500), 37.5);
eq("sin costo no hay margen", [M.margenPct(1000, null), M.margenPct(1000, 0), M.margenPct(0, 500)], [null, null, null]);
const lista = [
  { nombre: "A", precio: 1000, costo: 700 }, { nombre: "B", precio: 500, costo: 400 },
  { nombre: "C", precio: 800, costo: 500 }, { nombre: "D", precio: 900, costo: null },
];
eq("margen bajo al 35%: B (20%) primero, después A (30%); C y D no entran", M.productosMargenBajo(lista, 35).map((p) => p.nombre), ["B", "A"]);
eq("con objetivo 20% no hay bajo margen", M.productosMargenBajo(lista, 20).length, 0);
eq("variación: costo que sube 20% se avisa", M.variacionCosto(500, 600)?.pct, 20);
eq("variación: 5% no se avisa con umbral 10", M.variacionCosto(500, 525), null);
eq("variación: baja de 25% también se avisa", M.variacionCosto(400, 300)?.pct, -25);
eq("variación: sin costo anterior no hay aviso", M.variacionCosto(null, 600), null);
console.log(fallos ? `\n${fallos} FALLAS` : "\nmargen: todo OK");
process.exit(fallos ? 1 : 0);
