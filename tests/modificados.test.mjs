// Prueba de lib/modificados.ts: node tests/modificados.test.mjs  (o: npm run test:modificados)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/modificados.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const M = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };

// "hoy" arranca a las 00:00 de Argentina (03:00 UTC)
eq("hoy a las 15:00 AR", M.desdePeriodo("hoy", new Date("2026-10-17T18:00:00Z")), "2026-10-17T03:00:00.000Z");
eq("hoy a las 01:00 AR (04:00 UTC)", M.desdePeriodo("hoy", new Date("2026-10-17T04:00:00Z")), "2026-10-17T03:00:00.000Z");
eq("hoy a las 23:30 AR del día anterior (02:30 UTC)", M.desdePeriodo("hoy", new Date("2026-10-17T02:30:00Z")), "2026-10-16T03:00:00.000Z");
eq("7 días", M.desdePeriodo("7", new Date("2026-10-17T12:00:00Z")), "2026-10-10T12:00:00.000Z");
eq("30 días", M.desdePeriodo("30", new Date("2026-10-17T12:00:00Z")), "2026-09-17T12:00:00.000Z");

const mov = (producto_id, tipo, cantidad, created_at, nombre = "P" + producto_id, por_peso = false) => ({ producto_id, tipo, cantidad, created_at, nombre, por_peso });
const movs = [
  mov("a", "ajuste", -3, "2026-10-17T10:00:00Z"),
  mov("a", "compra", 10, "2026-10-17T12:00:00Z"),
  mov("a", "venta", -2, "2026-10-17T13:00:00Z"),
  mov("b", "venta", -1, "2026-10-17T14:00:00Z"),
  mov("c", "ajuste", 5, "2026-10-16T09:00:00Z"),
  mov("d", "devolucion", 1, "2026-10-17T15:00:00Z"),
  mov("e", "pedido", -4, "2026-10-17T16:00:00Z"),
];
const sin = M.agruparMovimientos(movs, false);
eq("por defecto oculta ventas, pedidos y devoluciones", sin.map((f) => f.producto_id), ["a", "c"]);
eq("neto de a sin ventas = -3 + 10", sin[0].neto, 7);
eq("último movimiento de a (sin ventas)", sin[0].ultimo, "2026-10-17T12:00:00Z");
eq("cuenta de movimientos de a (sin ventas)", sin[0].movimientos, 2);
const con = M.agruparMovimientos(movs, true);
eq("con el tilde aparecen todos, el más reciente primero", con.map((f) => f.producto_id), ["e", "d", "b", "a", "c"]);
eq("neto de a con ventas = -3 + 10 - 2", con.find((f) => f.producto_id === "a").neto, 5);
eq("sin movimientos no hay filas", M.agruparMovimientos([], true), []);
eq("formato positivo", M.formatearNeto(7, false), "+7");
eq("formato negativo", M.formatearNeto(-3, false), "−3");
eq("formato cero", M.formatearNeto(0, false), "0");
eq("formato por peso en kg", M.formatearNeto(-1500, true), "−1,5 kg");
console.log(fallos ? `\n${fallos} FALLAS` : "\nmodificados: todo OK");
process.exit(fallos ? 1 : 0);
