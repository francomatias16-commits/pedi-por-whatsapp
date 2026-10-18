// Prueba de rutaDeStorage: node tests/fotos.test.mjs  (o: npm run test:fotos)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/fotos.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const F = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (a !== b) { fallos++; console.log("FALLA", n, a, "!=", b); } };
const K = "0b6f9f3e-1111-4222-8333-444455556666";
eq("url pública", F.rutaDeStorage(`https://abc.supabase.co/storage/v1/object/public/productos/${K}/p1-123.jpg`), `${K}/p1-123.jpg`);
eq("con query", F.rutaDeStorage(`https://abc.supabase.co/storage/v1/object/public/productos/${K}/p1-123.jpg?t=1`), `${K}/p1-123.jpg`);
eq("url externa (Open Food Facts)", F.rutaDeStorage("https://images.openfoodfacts.org/images/products/779/front.jpg"), null);
eq("otro bucket", F.rutaDeStorage("https://abc.supabase.co/storage/v1/object/public/otros/x.jpg"), null);
eq("null", F.rutaDeStorage(null), null);
eq("vacío", F.rutaDeStorage(""), null);
eq("ruta generada", /^k1\/p9-\d+\.jpg$/.test(F.rutaFoto("k1", "p9")), true);
console.log(fallos ? `${fallos} fallos` : "fotos: todo OK");
process.exit(fallos ? 1 : 0);
