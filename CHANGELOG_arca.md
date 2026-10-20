# Facturación electrónica ARCA (Factura C y Nota de crédito C)

- `supabase/migrations/0058_facturacion_arca.sql` (aditiva): certificado y token del proveedor (solo servidor), `facturacion_config` por local (CUIT, razón social, domicilio, punto de venta, condición IVA, estado de la delegación), `comprobantes_arca` con índices únicos (una factura viva por venta, una nota por devolución, número no repetido), candado de emisión, funciones de reserva/resultado y trigger que exige la nota de crédito antes de anular una venta facturada.
- `lib/arca/`: `comun.ts` (lógica pura), `firma.ts` (CMS con `node:crypto`), `servidor.ts` (WSAA, WSFE, delegación, emisión idempotente), `pdf.ts` (comprobante con QR), `cliente.ts` (navegador), `rutas.ts`.
- API: `/api/arca/{config,verificar,facturar,nota-credito,pdf}`.
- Panel: Mi negocio > Facturación electrónica (datos fiscales, pasos de delegación, verificar conexión). Caja: panel de facturación en Buscar ventas y Ventas del turno; la devolución emite sola su nota de crédito.
- `scripts/cargar-certificado-arca.mjs`, `docs/ARCA.md`, `tests/arca.test.mjs` (incluye verificación de la firma contra openssl), mensajes amigables en `lib/errores.ts`.
- Variable nueva: `ARCA_AMBIENTE` (`homologacion` por defecto, `produccion`). Dependencia nueva: `pdfkit`.
