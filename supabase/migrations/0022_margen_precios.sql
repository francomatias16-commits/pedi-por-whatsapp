-- Etapa 19 · Costo, margen y sugerencia de precio por costo (Fase 2.5 del plan).
--  * Precio sugerido = costo / (1 − margen objetivo). El margen es sobre el precio de venta.
--  * Solo SUBE precios: los productos que ya tienen margen igual o mayor al objetivo no se tocan.
--  * El ajuste queda en el historial de precios y se deshace con revertir_ajuste, igual que los de porcentaje.
--  * Productos sin costo cargado no entran.
-- Aplicar DESPUÉS de 0001..0021.

alter table public.ajustes_precios add column tipo text not null default 'porcentaje' check (tipo in ('porcentaje', 'margen'));

create or replace function public.precio_por_margen(p_costo numeric, p_margen numeric, p_red int) returns numeric
language sql immutable as $$
  select case when p_red > 0 then ceil(p_costo / (1 - p_margen / 100) / p_red) * p_red
              else round(p_costo / (1 - p_margen / 100), 2) end
$$;

create or replace function public.previsualizar_margen(p_kiosco uuid, p_margen numeric, p_categoria text, p_redondeo int)
returns table (producto_id uuid, nombre text, categoria text, costo numeric, precio_anterior numeric, precio_nuevo numeric, margen_actual numeric)
language sql stable security invoker set search_path = public as $$
  select p.id, p.nombre, p.categoria, p.costo, p.precio,
         public.precio_por_margen(p.costo, p_margen, p_redondeo),
         round((p.precio - p.costo) / nullif(p.precio, 0) * 100, 1)
  from public.productos p
  where p.kiosco_id = p_kiosco and public.es_dueno(p_kiosco)
    and p.costo is not null and p.costo > 0
    and (p_categoria is null or p.categoria = p_categoria)
    and public.precio_por_margen(p.costo, p_margen, p_redondeo) > p.precio
  order by p.categoria, p.nombre
$$;

create or replace function public.ajustar_precios_por_margen(p_kiosco uuid, p_margen numeric, p_categoria text, p_redondeo int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_margen is null or p_margen < 1 or p_margen > 95 then raise exception 'margen_invalido'; end if;
  if p_redondeo not in (0, 1, 10, 50, 100) then raise exception 'redondeo_invalido'; end if;

  insert into public.ajustes_precios (kiosco_id, porcentaje, categoria, redondeo, tipo)
  values (p_kiosco, p_margen, p_categoria, p_redondeo, 'margen') returning id into v_id;

  with cambios as (
    select p.id, p.precio, public.precio_por_margen(p.costo, p_margen, p_redondeo) as nuevo
    from public.productos p
    where p.kiosco_id = p_kiosco and p.costo is not null and p.costo > 0
      and (p_categoria is null or p.categoria = p_categoria)
      and public.precio_por_margen(p.costo, p_margen, p_redondeo) > p.precio
  ), hist as (
    insert into public.historial_precios (ajuste_id, kiosco_id, producto_id, precio_anterior, precio_nuevo)
    select v_id, p_kiosco, c.id, c.precio, c.nuevo from cambios c
    returning producto_id, precio_nuevo
  )
  update public.productos p set precio = hist.precio_nuevo from hist where p.id = hist.producto_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'sin_cambios'; end if;

  update public.ajustes_precios set cantidad = v_n where id = v_id;
  return jsonb_build_object('ajuste_id', v_id, 'cantidad', v_n);
end $$;

-- Función pura (no lee tablas): la usan las vistas previas con permisos de dueño.
revoke all on function public.precio_por_margen(numeric, numeric, int) from public, anon;
grant execute on function public.precio_por_margen(numeric, numeric, int) to authenticated;
revoke all on function public.previsualizar_margen(uuid, numeric, text, int) from public, anon;
revoke all on function public.ajustar_precios_por_margen(uuid, numeric, text, int) from public, anon;
grant execute on function public.previsualizar_margen(uuid, numeric, text, int), public.ajustar_precios_por_margen(uuid, numeric, text, int) to authenticated;
