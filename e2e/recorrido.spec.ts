import { test, expect } from "@playwright/test";

// Recorrido crítico: salud, tienda pública, pedido y panel protegido.
// Necesita un kiosco de prueba cargado con e2e/seed.sql. Verificación en base opcional (E2E_SUPABASE_URL + E2E_SERVICE_ROLE).
const SLUG = process.env.E2E_SLUG ?? "e2e-kiosco";
const PRODUCTO = process.env.E2E_PRODUCTO ?? "Alfajor E2E";

test("salud: la base responde", async ({ request }) => {
  const r = await request.get("/api/salud");
  expect(r.status()).toBe(200);
  expect((await r.json()).estado).toBe("ok");
});

test("una página que no existe muestra el 404 propio", async ({ page }) => {
  await page.goto("/esta-pagina-no-existe-e2e");
  await expect(page.getByText("No encontramos esa página")).toBeVisible();
});

test("el panel sin sesión pide entrar", async ({ page }) => {
  await page.goto("/panel");
  await expect(page.getByRole("heading", { name: "Entrá a tu kiosco" })).toBeVisible();
});

test("tienda: el cliente arma un pedido y queda guardado", async ({ page }) => {
  // El pedido termina abriendo wa.me. Se intercepta para que el navegador de prueba no salga del sitio.
  let linkWhatsApp = "";
  await page.route(/wa\.me|api\.whatsapp\.com/, (route) => { linkWhatsApp = route.request().url(); return route.fulfill({ status: 200, body: "ok" }); });

  const tel = "34155" + String(Math.floor(10000 + Math.random() * 89999)); // distinto en cada corrida: hay tope anti-spam por teléfono
  await page.goto(`/${SLUG}`);
  await page.getByRole("button", { name: `Agregar ${PRODUCTO}` }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  await page.getByLabel("Nombre").fill("Cliente E2E");
  await page.getByLabel("Tu WhatsApp").fill(tel);
  await page.getByRole("button", { name: "Enviar pedido por WhatsApp" }).click();
  await expect.poll(() => linkWhatsApp, { timeout: 15_000 }).toContain("wa.me");

  const url = process.env.E2E_SUPABASE_URL, clave = process.env.E2E_SERVICE_ROLE;
  test.skip(!url || !clave, "Sin E2E_SUPABASE_URL y E2E_SERVICE_ROLE no se verifica el pedido en la base");
  const r = await page.request.get(`${url}/rest/v1/pedidos?cliente_telefono=eq.549${tel}&select=numero,estado,total`, { headers: { apikey: clave!, Authorization: `Bearer ${clave}` } });
  const filas = await r.json();
  expect(filas).toHaveLength(1);
  expect(filas[0].estado).toBe("pendiente");
});
