-- 0063: la Caja avisa si el producto que se vende vence pronto o ya venció.
-- lotes_stock solo lo lee el dueño; cajero y encargado necesitan este dato sin ver el resto.
-- Solo lectura. Sin DROP. No toca precios ni stock.
create or replace function public.pos_vencimientos(p_kiosco uuid)
returns table (producto_id uuid, vence date, cantidad int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['cajero', 'encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  return query
    select distinct on (lo.producto_id) lo.producto_id, lo.vence, lo.cantidad
      from public.lotes_stock lo
     where lo.kiosco_id = p_kiosco and lo.activo and lo.cantidad > 0
     order by lo.producto_id, lo.vence asc, lo.created_at asc;
end $$;
revoke all on function public.pos_vencimientos(uuid) from public, anon;
grant execute on function public.pos_vencimientos(uuid) to authenticated;
