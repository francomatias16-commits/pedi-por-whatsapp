// Prueba de lib/pagos/oauth (state firmado, dirección de autorización, lectura del token, vencimiento) y de la migración 0057.
// Uso: node tests/oauth.test.mjs
import ts from "typescript";
import { readFileSync } from "node:fs";
const cargar = async (ruta) => {
  const js = ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const O = await cargar("../lib/pagos/oauth.ts");
let fallos = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { fallos++; console.log("FALLA", n, JSON.stringify(a), "!=", JSON.stringify(b)); } };
const ok = (n, c) => { if (!c) { fallos++; console.log("FALLA", n); } };

const K = "0b1c2d3e-0000-4000-8000-000000000001", U = "0b1c2d3e-0000-4000-8000-000000000002", SEC = "secreto-de-la-app";
const ahora = Date.UTC(2026, 9, 19, 12, 0, 0);

// --- state
const { state, nonce } = O.crearState({ kiosco: K, usuario: U, secreto: SEC, ahora });
eq("state válido", O.leerState(state, SEC, ahora + 60_000), { kiosco: K, usuario: U, nonce, vence: ahora + 10 * 60_000 });
eq("state vencido", O.leerState(state, SEC, ahora + 11 * 60_000), null);
eq("otro secreto", O.leerState(state, "otro", ahora), null);
eq("sin secreto", O.leerState(state, undefined, ahora), null);
eq("state vacío", O.leerState("", SEC, ahora), null);
eq("state sin firma", O.leerState(state.split(".")[0], SEC, ahora), null);
eq("state con partes de más", O.leerState(state + ".x", SEC, ahora), null);
const [cuerpo, firma] = state.split(".");
const otroCuerpo = Buffer.from([K, "otro-usuario", nonce, String(ahora + 600000)].join("|")).toString("base64url");
eq("cuerpo adulterado con la firma vieja", O.leerState(`${otroCuerpo}.${firma}`, SEC, ahora), null);
eq("firma adulterada", O.leerState(`${cuerpo}.${firma.slice(0, -2)}AA`, SEC, ahora), null);
ok("dos states distintos (nonce aleatorio)", O.crearState({ kiosco: K, usuario: U, secreto: SEC, ahora }).state !== state);
eq("nonce fijo se respeta", O.crearState({ kiosco: K, usuario: U, secreto: SEC, ahora, nonce: "abc" }).nonce, "abc");

// --- dirección de autorización
const url = new URL(O.urlAutorizacion({ clientId: "123", redirectUri: O.redirectUri("https://pedi.app/"), state }));
eq("host de autorización", url.origin + url.pathname, "https://auth.mercadopago.com.ar/authorization");
eq("client_id", url.searchParams.get("client_id"), "123");
eq("response_type", url.searchParams.get("response_type"), "code");
eq("platform_id", url.searchParams.get("platform_id"), "mp");
eq("redirect_uri sin barra doble", url.searchParams.get("redirect_uri"), "https://pedi.app/api/pagos/mp/oauth/callback");
eq("state viaja intacto", url.searchParams.get("state"), state);

// --- respuesta del token
const buena = { access_token: "APP_USR-1234567890123456-101912-abcdef0123456789-555", refresh_token: "TG-0123456789abcdef", expires_in: 15552000, user_id: 555, public_key: "APP_USR-pk" };
eq("token ok", O.leerTokenOAuth(buena), { access_token: buena.access_token, refresh_token: buena.refresh_token, expires_in: 15552000, user_id: "555", public_key: "APP_USR-pk" });
eq("expires_in faltante = 180 días", O.leerTokenOAuth({ ...buena, expires_in: undefined }).expires_in, 15552000);
eq("sin public_key", O.leerTokenOAuth({ ...buena, public_key: undefined }).public_key, null);
for (const [n, r] of [["null", null], ["sin access", { ...buena, access_token: undefined }], ["access corto", { ...buena, access_token: "x" }], ["sin refresh", { ...buena, refresh_token: undefined }], ["sin user_id", { ...buena, user_id: undefined }], ["user_id no numérico", { ...buena, user_id: "abc" }], ["texto", "hola"]])
  eq("token inválido: " + n, O.leerTokenOAuth(r), null);

// --- vencimiento
eq("expira en 180 días", O.calcularExpira(15552000, ahora), new Date(ahora + 15552000_000).toISOString());
const dia = 86_400_000;
eq("lejos: no renueva", O.necesitaRenovar(new Date(ahora + 100 * dia).toISOString(), ahora), false);
eq("a 2 días: renueva", O.necesitaRenovar(new Date(ahora + 2 * dia).toISOString(), ahora), true);
eq("a 4 días: no renueva (límite de 3)", O.necesitaRenovar(new Date(ahora + 4 * dia).toISOString(), ahora), false);
eq("a 20 días con el margen del cron (30): renueva", O.necesitaRenovar(new Date(ahora + 20 * dia).toISOString(), ahora, O.DIAS_CRON), true);
eq("sin fecha: renueva", O.necesitaRenovar(null, ahora), true);
eq("fecha dañada: renueva", O.necesitaRenovar("no-es-fecha", ahora), true);
eq("vencido", O.vencido(new Date(ahora - 1).toISOString(), ahora), true);
eq("vigente", O.vencido(new Date(ahora + 1000).toISOString(), ahora), false);
eq("sin fecha cuenta como vencido", O.vencido(null, ahora), true);

// --- motivos de vuelta (lista cerrada)
eq("motivo válido", O.motivoVuelta("ok"), "ok");
eq("motivo desconocido", O.motivoVuelta("<script>"), null);
eq("el nombre de la cookie no choca con otras", O.COOKIE_STATE, "mp_oauth");

// --- migración 0057
const sql = readFileSync(new URL("../supabase/migrations/0057_mp_oauth.sql", import.meta.url), "utf8");
ok("agrega refresh token, vencimiento y turno", ["refresh_token_cifrado", "token_expira_at", "renovando_hasta"].every((c) => sql.includes(c)));
ok("el turno de renovación no se abre al navegador", /revoke all on function public\.mp_renovacion_tomar\(uuid, int\) from public, anon, authenticated/.test(sql) && !/grant execute on function public\.mp_renovacion_tomar/.test(sql));
ok("el estado no pide clave secreta a quien usa OAuth", /'sin_secreto', i\.forma_conexion = 'token'/.test(sql));
// El nombre de la cookie y el de los motivos que usa el panel tienen que seguir siendo los de la lista cerrada.
const panel = readFileSync(new URL("../components/CobroMP.tsx", import.meta.url), "utf8");
for (const m of O.MOTIVOS_VUELTA) ok("el panel entiende ?mp=" + m, new RegExp(`\\b${m}\\b\\s*:`).test(panel));

console.log(fallos ? `oauth: ${fallos} fallos` : "oauth: todo OK");
process.exitCode = fallos ? 1 : 0;
