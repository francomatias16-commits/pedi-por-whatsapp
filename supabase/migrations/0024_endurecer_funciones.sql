-- Etapa 21 · Endurecimiento detectado por el linter de Supabase (sin cambios de comportamiento).
--  * search_path fijo en las 3 funciones auxiliares que lo tenían mutable.
--  * Las funciones de trigger de fidelidad no tienen por qué ser invocables por la API (RPC): se les quita EXECUTE.
--    Los triggers siguen funcionando: PostgreSQL no vuelve a chequear EXECUTE cuando el trigger se dispara.
--  * crear_pedido queda ejecutable por anon a propósito (es la tienda pública).
-- Aplicar DESPUÉS de 0001..0023. No tiene DROP.

alter function public.fidelidad_validar set search_path = public;
alter function public.fidelidad_aplica set search_path = public;
alter function public.precio_por_margen(numeric, numeric, int) set search_path = public;

revoke all on function public.fidelidad_inicial() from public, anon, authenticated;
revoke all on function public.fidelidad_venta() from public, anon, authenticated;
revoke all on function public.fidelidad_venta_anulada() from public, anon, authenticated;
