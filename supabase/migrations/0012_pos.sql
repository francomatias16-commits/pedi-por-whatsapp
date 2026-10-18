-- Etapa 6 · POS completo (réplica del punto de venta de referencia).
--  * Ventas de mostrador con descuento global (%), cliente opcional y subtotal.
--  * Medios de pago: efectivo, transferencia, mercadopago (QR), tarjeta y cuenta_corriente.
--    - cuenta_corriente exige cliente y suma un movimiento 'fiado' en la libreta del cliente.
--    - El vuelto solo sale del efectivo; lo que no es efectivo no puede pasarse del total.
--  * Anulación con motivo obligatorio: repone stock y, si hubo cuenta corriente, la revierte con un 'pago'.
--  * Favoritos del POS (productos de acceso rápido).
--  * Sangrías y retiros no pueden superar el efectivo disponible en caja.
--  * Reporte Z por turno (cobros por medio, descuentos, anuladas, efectivo esperado).
-- Aplicar DESPUÉS de 0001..0011.

-- 1) Columnas nuevas en ventas_mostrador
alter table public.ventas_mostrador
  add column subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  add column descuento numeric(12,2) not null default 0 check (descuento >= 0),
  add column descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  add column cliente_id uuid,
  add column anulada_motivo text check (anulada_motivo is null or length(anulada_motivo) <= 200),
  add foreign key (kiosco_id, cliente_id) references public.clientes(kiosco_id, id) on delete set null (cliente_id);
update public.ventas_mostrador set subtotal = total where subtotal = 0;

-- 2) Medios de pago ampliados
alter table public.ventas_mostrador_pagos drop constraint ventas_mostrador_pagos_medio_check;
alter table public.ventas_mostrador_pagos
  add constraint ventas_mostrador_pagos_medio_check
  check (medio in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'cuenta_corriente'));

-- 3) Favoritos del POS
create table public.pos_favoritos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  orden int not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  unique (kiosco_id, producto_id)
);
alter table public.pos_favoritos enable row level security;
create policy pos_favoritos_dueno on public.pos_favoritos for all to authenticated
  using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
revoke all on public.pos_favoritos from anon, authenticated;
grant select, insert, update, delete on public.pos_favoritos to authenticated;

-- 4) Cobros por medio de un turno (pedidos entregados sin fiado + mostrador no anulado).
--    El vuelto resta del efectivo. cuenta_corriente es solo informativo (no entra plata a caja).
create or replace function public.caja_ventas_por_medio(p_turno uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype;
  v_medio text;
  v_pedidos numeric; v_mostrador numeric; v_vuelto numeric;
  r jsonb := '{}'::jsonb;
begin
  select * into v_t from public.turnos_caja where id = p_turno;
  if not found then return r; end if;
  foreach v_medio in array array['efectivo', 'transferencia', 'mercadopago', 'tarjeta'] loop
    select coalesce(sum(p.total), 0) into v_pedidos
      from public.pedidos p
     where p.kiosco_id = v_t.kiosco_id and p.estado = 'entregado' and p.medio_pago = v_medio
       and p.entregado_at >= v_t.abierto_at and (v_t.cerrado_at is null or p.entregado_at <= v_t.cerrado_at)
       and not exists (select 1 from public.fiado_movimientos f where f.pedido_id = p.id);
    select coalesce(sum(pg.monto), 0) into v_mostrador
      from public.ventas_mostrador_pagos pg
      join public.ventas_mostrador v on v.id = pg.venta_id
     where v.turno_id = p_turno and not v.anulada and pg.medio = v_medio;
    v_vuelto := 0;
    if v_medio = 'efectivo' then
      select coalesce(sum(v.vuelto), 0) into v_vuelto
        from public.ventas_mostrador v where v.turno_id = p_turno and not v.anulada;
    end if;
    r := r || jsonb_build_object(v_medio, round(v_pedidos + v_mostrador - v_vuelto, 2));
  end loop;
  select coalesce(sum(pg.monto), 0) into v_mostrador
    from public.ventas_mostrador_pagos pg
    join public.ventas_mostrador v on v.id = pg.venta_id
   where v.turno_id = p_turno and not v.anulada and pg.medio = 'cuenta_corriente';
  r := r || jsonb_build_object('cuenta_corriente', round(v_mostrador, 2));
  return r;
end $$;
revoke all on function public.caja_ventas_por_medio(uuid) from public, anon, authenticated;

-- 5) Registrar venta de mostrador (descuento global, cliente, cuenta corriente)
drop function public.registrar_venta_mostrador(uuid, jsonb, jsonb);
create or replace function public.registrar_venta_mostrador(
  p_turno uuid, p_items jsonb, p_pagos jsonb, p_cliente uuid default null, p_descuento_pct numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype;
  v_prod public.productos%rowtype;
  v_item jsonb; v_pago jsonb;
  v_cant int; v_monto numeric(12,2); v_medio text;
  v_subtotal numeric(12,2) := 0; v_desc numeric(12,2); v_total numeric(12,2);
  v_pct numeric(5,2); v_pagado numeric(12,2) := 0;
  v_no_efectivo numeric(12,2) := 0; v_cc numeric(12,2) := 0; v_vuelto numeric(12,2);
  v_venta uuid; v_numero bigint;
begin
  select * into v_t from public.turnos_caja where id = p_turno for update;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
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

  insert into public.ventas_mostrador (kiosco_id, turno_id, total, cliente_id)
    values (v_t.kiosco_id, p_turno, 0, p_cliente)
    returning id, numero into v_venta, v_numero;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := coalesce((v_item->>'cantidad')::int, 0);
    if v_cant < 1 or v_cant > 99 then raise exception 'cantidad_invalida'; end if;
    select * into v_prod from public.productos
     where id = (v_item->>'producto_id')::uuid and kiosco_id = v_t.kiosco_id;
    if not found then raise exception 'producto_no_encontrado'; end if;
    if v_prod.stock_controlado then
      update public.productos
         set stock = stock - v_cant,
             disponible = case when stock - v_cant = 0 then false else disponible end
       where id = v_prod.id and stock >= v_cant;
      if not found then raise exception 'sin_stock'; end if;
    end if;
    insert into public.ventas_mostrador_items (venta_id, producto_id, nombre, precio_unit, cantidad)
      values (v_venta, v_prod.id, v_prod.nombre, v_prod.precio, v_cant);
    v_subtotal := v_subtotal + v_prod.precio * v_cant;
  end loop;

  v_desc := round(v_subtotal * v_pct / 100, 2);
  v_total := v_subtotal - v_desc;

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
  -- Lo que no es efectivo no puede pasarse del total: el vuelto solo sale de efectivo.
  if v_no_efectivo > v_total then raise exception 'pago_excede_total'; end if;
  v_vuelto := greatest(0, v_pagado - v_total);

  update public.ventas_mostrador
     set subtotal = v_subtotal, descuento = v_desc, descuento_pct = v_pct, total = v_total, vuelto = v_vuelto
   where id = v_venta;

  if v_cc > 0 then
    insert into public.fiado_movimientos (kiosco_id, cliente_id, tipo, monto, nota)
      values (v_t.kiosco_id, p_cliente, 'fiado', v_cc, 'Venta mostrador #' || v_numero);
  end if;

  return jsonb_build_object('venta_id', v_venta, 'numero', v_numero, 'subtotal', v_subtotal,
    'descuento', v_desc, 'total', v_total, 'vuelto', v_vuelto);
end $$;

-- 6) Anular venta (motivo obligatorio; solo con el turno abierto)
drop function public.anular_venta_mostrador(uuid);
create or replace function public.anular_venta_mostrador(p_venta uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_v public.ventas_mostrador%rowtype;
  v_estado text; v_motivo text; v_cc numeric(12,2);
  it record;
begin
  select * into v_v from public.ventas_mostrador where id = p_venta for update;
  if not found or not public.es_dueno(v_v.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_motivo := left(trim(coalesce(p_motivo, '')), 200);
  if length(v_motivo) < 3 then raise exception 'motivo_requerido'; end if;
  if v_v.anulada then raise exception 'ya_anulada'; end if;
  select estado into v_estado from public.turnos_caja where id = v_v.turno_id;
  if v_estado <> 'abierto' then raise exception 'turno_cerrado'; end if;

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

-- 7) Movimientos: sangría y retiro no pueden superar el efectivo disponible
create or replace function public.caja_registrar_movimiento(p_turno uuid, p_tipo text, p_monto numeric, p_concepto text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.turnos_caja%rowtype; v_disp numeric;
begin
  select * into v_t from public.turnos_caja where id = p_turno for update;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_t.estado <> 'abierto' then raise exception 'turno_cerrado'; end if;
  if p_tipo not in ('sangria', 'refuerzo', 'retiro_final') then raise exception 'tipo_invalido'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'monto_invalido'; end if;
  if p_tipo in ('sangria', 'retiro_final') then
    v_disp := v_t.monto_inicial + public.caja_ventas_efectivo(p_turno) + public.caja_neto_movimientos(p_turno);
    if round(p_monto, 2) > v_disp then raise exception 'sangria_excede_efectivo'; end if;
  end if;
  insert into public.movimientos_caja (kiosco_id, turno_id, tipo, monto, concepto)
    values (v_t.kiosco_id, p_turno, p_tipo, round(p_monto, 2), left(nullif(trim(coalesce(p_concepto, '')), ''), 200));
  return jsonb_build_object('ok', true);
end $$;

-- 8) Resumen del turno (ventas con subtotal, descuento, cliente y motivo de anulación)
create or replace function public.caja_resumen(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype; v_efectivo numeric; v_neto numeric;
  v_movs jsonb; v_ventas jsonb; v_medios jsonb;
begin
  select * into v_t from public.turnos_caja where id = p_turno;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_efectivo := public.caja_ventas_efectivo(p_turno);
  v_neto := public.caja_neto_movimientos(p_turno);
  v_medios := public.caja_ventas_por_medio(p_turno);
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'monto', monto, 'concepto', concepto, 'created_at', created_at)
                  order by created_at), '[]'::jsonb)
    into v_movs from public.movimientos_caja where turno_id = p_turno;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_ventas from (
    select jsonb_build_object(
      'id', v.id, 'numero', v.numero, 'subtotal', v.subtotal, 'descuento', v.descuento, 'total', v.total,
      'vuelto', v.vuelto, 'anulada', v.anulada, 'anulada_motivo', v.anulada_motivo,
      'cliente_nombre', (select c.nombre from public.clientes c where c.id = v.cliente_id),
      'created_at', v.created_at,
      'pagos', (select coalesce(jsonb_agg(jsonb_build_object('medio', pg.medio, 'monto', pg.monto)), '[]'::jsonb)
                  from public.ventas_mostrador_pagos pg where pg.venta_id = v.id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'precio_unit', i.precio_unit)), '[]'::jsonb)
                  from public.ventas_mostrador_items i where i.venta_id = v.id)
    ) as x
    from public.ventas_mostrador v where v.turno_id = p_turno
  ) s;
  return jsonb_build_object(
    'turno_id', v_t.id, 'estado', v_t.estado, 'abierto_at', v_t.abierto_at, 'cerrado_at', v_t.cerrado_at,
    'monto_inicial', v_t.monto_inicial, 'ventas_efectivo', v_efectivo, 'neto_movimientos', v_neto,
    'monto_calculado', v_t.monto_inicial + v_efectivo + v_neto, 'movimientos', v_movs,
    'ventas_por_medio', v_medios, 'ventas', v_ventas);
end $$;

-- 9) Reporte Z del turno
create or replace function public.caja_reporte_z(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype; v_efectivo numeric; v_neto numeric; v_medios jsonb;
  v_ref numeric; v_sal numeric; v_vendido numeric; v_desc numeric; v_ventas int; v_anuladas int;
begin
  select * into v_t from public.turnos_caja where id = p_turno;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_efectivo := public.caja_ventas_efectivo(p_turno);
  v_neto := public.caja_neto_movimientos(p_turno);
  v_medios := public.caja_ventas_por_medio(p_turno);
  select coalesce(sum(monto) filter (where tipo = 'refuerzo'), 0),
         coalesce(sum(monto) filter (where tipo in ('sangria', 'retiro_final')), 0)
    into v_ref, v_sal from public.movimientos_caja where turno_id = p_turno;
  select coalesce(sum(total) filter (where not anulada), 0), coalesce(sum(descuento) filter (where not anulada), 0),
         count(*) filter (where not anulada), count(*) filter (where anulada)
    into v_vendido, v_desc, v_ventas, v_anuladas from public.ventas_mostrador where turno_id = p_turno;
  return jsonb_build_object(
    'turno_id', v_t.id, 'estado', v_t.estado, 'abierto_at', v_t.abierto_at, 'cerrado_at', v_t.cerrado_at,
    'monto_inicial', v_t.monto_inicial, 'cobros_por_medio', v_medios,
    'refuerzos', v_ref, 'sangrias_y_retiros', v_sal,
    'efectivo_esperado', v_t.monto_inicial + v_efectivo + v_neto,
    'monto_declarado', v_t.monto_final_declarado, 'diferencia', v_t.diferencia,
    'total_vendido', v_vendido, 'descuentos', v_desc, 'ventas', v_ventas, 'anuladas', v_anuladas);
end $$;

revoke all on function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric) from public, anon;
revoke all on function public.anular_venta_mostrador(uuid, text) from public, anon;
revoke all on function public.caja_registrar_movimiento(uuid, text, numeric, text) from public, anon;
revoke all on function public.caja_resumen(uuid) from public, anon;
revoke all on function public.caja_reporte_z(uuid) from public, anon;
grant execute on function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric) to authenticated;
grant execute on function public.anular_venta_mostrador(uuid, text) to authenticated;
grant execute on function public.caja_registrar_movimiento(uuid, text, numeric, text) to authenticated;
grant execute on function public.caja_resumen(uuid) to authenticated;
grant execute on function public.caja_reporte_z(uuid) to authenticated;
