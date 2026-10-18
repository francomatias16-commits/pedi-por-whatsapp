# Etapa 8 — Ayuda y modo simple

`tsc` y `npm test` en verde (incluye la nueva prueba `test:modo`).

- **¿Cómo se usa?** en la barra superior: guía corta de la pantalla actual (`lib/guias.ts`) y botón "Hablar por WhatsApp" con el mensaje ya armado para esa pantalla.
- **Bienvenida:** recorrido de 4 pasos (Inicio, Pedidos, Productos, compartir la tienda). Sale una sola vez por kiosco en cada dispositivo. Se puede saltar o volver atrás.
- **Ver la bienvenida otra vez:** en Mi negocio, dentro de "Ayuda y modo".
- **Modo simple / completo:** por defecto **simple**. En simple se ocultan de las pestañas Radar (Alertas), Conteo, Carteles de precio, Proveedores y Puntos. Siguen accesibles por link y vuelven en modo completo. Si estás en una de esas pantallas, la pestaña se muestra igual.
- El modo se elige en Mi negocio y se guarda en el dispositivo (no en la base).

## Nota
- El modo se guarda en este celular o computadora. Si el kiosquero usa dos dispositivos, lo elige en cada uno. Para que sea del kiosco, hay que sumar una columna en la base (no se hizo, para no tocar migraciones en esta etapa).
