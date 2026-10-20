// Crea (o reinicia) la demo en vivo: la cuenta de la demo y el kiosco ficticio. Se corre una vez por ambiente, desde tu computadora.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_EMAIL=demo@tu-dominio.com DEMO_PASSWORD='una-clave-larga' \\
//   node scripts/crear-demo.mjs
//
// Antes hay que haber aplicado la migración 0059. Después cargá DEMO_EMAIL y DEMO_PASSWORD en Vercel (los mismos valores) para que
// /demo pueda entrar. El reinicio diario (/api/cron/demo) vuelve a dejar los datos y la contraseña como están acá.
import { createClient } from "@supabase/supabase-js";

const fallar = (m) => { console.error(`Error: ${m}`); process.exit(1); };
const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: sr, DEMO_EMAIL: email, DEMO_PASSWORD: clave } = process.env;
if (!url || !sr) fallar("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
if (!email || !/^\S+@\S+\.\S+$/.test(email)) fallar("Falta DEMO_EMAIL (un mail que uses solo para la demo).");
if (!clave || clave.length < 12) fallar("Falta DEMO_PASSWORD (al menos 12 caracteres).");

const admin = createClient(url, sr, { auth: { persistSession: false } });

// ¿Ya existe la cuenta? (la lista de Supabase viene paginada)
let usuario = null;
for (let pagina = 1; !usuario; pagina++) {
  const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
  if (error) fallar(`No pude leer las cuentas: ${error.message}`);
  usuario = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (data.users.length < 200) break;
}
if (usuario) {
  const { error } = await admin.auth.admin.updateUserById(usuario.id, { password: clave, email_confirm: true });
  if (error) fallar(`No pude actualizar la cuenta: ${error.message}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password: clave, email_confirm: true });
  if (error || !data.user) fallar(`No pude crear la cuenta: ${error?.message}`);
  usuario = data.user;
}

const { data: kiosco, error } = await admin.rpc("demo_reiniciar", { p_user: usuario.id });
if (error) fallar(`No pude armar el kiosco demo: ${error.message}${/does not exist/.test(error.message) ? " (¿aplicaste la migración 0059?)" : ""}`);
console.log(`Demo lista. Cuenta: ${email} · kiosco ${kiosco} · tienda pública: /kiosco-demo`);
