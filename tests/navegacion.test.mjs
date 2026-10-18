// Prueba de lib/navegacion.ts: node tests/navegacion.test.mjs  (o: npm run test:navegacion)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/navegacion.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const N = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };

// 13 pantallas, cada una con una sola ruta; ida y vuelta
const todas = N.DESTINOS.flatMap((d) => d.subs.map((s) => s.tab));
eq("13 pantallas", todas.length, 13);
eq("sin repetidas", new Set(todas).size, 13);
for (const t of todas) eq(`ida y vuelta ${t}`, N.tabDeRuta(N.segmentosDe(N.rutaDeTab(t))), t);
eq("7 destinos", N.DESTINOS.length, 7);

eq("inicio", N.rutaDeTab("resumen"), "/panel");
eq("caja", N.rutaDeTab("caja"), "/panel/vender");
eq("precios", N.rutaDeTab("precios"), "/panel/productos/precios");
eq("reponer es la primera de compras", N.rutaDeTab("reponer"), "/panel/compras");
eq("proveedores", N.rutaDeTab("proveedores"), "/panel/compras/proveedores");
eq("destino", N.destinoDeTab("sellos"), "clientes");

eq("segmentos raíz", N.segmentosDe("/panel"), []);
eq("segmentos barra final", N.segmentosDe("/panel/"), []);
eq("segmentos 2", N.segmentosDe("/panel/clientes/puntos"), ["clientes", "puntos"]);
eq("raíz abre inicio", N.tabDeRuta([]), "resumen");
eq("destino sin slug abre su primera", N.tabDeRuta(["productos"]), "productos");
eq("slug raro abre la primera", N.tabDeRuta(["productos", "xx"]), "productos");
eq("destino raro", N.tabDeRuta(["nada"]), null);
eq("/panel/inicio no existe", N.tabDeRuta(["inicio"]), null);

// links viejos (avisos push)
eq("legacy reponer", N.rutaLegacy("?tab=reponer"), "/panel/compras");
eq("legacy fiado", N.rutaLegacy("?tab=fiado"), "/panel/clientes");
eq("legacy radar", N.rutaLegacy("?tab=radar"), "/panel/clientes/alertas");
eq("legacy raro", N.rutaLegacy("?tab=hack"), null);
eq("legacy vacío", N.rutaLegacy(""), null);

if (fallos) { console.log(`navegacion: ${fallos} fallos`); process.exit(1); }
console.log("navegacion.test.mjs: OK");
