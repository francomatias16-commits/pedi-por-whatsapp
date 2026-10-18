// Prueba de lib/fuga.ts: node tests/fuga.test.mjs  (o: npm run test:fuga)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/fuga.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const F = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };
eq("aviso plural", F.armarAvisoFuga({ clientes: 3, dias: 45 }).body, "3 clientes no compran hace más de 45 días");
eq("aviso singular", F.armarAvisoFuga({ clientes: 1, dias: 45 }).body, "1 cliente no compra hace más de 45 días");
eq("aviso con título propio", F.armarAvisoFuga({ clientes: 2, dias: 45 }).title, "Clientes que dejaron de venir");
eq("aviso lleva a Radar", F.armarAvisoFuga({ clientes: 1, dias: 45 }).url, "/panel?tab=radar");
console.log(fallos ? `\n${fallos} FALLAS` : "\nfuga: todo OK");
process.exit(fallos ? 1 : 0);
