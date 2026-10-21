// Prueba de roles y equipo (lib/navegacion.ts + lib/equipo.ts): node tests/roles.test.mjs  (o: npm run test:roles)
import ts from "typescript";
import { readFileSync } from "node:fs";
const cargar = async (ruta) => {
  const js = ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const N = await cargar("../lib/navegacion.ts");
const E = await cargar("../lib/equipo.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };

const todas = N.DESTINOS.flatMap((d) => d.subs.map((s) => s.tab));

// ---- Qué ve cada rol
eq("tres roles", N.ROLES, ["cajero", "encargado", "dueno"]);
eq("el dueño ve las 13 pantallas", todas.filter((t) => N.puedeVer("dueno", t)).length, 13);
eq("el encargado ve las 13 pantallas (Mi negocio solo con resultados)", todas.filter((t) => N.puedeVer("encargado", t)).length, 13);
eq("el cajero ve solo caja, pedidos y fiado", todas.filter((t) => N.puedeVer("cajero", t)), ["pedidos", "caja", "fiado"].sort((a, b) => todas.indexOf(a) - todas.indexOf(b)));
for (const t of ["productos", "precios", "etiquetas", "conteo", "sellos", "radar", "reponer", "proveedores", "local", "resumen"]) eq(`el cajero NO ve ${t}`, N.puedeVer("cajero", t), false);
eq("el cajero entra por la caja", N.tabInicio("cajero"), "caja");
eq("el encargado entra por el inicio", N.tabInicio("encargado"), "resumen");
eq("el dueño entra por el inicio", N.tabInicio("dueno"), "resumen");
for (const r of N.ROLES) eq(`la pantalla de entrada de ${r} es visible para ${r}`, N.puedeVer(r, N.tabInicio(r)), true);

// ---- Destinos filtrados
eq("cajero: destinos", N.destinosPara("cajero").map((d) => d.id), ["vender", "pedidos", "clientes"]);
eq("cajero: clientes solo trae Fiado", N.destinosPara("cajero").find((d) => d.id === "clientes").subs.map((s) => s.tab), ["fiado"]);
eq("encargado: 8 destinos", N.destinosPara("encargado").length, 8);
eq("dueño: 8 destinos", N.destinosPara("dueno").length, 8);
eq("destinosPara no modifica la lista original", N.DESTINOS.find((d) => d.id === "clientes").subs.length, 2);
for (const r of N.ROLES) for (const d of N.destinosPara(r)) eq(`${r}/${d.id}: la primera pantalla es visible`, N.puedeVer(r, d.subs[0].tab), true);

// ---- Permisos finos
eq("solo el dueño configura el local", N.ROLES.map(N.puedeConfigurarLocal), [false, false, true]);
eq("encargado y dueño administran la caja", N.ROLES.map(N.puedeAdministrarCaja), [false, true, true]);
eq("encargado y dueño corrigen fiado", N.ROLES.map(N.puedeCorregirFiado), [false, true, true]);
eq("solo el cajero exige supervisor", N.ROLES.map(N.exigeSupervisor), [true, false, false]);
eq("esRol acepta los tres", ["cajero", "encargado", "dueno"].every(N.esRol), true);
eq("esRol rechaza otros", [N.esRol("admin"), N.esRol(""), N.esRol(null), N.esRol(undefined), N.esRol(3)], [false, false, false, false, false]);
eq("etiquetas y detalles para cada rol", N.ROLES.every((r) => N.ETIQUETA_ROL[r] && N.DETALLE_ROL[r].length > 20), true);

// ---- Enlaces de invitación
const T = "a1b2c3d4".repeat(8);
eq("token de 64 hex es válido", E.tokenValido(T), true);
eq("token corto", E.tokenValido("abc"), false);
eq("token con mayúsculas", E.tokenValido(T.toUpperCase()), false);
eq("token con símbolos", E.tokenValido(T.slice(0, 63) + "-"), false);
eq("token nulo", [E.tokenValido(null), E.tokenValido(undefined), E.tokenValido(12)], [false, false, false]);
eq("ruta", E.rutaInvitacion(T), `/unirse/${T}`);
eq("link", E.linkInvitacion("https://pedi.app", T), `https://pedi.app/unirse/${T}`);
eq("link sin barra doble", E.linkInvitacion("https://pedi.app/", T), `https://pedi.app/unirse/${T}`);
eq("token de ruta", E.tokenDeRuta(`/unirse/${T}`), T);
eq("token de ruta con barra final", E.tokenDeRuta(`/unirse/${T}/`), T);
eq("ruta con token inválido", E.tokenDeRuta("/unirse/xyz"), null);
eq("otra ruta", E.tokenDeRuta(`/panel/${T}`), null);
const msg = E.mensajeInvitacion("Kiosco Sol", "cajero", `https://pedi.app/unirse/${T}`);
eq("el mensaje nombra el local, el rol y el enlace", [msg.includes("Kiosco Sol"), msg.includes("como cajero"), msg.includes(T)], [true, true, true]);
eq("el mensaje avisa que es de un solo uso", msg.includes("una sola vez") && msg.includes("7 días"), true);
eq("mensaje de encargado", E.mensajeInvitacion("X", "encargado", "l").includes("como encargado"), true);

// ---- Vencimiento y orden
const ahora = new Date("2026-10-18T12:00:00Z");
eq("faltan 7 días", E.diasRestantes("2026-10-25T12:00:00Z", ahora), 7);
eq("falta menos de un día", E.diasRestantes("2026-10-18T20:00:00Z", ahora), 1);
eq("vencida", E.diasRestantes("2026-10-17T12:00:00Z", ahora), 0);
eq("vence justo ahora", E.diasRestantes("2026-10-18T12:00:00Z", ahora), 0);
const ms = [
  { user_id: "3", rol: "cajero", activo: false, email: "c", desde: "2026-01-03" },
  { user_id: "2", rol: "encargado", activo: true, email: "b", desde: "2026-01-02" },
  { user_id: "1", rol: "dueno", activo: true, email: "a", desde: "2026-01-05" },
  { user_id: "4", rol: "cajero", activo: true, email: "d", desde: "2026-01-01" },
];
eq("orden: dueño, activos por antigüedad, quitados al final", E.ordenarMiembros(ms).map((m) => m.user_id), ["1", "4", "2", "3"]);
eq("ordenar no modifica la lista original", ms.map((m) => m.user_id), ["3", "2", "1", "4"]);

// ---- Coherencia con la base: las pantallas de la caja del cajero no piden nada solo-encargado
const sql = readFileSync(new URL("../supabase/migrations/0030_equipo.sql", import.meta.url), "utf8");
for (const f of ["caja_abrir_turno", "caja_cerrar_turno", "caja_resumen", "caja_reporte_z", "registrar_venta_mostrador", "anular_venta_mostrador", "devolver_venta_mostrador", "pos_buscar_ventas", "pos_pin_verificar", "pasar_a_fiado"])
  eq(`la base deja al cajero usar ${f}`, new RegExp(`"${f}":"C"`).test(sql), true);
for (const f of ["registrar_compra", "ajustar_stock", "ajustar_precios", "proveedor_guardar", "sumar_stock_rapido", "curva_abc", "reposicion_resumen"])
  eq(`la base reserva ${f} para encargado y dueño`, new RegExp(`"${f}":"E"`).test(sql), true);
eq("el rol del cajero para la caja coincide con las pantallas de la app", N.puedeVer("cajero", "caja") && N.puedeVer("cajero", "pedidos") && N.puedeVer("cajero", "fiado"), true);

if (fallos) { console.log(`roles: ${fallos} fallos`); process.exit(1); }
console.log("roles.test.mjs: OK");
