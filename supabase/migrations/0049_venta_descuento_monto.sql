-- 0049 · Venta en mostrador: descuento en pesos exacto (premios de monto y de producto).
-- Antes el monto se convertía en porcentaje con 2 decimales y el descuento real podía diferir unos centavos.
-- Ahora se manda p_descuento_monto. Reemplaza la firma (PostgREST resuelve por nombres): el cliente viejo sin
-- p_descuento_monto sigue andando porque el parámetro tiene default null.
-- Regla: monto y porcentaje no se combinan (descuento_doble); el monto se topa en el subtotal.

drop function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric, uuid, timestamptz); -- drop-ok: cambia la firma para agregar p_descuento_monto

CREATE OR REPLACE FUNCTION public.registrar_venta_mostrador(p_turno uuid, p_items jsonb, p_pagos jsonb, p_cliente uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0, p_offline_id uuid DEFAULT NULL::uuid, p_fecha timestamp with time zone DEFAULT NULL::timestamp with time zone, p_descuento_monto numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.turnos_caja%rowtype;
  v_prod public.productos%rowtype;
  v_item jsonb; v_pago jsonb; v_ex public.ventas_mostrador%rowtype;
  v_cant int; v_monto numeric(12,2); v_medio text; v_lpct numeric(5,2);
  v_bruto numeric(12,2); v_promo numeric(12,2); v_promo_id uuid; v_man numeric(12,2); v_linea numeric(12,2);
  v_sum_bruto numeric(12,2) := 0; v_sum_promo numeric(12,2) := 0; v_sum_man numeric(12,2) := 0; v_sum_linea numeric(12,2) := 0;
  v_desc_g numeric(12,2); v_desc_monto numeric(12,2); v_asig numeric(12,2); v_resto numeric(12,2); v_total numeric(12,2); v_desc_tot numeric(12,2);
  v_pct numeric(5,2); v_pagado numeric(12,2) := 0; v_no_efectivo numeric(12,2) := 0; v_cc numeric(12,2) := 0;
  v_vuelto numeric(12,2); v_venta uuid; v_numero bigint; v_seq int := 0; v_n int; v_fecha timestamptz;
  r record;
begin
  -- Historial de stock (0020): el trigger de productos registra el movimiento con este tipo.
  perform set_config('app.mov_tipo', 'venta', true);
  select * into v_t from public.turnos_caja where id = p_turno for update;
  if not found or not public.es_miembro(v_t.kiosco_id, array['cajero','encargado','dueno']) then raise exception 'no_autorizado'; end if;

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
  -- Descuento en pesos (premio de monto o de producto): exacto, nunca mayor al subtotal. No se combina con el porcentaje.
  if p_descuento_monto is not null then
    if p_descuento_monto < 0 then raise exception 'descuento_invalido'; end if;
    if v_pct > 0 then raise exception 'descuento_doble'; end if;
    v_desc_monto := round(p_descuento_monto, 2);
  end if;
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
  if v_desc_monto is not null then
    v_desc_g := least(v_desc_monto, v_sum_linea);
  else
    v_desc_g := round(v_sum_linea * v_pct / 100, 2);
  end if;
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
end $function$;


revoke all on function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric, uuid, timestamptz, numeric) from public, anon;
grant execute on function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric, uuid, timestamptz, numeric) to authenticated;
