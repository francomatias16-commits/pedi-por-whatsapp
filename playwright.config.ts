import { defineConfig } from "@playwright/test";

// E2E contra un proyecto de Supabase de PRUEBA (nunca producción). Variables en e2e/README.md.
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", locale: "es-AR" },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run start", url: "http://localhost:3000/api/salud", reuseExistingServer: true, timeout: 120_000 },
});
