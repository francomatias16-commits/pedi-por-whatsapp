-- Etapa 5 · Mostrador: ventas cobradas en el local.
--  * Cada venta pertenece al turno de caja abierto. Sin turno abierto no se puede vender.
--  * Descuenta stock (productos con stock_controlado) en el mismo paso; si no alcanza, no vende.
--  * Pagos mixtos: efectivo, transferencia y mercadopago. El vuelto sale solo del efectivo.
--  * Anular devuelve el stock y saca la venta de la caja, solo mientras el turno esté abierto.
--  * El arqueo (caja_cerrar_turno) ya usa caja_ventas_efectivo, que ahora incluye el efectivo neto del mostrador.
-- Aplicar DESPUÉS de 0001..0010.

-- 1) Tablas
create table public.ventas_mostrador (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  turno_id uuid not null references public.turnos_caja(id) on delete cascade,
  numero bigint generated always as identity,
  total numeric(12,2) not null default 0 check (total >= 0),
  vuelto numeric(12,2) not null default 0 check (vuelto >= 0),
  anulada boolean not null default false,
  anulada_at timestamptz,
  usuario_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((anulada = false and anulada_at is null) or (anulada = true and anulada_at is not null))
);
create index on public.ventas_mostrador (turno_id);

create table public.ventas_mostrador_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas_mostrador(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  nombre text not null,
  precio_unit numeric(12,2) not null check (precio_unit >= 0),
  cantidad int not null check (cantidad between 1 and 99)
);
create index on public.ventas_mostrador_items (venta_id);

create table public.ventas_mostrador_pagos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas_mostrador(id) on delete cascade,
  medio text not null check (medio in ('efectivo', 'transferencia', 'mercadopago')),
  monto numeric(12,2) not null check (monto > 0)
);
create index on public.ventas_mostrador_pagos (venta_id);

alter table public.ventas_mostrador enable row level security;
alter table public.ventas_mostrador_items enable row level security;
alter table public.ventas_mostrador_pagos enable row level security;
create policy ventas_mostrador_dueno on public.ventas_mostrador for select to authenticated using (public.es_dueno(kiosco_id));
create policy ventas_mostrador_items_dueno on public.ventas_mostrador_items for select to authenticated
  using (exists (select 1 from public.ventas_mostrador v where v.id = venta_id and public.es_dueno(v.kiosco_id)));
create policy ventas_mostrador_pagos_dueno on public.ventas_mostrador_pagos for select to authenticated
  using (exists (select 1 from public.ventas_mostrador v where v.id = venta_id and public.es_dueno(v.kiosco_id)));
revoke all on public.ventas_mostrador, public.ventas_mostrador_items, public.ventas_mostrador_pagos from anon, authenticated;
grant select on public.ventas_mostrador, public.ventas_mostrador_items, public.ventas_mostrador_pagos to authenticated;

-- 2) Cálculo por medio de pago para un turno.
--    Pedidos entregados (sin fiado) + pagos del mostrador no anulados. El vuelto resta del efectivo.
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
  foreach v_medio in array array['efectivo', 'transferencia', 'mercadopago'] loop
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
  return r;
end $$;

-- Efectivo de ventas (pedidos + mostrador neto de vuelto). Lo usa el arqueo de caja_cerrar_turno.
create or replace function public.caja_ventas_efectivo(p_turno uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce((public.caja_ventas_por_medio(p_turno) ->> 'efectivo')::numeric, 0)::numeric(12,2)
$$;

revoke all on function public.caja_ventas_por_medio(uuid) from public, anon, authenticated;
revoke all on function public.caja_ventas_efectivo(uuid) from public, anon, authenticated;

-- 3) Registrar venta de mostrador
create or replace function public.registrar_venta_mostrador(p_turno uuid, p_items jsonb, p_pagos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype;
  v_prod public.productos%rowtype;
  v_item jsonb; v_pago jsonb;
  v_cant int; v_monto numeric(12,2); v_medio text;
  v_subtotal numeric(12,2) := 0; v_pagado numeric(12,2) := 0;
  v_efectivo numeric(12,2) := 0; v_no_efectivo numeric(12,2) := 0; v_vuelto numeric(12,2);
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

  insert into public.ventas_mostrador (kiosco_id, turno_id, total)
    values (v_t.kiosco_id, p_turno, 0)
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

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_medio := v_pago->>'medio';
    if v_medio not in ('efectivo', 'transferencia', 'mercadopago') then raise exception 'medio_pago_invalido'; end if;
    v_monto := round(coalesce((v_pago->>'monto')::numeric, 0), 2);
    if v_monto <= 0 then raise exception 'monto_invalido'; end if;
    insert into public.ventas_mostrador_pagos (venta_id, medio, monto) values (v_venta, v_medio, v_monto);
    v_pagado := v_pagado + v_monto;
    if v_medio = 'efectivo' then v_efectivo := v_efectivo + v_monto;
    else v_no_efectivo := v_no_efectivo + v_monto; end if;
  end loop;

  if v_pagado < v_subtotal then raise exception 'pago_insuficiente'; end if;
  -- Lo que no es efectivo no puede pasarse del total: el vuelto solo sale de efectivo.
  if v_no_efectivo > v_subtotal then raise exception 'pago_excede_total'; end if;
  v_vuelto := greatest(0, v_pagado - v_subtotal);

  update public.ventas_mostrador set total = v_subtotal, vuelto = v_vuelto where id = v_venta;
  return jsonb_build_object('venta_id', v_venta, 'numero', v_numero, 'total', v_subtotal, 'vuelto', v_vuelto);
end $$;

-- 4) Anular venta de mostrador (solo en turno abierto)
create or replace function public.anular_venta_mostrador(p_venta uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_v public.ventas_mostrador%rowtype;
  v_estado text;
  it record;
begin
  select * into v_v from public.ventas_mostrador where id = p_venta for update;
  if not found or not public.es_dueno(v_v.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_v.anulada then raise exception 'ya_anulada'; end if;
  select estado into v_estado from public.turnos_caja where id = v_v.turno_id;
  if v_estado <> 'abierto' then raise exception 'turno_cerrado'; end if;

  for it in select producto_id, cantidad from public.ventas_mostrador_items where venta_id = p_venta and producto_id is not null loop
    update public.productos
       set stock = stock + it.cantidad,
           disponible = case when stock + it.cantidad > 0 then true else disponible end
     where id = it.producto_id and stock_controlado;
  end loop;

  update public.ventas_mostrador set anulada = true, anulada_at = clock_timestamp() where id = p_venta;
  return jsonb_build_object('ok', true);
end $$;

-- 5) Resumen del turno: ahora incluye ventas por medio y la lista de ventas del mostrador.
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
      'id', v.id, 'numero', v.numero, 'total', v.total, 'vuelto', v.vuelto, 'anulada', v.anulada,
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

revoke all on function public.registrar_venta_mostrador(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.anular_venta_mostrador(uuid) from public, anon;
revoke all on function public.caja_resumen(uuid) from public, anon;
grant execute on function public.registrar_venta_mostrador(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.anular_venta_mostrador(uuid) to authenticated;
grant execute on function public.caja_resumen(uuid) to authenticated;
