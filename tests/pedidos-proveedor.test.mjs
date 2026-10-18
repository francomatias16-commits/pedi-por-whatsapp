// Prueba de lib/pedidos-proveedor.ts: node tests/pedidos-proveedor.test.mjs  (o: npm run test:pedidos)
import ts from "typescript";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const cargar = async (rel, reemplazos = {}) => {
  let src = readFileSync(new URL("../lib/" + rel, import.meta.url), "utf8");
  for (const [a, b] of Object.entries(reemplazos)) src = src.replace(a, b);
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
globalThis.__compras = await cargar("compras.ts");
const P = await cargar("pedidos-proveedor.ts", { 'import { cantidadDesdeTexto, cantidadTexto, type LineaCompra } from "./compras";': "const { cantidadDesdeTexto, cantidadTexto } = globalThis.__compras;" });

const items = [
  { id: "i1", producto_id: "p1", nombre: "Alfajor", por_peso: false, cantidad: 10, recibida: 6 },
  { id: "i2", producto_id: "p2", nombre: "Queso", por_peso: true, cantidad: 2500, recibida: 0 },
  { id: "i3", producto_id: null, nombre: "Borrado", por_peso: false, cantidad: 3, recibida: 3 },
];

// acciones por estado
assert.deepEqual(P.acciones("borrador"), { enviar: true, cancelar: true, recibir: false, cerrar: false });
assert.deepEqual(P.acciones("enviada"), { enviar: false, cancelar: true, recibir: true, cerrar: false });
assert.deepEqual(P.acciones("recibida_parcial"), { enviar: false, cancelar: false, recibir: true, cerrar: true });
assert.deepEqual(P.acciones("recibida"), { enviar: false, cancelar: false, recibir: false, cerrar: false });
assert.deepEqual(P.acciones("cancelada"), { enviar: false, cancelar: false, recibir: false, cerrar: false });

// pendiente y faltante
assert.equal(P.pendiente(items[0]), 4);
assert.equal(P.pendiente({ cantidad: 3, recibida: 5 }), 0);
assert.ok(P.textoFaltante(items).includes("Alfajor 4") && P.textoFaltante(items).includes("Queso") && !P.textoFaltante(items).includes("Borrado"));
assert.equal(P.textoFaltante([items[2]]), "");

// armarRecepcion
let r = P.armarRecepcion(items, { i1: "4", i2: "1,5" });
assert.equal(r.ok, true);
assert.deepEqual(r.payload, [{ item_id: "i1", cantidad: 4 }, { item_id: "i2", cantidad: 1500 }]);
r = P.armarRecepcion(items, { i1: "5" });
assert.equal(r.ok, false); assert.match(r.error, /solo faltan 4/);
r = P.armarRecepcion(items, { i1: "abc" });
assert.equal(r.ok, false); assert.match(r.error, /Revisá la cantidad de Alfajor/);
r = P.armarRecepcion(items, { i1: "  ", i2: "" });
assert.equal(r.ok, false); assert.match(r.error, /al menos un producto/);
r = P.armarRecepcion(items, { i3: "1" });
assert.equal(r.ok, false); // ya estaba todo recibido

// lineasParaCompra
const ls = P.lineasParaCompra(items, [{ item_id: "i1", cantidad: 4 }, { item_id: "i2", cantidad: 1500 }, { item_id: "i3", cantidad: 1 }], { p1: 120.5, p2: null });
assert.deepEqual(ls, [
  { producto_id: "p1", nombre: "Alfajor", por_peso: false, cantidad: 4, costo: 120.5 },
  { producto_id: "p2", nombre: "Queso", por_peso: true, cantidad: 1500, costo: 0 },
]); // el ítem sin producto (borrado) no se puede cargar como compra

// errores
assert.match(P.mensajePedido("recepcion_excede_pendiente"), /más de lo que falta/);
assert.equal(P.mensajePedido("algo raro"), "No se pudo completar la operación.");
console.log("pedidos-proveedor.test.mjs: OK");
