# Etapa 3D: fotos automáticas de productos

Tercera parte de la Etapa 3 (la 3B, WhatsApp oficial, sigue pendiente de Meta). El local no tiene que sacar una foto por producto: la app **sugiere** fotos y el encargado o el dueño elige una.

## Cómo funciona

1. **Interruptor (dueño).** Mi negocio → "Fotos automáticas". Arranca apagado. Apagado, no aparece nada nuevo.
2. **Buscar.** Con el interruptor encendido, al editar un producto aparece "Buscar foto automática". El servidor consulta, en este orden: la base de la red (foto que ya cargó otro local para ese código), Open Food Facts / Open Beauty Facts / Open Products Facts (por código y por nombre) y, solo si hace falta (menos de 3 resultados) y hay clave configurada, un buscador de imágenes (Serper). Devuelve hasta 6 sugerencias sin repetidos.
3. **Elegir.** Nunca se cambia una foto sola. Cada sugerencia dice de dónde viene. Si viene de una búsqueda en internet, hay que tildar "Confirmo que puedo usar esta foto" antes de poder usarla, y la base lo exige (`derechos_requeridos`).
4. **Aplicar.** El servidor descarga la imagen (`/api/fotos/descargar`), el navegador la comprime a 800 px / 400 KB y la sube al bucket del local; recién ahí `foto_aplicar` la asigna al producto. No se guarda ningún enlace externo.
5. **Deshacer.** Tras aplicar aparece "Deshacer el cambio": vuelve a la foto anterior. Si la foto se cambió de otra forma después, no se pisa (`foto_cambio_posterior`).
6. **Historial.** `fotos_historial` registra cada cambio: de dónde salió, quién lo hizo, si confirmó derechos y la imagen anterior. Lo ven encargado y dueño. Apagar el interruptor no lo borra.

## Quién puede qué

| | Cajero | Encargado | Dueño |
|---|---|---|---|
| Buscar y aplicar fotos | no | sí | sí |
| Deshacer | no | sí | sí |
| Ver historial | no | sí | sí |
| Encender o apagar | no | no | sí |

## Costo y límites

- Open Food Facts y la base de la red no tienen costo ni tope.
- La búsqueda en internet (Serper) es paga: tope diario **por local** (30 por defecto; se cambia con `FOTOS_LIMITE_DIARIO`, de 1 a 1000). Al llegar al tope se avisa y las otras fuentes siguen andando. Las consultas se cuentan en `fotos_uso` (solo lectura desde el servidor), para medir el gasto real antes de decidir si vale la pena.
- Sin `SERPER_API_KEY`, la búsqueda en internet simplemente no se usa.

## Variables de entorno (Vercel)

- `SERPER_API_KEY` (opcional): clave de https://serper.dev. Sin ella solo se usan la base de la red y Open Food Facts.
- `FOTOS_LIMITE_DIARIO` (opcional): tope diario por local de la fuente paga.

## Completar las fotos que faltan (lote)

En Productos, arriba del catálogo, aparece "Fotos que faltan (N)" cuando el interruptor está encendido y hay productos sin foto.

- **Tandas de 25.** "Buscar fotos para los que faltan" revisa de a 25 productos (los disponibles primero, por nombre) y después se pide "la siguiente tanda". Se puede parar en cualquier momento.
- **Solo fuentes gratuitas:** la base de la red y Open Food Facts. En lote no se usa la búsqueda en internet (Serper), porque es paga y exige confirmar derechos producto por producto. El servidor lo garantiza con `solo_gratis` en `/api/fotos/sugerir`.
- **Nunca aplica sola.** Cada fila muestra la foto propuesta junto al nombre del producto y arranca sin tildar. "Tildar las que coinciden por código" marca las de productos con código de barras (coincidencia exacta); las encontradas por nombre dicen que hay que revisarlas. "Usar N fotos tildadas" las guarda una por una con el mismo camino de siempre (`foto_aplicar`), así quedan en el historial.
- Las fotos aplicadas en lote no tienen botón de deshacer en pantalla (el de a uno solo aparece justo después de aplicar); si una quedó mal, se cambia desde el producto.
- Quién puede: encargado y dueño, igual que el modo de a uno. Sin interruptor, no aparece.
- Código: `lib/fotos-lote.ts` (lógica pura, con prueba), `components/FotosLote.tsx`, `aplicarFotoGratuita` en `lib/fotos-cliente.ts`.

## Limpieza de fotos viejas

Migración `0035_fotos_limpieza.sql` y cron semanal `/api/cron/fotos-limpieza` (lunes 06:40 UTC, ver `vercel.json`).

- Borra del bucket la foto que se reemplazó hace más de 30 días (o la foto que se deshizo, si su baja había fallado). Cambia el plazo con `FOTOS_RETENCION_DIAS` (de 7 a 365).
- **Nunca borra una foto que un producto use hoy**, ni una que otra aplicación reciente todavía pueda restaurar. Solo borra dentro de la carpeta del propio local.
- Cada fila del historial se marca como `limpiada_at` y no se vuelve a revisar. El historial se conserva; solo se borran los archivos.
- Pasado el plazo, `foto_deshacer` responde `foto_vencida` en vez de volver a un archivo que ya no existe. En la app, "Deshacer el cambio" solo aparece justo después de aplicar, así que en la práctica no cambia nada para el local.
- Se autoriza con `CRON_SECRET`, igual que los otros crons. Devuelve cuántos archivos borró.
- Si un borrado falla, esa fila no se marca y se reintenta la semana siguiente.

## Seguridad de la descarga

`/api/fotos/descargar` pide una URL ajena, así que se defiende en capas (código en `lib/fotos-descarga.ts` y `lib/fotos-sugerencias.ts`):

- Exige sesión de encargado o dueño y el interruptor encendido.
- Solo `https` a un nombre de dominio: nada de IPs, `localhost`, usuario/contraseña ni puertos raros.
- **La IP se valida en el momento de conectar** (`lookup` propio de la conexión): si el nombre resuelve a una red interna, loopback o reservada (IPv4 o IPv6), o a ninguna dirección, la conexión se corta antes de enviar nada. No hay intervalo entre validar y conectar, así que el DNS rebinding no funciona.
- Sigue como máximo 3 redirecciones, revisando cada una con las mismas reglas.
- Acepta solo JPEG, PNG y WebP (no SVG), con tope de 8 segundos y 5 MB.

Pendiente de probar en preview: la descarga exitosa de una foto real (en el contenedor de desarrollo no hay red, así que solo se probaron con sockets los rechazos).

## Decisiones que tomé por vos

- **Sugerir, no aplicar solo.** Una foto equivocada en la tienda pública es peor que no tener foto.
- **Confirmación de derechos solo para fotos de internet.** Open Food Facts es de licencia abierta; las de la base de la red las cargaron otros locales.
- **La foto anterior no se borra al aplicar una nueva**, para poder deshacer. Pasados 30 días, la limpieza automática (ver abajo) borra el archivo.
- **Serper como fuente paga**, por ser barata y simple. Se cambia tocando solo `leerSerper` y la llamada en `/api/fotos/sugerir`.
- **Completar en lote, de a tandas y con revisión.** Ver la sección siguiente. El modo de a uno sigue igual para la búsqueda en internet.

## Despliegue

1. Backup.
2. Aplicar `0034_fotos_auto.sql` en el SQL Editor (después de la 0033), y luego `0035_fotos_limpieza.sql`, antes de subir el código.
3. Cargar `SERPER_API_KEY` en Vercel si se quiere la búsqueda en internet.
4. Subir el código y probar en preview.
5. Dejar el interruptor apagado hasta probar con un piloto.

## Checklist de aceptación

- [ ] Con el interruptor apagado, Productos se ve igual que antes.
- [ ] Un cajero no ve el botón ni puede llamar a `/api/fotos/*` (responde 401).
- [ ] Un producto con código de barras conocido muestra al menos una sugerencia de Open Food Facts.
- [ ] Una foto de internet no se puede usar sin tildar la confirmación.
- [ ] Al usar una foto, aparece en el catálogo y en la tienda pública.
- [ ] "Deshacer el cambio" devuelve la foto anterior (o deja el producto sin foto si no había).
- [ ] Con el tope en 1, la segunda búsqueda en internet del día avisa y no falla.
- [ ] En el celular, las miniaturas se tocan cómodo y el texto se lee.
- [ ] Lote: con 30 productos sin foto, la primera tanda revisa 25 y la siguiente los 5 restantes.
- [ ] Lote: nada queda tildado al principio; "Usar fotos tildadas" las pone en el catálogo y en la tienda pública, y desaparecen de la lista de faltantes.
- [ ] Lote: un cajero no ve la sección ni puede llamar a `/api/fotos/sugerir` (401).
- [ ] Lote: no se ven sugerencias con la etiqueta de internet (Serper), aunque haya `SERPER_API_KEY`.
- [ ] Limpieza: abrir `/api/cron/fotos-limpieza` con `Authorization: Bearer <CRON_SECRET>` responde 200 con `borrados: 0` si no hay nada vencido, y 401 sin el secreto.
- [ ] Limpieza: con una fila de prueba de más de 30 días en `fotos_historial`, el archivo viejo desaparece del bucket y la foto actual del producto sigue visible.
