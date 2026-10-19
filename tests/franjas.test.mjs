// Prueba de la ventana de entrega: node tests/franjas.test.mjs  (o: npm run test:franjas)
import ts from "typescript";
import { readFileSync } from "node:fs";
const leer = (r) => readFileSync(new URL(r, import.meta.url), "utf8");
const js = ts.transpileModule(leer("../lib/franjas.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const F = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };

eq("hora con segundos", F.horaCorta("09:00:00"), "9:00");
eq("hora sin cero", F.horaCorta("9:05"), "9:05");
eq("hora tarde", F.horaCorta("18:30:00"), "18:30");
eq("hora rara queda igual", F.horaCorta("mañana"), "mañana");
eq("etiqueta", F.etiquetaFranja({ nombre: "Mañana", desde: "09:00:00", hasta: "13:00:00" }), "Mañana · de 9:00 a 13:00");

eq("válida", F.validarFranja({ nombre: "Mañana", desde: "09:00", hasta: "13:00" }), null);
eq("válida con segundos", F.validarFranja({ nombre: "Tarde", desde: "14:00:00", hasta: "18:00:00" }), null);
eq("sin nombre", F.validarFranja({ nombre: "  ", desde: "09:00", hasta: "13:00" }), "franja_nombre_invalido");
eq("nombre largo", F.validarFranja({ nombre: "x".repeat(41), desde: "09:00", hasta: "13:00" }), "franja_nombre_invalido");
eq("nombre de 40", F.validarFranja({ nombre: "x".repeat(40), desde: "09:00", hasta: "13:00" }), null);
eq("hasta antes de desde", F.validarFranja({ nombre: "A", desde: "13:00", hasta: "09:00" }), "franja_horas_invalidas");
eq("iguales", F.validarFranja({ nombre: "A", desde: "09:00", hasta: "09:00" }), "franja_horas_invalidas");
eq("vacías", F.validarFranja({ nombre: "A", desde: "", hasta: "" }), "franja_horas_invalidas");
eq("hora imposible", F.validarFranja({ nombre: "A", desde: "25:00", hasta: "26:00" }), "franja_horas_invalidas");
eq("tope", F.TOPE_FRANJAS, 10);

// La tienda manda la franja solo con envío y franjas encendidas, y no deja pedir sin elegirla.
const tienda = leer("../components/Tienda.tsx");
eq("tienda envía p_franja", tienda.includes('p_franja: modalidad === "envio" && franjasActivas ? franjaId || null : null'), true);
eq("tienda exige la franja", tienda.includes("!faltaZona && !faltaFranja"), true);
eq("tienda copia la franja al WhatsApp", tienda.includes("franja: data.franja ?? undefined"), true);

// Migración: lo que tiene que existir y quedar protegido.
const sql = leer("../supabase/migrations/0036_franjas_entrega.sql");
for (const t of ["franjas_entrega_activo", "franja_requerida", "franja_invalida", "franja_id", "franja_nombre", "check (desde < hasta)"]) eq(`migración menciona ${t}`, sql.includes(t), true);
eq("la 9 argumentos delega", /select public\.crear_pedido\(p_slug, p_nombre, p_telefono, p_modalidad, p_direccion, p_notas, p_items, p_zona, p_medio_pago, null::uuid\)/.test(sql), true);
eq("la franja se lee de la base por local", sql.includes("where id = p_franja and kiosco_id = v_kiosco.id and activa"), true);
eq("solo el dueño enciende", /franjas_configurar_activo[\s\S]*?es_dueno\(p_kiosco\)/.test(sql), true);

console.log(fallos ? `${fallos} fallos` : "franjas: todo OK");
process.exit(fallos ? 1 : 0);
