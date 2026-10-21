-- 0062: endurece lo creado en 0061, igual que 0046/0047 con el resto.
--  * venta_lotes_consumo: solo lectura para authenticated (TRUNCATE no pasa por RLS).
--  * Las funciones de trigger no se llaman desde la app.
-- Idempotente y sin DROP. No cambia el comportamiento de ventas, anulaciones ni devoluciones.
revoke all on public.venta_lotes_consumo from anon, authenticated;
grant select on public.venta_lotes_consumo to authenticated;
revoke execute on function public.lotes_consumir_venta_item() from public, anon, authenticated;
revoke execute on function public.lotes_reponer_por_anulacion() from public, anon, authenticated;
revoke execute on function public.lotes_reponer_por_devolucion() from public, anon, authenticated;
