-- Etapa 16 · Motivos de ajuste de stock y reporte de mermas (Fase 2.2 y 2.3 del plan).
--  * Cada ajuste guarda un tipo de motivo: manual, merma, rotura, vencimiento o conteo_fisico.
--  * ajustar_stock sigue aceptando 3 argumentos (tipo 'manual' por defecto); el tipo es opcional.
--  * reporte_mermas: unidades y costo perdido por motivo y top de productos, valorizado a costo (productos.costo).
--    Pérdidas = merma + rotura + vencimiento. El conteo físico se informa aparte (no es pérdida en sí).
-- Aplicar DESPUÉS de 0001..0018.

-- 1) Tipo de motivo en el historial. Los movimientos anteriores quedan en null (se leen como 'manual').
alter table public.stock_movimientos
  add column motivo_tipo text check (motivo_tipo in ('manual', 'merma', 'rotura', 'vencimiento', 'conteo_fisico'));

-- 2) Ajuste con tipo. Se reemplaza la firma de 3 argumentos por una de 4 con default (evita dos candidatos para PostgREST).
drop function public.ajustar_stock(uuid, int, text);
create function public.ajustar_stock(p_producto uuid, p_nuevo int, p_motivo text, p_tipo text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_p public.productos%rowtype; v_m text := left(trim(coalesce(p_motivo, '')), 200);
begin
  select * into v_p from public.productos where id = p_producto for update;
  if not found or not public.es_dueno(v_p.kiosco_id) then raise exception 'no_autorizado'; end if;
  if not v_p.stock_controlado then raise exception 'stock_no_controlado'; end if;
  if p_nuevo is null or p_nuevo < 0 or p_nuevo > 99999999 then raise exception 'cantidad_invalida'; end if;
  if p_tipo is null or p_tipo not in ('manual', 'merma', 'rotura', 'vencimiento', 'conteo_fisico') then raise exception 'tipo_ajuste_invalido'; end if;
  if length(v_m) < 3 then raise exception 'motivo_requerido'; end if;
  if p_nuevo = v_p.stock then raise exception 'sin_cambios'; end if;
  update public.productos set stock = p_nuevo, disponible = case when p_nuevo = 0 then false else disponible end where id = p_producto;
  insert into public.stock_movimientos (kiosco_id, producto_id, tipo, cantidad, stock_resultante, motivo, motivo_tipo)
    values (v_p.kiosco_id, p_producto, 'ajuste', p_nuevo - v_p.stock, p_nuevo, v_m, p_tipo);
  return jsonb_build_object('stock', p_nuevo);
end $$;
revoke all on function public.ajustar_stock(uuid, int, text, text) from public, anon;
grant execute on function public.ajustar_stock(uuid, int, text, text) to authenticated;

-- 3) Reporte de mermas por período (lo ve solo el dueño).
create or replace function public.reporte_mermas(p_kiosco uuid, p_desde timestamptz, p_hasta timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_por jsonb; v_top jsonb; v_total numeric(14,2);
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  -- Costo por unidad; por peso el stock está en gramos y el costo es por kg.
  select coalesce(jsonb_agg(jsonb_build_object('motivo', g.motivo, 'unidades', g.unidades, 'costo', g.costo) order by g.costo desc), '[]')
    into v_por
    from (
      select coalesce(m.motivo_tipo, 'manual') as motivo, sum(-m.cantidad) as unidades,
             round(sum((-m.cantidad) * case when p.vendido_por_peso then coalesce(p.costo, 0) / 1000.0 else coalesce(p.costo, 0) end), 2) as costo
        from public.stock_movimientos m join public.productos p on p.id = m.producto_id
       where m.kiosco_id = p_kiosco and m.tipo = 'ajuste' and m.cantidad < 0
         and m.created_at >= p_desde and m.created_at < p_hasta
       group by 1) g;

  select coalesce(sum(g.costo), 0) into v_total
    from (
      select round(sum((-m.cantidad) * case when p.vendido_por_peso then coalesce(p.costo, 0) / 1000.0 else coalesce(p.costo, 0) end), 2) as costo
        from public.stock_movimientos m join public.productos p on p.id = m.producto_id
       where m.kiosco_id = p_kiosco and m.tipo = 'ajuste' and m.cantidad < 0
         and coalesce(m.motivo_tipo, 'manual') in ('merma', 'rotura', 'vencimiento')
         and m.created_at >= p_desde and m.created_at < p_hasta
       group by m.producto_id, p.vendido_por_peso) g;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', t.nombre, 'por_peso', t.por_peso, 'unidades', t.unidades, 'costo', t.costo) order by t.costo desc), '[]')
    into v_top
    from (
      select p.nombre, p.vendido_por_peso as por_peso, sum(-m.cantidad) as unidades,
             round(sum((-m.cantidad) * case when p.vendido_por_peso then coalesce(p.costo, 0) / 1000.0 else coalesce(p.costo, 0) end), 2) as costo
        from public.stock_movimientos m join public.productos p on p.id = m.producto_id
       where m.kiosco_id = p_kiosco and m.tipo = 'ajuste' and m.cantidad < 0
         and coalesce(m.motivo_tipo, 'manual') in ('merma', 'rotura', 'vencimiento')
         and m.created_at >= p_desde and m.created_at < p_hasta
       group by p.id, p.nombre, p.vendido_por_peso
       order by 4 desc
       limit 10) t;

  return jsonb_build_object('total_perdida', round(v_total, 2), 'por_motivo', v_por, 'top', v_top);
end $$;
revoke all on function public.reporte_mermas(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reporte_mermas(uuid, timestamptz, timestamptz) to authenticated;
