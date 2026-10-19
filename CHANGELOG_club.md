# Club de clientes (migración 0039)

El cliente escanea el QR del mostrador una sola vez, recibe su tarjeta (instalable en el celular) y después de cada compra
toca "Sumar mi compra". Al kiosquero le llega un aviso por cada sello y puede rechazarlo; si no hace nada, el sello queda firme.

- Base: `0039_club.sql` (clientes.club_token, kioscos.club_*, sellos.origen 'club', funciones club_*). Sin aplicar en producción.
- Público: `/[slug]/club` (alta), `/tarjeta/[token]` (tarjeta + manifest propio), `/api/club/unirse` y `/api/club/sumar` (suman y avisan por push).
- Panel: Puntos → pestaña **Club** (sellos de las últimas 24 h con Rechazar/Deshacer, premio simple, QR y cartel, avisos, límites).
  Clientes → "Mandar tarjeta del club" (reenvía el link por WhatsApp y invalida el anterior).
- Límites opcionales (segundo plano): sellos por día (1 por defecto), espera entre sellos, horario, pausar el club.
  Las campañas activas (sellos dobles, bienvenida, topes) se aplican igual que en el mostrador.
- Seguridad: anon solo ejecuta club_datos/club_unirse/club_tarjeta/club_sumar; un teléfono ya registrado no devuelve la tarjeta.
- Pruebas: `npm run test:club` (lógica y chequeos estáticos). La base se validó aparte en Postgres (47 chequeos de roles y reglas).
