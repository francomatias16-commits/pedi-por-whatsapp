# E2E (Playwright)

Prueba el recorrido crítico: salud, 404, panel protegido y tienda → pedido. Corre contra un proyecto de Supabase **de prueba**.

1. Crear (o reusar) el proyecto de pruebas y aplicar las migraciones en orden.
2. Crear en Authentication del proyecto de pruebas un usuario con mail y contraseña (confirmado), poner su mail en `e2e/seed.sql` (`v_mail`) y pegar el archivo en el SQL Editor.
3. Local: `npx playwright install chromium`, `npm run build`, y `E2E_SUPABASE_URL=… E2E_SERVICE_ROLE=… npm run test:e2e`
   (la URL y la anon key del proyecto de pruebas van en `.env.local`).
4. En CI: secretos `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` y `E2E_SERVICE_ROLE`. Sin ellos el job se omite.

`E2E_SERVICE_ROLE` solo se usa para verificar que el pedido quedó guardado. Nunca va con `NEXT_PUBLIC_`.
Panel con sesión (`e2e/promos.spec.ts`: premios, campañas, club, sorteos y ofertas de la caja): entra por la pantalla de mail y contraseña con `E2E_PANEL_MAIL` y `E2E_PANEL_CLAVE` (en CI, secretos con esos nombres). Sin ellas esas pruebas se omiten; la de la tarjeta del cliente corre igual. Cada prueba crea datos con nombre único y los borra o cancela al terminar.
No cubre `Realizar el sorteo`: es irreversible y necesita clientes con papelitos usados (lo cubren las pruebas SQL).

Responsive: `npm run test:responsive` revisa que ninguna página tenga scroll horizontal en 360, 390, 768 y 1280 px, y guarda capturas de cada una en el reporte (`playwright show-report`). No necesita sesión; el panel se prueba solo en su pantalla de entrada.
