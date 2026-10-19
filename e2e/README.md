# E2E (Playwright)

Prueba el recorrido crítico: salud, 404, panel protegido y tienda → pedido. Corre contra un proyecto de Supabase **de prueba**.

1. Crear (o reusar) el proyecto de pruebas y aplicar las migraciones en orden.
2. Entrar una vez al panel de pruebas con Google y pegar `e2e/seed.sql` en el SQL Editor.
3. Local: `npx playwright install chromium`, `npm run build`, y `E2E_SUPABASE_URL=… E2E_SERVICE_ROLE=… npm run test:e2e`
   (la URL y la anon key del proyecto de pruebas van en `.env.local`).
4. En CI: secretos `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` y `E2E_SERVICE_ROLE`. Sin ellos el job se omite.

`E2E_SERVICE_ROLE` solo se usa para verificar que el pedido quedó guardado. Nunca va con `NEXT_PUBLIC_`.
Pendiente de la etapa 0: el paso "panel" con sesión iniciada (el login es solo con Google) se agrega cuando haya un usuario de prueba con contraseña.

Responsive: `npm run test:responsive` revisa que ninguna página tenga scroll horizontal en 360, 390, 768 y 1280 px, y guarda capturas de cada una en el reporte (`playwright show-report`). No necesita sesión; el panel se prueba solo en su pantalla de entrada.
