// Prueba de completar fotos en lote: node tests/fotos-lote.test.mjs  (o: npm run test:fotos-lote)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/fotos-lote.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const L = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const P = (id, nombre, extra = {}) => ({ id, nombre, barcode: null, imagen_url: null, disponible: true, ...extra });

// faltantes: sin foto (null, vacío o solo espacios), disponibles primero, por nombre sin tildes
const lista = [P("1", "Zanahoria"), P("2", "Alfajor", { imagen_url: "https://x/y.jpg" }), P("3", "Ángel", { disponible: false }), P("4", "Bizcocho", { imagen_url: "  " }), P("5", "Águila")];
eq("faltantes", L.faltantes(lista).map((p) => p.id), ["5", "4", "1", "3"]);
eq("faltantes no muta", lista.map((p) => p.id), ["1", "2", "3", "4", "5"]);
eq("faltantes vacío", L.faltantes([]), []);

// próxima tanda
const muchos = Array.from({ length: 60 }, (_, i) => P(String(i), `Producto ${String(i).padStart(2, "0")}`));
eq("tanda por defecto", L.proximaTanda(muchos, new Set()).length, 25);
eq("tanda salta vistos", L.proximaTanda(muchos, new Set(["0", "1", "2"]))[0].id, "3");
eq("tanda chica al final", L.proximaTanda(muchos, new Set(muchos.slice(0, 50).map((p) => p.id))).length, 10);
eq("todo visto", L.proximaTanda(muchos, new Set(muchos.map((p) => p.id))), []);
eq("tanda a medida", L.proximaTanda(muchos, new Set(), 5).length, 5);

// sugerencia propuesta: global > openfoodfacts, nunca búsqueda en internet
const S = (fuente, url) => ({ url, miniatura: url, fuente, titulo: "", abierta: fuente !== "busqueda" });
eq("prefiere global", L.primeraGratuita([S("openfoodfacts", "a"), S("global", "b")]).url, "b");
eq("usa openfoodfacts", L.primeraGratuita([S("busqueda", "x"), S("openfoodfacts", "a")]).url, "a");
eq("ignora búsqueda", L.primeraGratuita([S("busqueda", "x"), S("busqueda", "y")]), null);
eq("sin sugerencias", L.primeraGratuita([]), null);

// código de barras
eq("código EAN13", L.tieneCodigo(P("1", "a", { barcode: "7790895000010" })), true);
eq("código corto", L.tieneCodigo(P("1", "a", { barcode: "123" })), false);
eq("sin código", L.tieneCodigo(P("1", "a")), false);
eq("código con símbolos", L.tieneCodigo(P("1", "a", { barcode: "7790-8950-00010" })), true);

// la ruta del servidor respeta solo_gratis
const ruta = readFileSync(new URL("../app/api/fotos/sugerir/route.ts", import.meta.url), "utf8");
eq("servidor lee solo_gratis", ruta.includes("body?.solo_gratis === true"), true);
eq("servidor no usa búsqueda paga en lote", /busquedaDisponible = !soloGratis && /.test(ruta), true);

console.log(fallos ? `${fallos} fallos` : "fotos-lote: todo OK");
process.exit(fallos ? 1 : 0);
