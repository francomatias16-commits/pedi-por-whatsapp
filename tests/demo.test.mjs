// La demo en vivo (0059 + /demo): que el cableado no se rompa sin que nadie se entere. La parte de base de datos está en supabase/tests/demo_test.py.
// Uso: node tests/demo.test.mjs
import { readFileSync, existsSync } from "node:fs";
const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let mal = 0;
const ok = (c, m) => { if (!c) mal++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };

ok(existsSync(new URL("../app/demo/page.tsx", import.meta.url)), "existe la ruta /demo");
ok(!/localStorage|password|DEMO_PASSWORD/i.test(leer("components/panel/EntrarDemo.tsx") + leer("app/demo/page.tsx")), "el navegador no conoce la contraseña de la demo");
const api = leer("app/api/demo/route.ts");
ok(/process\.env\.DEMO_PASSWORD/.test(api) && /export async function POST/.test(api), "la contraseña vive solo en el servidor (POST /api/demo)");
ok(/no-store/.test(api), "/api/demo no se guarda en caché");
const cron = leer("app/api/cron/demo/route.ts");
ok(/CRON_SECRET/.test(cron) && /demo_reiniciar/.test(cron) && /updateUserById/.test(cron), "el cron exige el secreto, reinicia los datos y restablece la contraseña");
const vercel = JSON.parse(leer("vercel.json"));
ok(vercel.crons.some((c) => c.path === "/api/cron/demo"), "el reinicio diario está programado en vercel.json");
const env = leer(".env.example");
ok(/DEMO_EMAIL=/.test(env) && /DEMO_PASSWORD=/.test(env), ".env.example documenta DEMO_EMAIL y DEMO_PASSWORD");
const srv = leer("lib/pagos/servidor.ts");
ok((srv.match(/es_demo/g) ?? []).length >= 2, "esDueno y rolDe no autorizan nada sobre el kiosco demo (cobros, facturas, fotos)");
ok(/es_demo/.test(leer("app/api/pagos/mp/oauth/callback/route.ts")), "la demo no puede conectar una cuenta real de Mercado Pago");
const err = leer("lib/errores.ts");
ok(/\["demo_solo_lectura"/.test(err), "hay mensaje amigable para demo_solo_lectura");
ok(/es_demo/.test(leer("components/panel/PanelApp.tsx")) && /AvisoDemo/.test(leer("components/panel/Dueno.tsx")), "el panel avisa que se está en la demo");
const portada = leer("app/page.tsx");
ok((portada.match(/href="\/demo"/g) ?? []).length >= 2, "la portada tiene el botón Ver demo en vivo");
const mig = leer("supabase/migrations/0059_demo_en_vivo.sql");
ok(/demo_proteger_tablas\(\)/.test(mig) && /before insert or update or delete or truncate/.test(mig), "la migración instala el bloqueo de escritura en todas las tablas");
ok(/revoke execute on function public\.demo_reiniciar/.test(mig) && /grant execute on function public\.demo_reiniciar\(uuid\) to service_role/.test(mig), "reiniciar la demo solo lo puede el servicio");
const sitemap = existsSync(new URL("../app/sitemap.ts", import.meta.url)) ? leer("app/sitemap.ts") : "";
ok(!/\/demo/.test(sitemap), "la demo no se publica en el sitemap");

console.log(mal ? `${mal} FALLAS` : "TODO OK"); process.exit(mal ? 1 : 0);
