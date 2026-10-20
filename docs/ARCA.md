# Facturación electrónica con ARCA (Factura C y Nota de crédito C)

Solo desde la caja. Un único certificado del proveedor firma por todos los locales; cada kiosquero delega el servicio a la CUIT del proveedor y elige su propio punto de venta.

## Puesta en marcha (en este orden)

1. **Migración**: hacer backup y correr `supabase/migrations/0058_facturacion_arca.sql` entera en el SQL Editor (aditiva).
2. **Variable en Vercel** (producción): `ARCA_AMBIENTE=homologacion` para probar; `produccion` para facturar de verdad. Sin la variable, es homologación. `PAGOS_CIFRADO_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya existen y se reutilizan.
3. **Cargar el certificado del proveedor** (una vez por ambiente, desde tu computadora, el certificado y la clave no se comparten con nadie):
   ```
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PAGOS_CIFRADO_KEY=... \
   node scripts/cargar-certificado-arca.mjs --cuit <CUIT del proveedor> --cert certificado.crt --key privada.key [--produccion]
   ```
   Sin `--produccion` carga el de homologación. El script verifica que la clave corresponda al certificado y que esté vigente, y lo guarda cifrado (AES-256-GCM).
4. **Subir el código** (commit y push) y esperar el deploy. `pdfkit` queda como paquete externo en `next.config.mjs`.
5. **Probar** (homologación): en el panel, Mi negocio > Facturación electrónica: cargar los datos del local, y *Verificar conexión*. Después, en la caja: Buscar ventas > abrir una venta > *Emitir Factura C*.

## Cómo funciona

- `lib/arca/comun.ts`: lógica pura (CUIT, fechas de Argentina, sobres SOAP de WSFE y WSAA, lectura de respuestas, URL del QR). Probada en `tests/arca.test.mjs`.
- `lib/arca/firma.ts`: firma CMS/PKCS#7 del ticket de acceso con `node:crypto` (sin openssl ni librerías). La prueba verifica la firma contra `openssl cms -verify`.
- `lib/arca/servidor.ts`: token WSAA compartido (tabla `tokens_wsaa_proveedor`), verificación de la delegación, emisión.
- Emisión: reserva en SQL (`arca_reservar_*`, idempotente, el importe sale de la venta) → candado por local/punto de venta → último número en ARCA → se anota el número → `FECAESolicitar`. Si se corta la respuesta, el comprobante queda **incierto** y al reintentar se consulta `FECompConsultar` antes de pedir otro número (no se duplica).
- Una venta con factura no se anula hasta emitir la nota de crédito por el saldo (trigger). Las devoluciones de la caja emiten su nota de crédito solas; si falla, la devolución queda registrada y la nota se reintenta desde Buscar ventas.
- Rutas: `/api/arca/config` y `/verificar` (solo dueño), `/facturar`, `/nota-credito` y `/pdf` (cajero, encargado, dueño).

## Cada kiosquero (una vez)

ARCA con clave fiscal > Administrador de Relaciones > Nueva relación > ARCA > WebServices > Facturación Electrónica, representante = CUIT del proveedor. Tiene que tener además un punto de venta “Factura Electrónica - Web Services”. La pantalla de Mi negocio lo explica paso a paso.

## Alcance y límites

- Solo Factura C (monotributo y exento); concepto productos; receptor Consumidor Final o con DNI.
- No cubre Factura A/B, CUIT del receptor, ni venta por pedidos de la tienda (solo mostrador).
- El PDF de homologación lleva la leyenda “sin validez fiscal”.
