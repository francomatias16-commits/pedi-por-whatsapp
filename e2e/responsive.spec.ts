import { test, expect } from "@playwright/test";

// Responsive: en cada tamaño de pantalla la página no puede tener scroll horizontal.
// Corre contra el mismo servidor que el resto de e2e (npm run test:e2e).
const SLUG = process.env.E2E_SLUG ?? "e2e-kiosco";

const VIEWPORTS = [
  { nombre: "celular chico", width: 360, height: 640 },
  { nombre: "celular", width: 390, height: 844 },
  { nombre: "tablet", width: 768, height: 1024 },
  { nombre: "escritorio", width: 1280, height: 800 },
];

const PAGINAS = [
  { nombre: "inicio", ruta: "/" },
  { nombre: "panel sin sesión", ruta: "/panel" },
  { nombre: "tienda pública", ruta: `/${SLUG}` },
  { nombre: "términos", ruta: "/terminos" },
  { nombre: "privacidad", ruta: "/privacidad" },
];

for (const vp of VIEWPORTS) {
  for (const pag of PAGINAS) {
    test(`${pag.nombre} sin scroll horizontal en ${vp.nombre} (${vp.width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pag.ruta);
      await page.waitForLoadState("networkidle");

      const medidas = await page.evaluate(() => ({
        ancho: document.documentElement.scrollWidth,
        ventana: window.innerWidth,
      }));
      // Un píxel de tolerancia por redondeos de subpíxeles.
      expect(medidas.ancho, `scrollWidth ${medidas.ancho} > ventana ${medidas.ventana}`).toBeLessThanOrEqual(medidas.ventana + 1);

      const captura = await page.screenshot({ fullPage: true });
      await testInfo.attach(`${pag.nombre}-${vp.width}`, { body: captura, contentType: "image/png" });
    });
  }
}
