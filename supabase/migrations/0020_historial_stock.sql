-- Etapa 17 · Historial completo de stock (Fase 2.1 del plan).
--  * Ventas del mostrador, anulaciones, devoluciones y pedidos (confirmar/entregar y cancelar) quedan en stock_movimientos.
--  * Un único trigger sobre productos.stock registra el movimiento: el tipo viene de app.mov_tipo, que fijan las
--    funciones que cambian stock. Las compras, anulaciones de compra, ajustes y cargas rápidas siguen escribiendo
--    su propia fila (no fijan app.mov_tipo), así que no hay duplicados.
--  * Las funciones de abajo son las versiones vigentes (0013 y 0009) con una sola línea agregada.
-- Aplicar DESPUÉS de 0001..0019.

-- 1) Nuevos tipos de movimiento.
alter table public.stock_movimientos drop constraint stock_movimientos_tipo_check;
alter table public.stock_movimientos add constraint stock_movimientos_tipo_check check (tipo in (
  'compra', 'anulacion_compra', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'pedido', 'cancelacion_pedido'));

-- 2) Trigger único: cualquier cambio de stock con tipo fijado queda registrado (delta y saldo resultante).
create or replace function public.stock_registrar_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo text := nullif(current_setting('app.mov_tipo', true), '');
begin
  if v_tipo is null or new.stock = old.stock or not new.stock_controlado then return new; end if;
  insert into public.stock_movimientos (kiosco_id, producto_id, tipo, cantidad, stock_resultante, motivo)
    values (new.kiosco_id, new.id, v_tipo, new.stock - old.stock, new.stock, null);
  return new;
end $$;
revoke execute on function public.stock_registrar_movimiento() from public, anon, authenticated;

create trigger productos_stock_movimiento after update of stock on public.productos
  for each row execute function public.stock_registrar_movimiento();

-- 3) Funciones que cambian stock, con su tipo de movimiento.

-- Trigger de pedidos (0009) con tipo de movimiento.
create or replace function public.stock_al_consumir() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_consume_old boolean := old.estado in ('confirmado', 'entregado');
  v_consume_new boolean := new.estado in ('confirmado', 'entregado');
  it record;
begin
  if v_consume_old = v_consume_new then return new; end if;
  perform set_config('app.mov_tipo', case when v_consume_new then 'pedido' else 'cancelacion_pedido' end, true);
  for it in
    select producto_id, sum(cantidad)::int as cant from public.pedido_items
    where pedido_id = new.id and producto_id is not null group by producto_id
  loop
    if v_consume_new then
      if exists (select 1 from public.productos p where p.id = it.producto_id and p.stock_controlado and p.stock < it.cant) then
        raise exception 'sin_stock';
      end if;
      update public.productos
        set stock = stock - it.cant,
            disponible = case when stock - it.cant = 0 then false else disponible end
        where id = it.producto_id and stock_controlado;
    else
      update public.productos set stock = stock + it.cant
        where id = it.producto_id and stock_controlado;
    end if;
  end loop;
  return new;
end $$;

-- Venta del mostrador (0013).
create or replace function public.registrar_venta_mostrador(
  p_turno uuid, p_items jsonb, p_pagos jsonb, p_cliente uuid default null, p_descuento_pct numeric default 0,
  p_offline_id uuid default null, p_fecha timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype;
  v_prod public.productos%rowtype;
  v_item jsonb; v_pago jsonb; v_ex public.ventas_mostrador%rowtype;
  v_cant int; v_monto numeric(12,2); v_medio text; v_lpct numeric(5,2);
  v_bruto numeric(12,2); v_promo numeric(12,2); v_promo_id uuid; v_man numeric(12,2); v_linea numeric(12,2);
  v_sum_bruto numeric(12,2) := 0; v_sum_promo numeric(12,2) := 0; v_sum_man numeric(12,2) := 0; v_sum_linea numeric(12,2) := 0;
  v_desc_g numeric(12,2); v_asig numeric(12,2); v_resto numeric(12,2); v_total numeric(12,2); v_desc_tot numeric(12,2);
  v_pct numeric(5,2); v_pagado numeric(12,2) := 0; v_no_efectivo numeric(12,2) := 0; v_cc numeric(12,2) := 0;
  v_vuelto numeric(12,2); v_venta uuid; v_numero bigint; v_seq int := 0; v_n int; v_fecha timestamptz;
  r record;
begin
  -- Historial de stock (0020): el trigger de productos registra el movimiento con este tipo.
  perform set_config('app.mov_tipo', 'venta', true);
  select * into v_t from public.turnos_caja where id = p_turno for update;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;

  -- Reenvío de una venta offline ya registrada: se devuelve la misma, sin duplicar nada.
  if p_offline_id is not null then
    select * into v_ex from public.ventas_mostrador where kiosco_id = v_t.kiosco_id and offline_id = p_offline_id;
    if found then
      return jsonb_build_object('venta_id', v_ex.id, 'numero', v_ex.numero, 'subtotal', v_ex.subtotal,
        'descuento', v_ex.descuento, 'total', v_ex.total, 'vuelto', v_ex.vuelto, 'duplicada', true);
    end if;
  end if;

  if v_t.estado <> 'abierto' then raise exception 'turno_cerrado'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 or jsonb_array_length(p_pagos) > 5 then
    raise exception 'pagos_invalidos';
  end if;
  v_pct := round(coalesce(p_descuento_pct, 0), 2);
  if v_pct < 0 or v_pct > 100 then raise exception 'descuento_invalido'; end if;
  if p_cliente is not null and not exists (
    select 1 from public.clientes where id = p_cliente and kiosco_id = v_t.kiosco_id
  ) then raise exception 'cliente_no_encontrado'; end if;
  v_fecha := coalesce(p_fecha, clock_timestamp());
  if v_fecha > clock_timestamp() + interval '5 minutes' or v_fecha < clock_timestamp() - interval '30 days' then
    raise exception 'fecha_invalida';
  end if;

  insert into public.ventas_mostrador (kiosco_id, turno_id, total, cliente_id, offline_id, fecha_offline, created_at)
    values (v_t.kiosco_id, p_turno, 0, p_cliente, p_offline_id, case when p_offline_id is null then null else v_fecha end, v_fecha)
    returning id, numero into v_venta, v_numero;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_seq := v_seq + 1;
    select * into v_prod from public.productos
     where id = (v_item->>'producto_id')::uuid and kiosco_id = v_t.kiosco_id;
    if not found then raise exception 'producto_no_encontrado'; end if;
    v_cant := coalesce((v_item->>'cantidad')::int, 0);
    if v_cant < 1 or v_cant > (case when v_prod.vendido_por_peso then 99999 else 99 end) then
      raise exception 'cantidad_invalida';
    end if;
    v_lpct := round(coalesce((v_item->>'descuento_pct')::numeric, 0), 2);
    if v_lpct < 0 or v_lpct > 100 then raise exception 'descuento_invalido'; end if;

    if v_prod.stock_controlado then
      if v_prod.permite_sin_stock then
        update public.productos set stock = greatest(stock - v_cant, 0) where id = v_prod.id;
      else
        update public.productos
           set stock = stock - v_cant,
               disponible = case when stock - v_cant = 0 then false else disponible end
         where id = v_prod.id and stock >= v_cant;
        if not found then raise exception 'sin_stock'; end if;
      end if;
    end if;

    v_bruto := case when v_prod.vendido_por_peso then round(v_prod.precio * v_cant / 1000.0, 2)
                    else round(v_prod.precio * v_cant, 2) end;

    -- Mejor promoción vigente para el renglón (NxM solo en productos por unidad).
    select s.id, s.d into v_promo_id, v_promo from (
      select pr.id,
             case pr.tipo
               when 'pct' then round(v_bruto * pr.pct / 100, 2)
               else case when v_prod.vendido_por_peso then 0
                         else (v_cant / pr.lleva) * (pr.lleva - pr.paga) * v_prod.precio end
             end as d
        from public.pos_promos pr
       where pr.kiosco_id = v_t.kiosco_id and pr.activa
         and (pr.producto_id = v_prod.id or (pr.categoria is not null and pr.categoria = v_prod.categoria))
         and (pr.desde is null or pr.desde <= (v_fecha at time zone 'America/Argentina/Buenos_Aires')::date)
         and (pr.hasta is null or pr.hasta >= (v_fecha at time zone 'America/Argentina/Buenos_Aires')::date)
    ) s order by s.d desc, s.id limit 1;
    if v_promo is null or v_promo <= 0 then v_promo := 0; v_promo_id := null; end if;
    v_promo := least(v_promo, v_bruto);
    v_man := round((v_bruto - v_promo) * v_lpct / 100, 2);
    v_linea := v_bruto - v_promo - v_man;

    insert into public.ventas_mostrador_items
      (venta_id, producto_id, nombre, precio_unit, cantidad, seq, por_peso, descuento_pct, bruto, descuento_promo,
       descuento_linea, promo_id, neto)
      values (v_venta, v_prod.id, v_prod.nombre, v_prod.precio, v_cant, v_seq, v_prod.vendido_por_peso, v_lpct, v_bruto,
              v_promo, v_man, v_promo_id, v_linea);
    v_sum_bruto := v_sum_bruto + v_bruto; v_sum_promo := v_sum_promo + v_promo;
    v_sum_man := v_sum_man + v_man; v_sum_linea := v_sum_linea + v_linea;
  end loop;

  -- Descuento global: se prorratea entre renglones (el último absorbe el redondeo) para poder devolver con exactitud.
  v_desc_g := round(v_sum_linea * v_pct / 100, 2);
  if v_desc_g > 0 then
    v_resto := v_desc_g; v_n := v_seq; v_seq := 0;
    for r in select id, neto from public.ventas_mostrador_items where venta_id = v_venta order by seq loop
      v_seq := v_seq + 1;
      v_asig := case when v_seq = v_n then v_resto else round(v_desc_g * r.neto / v_sum_linea, 2) end;
      v_asig := least(v_asig, r.neto);
      update public.ventas_mostrador_items set neto = r.neto - v_asig where id = r.id;
      v_resto := v_resto - v_asig;
    end loop;
  end if;
  v_total := v_sum_linea - v_desc_g;
  v_desc_tot := v_sum_promo + v_sum_man + v_desc_g;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_medio := v_pago->>'medio';
    if v_medio is null or v_medio not in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'cuenta_corriente') then
      raise exception 'medio_pago_invalido';
    end if;
    v_monto := round(coalesce((v_pago->>'monto')::numeric, 0), 2);
    if v_monto <= 0 then raise exception 'monto_invalido'; end if;
    if v_medio = 'cuenta_corriente' then
      if p_cliente is null then raise exception 'cuenta_corriente_sin_cliente'; end if;
      v_cc := v_cc + v_monto;
    end if;
    insert into public.ventas_mostrador_pagos (venta_id, medio, monto) values (v_venta, v_medio, v_monto);
    v_pagado := v_pagado + v_monto;
    if v_medio <> 'efectivo' then v_no_efectivo := v_no_efectivo + v_monto; end if;
  end loop;

  if v_pagado < v_total then raise exception 'pago_insuficiente'; end if;
  if v_no_efectivo > v_total then raise exception 'pago_excede_total'; end if;
  v_vuelto := greatest(0, v_pagado - v_total);

  update public.ventas_mostrador
     set subtotal = v_sum_bruto, descuento = v_desc_tot, descuento_pct = v_pct, total = v_total, vuelto = v_vuelto,
         descuento_lineas = v_sum_man, descuento_promos = v_sum_promo
   where id = v_venta;

  if v_cc > 0 then
    insert into public.fiado_movimientos (kiosco_id, cliente_id, tipo, monto, nota)
      values (v_t.kiosco_id, p_cliente, 'fiado', v_cc, 'Venta mostrador #' || v_numero);
  end if;

  return jsonb_build_object('venta_id', v_venta, 'numero', v_numero, 'subtotal', v_sum_bruto,
    'descuento', v_desc_tot, 'total', v_total, 'vuelto', v_vuelto, 'duplicada', false);
end $$;

-- Anulación de venta (0013).
create or replace function public.anular_venta_mostrador(p_venta uuid, p_motivo text, p_token uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_v public.ventas_mostrador%rowtype;
  v_estado text; v_motivo text; v_cc numeric(12,2);
  it record;
begin
  -- Historial de stock (0020): el trigger de productos registra el movimiento con este tipo.
  perform set_config('app.mov_tipo', 'anulacion_venta', true);
  select * into v_v from public.ventas_mostrador where id = p_venta for update;
  if not found or not public.es_dueno(v_v.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_motivo := left(trim(coalesce(p_motivo, '')), 200);
  if length(v_motivo) < 3 then raise exception 'motivo_requerido'; end if;
  if v_v.anulada then raise exception 'ya_anulada'; end if;
  select estado into v_estado from public.turnos_caja where id = v_v.turno_id;
  if v_estado <> 'abierto' then raise exception 'turno_cerrado'; end if;
  if exists (select 1 from public.devoluciones_mostrador where venta_id = p_venta) then raise exception 'tiene_devoluciones'; end if;
  perform public.pos_exigir_pin(v_v.kiosco_id, 'anular', p_token);

  for it in select producto_id, cantidad from public.ventas_mostrador_items where venta_id = p_venta and producto_id is not null loop
    update public.productos
       set stock = stock + it.cantidad,
           disponible = case when stock + it.cantidad > 0 then true else disponible end
     where id = it.producto_id and stock_controlado;
  end loop;

  select coalesce(sum(monto), 0) into v_cc
    from public.ventas_mostrador_pagos where venta_id = p_venta and medio = 'cuenta_corriente';
  if v_cc > 0 and v_v.cliente_id is not null then
    insert into public.fiado_movimientos (kiosco_id, cliente_id, tipo, monto, nota)
      values (v_v.kiosco_id, v_v.cliente_id, 'pago', v_cc, 'Anulación venta mostrador #' || v_v.numero);
  end if;

  update public.ventas_mostrador
     set anulada = true, anulada_at = clock_timestamp(), anulada_motivo = v_motivo
   where id = p_venta;
  return jsonb_build_object('ok', true);
end $$;

-- Devolución (0013).
create or replace function public.devolver_venta_mostrador(
  p_venta uuid, p_items jsonb, p_medio text, p_motivo text, p_token uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_v public.ventas_mostrador%rowtype; v_t public.turnos_caja%rowtype;
  v_it public.ventas_mostrador_items%rowtype; v_x jsonb;
  v_motivo text; v_cant int; v_ya_cant int; v_ya_monto numeric(12,2); v_monto numeric(12,2);
  v_total numeric(12,2) := 0; v_dev uuid; v_numero bigint; v_repone boolean; v_disp numeric; v_cc_pagado numeric(12,2);
  v_detalle jsonb := '[]'::jsonb;
begin
  -- Historial de stock (0020): el trigger de productos registra el movimiento con este tipo.
  perform set_config('app.mov_tipo', 'devolucion', true);
  select * into v_v from public.ventas_mostrador where id = p_venta for update;
  if not found or not public.es_dueno(v_v.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_v.anulada then raise exception 'ya_anulada'; end if;
  v_motivo := left(trim(coalesce(p_motivo, '')), 200);
  if length(v_motivo) < 3 then raise exception 'motivo_requerido'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'cuenta_corriente') then
    raise exception 'medio_pago_invalido';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;
  select * into v_t from public.turnos_caja where kiosco_id = v_v.kiosco_id and estado = 'abierto' for update;
  if not found then raise exception 'sin_turno_abierto'; end if;
  perform public.pos_exigir_pin(v_v.kiosco_id, 'devolucion', p_token);
  if p_medio = 'cuenta_corriente' then
    if v_v.cliente_id is null then raise exception 'cuenta_corriente_sin_cliente'; end if;
    select coalesce(sum(monto), 0) into v_cc_pagado
      from public.ventas_mostrador_pagos where venta_id = p_venta and medio = 'cuenta_corriente';
    if v_cc_pagado = 0 then raise exception 'venta_sin_cuenta_corriente'; end if;
  end if;

  insert into public.devoluciones_mostrador (kiosco_id, venta_id, turno_id, total, medio, motivo)
    values (v_v.kiosco_id, p_venta, v_t.id, 0.01, p_medio, v_motivo)
    returning id, numero into v_dev, v_numero;

  for v_x in select * from jsonb_array_elements(p_items) loop
    select * into v_it from public.ventas_mostrador_items
     where id = (v_x->>'item_id')::uuid and venta_id = p_venta for update;
    if not found then raise exception 'item_no_encontrado'; end if;
    v_cant := coalesce((v_x->>'cantidad')::int, 0);
    if v_cant < 1 then raise exception 'cantidad_invalida'; end if;
    select coalesce(sum(cantidad), 0), coalesce(sum(monto), 0) into v_ya_cant, v_ya_monto
      from public.devoluciones_mostrador_items where item_id = v_it.id;
    if v_ya_cant + v_cant > v_it.cantidad then raise exception 'devolucion_excede_venta'; end if;
    -- Reembolso proporcional al neto efectivamente cobrado; la última parte absorbe el redondeo.
    v_monto := case when v_ya_cant + v_cant = v_it.cantidad then v_it.neto - v_ya_monto
                    else round(v_it.neto * v_cant / v_it.cantidad, 2) end;
    v_repone := coalesce((v_x->>'repone_stock')::boolean, true);
    insert into public.devoluciones_mostrador_items (devolucion_id, item_id, cantidad, monto, repone_stock)
      values (v_dev, v_it.id, v_cant, v_monto, v_repone);
    if v_repone and v_it.producto_id is not null then
      update public.productos
         set stock = stock + v_cant,
             disponible = case when stock + v_cant > 0 then true else disponible end
       where id = v_it.producto_id and stock_controlado;
    end if;
    v_total := v_total + v_monto;
    v_detalle := v_detalle || jsonb_build_object('item_id', v_it.id, 'cantidad', v_cant, 'monto', v_monto);
  end loop;

  if v_total <= 0 then raise exception 'monto_invalido'; end if;
  if p_medio = 'cuenta_corriente' and v_total > v_cc_pagado then raise exception 'devolucion_excede_cuenta_corriente'; end if;
  update public.devoluciones_mostrador set total = v_total where id = v_dev;

  if p_medio = 'efectivo' then
    v_disp := v_t.monto_inicial + public.caja_ventas_efectivo(v_t.id) + public.caja_neto_movimientos(v_t.id);
    if v_disp < 0 then raise exception 'efectivo_insuficiente'; end if;
  end if;
  if p_medio = 'cuenta_corriente' then
    insert into public.fiado_movimientos (kiosco_id, cliente_id, tipo, monto, nota)
      values (v_v.kiosco_id, v_v.cliente_id, 'pago', v_total, 'Devolución venta mostrador #' || v_v.numero);
  end if;
  return jsonb_build_object('devolucion_id', v_dev, 'numero', v_numero, 'total', v_total, 'items', v_detalle);
end $$;
