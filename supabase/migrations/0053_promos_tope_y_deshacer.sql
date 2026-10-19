-- 0053 · Descuento en % con tope en pesos (premios de fidelidad y niveles por etapas) y "Deshacer" de las etapas.
-- Aplicar DESPUÉS de 0052. Sin DROP.
--  * fidelidad_premios.tope_pesos: solo para premios de tipo 'pct'. El descuento no pasa de ese monto (el plan, sección 2).
--  * club_evaluar: el costo del descuento en % se topa en tope_pesos (así la rentabilidad y el semáforo lo ven).
--  * promo_etapas_guardar: el nivel de % acepta "tope" (opcional, mayor que cero).
--  * promo_etapas_quitar: saca todos los premios activos (es lo que "Deshacer" hace cuando no había niveles antes).

alter table public.fidelidad_premios add column tope_pesos numeric(12,2);
alter table public.fidelidad_premios add constraint fidelidad_premios_tope_check
  check (tope_pesos is null or (tope_pesos > 0 and tipo = 'pct'));

create or replace function public.club_evaluar(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  k public.kioscos%rowtype; v_ticket numeric; v_sellos_compra numeric; v_out jsonb := '[]'::jsonb;
  p public.fidelidad_premios%rowtype; v_costo numeric; v_precio numeric; v_margen numeric; v_compras int; v_gasto numeric; v_pct numeric; v_sem text; v_frase text; v_motivo text;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select * into k from public.kioscos where id = p_kiosco;

  -- Ticket promedio de los últimos 90 días: ventas de mostrador y pedidos entregados.
  select avg(t.total) into v_ticket from (
    select total from public.ventas_mostrador where kiosco_id = p_kiosco and not anulada and created_at > now() - interval '90 days'
    union all
    select total from public.pedidos where kiosco_id = p_kiosco and entregado_at is not null and entregado_at > now() - interval '90 days'
  ) t;

  -- Sellos que deja una compra promedio, según las campañas activas de compra (visita y monto).
  select coalesce(sum(case c.tipo
           when 'visita' then c.sellos
           when 'monto' then (coalesce(v_ticket, 0) / nullif(c.por_monto, 0)) * c.sellos
           else 0 end), 0) into v_sellos_compra
    from public.fidelidad_campanas c where c.kiosco_id = p_kiosco and c.activa and c.tipo in ('visita', 'monto');

  for p in select * from public.fidelidad_premios f where f.kiosco_id = p_kiosco and f.activo order by f.costo_sellos, f.created_at loop
    v_costo := null; v_precio := null; v_margen := null; v_motivo := null;
    if p.tipo = 'producto' then
      select pr.costo, pr.precio into v_costo, v_precio from public.productos pr where pr.id = p.producto_id;
    elsif p.tipo = 'pct' then
      v_costo := round(case when p.tope_pesos is null then coalesce(v_ticket, 0) * p.valor / 100 else least(coalesce(v_ticket, 0) * p.valor / 100, p.tope_pesos) end, 2);
    elsif p.tipo = 'monto' then
      v_costo := p.valor;
    end if;

    -- Margen del producto que se regala: no puede caer por debajo del piso del kiosquero.
    if p.tipo = 'producto' and v_precio is not null and v_precio > 0 and v_costo is not null then
      v_margen := round((v_precio - v_costo) / v_precio * 100, 1);
    end if;

    -- El margen no depende de las ventas: si el producto ya deja poco margen, se marca aunque no haya historial.
    if v_margen is not null and v_margen < k.club_margen_minimo then
      v_sem := 'reduce_margen';
      v_motivo := format('Deja un margen de %s%%, por debajo del mínimo de %s%%.', v_margen, k.club_margen_minimo);
      v_compras := null; v_gasto := null; v_pct := null;
    elsif v_sellos_compra <= 0 or v_ticket is null then
      v_sem := 'sin_datos';
      v_motivo := 'Todavía no hay compras suficientes para calcular.';
      v_compras := null; v_gasto := null; v_pct := null;
    else
      v_compras := ceil(p.costo_sellos / v_sellos_compra)::int;
      v_gasto := v_compras * v_ticket;
      if v_costo is null then
        v_sem := 'sin_datos';
        v_motivo := 'Falta el costo del producto o el valor del descuento.';
        v_pct := null;
      else
        v_pct := round(v_costo / nullif(v_gasto, 0) * 100, 1);
        if v_pct <= 10 then v_sem := 'conviene';
        elsif v_pct <= 25 then v_sem := 'ajustado';
        else v_sem := 'pierde_plata';
        end if;
      end if;
    end if;

    v_frase := case v_sem
      when 'sin_datos' then v_motivo
      when 'reduce_margen' then v_motivo
      else format('Le cuesta al local $%s. Llegar a él lleva unas %s compras de $%s en promedio. %s.',
                  round(v_costo), v_compras, round(v_ticket),
                  case v_sem when 'conviene' then 'Conviene' when 'ajustado' then 'Está ajustado' else 'Pierde plata' end)
    end;

    v_out := v_out || jsonb_build_object(
      'premio_id', p.id, 'nombre', p.nombre, 'tipo', p.tipo, 'costo_sellos', p.costo_sellos,
      'costo_local', round(v_costo, 2), 'margen_pct', v_margen, 'compras_para_llegar', v_compras,
      'gasto_para_llegar', round(v_gasto, 2), 'pct_del_gasto', v_pct, 'semaforo', v_sem, 'frase', v_frase);
  end loop;

  return jsonb_build_object('ticket_promedio', round(v_ticket, 2), 'sellos_por_compra', round(v_sellos_compra, 2),
    'margen_minimo', k.club_margen_minimo, 'tope_promos_pct', k.club_tope_promos_pct, 'premios', v_out);
end $$;

create or replace function public.promo_etapas_guardar(p_kiosco uuid, p_niveles jsonb, p_confirmar_margen boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.kioscos%rowtype; v_n int; i int; n jsonb; v_prev int := 0; v_sellos int; v_tipo text; v_prod uuid; v_val numeric; pd public.productos%rowtype; v_margen numeric; v_baja boolean := false;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_niveles is null or jsonb_typeof(p_niveles) <> 'array' then raise exception 'promo_etapas_invalidas'; end if;
  v_n := jsonb_array_length(p_niveles);
  if v_n < 2 or v_n > 6 then raise exception 'promo_etapas_cantidad'; end if;
  select * into k from public.kioscos where id = p_kiosco;

  -- Primero se valida todo; recién después se toca la base.
  for i in 0..v_n - 1 loop
    n := p_niveles->i;
    if jsonb_typeof(n) <> 'object' or length(trim(coalesce(n->>'nombre', ''))) not between 1 and 80 then raise exception 'promo_etapas_invalidas'; end if;
    begin v_sellos := (n->>'costo_sellos')::int; exception when others then raise exception 'promo_etapas_invalidas'; end;
    if v_sellos is null or v_sellos < 1 or v_sellos > 1000 or v_sellos <= v_prev then raise exception 'promo_etapas_invalidas'; end if;
    v_prev := v_sellos;
    v_tipo := n->>'tipo';
    if v_tipo is null or v_tipo not in ('libre', 'producto', 'pct', 'monto') then raise exception 'promo_etapas_invalidas'; end if;
    if v_tipo = 'producto' then
      begin v_prod := (n->>'producto_id')::uuid; exception when others then raise exception 'promo_etapas_invalidas'; end;
      select * into pd from public.productos where id = v_prod and kiosco_id = p_kiosco;
      if not found then raise exception 'producto_invalido'; end if;
      if pd.stock_controlado and pd.stock <= 0 then raise exception 'promo_falta_stock'; end if;
      if pd.costo is not null and pd.precio > 0 then
        v_margen := round((pd.precio - pd.costo) / pd.precio * 100, 1);
        if v_margen < k.club_margen_minimo then v_baja := true; end if;
      end if;
    elsif v_tipo in ('pct', 'monto') then
      begin v_val := (n->>'valor')::numeric; exception when others then raise exception 'promo_etapas_invalidas'; end;
      if v_val is null or v_val <= 0 or (v_tipo = 'pct' and v_val > 100) then raise exception 'promo_etapas_invalidas'; end if;
      if v_tipo = 'pct' and coalesce(n->>'tope', '') <> '' then
        if (n->>'tope') !~ '^[0-9]+(\.[0-9]+)?$' or (n->>'tope')::numeric <= 0 then raise exception 'promo_etapas_invalidas'; end if;
      end if;
    end if;
  end loop;
  if v_baja then
    if not coalesce(p_confirmar_margen, false) then raise exception 'promo_reduce_margen'; end if;
    perform public.promo_historial_registrar(p_kiosco, 'margen_confirmado', 'fidelidad_premios', 'premio_por_etapas', 'Premios por etapas');
  end if;

  perform set_config('app.promo_silencio', 'on', true);
  update public.promo_liquidacion set activa = false, pausada_at = now() where kiosco_id = p_kiosco and activa and tipo = 'regalo';
  update public.fidelidad_premios set activo = false where kiosco_id = p_kiosco and activo;
  for i in 0..v_n - 1 loop
    n := p_niveles->i; v_tipo := n->>'tipo';
    insert into public.fidelidad_premios (kiosco_id, nombre, costo_sellos, tipo, producto_id, valor, tope_pesos)
      values (p_kiosco, trim(n->>'nombre'), (n->>'costo_sellos')::int, v_tipo,
              case when v_tipo = 'producto' then (n->>'producto_id')::uuid end,
              case when v_tipo in ('pct', 'monto') then (n->>'valor')::numeric end,
              case when v_tipo = 'pct' and coalesce(n->>'tope', '') <> '' then (n->>'tope')::numeric end);
  end loop;
  perform set_config('app.promo_silencio', '', true);
  perform public.promo_historial_registrar(p_kiosco, 'cambio', 'fidelidad_premios', 'premio_por_etapas', 'Premios por etapas', jsonb_build_object('niveles', v_n));
  return jsonb_build_object('ok', true, 'niveles', v_n);
end $$;

create or replace function public.promo_etapas_quitar(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  perform set_config('app.promo_silencio', 'on', true);
  update public.promo_liquidacion set activa = false, pausada_at = now() where kiosco_id = p_kiosco and activa and tipo = 'regalo';
  update public.fidelidad_premios set activo = false where kiosco_id = p_kiosco and activo;
  perform set_config('app.promo_silencio', '', true);
  perform public.promo_historial_registrar(p_kiosco, 'cambio', 'fidelidad_premios', 'premio_por_etapas', 'Premios por etapas', jsonb_build_object('niveles', 0));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.promo_etapas_quitar(uuid) from public, anon;
grant execute on function public.promo_etapas_quitar(uuid) to authenticated;
