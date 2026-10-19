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
- **La foto anterior no se borra al aplicar una nueva**, para poder deshacer. Quedan archivos viejos en el bucket; si molesta el espacio, se puede agregar una limpieza de fotos con más de 30 días en el historial.
- **Serper como fuente paga**, por ser barata y simple. Se cambia tocando solo `leerSerper` y la llamada en `/api/fotos/sugerir`.
- **Una por una.** No hay modo "completar todas las fotos que faltan": queda para después si los pilotos lo piden.

## Despliegue

1. Backup.
2. Aplicar `0034_fotos_auto.sql` en el SQL Editor (después de la 0033), antes de subir el código.
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
