// Prueba de lib/fiado.ts: node tests/fiado.test.mjs  (o: npm run test:fiado)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/fiado.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const F = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };
eq("aviso plural", F.armarAvisoFiado({ clientes: 3, monto: 12500.4, dias: 30 }).body, "3 clientes deben $12.500 hace más de 30 días");
eq("aviso singular", F.armarAvisoFiado({ clientes: 1, monto: 1000, dias: 30 }).body, "1 cliente debe $1.000 hace más de 30 días");
eq("aviso lleva al fiado", F.armarAvisoFiado({ clientes: 1, monto: 1, dias: 30 }).url, "/panel?tab=fiado");
console.log(fallos ? `\n${fallos} FALLAS` : "\nfiado: todo OK");
process.exit(fallos ? 1 : 0);
