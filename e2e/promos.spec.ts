import { test, expect, type Page } from "@playwright/test";

// Promos, club y sorteos: panel del dueño (premios, campañas, club, sorteos, ofertas de la caja) y tarjeta del cliente.
// Necesita el kiosco de e2e/seed.sql y un usuario de prueba con mail y contraseña que sea dueño de ese kiosco:
//   E2E_PANEL_MAIL y E2E_PANEL_CLAVE. Sin ellos las pruebas del panel se omiten; la del cliente corre igual.
// Cada prueba usa nombres únicos y deja todo como estaba (borra o cancela lo que crea).
const SLUG = process.env.E2E_SLUG ?? "e2e-kiosco";
const MAIL = process.env.E2E_PANEL_MAIL, CLAVE = process.env.E2E_PANEL_CLAVE;
const unico = () => String(Date.now()).slice(-7);

async function entrarAlPanel(page: Page, ruta: string) {
  await page.goto("/panel");
  await page.getByLabel("Usuario (tu mail)").fill(MAIL!);
  await page.getByLabel("Contraseña").fill(CLAVE!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByLabel("Usuario (tu mail)")).toBeHidden({ timeout: 20_000 });
  if (ruta !== "/panel") await page.goto(ruta);
}
const pestaña = (page: Page, nombre: string) => page.getByRole("tab", { name: nombre, exact: true });
// Los pasos de "Mi programa" son bloques que se abren con un toque: se abre solo si está cerrado.
async function abrirPaso(page: Page, titulo: string) {
  const bloque = page.locator("details.plegable", { has: page.locator("summary", { hasText: titulo }) });
  if (!(await bloque.evaluate((e) => (e as HTMLDetailsElement).open))) await bloque.locator("summary").click();
}

test.describe("panel: promos, club y sorteos", () => {
  test.skip(!MAIL || !CLAVE, "Faltan E2E_PANEL_MAIL y E2E_PANEL_CLAVE");

  test("premios: vista previa para el cliente y deshacer", async ({ page }) => {
    const nombre = `Premio E2E ${unico()}`;
    await entrarAlPanel(page, "/panel/puntos");
    await pestaña(page, "Mi programa").click();
    await abrirPaso(page, "3. Más premios");
    await page.getByRole("button", { name: "Nuevo premio" }).click();
    await page.getByLabel("Nombre").fill(nombre);
    await page.getByLabel("Costo en sellos").fill("7");
    await expect(page.getByText("Así lo verá el cliente")).toBeVisible();
    await expect(page.getByText(`${nombre}: lo canjeás con 7 sellos. Lo retirás en el kiosco.`)).toBeVisible();

    await page.getByRole("button", { name: "Guardar premio" }).click();
    await expect(page.getByRole("heading", { name: /Tus premios/ })).toBeVisible();
    await expect(page.getByText(nombre, { exact: true })).toBeVisible();
    await expect(page.getByText(`Se creó “${nombre}”.`)).toBeVisible();

    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    await expect(page.getByText("Listo, volvió a como estaba.")).toBeVisible();
    await expect(page.getByText(nombre, { exact: true })).toHaveCount(0);
  });

  test("premios: pausar y deshacer vuelve a activarlo; borrar y deshacer lo recrea", async ({ page }) => {
    const nombre = `Premio E2E ${unico()}`;
    await entrarAlPanel(page, "/panel/puntos");
    await pestaña(page, "Mi programa").click();
    await abrirPaso(page, "3. Más premios");
    await page.getByRole("button", { name: "Nuevo premio" }).click();
    await page.getByLabel("Nombre").fill(nombre);
    await page.getByRole("button", { name: "Guardar premio" }).click();
    const tarjeta = page.locator(".card", { hasText: nombre }).filter({ has: page.getByRole("button", { name: "Pausar" }) });
    await expect(tarjeta).toBeVisible();

    await tarjeta.getByRole("button", { name: "Pausar" }).click();
    await expect(page.getByText(`Se pausó “${nombre}”.`)).toBeVisible();
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    await expect(page.locator(".card", { hasText: nombre }).getByRole("button", { name: "Pausar" })).toBeVisible();

    await page.locator(".card", { hasText: nombre }).getByRole("button", { name: "Borrar" }).click();
    await page.getByRole("button", { name: "Sí, seguir" }).click();
    await expect(page.getByText(`Se borró “${nombre}”.`)).toBeVisible();
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    await expect(page.getByText(nombre, { exact: true })).toBeVisible();

    // Limpieza
    await page.locator(".card", { hasText: nombre }).getByRole("button", { name: "Borrar" }).click();
    await page.getByRole("button", { name: "Sí, seguir" }).click();
    await expect(page.getByText(nombre, { exact: true })).toHaveCount(0);
  });

  test("campañas: vista previa para el cliente y deshacer", async ({ page }) => {
    const nombre = `Campaña E2E ${unico()}`;
    await entrarAlPanel(page, "/panel/puntos");
    await pestaña(page, "Mi programa").click();
    await abrirPaso(page, "2. Cómo se suman");
    await page.getByRole("button", { name: "Desde cero" }).click();
    await page.getByLabel("Nombre").fill(nombre);
    await expect(page.getByText("Así lo verá el cliente")).toBeVisible();
    await expect(page.getByText(/Ganás 1 sello en cada compra/)).toBeVisible();

    await page.getByRole("button", { name: "Guardar campaña" }).click();
    await expect(page.getByText("Forma de sumar puntos guardada")).toBeVisible();
    await expect(page.getByText(`Se creó “${nombre}”.`)).toBeVisible();
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    await expect(page.getByText("Listo, volvió a como estaba.")).toBeVisible();
    await expect(page.getByText(nombre, { exact: true })).toHaveCount(0);
  });

  test("club: la regla simple muestra cómo la ve el cliente", async ({ page }) => {
    await entrarAlPanel(page, "/panel/puntos");
    await pestaña(page, "Mi programa").click();
    await page.getByLabel("Qué se llevan").fill("Gaseosa E2E");
    await page.getByLabel("Cada cuántos sellos").fill("8");
    await expect(page.getByText("Cada compra suma sellos. Al juntar 8 sellos te llevás Gaseosa E2E.")).toBeVisible();
    await page.getByLabel("Cada cuántos sellos").fill("");
    await expect(page.getByText("Completá el premio y los sellos para ver cómo lo verá el cliente.")).toBeVisible();
  });

  test("sorteos: se arma, no se puede sortear sin permiso y se cancela", async ({ page }) => {
    const nombre = `Sorteo E2E ${unico()}`;
    await entrarAlPanel(page, "/panel/puntos");
    await pestaña(page, "Promociones").click();
    const seccion = page.locator(".card", { has: page.getByRole("heading", { name: "Sorteos", exact: true }) });
    await seccion.getByLabel("Nombre").fill(nombre);
    await seccion.getByLabel("Premio 1").fill("Un premio de prueba");
    await seccion.getByRole("button", { name: "Armar sorteo" }).click();
    await expect(page.getByText("Listo, el sorteo quedó armado. Falta confirmar el permiso.")).toBeVisible();

    const fila = seccion.locator(".fila-sep", { hasText: nombre });
    await expect(fila.getByRole("button", { name: "Realizar el sorteo" })).toBeDisabled();
    await fila.getByRole("button", { name: "Confirmar que tengo el permiso" }).click();
    await page.getByRole("button", { name: "Sí, lo confirmo" }).click();
    await expect(fila.getByText("Permiso confirmado")).toBeVisible();

    await fila.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Sí, cancelar" }).click();
    await expect(page.getByText("Sorteo cancelado.")).toBeVisible();
  });

  test("caja: una promo por producto y aviso si baja el margen", async ({ page }) => {
    const nombre = `Oferta E2E ${unico()}`;
    await entrarAlPanel(page, "/panel/vender");
    const abrir = page.getByRole("button", { name: "Abrir caja y empezar a vender" });
    if (await abrir.isVisible().catch(() => false)) await abrir.click();
    await page.getByRole("button", { name: /Más/ }).click();
    await page.getByRole("button", { name: "Ofertas" }).click();

    const nueva = async (nom: string, pct: string) => {
      await page.getByRole("button", { name: "Nueva promoción" }).click();
      await page.getByLabel("Nombre").fill(nom);
      await page.getByLabel("Tipo").selectOption("pct");
      await page.getByLabel("Producto").selectOption({ label: "Gaseosa E2E" });
      await page.getByLabel("Descuento (%)").fill(pct);
      await page.getByRole("button", { name: "Guardar promoción" }).click();
    };

    // 1) 30% sobre un producto con 30% de margen lo deja sin ganancia: avisa y, si se vuelve, no guarda nada
    await nueva(nombre, "30");
    await expect(page.getByText("Baja el margen")).toBeVisible();
    await page.getByRole("button", { name: "No, volver" }).click();
    await expect(page.locator(".card", { hasText: nombre }).filter({ has: page.getByRole("button", { name: "Pausar" }) })).toHaveCount(0);

    // 2) con 10% el margen sigue sobre el mínimo: se guarda sin preguntar
    await page.getByLabel("Descuento (%)").fill("10");
    await page.getByRole("button", { name: "Guardar promoción" }).click();
    const tarjeta = page.locator(".card", { hasText: nombre }).filter({ has: page.getByRole("button", { name: "Pausar" }) });
    await expect(tarjeta).toBeVisible();

    // 3) una segunda promo activa del mismo producto se rechaza con un mensaje claro
    await nueva(`${nombre} bis`, "5");
    await expect(page.getByRole("alert")).toContainText("ya tiene otra promoción activa");
    await page.getByRole("button", { name: "Cancelar" }).click();

    // Limpieza
    await tarjeta.getByRole("button", { name: "Eliminar" }).click();
    await page.getByRole("button", { name: "Sí, eliminar" }).click();
    await expect(page.getByText(nombre, { exact: true })).toHaveCount(0);
  });
});

test("club: el cliente crea su tarjeta desde el QR del local", async ({ page }) => {
  const tel = "34155" + String(Math.floor(10000 + Math.random() * 89999)); // distinto en cada corrida
  await page.goto(`/${SLUG}/club`);
  await expect(page.getByRole("heading", { name: "Sumá sellos con cada compra" })).toBeVisible();
  await page.getByLabel("Tu nombre").fill("Cliente E2E");
  await page.getByLabel("Tu teléfono").fill(tel);
  await page.getByRole("button", { name: "Crear mi tarjeta" }).click();
  await expect(page).toHaveURL(/\/tarjeta\//, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Hola, Cliente E2E/ })).toBeVisible();
});
