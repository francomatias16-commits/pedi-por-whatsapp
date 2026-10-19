-- 0051 · Promociones fase B: liquidar stock (productos que no salen).
-- Aplicar DESPUÉS de 0050. Sin DROP.
--  * promo_sin_rotacion: productos con stock controlado que no se vendieron en N días, con el capital parado.
--  * promo_liquidacion: una promoción de liquidación por producto (índice único). Tres formas:
--      descuento  -> una promoción de porcentaje en pos_promos (la caja ya la aplica al cobrar, sin tocar la venta);
--      regalo     -> un premio de producto en fidelidad_premios que cuesta N sellos;
--      dos_sellos -> una campaña 'dos_producto': llevar 2 o más del producto suma N sellos extra.
--  * Guardarraíles: stock, fecha de fin, una sola promoción por producto, margen mínimo (con confirmación), tope del mes.
--  * Apagado automático: al agotarse el stock (trigger sobre productos), al vencer la fecha o al llegar al tope (promo_apagado_auto).

create table public.promo_liquidacion (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  clave text not null references public.promo_catalogo(clave),
  tipo text not null check (tipo in ('regalo', 'descuento', 'dos_sellos')),
  producto_id uuid not null references public.productos(id) on delete cascade,
  valor numeric(12,2) not null check (valor > 0),
  desde date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  hasta date,
  activa boolean not null default true,
  premio_id uuid references public.fidelidad_premios(id) on delete set null,
  campana_id uuid references public.fidelidad_campanas(id) on delete set null,
  pos_promo_id uuid references public.pos_promos(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  pausada_at timestamptz,
  check (hasta is null or hasta >= desde)
);
create unique index promo_liquidacion_producto_activa on public.promo_liquidacion (kiosco_id, producto_id) where activa;
create index promo_liquidacion_kiosco on public.promo_liquidacion (kiosco_id) where activa;
alter table public.promo_liquidacion enable row level security;
revoke all on public.promo_liquidacion from anon, authenticated;

-- Interna: pausa una liquidación y deshace lo que armó. p_accion es lo que queda en el historial.
create or replace function public.promo_liquidacion_apagar(p_id uuid, p_accion text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.promo_liquidacion%rowtype; v_nombre text;
begin
  select * into l from public.promo_liquidacion where id = p_id and activa for update;
  if not found then return; end if;
  perform set_config('app.promo_silencio', 'on', true);
  update public.promo_liquidacion set activa = false, pausada_at = now() where id = l.id;
  if l.pos_promo_id is not null then update public.pos_promos set activa = false where id = l.pos_promo_id; end if;
  if l.premio_id is not null then update public.fidelidad_premios set activo = false where id = l.premio_id; end if;
  if l.campana_id is not null then update public.fidelidad_campanas set activa = false where id = l.campana_id; end if;
  perform set_config('app.promo_silencio', '', true);
  select nombre into v_nombre from public.productos where id = l.producto_id;
  perform public.promo_historial_registrar(l.kiosco_id, p_accion, 'promo_liquidacion', l.clave, v_nombre, jsonb_build_object('tipo', l.tipo, 'valor', l.valor));
end $$;

-- Productos parados: stock controlado, con unidades, sin ventas (mostrador ni pedidos entregados) en los últimos p_dias.
create or replace function public.promo_sin_rotacion(p_kiosco uuid, p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  if p_dias is null or p_dias < 7 or p_dias > 365 then raise exception 'promo_valor_invalido'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'producto_id', x.id, 'nombre', x.nombre, 'stock', x.stock, 'costo', x.costo, 'precio', x.precio,
      'margen_pct', case when x.costo is not null and x.precio > 0 then round((x.precio - x.costo) / x.precio * 100, 1) end,
      'dias_sin_venta', x.dias, 'capital', case when x.costo is not null then round(x.stock * x.costo, 2) end,
      'liquidacion', x.liq) order by x.stock * coalesce(x.costo, 0) desc, x.dias desc, x.nombre)
    from (
      select * from (
        select p.id, p.nombre, p.stock, p.costo, p.precio,
               floor(extract(epoch from (now() - coalesce(u.ultima, p.created_at))) / 86400)::int as dias,
               (select l.tipo from public.promo_liquidacion l where l.producto_id = p.id and l.activa) as liq
          from public.productos p
          left join lateral (
            select max(t.f) as ultima from (
              select v.created_at as f from public.ventas_mostrador_items i join public.ventas_mostrador v on v.id = i.venta_id where i.producto_id = p.id and not v.anulada
              union all
              select pe.entregado_at from public.pedido_items pi join public.pedidos pe on pe.id = pi.pedido_id where pi.producto_id = p.id and pe.entregado_at is not null) t) u on true
         where p.kiosco_id = p_kiosco and p.stock_controlado and p.stock > 0
      ) y where y.dias >= p_dias
      order by y.stock * coalesce(y.costo, 0) desc limit 50
    ) x), '[]'::jsonb);
end $$;

create or replace function public.promo_liquidaciones(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'clave', l.clave, 'tipo', l.tipo, 'producto_id', l.producto_id, 'producto', p.nombre, 'valor', l.valor, 'desde', l.desde, 'hasta', l.hasta) order by l.created_at)
    from public.promo_liquidacion l join public.productos p on p.id = l.producto_id where l.kiosco_id = p_kiosco and l.activa), '[]'::jsonb);
end $$;

-- Dueño: arma una liquidación para un producto.
create or replace function public.promo_liquidar_activar(p_kiosco uuid, p_clave text, p_producto uuid, p_valor numeric, p_hasta date default null, p_confirmar_margen boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k public.kioscos%rowtype; pd public.productos%rowtype; v_tipo text; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_margen numeric; v_final numeric; v_id uuid := gen_random_uuid(); v_premio uuid; v_camp uuid; v_pos uuid; v_costo jsonb;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  v_tipo := case p_clave when 'descuento_sin_movimiento' then 'descuento' when 'liquidar_sin_rotacion' then 'regalo' when 'llevá_dos_suma_mas' then 'dos_sellos' end;
  if v_tipo is null then raise exception 'promo_no_disponible'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'promo_valor_invalido'; end if;
  if v_tipo = 'descuento' and p_valor > 90 then raise exception 'promo_valor_invalido'; end if;
  if v_tipo = 'regalo' and (p_valor <> floor(p_valor) or p_valor > 1000) then raise exception 'promo_valor_invalido'; end if;
  if v_tipo = 'dos_sellos' and (p_valor <> floor(p_valor) or p_valor > 100) then raise exception 'promo_valor_invalido'; end if;

  select * into pd from public.productos where id = p_producto and kiosco_id = p_kiosco;
  if not found then raise exception 'producto_invalido'; end if;
  if not pd.stock_controlado or pd.stock <= 0 then raise exception 'promo_falta_stock'; end if;
  if p_hasta is not null and p_hasta < v_hoy then raise exception 'promo_fecha_invalida'; end if;

  -- Una sola promoción por producto: ni otra liquidación ni una promoción de la caja vigente.
  if exists (select 1 from public.promo_liquidacion where producto_id = p_producto and activa)
     or exists (select 1 from public.pos_promos pp where pp.producto_id = p_producto and pp.activa and (pp.hasta is null or pp.hasta >= v_hoy)) then
    raise exception 'promo_producto_duplicada';
  end if;

  v_costo := public.promo_costo_mes(p_kiosco);
  if (v_costo->>'supera')::boolean then raise exception 'promo_supera_tope'; end if;

  -- Margen: el descuento se mira sobre el precio ya rebajado; el regalo, sobre el margen del producto.
  select * into k from public.kioscos where id = p_kiosco;
  if pd.costo is not null and pd.precio > 0 and v_tipo <> 'dos_sellos' then
    v_final := case when v_tipo = 'descuento' then pd.precio * (1 - p_valor / 100) else pd.precio end;
    v_margen := case when v_final > 0 then round((v_final - pd.costo) / v_final * 100, 1) else -100 end;
    if v_margen < k.club_margen_minimo then
      if not coalesce(p_confirmar_margen, false) then raise exception 'promo_reduce_margen'; end if;
      perform public.promo_historial_registrar(p_kiosco, 'margen_confirmado', 'promo_liquidacion', p_clave, pd.nombre, jsonb_build_object('margen', v_margen, 'minimo', k.club_margen_minimo));
    end if;
  end if;

  perform set_config('app.promo_silencio', 'on', true);
  if v_tipo = 'descuento' then
    insert into public.pos_promos (kiosco_id, nombre, tipo, producto_id, pct, desde, hasta) values (p_kiosco, 'Liquidación: ' || left(pd.nombre, 60), 'pct', p_producto, p_valor, v_hoy, p_hasta) returning id into v_pos;
  elsif v_tipo = 'regalo' then
    insert into public.fidelidad_premios (kiosco_id, nombre, costo_sellos, tipo, producto_id) values (p_kiosco, left(pd.nombre, 80), p_valor::int, 'producto', p_producto) returning id into v_premio;
  else
    insert into public.fidelidad_campanas (kiosco_id, nombre, tipo, sellos, producto_id, hasta) values (p_kiosco, 'Llevá dos: ' || left(pd.nombre, 65), 'dos_producto', p_valor::int, p_producto, p_hasta) returning id into v_camp;
  end if;
  insert into public.promo_liquidacion (id, kiosco_id, clave, tipo, producto_id, valor, hasta, premio_id, campana_id, pos_promo_id)
    values (v_id, p_kiosco, p_clave, v_tipo, p_producto, p_valor, p_hasta, v_premio, v_camp, v_pos);
  perform set_config('app.promo_silencio', '', true);
  perform public.promo_historial_registrar(p_kiosco, 'activar', 'promo_liquidacion', p_clave, pd.nombre, jsonb_build_object('tipo', v_tipo, 'valor', p_valor, 'hasta', p_hasta));
  return jsonb_build_object('id', v_id, 'tipo', v_tipo, 'producto', pd.nombre);
end $$;

create or replace function public.promo_liquidar_pausar(p_kiosco uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if not exists (select 1 from public.promo_liquidacion where id = p_id and kiosco_id = p_kiosco and activa) then raise exception 'promo_no_disponible'; end if;
  perform public.promo_liquidacion_apagar(p_id, 'pausar');
  return jsonb_build_object('ok', true);
end $$;

-- Apagado automático por stock: cuando un producto llega a 0, se pausa su liquidación.
create or replace function public.promo_liquidacion_stock_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.promo_liquidacion where producto_id = new.id and activa loop
    perform public.promo_liquidacion_apagar(r.id, 'apagado_stock');
  end loop;
  return new;
end $$;
create trigger trg_promo_liquidacion_stock after update of stock on public.productos
  for each row when (new.stock <= 0 and old.stock > 0) execute function public.promo_liquidacion_stock_trg();

-- Apagado automático completo (reemplaza la de 0050): tope del mes, stock agotado y fecha de fin vencida.
create or replace function public.promo_apagado_auto(p_kiosco uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_m int; v_costo jsonb := public.promo_costo_mes(p_kiosco); r record; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if (v_costo->>'supera')::boolean then
    perform set_config('app.promo_motivo', 'apagado_tope', true);
    update public.fidelidad_campanas c set activa = false
     where c.kiosco_id = p_kiosco and c.activa and c.promo_clave in (select clave from public.promo_catalogo where automatica);
    get diagnostics v_m = row_count; v_n := v_n + v_m;
    perform set_config('app.promo_motivo', '', true);
  end if;
  for r in select l.id, (p.stock_controlado and p.stock <= 0) as sin_stock from public.promo_liquidacion l join public.productos p on p.id = l.producto_id
            where l.kiosco_id = p_kiosco and l.activa and ((p.stock_controlado and p.stock <= 0) or (l.hasta is not null and l.hasta < v_hoy)) loop
    perform public.promo_liquidacion_apagar(r.id, case when r.sin_stock then 'apagado_stock' else 'pausar' end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.promo_liquidacion_apagar(uuid, text) from public, anon, authenticated;
revoke all on function public.promo_liquidacion_stock_trg() from public, anon, authenticated;
revoke all on function public.promo_apagado_auto(uuid) from public, anon, authenticated;
revoke all on function public.promo_sin_rotacion(uuid, int) from public, anon;
grant execute on function public.promo_sin_rotacion(uuid, int) to authenticated;
revoke all on function public.promo_liquidaciones(uuid) from public, anon;
grant execute on function public.promo_liquidaciones(uuid) to authenticated;
revoke all on function public.promo_liquidar_activar(uuid, text, uuid, numeric, date, boolean) from public, anon;
grant execute on function public.promo_liquidar_activar(uuid, text, uuid, numeric, date, boolean) to authenticated;
revoke all on function public.promo_liquidar_pausar(uuid, uuid) from public, anon;
grant execute on function public.promo_liquidar_pausar(uuid, uuid) to authenticated;
