// Prueba de lib/modo.ts: node tests/modo.test.mjs  (o: npm run test:modo)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/modo.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const M = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };

const subs = [{ tab: "productos" }, { tab: "precios" }, { tab: "etiquetas" }, { tab: "conteo" }];
eq("simple oculta avanzadas", M.pestanasVisibles(subs, "simple", "productos").map((s) => s.tab), ["productos", "precios"]);
eq("completo muestra todo", M.pestanasVisibles(subs, "completo", "productos").length, 4);
eq("pantalla avanzada actual se ve en simple", M.pestanasVisibles(subs, "simple", "conteo").map((s) => s.tab), ["productos", "precios", "conteo"]);
eq("sin pestañas avanzadas", M.pestanasVisibles([{ tab: "reponer" }, { tab: "proveedores" }], "simple", "reponer").map((s) => s.tab), ["reponer"]);

if (fallos) { console.log(`modo: ${fallos} fallos`); process.exit(1); }
console.log("modo.test.mjs: OK");
