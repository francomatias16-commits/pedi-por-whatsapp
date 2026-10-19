-- 0040 · "Clientes que dejaron de venir" también cuenta al club y a la tienda.
-- Hasta la 0039 la lista solo miraba ventas del mostrador con cliente cargado; un cliente del club que suma su sello con un toque
-- (sin venta cargada en la caja) nunca aparecía. Misma firma y mismas columnas que la 0025: la app no cambia de llamada.
-- Una "compra" es: una venta de caja con cliente (no anulada), un pedido de la tienda (no cancelado) o un toque del club (no rechazado).
-- Aplicar DESPUÉS de 0039. Sin DROP.

create or replace function public.clientes_en_fuga(p_kiosco uuid, p_dias_sin_comprar int default 45, p_min_compras int default 3)
returns table (cliente_id uuid, nombre text, telefono text, compras int, ultima_compra timestamptz, dias_sin_comprar int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_dias_sin_comprar is null or p_dias_sin_comprar < 7 or p_dias_sin_comprar > 365 then raise exception 'dias_invalidos'; end if;
  if p_min_compras is null or p_min_compras < 1 or p_min_compras > 100 then raise exception 'minimo_compras_invalido'; end if;
  return query
    select c.id, c.nombre, c.telefono, v.compras, v.ultima,
           (extract(day from now() - v.ultima))::int
      from (select e.cid, count(*)::int as compras, max(e.cuando) as ultima
              from (
                select vm.cliente_id as cid, vm.created_at as cuando
                  from public.ventas_mostrador vm
                 where vm.kiosco_id = p_kiosco and vm.cliente_id is not null and not vm.anulada
                union all
                select pe.cliente_id, pe.created_at
                  from public.pedidos pe
                 where pe.kiosco_id = p_kiosco and pe.cliente_id is not null and pe.estado <> 'cancelado'
                union all
                select s.cliente_id, min(s.created_at)
                  from public.sellos s
                 where s.kiosco_id = p_kiosco and s.origen = 'club' and not s.anulado and s.cantidad > 0
                 group by s.club_evento, s.cliente_id
              ) e
             where e.cuando >= now() - interval '1 year'
             group by e.cid) v
      join public.clientes c on c.id = v.cid and c.kiosco_id = p_kiosco
     where v.compras >= p_min_compras
       and v.ultima < now() - make_interval(days => p_dias_sin_comprar)
     order by v.ultima asc;
end $$;
revoke all on function public.clientes_en_fuga(uuid, int, int) from public, anon;
grant execute on function public.clientes_en_fuga(uuid, int, int) to authenticated;
