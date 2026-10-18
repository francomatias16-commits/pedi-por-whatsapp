// Prueba de lib/reposicion.ts: node tests/reposicion.test.mjs  (o: npm run test:reposicion)
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (f) => ts.transpileModule(readFileSync(new URL(`../lib/${f}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
// reposicion.ts importa ./compras: se inlinea la dependencia para no depender de un resolvedor de módulos en Node.
const compras = leer("compras.ts").replace(/^export /gm, "");
const repo = leer("reposicion.ts").replace(/^import .*compras.*$/m, "");
const js = compras + "\n" + repo;
const R = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fallos++; console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` → ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`); };

const fila = (o) => R.normalizarFila({ producto_id: "p", nombre: "X", categoria: "", por_peso: false, stock: 0, stock_minimo: 0, stock_objetivo: null, lead_time_dias: 3, velocidad_dia: 0, dias_restantes: null, cantidad_sugerida: 5, estado: "bajo", sin_datos: false, proveedor_id: null, proveedor_nombre: null, proveedor_telefono: null, costo: null, ...o });

// normalizar: los numeric pueden venir como texto
const n = R.normalizarFila({ producto_id: "a", nombre: "Coca", por_peso: false, stock: "2", stock_minimo: 0, stock_objetivo: null, lead_time_dias: 3, velocidad_dia: "0.800", dias_restantes: "2.5", cantidad_sugerida: "25", estado: "critico", sin_datos: false, proveedor_id: null, costo: "700.00" });
eq("normaliza numeric en texto", [n.velocidad_dia, n.dias_restantes, n.cantidad_sugerida, n.costo, n.stock_objetivo], [0.8, 2.5, 25, 700, null]);

// agrupar
const filas = [
  fila({ producto_id: "1", nombre: "Coca", proveedor_id: "pB", proveedor_nombre: "Zeta" }),
  fila({ producto_id: "2", nombre: "Galle", proveedor_id: "pA", proveedor_nombre: "Alfa" }),
  fila({ producto_id: "3", nombre: "Pan", proveedor_id: "pA", proveedor_nombre: "Alfa" }),
  fila({ producto_id: "4", nombre: "Sin prov" }),
  fila({ producto_id: "5", nombre: "Sin datos", sin_datos: true, cantidad_sugerida: 0, proveedor_id: "pA", proveedor_nombre: "Alfa" }),
];
const g = R.agruparPorProveedor(filas);
eq("grupos ordenados por nombre", g.grupos.map((x) => x.nombre), ["Alfa", "Zeta"]);
eq("productos por grupo", g.grupos.map((x) => x.filas.map((f) => f.producto_id)), [["2", "3"], ["1"]]);
eq("sin proveedor aparte", g.sinProveedor.map((f) => f.producto_id), ["4"]);
eq("sin datos aparte, aunque tenga proveedor", g.sinDatos.map((f) => f.producto_id), ["5"]);
eq("lista vacía", R.agruparPorProveedor([]), { grupos: [], sinProveedor: [], sinDatos: [] });

// cantidades
eq("input por peso (gramos → kg)", [R.cantidadAInput(4000, true), R.cantidadAInput(2500, true), R.cantidadAInput(250, true)], ["4", "2,5", "0,25"]);
eq("input por unidad", R.cantidadAInput(25, false), "25");

// mensaje
const msg = R.mensajePedidoProveedor("Kiosco Sur", "Distribuidora", [
  { nombre: "Coca 500", por_peso: false, cantidad: 25 }, { nombre: "Queso", por_peso: true, cantidad: 2500 }, { nombre: "Nada", por_peso: false, cantidad: 0 }]);
eq("mensaje de pedido", msg, "Hola Distribuidora! Te paso el pedido de Kiosco Sur:\n• Coca 500: 25\n• Queso: 2,5 kg\nGracias!");

// costo estimado
eq("costo estimado", R.costoEstimado([{ cantidad: 10, por_peso: false, costo: 700 }, { cantidad: 500, por_peso: true, costo: 6000 }, { cantidad: 3, por_peso: false, costo: null }, { cantidad: 2, por_peso: false, costo: 0 }]), { total: 10000, sinCosto: 2 });

// textos
eq("texto de días", [R.textoDias({ estado: "agotado", dias_restantes: null }), R.textoDias({ estado: "bajo", dias_restantes: null }), R.textoDias({ estado: "critico", dias_restantes: 0.4 }), R.textoDias({ estado: "critico", dias_restantes: 2.5 })], ["Se acabó", "Bajo el mínimo", "Menos de 1 día", "Alcanza 2,5 días"]);

// aviso push
eq("aviso con todo", R.armarAvisoStock({ agotados: 2, bajos: 4, sin_proveedor: 1 }), { title: "Hay que reponer mercadería", body: "2 se acabaron · 4 quedan poco · 1 sin proveedor asignado", url: "/panel?tab=reponer" });
eq("aviso singular y sin proveedor 0", R.armarAvisoStock({ agotados: 1, bajos: 0, sin_proveedor: 0 }).body, "1 se acabó");
eq("mensaje de error", [R.mensajeReposicion("pin_requerido").includes("PIN"), R.mensajeReposicion("xyz")], [true, "No se pudo completar la operación."]);

console.log(fallos ? `\n${fallos} FALLAS` : "\nreposicion: todo OK");
process.exit(fallos ? 1 : 0);
