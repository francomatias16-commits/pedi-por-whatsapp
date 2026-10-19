-- 0038 · La tienda pública (rol anon) deja de ver owner_id y deja de poder escribir en kioscos.
-- Antes anon tenía SELECT, INSERT, UPDATE y REFERENCES sobre toda la tabla. Las escrituras ya las frenaba RLS
-- (no hay políticas de escritura para anon), pero ahora además no tiene el privilegio.
-- La lectura pública sigue igual para todas las demás columnas: la tienda las necesita.
-- Usuarios logueados (authenticated) no cambian: el dueño sigue leyendo su local y sus permisos de escritura por RLS.
-- IMPORTANTE para futuras migraciones: si se agrega una columna que la tienda pública necesita, hay que darle SELECT
-- a anon explícitamente (grant select (columna) on public.kioscos to anon). Una columna nueva NO es visible para anon por defecto.
-- Aplicar DESPUÉS de 0001..0037.

revoke all on public.kioscos from anon;
grant select (
  id, nombre, slug, whatsapp, direccion, acepta_envio, created_at, sellos_por_premio, premio, abierto,
  horario, pedido_minimo, costo_envio, medios_pago, horario_auto, horarios, sellos_vencen_dias,
  baja_solicitada_at, cobro_online_activo, cobro_qr_activo, seguimiento_activo, zonas_envio_activo,
  fotos_auto_activo, franjas_entrega_activo
) on public.kioscos to anon;
