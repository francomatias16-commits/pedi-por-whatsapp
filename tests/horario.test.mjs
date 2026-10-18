// Prueba de lib/horario.ts: node tests/horario.test.mjs  (o: npm run test:horario)
import ts from "typescript";
import { readFileSync } from "node:fs";
const js = ts.transpileModule(readFileSync(new URL("../lib/horario.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const H = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const AR = (iso) => new Date(iso + "-03:00");   // hora argentina → instante
const SEM = { 1: [{ desde: "08:00", hasta: "13:00" }, { desde: "17:00", hasta: "22:00" }], 5: [{ desde: "20:00", hasta: "02:00" }] };
const k = (o = {}) => ({ abierto: true, horario_auto: true, horarios: SEM, ...o });
// 2026-10-19 es lunes (mismos casos que supabase/tests/etapa5_test.py)
for (const [iso, esp, n] of [
  ["2026-10-19T10:00", "abierta", "lun 10:00"], ["2026-10-19T08:00", "abierta", "lun 08:00 abre justo"], ["2026-10-19T07:59", "fuera_de_horario", "lun 07:59"],
  ["2026-10-19T13:00", "fuera_de_horario", "lun 13:00 cierra justo"], ["2026-10-19T13:59", "fuera_de_horario", "siesta"], ["2026-10-19T18:00", "abierta", "lun 18:00"],
  ["2026-10-19T22:00", "fuera_de_horario", "lun 22:00"], ["2026-10-23T23:00", "abierta", "vie 23:00 cruza medianoche"], ["2026-10-24T01:00", "abierta", "sáb 01:00 sigue por el viernes"],
  ["2026-10-24T02:00", "fuera_de_horario", "sáb 02:00 cerró"], ["2026-10-25T15:00", "fuera_de_horario", "domingo cerrado"], ["2026-10-21T15:00", "fuera_de_horario", "miércoles cerrado"],
]) eq(n, H.estadoTienda(k(), AR(iso)), esp);
eq("pausa manual gana", H.estadoTienda(k({ abierto: false }), AR("2026-10-19T10:00")), "pausada");
eq("sin horario auto: siempre abierta", H.estadoTienda(k({ horario_auto: false }), AR("2026-10-25T15:00")), "abierta");
// Cerca de medianoche UTC: el día argentino manda, no el UTC
eq("lun 23:30 AR = mar 02:30Z", H.horaArgentina(new Date("2026-10-20T02:30:00Z")), { dow: 1, min: 23 * 60 + 30 });
// próxima apertura
eq("abre hoy", H.textoApertura(SEM, AR("2026-10-19T14:00")), "Abre hoy a las 17:00");
eq("abre mañana", H.textoApertura({ 2: [{ desde: "09:00", hasta: "12:00" }] }, AR("2026-10-19T23:00")), "Abre mañana a las 09:00");
eq("abre el viernes", H.textoApertura(SEM, AR("2026-10-19T23:00")), "Abre el viernes a las 20:00");
eq("mismo día de la semana próxima", H.textoApertura({ 1: [{ desde: "08:00", hasta: "13:00" }] }, AR("2026-10-19T14:00")), "Abre el lunes a las 08:00");
eq("sin días", H.textoApertura({}, AR("2026-10-19T14:00")), null);
// resumen
eq("resumen agrupa", H.resumenHorario({ 1: [{ desde: "08:00", hasta: "22:00" }], 2: [{ desde: "08:00", hasta: "22:00" }], 3: [{ desde: "08:00", hasta: "22:00" }], 6: [{ desde: "09:00", hasta: "14:00" }] }), "Lun a Mié 08:00–22:00 · Sáb 09:00–14:00");
eq("resumen dos tramos", H.resumenHorario({ 1: SEM[1] }), "Lun 08:00–13:00 y 17:00–22:00");
eq("resumen dos días", H.resumenHorario({ 6: [{ desde: "09:00", hasta: "14:00" }], 0: [{ desde: "09:00", hasta: "14:00" }] }), "Sáb y Dom 09:00–14:00");
eq("resumen vacío", H.resumenHorario({}), "");
// validación (igual que horarios_validos en SQL)
eq("válido", H.horariosValidos(SEM), true);
eq("día 7", H.horariosValidos({ 7: [] }), false);
eq("25:00", H.horariosValidos({ 1: [{ desde: "25:00", hasta: "10:00" }] }), false);
eq("duración cero", H.horariosValidos({ 1: [{ desde: "08:00", hasta: "08:00" }] }), false);
eq("3 tramos", H.horariosValidos({ 1: Array(3).fill({ desde: "08:00", hasta: "09:00" }) }), false);
eq("H:MM", H.horariosValidos({ 1: [{ desde: "8:00", hasta: "9:00" }] }), false);
console.log(fallos ? `${fallos} fallos` : "horario: todo OK");
process.exit(fallos ? 1 : 0);
