// Prueba de lib/push.ts: node tests/push.test.mjs  (o: npm run test:push)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/push.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const P = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

eq("aviso con número, nombre y total", P.armarAvisoPedido({ numero: 12, cliente_nombre: "Ana", total: 3500 }),
  { title: "Nuevo pedido #12", body: "Ana · $3.500", url: "/panel" });
eq("total con decimales se redondea", P.armarAvisoPedido({ numero: 1, cliente_nombre: "Luis", total: "2485.5" }).body, "Luis · $2.486");

const buena = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BPk", auth: "xyz" } };
ok("suscripción completa es válida", P.suscripcionValida(buena));
ok("endpoint no https no vale", !P.suscripcionValida({ ...buena, endpoint: "http://x" }));
ok("sin auth no vale", !P.suscripcionValida({ endpoint: buena.endpoint, keys: { p256dh: "BPk" } }));
ok("vacía no vale", !P.suscripcionValida(null));

console.log(fallos ? `push: ${fallos} fallos` : "push: todo OK");
process.exitCode = fallos ? 1 : 0;
