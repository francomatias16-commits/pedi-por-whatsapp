# Club · paso 1: el cliente indica cómo pagó (0043)

## Lógica
- **Efectivo**: el sello suma al instante. Sin comprobante posible, el control es el tope de 1 por día (ya existente).
- **Transferencia / Mercado Pago**: el sello suma, queda "por verificar" y el kiosquero recibe un aviso distinto ("Verificá: Marta dice que pagó por transferencia"). Mira el comprobante y toca Confirmar, o Rechazar.
- El tope por día, la espera y el horario valen para los tres medios.

## Archivos
`supabase/migrations/0043_club_medio_pago.sql` (sin DROP), `lib/club.ts`, `lib/errores.ts`, `app/api/club/sumar/route.ts`, `app/api/club/_comun.ts`, `components/ClubTarjeta.tsx`, `components/sellos/Club.tsx`, `tests/club.test.mjs`, `supabase/tests/club_test.py`.

## Compatibilidad
`club_sumar(text)` sigue existiendo y cuenta como efectivo (tarjetas abiertas antes del cambio).

## Para aplicar
Aplicar la 0043 DESPUÉS de la 0042.
