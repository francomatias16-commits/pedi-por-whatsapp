-- Etapa 7 · POS avanzado (paridad con el POS de referencia).
--  * Venta por peso: cantidad en GRAMOS, precio por KG. Stock del producto también en gramos.
--  * PLU numérico por producto (balanzas / códigos de peso EAN-13).
--  * Descuento por renglón (%), promociones automáticas (NxM por producto, % por producto o categoría).
--  * Venta sin stock permitida por producto (permite_sin_stock).
--  * Idempotencia offline: p_offline_id evita duplicar una venta reenviada; p_fecha conserva la hora real.
--  * Devoluciones parciales por renglón con prorrateo del descuento, reposición de stock y reembolso por medio.
--  * PIN de supervisor (anular / devolver): verificación con bloqueo por intentos y token de un solo uso.
--  * Configuración del POS (ticket, cajón, sonido) y búsqueda de ventas.
-- Aplicar DESPUÉS de 0001..0012.

-- 1) Productos
alter table public.productos
  add column vendido_por_peso boolean not null default false,
  add column plu text,
  add column permite_sin_stock boolean not null default false,
  add constraint productos_plu_check check (plu is null or plu ~ '^[0-9]{1,6}$'),
  add constraint productos_kiosco_plu_key unique (kiosco_id, plu);

-- 2) Renglones de venta
alter table public.ventas_mostrador_items drop constraint ventas_mostrador_items_cantidad_check;
alter table public.ventas_mostrador_items
  add constraint ventas_mostrador_items_cantidad_check check (cantidad between 1 and 9999999),
  add column seq int not null default 0,
  add column por_peso boolean not null default false,
  add column descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  add column bruto numeric(12,2),
  add column descuento_promo numeric(12,2) not null default 0 check (descuento_promo >= 0),
  add column descuento_linea numeric(12,2) not null default 0 check (descuento_linea >= 0),
  add column promo_id uuid,
  add column neto numeric(12,2);
update public.ventas_mostrador_items set bruto = round(precio_unit * cantidad, 2), neto = round(precio_unit * cantidad, 2)
 where bruto is null;
alter table public.ventas_mostrador_items alter column bruto set not null, alter column neto set not null;
alter table public.ventas_mostrador_items add check (bruto >= 0 and neto >= 0);

-- 3) Ventas: offline + desglose de descuentos
alter table public.ventas_mostrador
  add column offline_id uuid,
  add column fecha_offline timestamptz,
  add column descuento_lineas numeric(12,2) not null default 0,
  add column descuento_promos numeric(12,2) not null default 0;
create unique index ventas_mostrador_offline_uq on public.ventas_mostrador (kiosco_id, offline_id) where offline_id is not null;

-- 4) Promociones
create table public.pos_promos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 80),
  tipo text not null check (tipo in ('nxm', 'pct')),
  producto_id uuid references public.productos(id) on delete cascade,
  categoria text,
  lleva int check (lleva is null or lleva between 2 and 99),
  paga int check (paga is null or paga >= 1),
  pct numeric(5,2) check (pct is null or (pct > 0 and pct <= 100)),
  desde date,
  hasta date,
  activa boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  check ((producto_id is not null)::int + (categoria is not null)::int = 1),
  check (tipo <> 'nxm' or (producto_id is not null and lleva is not null and paga is not null and paga < lleva)),
  check (tipo <> 'pct' or pct is not null),
  check (desde is null or hasta is null or desde <= hasta)
);
create index on public.pos_promos (kiosco_id) where activa;
alter table public.pos_promos enable row level security;
create policy pos_promos_dueno on public.pos_promos for all to authenticated
  using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
revoke all on public.pos_promos from anon, authenticated;
grant select, insert, update, delete on public.pos_promos to authenticated;

-- 5) Configuración del POS (el hash del PIN nunca se lee desde el cliente)
create table public.pos_config (
  kiosco_id uuid primary key references public.kioscos(id) on delete cascade,
  pin_hash text,
  pin_salt text,
  tiene_pin boolean generated always as (pin_hash is not null) stored,
  pin_anular boolean not null default true,
  pin_devolucion boolean not null default true,
  ticket_encabezado text check (ticket_encabezado is null or length(ticket_encabezado) <= 200),
  ticket_pie text check (ticket_pie is null or length(ticket_pie) <= 200),
  ticket_ancho int not null default 58 check (ticket_ancho in (58, 80)),
  imprimir_auto boolean not null default false,
  abrir_cajon boolean not null default false,
  sonido boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.pos_config enable row level security;
create policy pos_config_dueno on public.pos_config for all to authenticated
  using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
revoke all on public.pos_config from anon, authenticated;
grant select (kiosco_id, tiene_pin, pin_anular, pin_devolucion, ticket_encabezado, ticket_pie, ticket_ancho,
              imprimir_auto, abrir_cajon, sonido, updated_at) on public.pos_config to authenticated;
grant insert (kiosco_id, pin_anular, pin_devolucion, ticket_encabezado, ticket_pie, ticket_ancho,
              imprimir_auto, abrir_cajon, sonido) on public.pos_config to authenticated;
grant update (pin_anular, pin_devolucion, ticket_encabezado, ticket_pie, ticket_ancho,
              imprimir_auto, abrir_cajon, sonido, updated_at) on public.pos_config to authenticated;

create table public.pos_pin_intentos (
  id bigint generated always as identity primary key,
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.pos_pin_intentos (kiosco_id, created_at desc);
create table public.pos_pin_tokens (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  expira_at timestamptz not null,
  usado boolean not null default false
);
alter table public.pos_pin_intentos enable row level security;
alter table public.pos_pin_tokens enable row level security;
revoke all on public.pos_pin_intentos, public.pos_pin_tokens from anon, authenticated;

-- Consume un token válido (un solo uso). Devuelve true si estaba vigente.
create or replace function public.pos_consumir_token(p_kiosco uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_token is null then return false; end if;
  update public.pos_pin_tokens set usado = true
   where id = p_token and kiosco_id = p_kiosco and not usado and expira_at > clock_timestamp();
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;
revoke all on function public.pos_consumir_token(uuid, uuid) from public, anon, authenticated;

-- Exige PIN solo si el kiosco lo tiene configurado y la acción lo pide.
create or replace function public.pos_exigir_pin(p_kiosco uuid, p_accion text, p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.pos_config%rowtype;
begin
  select * into v_c from public.pos_config where kiosco_id = p_kiosco;
  if not found or v_c.pin_hash is null then return; end if;
  if p_accion = 'anular' and not v_c.pin_anular then return; end if;
  if p_accion = 'devolucion' and not v_c.pin_devolucion then return; end if;
  if not public.pos_consumir_token(p_kiosco, p_token) then raise exception 'pin_requerido'; end if;
end $$;
revoke all on function public.pos_exigir_pin(uuid, text, uuid) from public, anon, authenticated;

-- Verifica el PIN SIN lanzar error al fallar (para que el intento quede registrado).
create or replace function public.pos_pin_verificar(p_kiosco uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c public.pos_config%rowtype; v_fallos int; v_tok uuid;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into v_c from public.pos_config where kiosco_id = p_kiosco;
  if not found or v_c.pin_hash is null then return jsonb_build_object('ok', true, 'sin_pin', true); end if;
  select count(*) into v_fallos from public.pos_pin_intentos
   where kiosco_id = p_kiosco and created_at > clock_timestamp() - interval '10 minutes';
  if v_fallos >= 5 then return jsonb_build_object('ok', false, 'bloqueado', true); end if;
  if encode(sha256(convert_to(v_c.pin_salt || coalesce(p_pin, ''), 'utf8')), 'hex') <> v_c.pin_hash then
    insert into public.pos_pin_intentos (kiosco_id) values (p_kiosco);
    return jsonb_build_object('ok', false, 'bloqueado', false, 'restantes', greatest(0, 4 - v_fallos));
  end if;
  delete from public.pos_pin_intentos where kiosco_id = p_kiosco;
  delete from public.pos_pin_tokens where kiosco_id = p_kiosco and (usado or expira_at < clock_timestamp());
  insert into public.pos_pin_tokens (kiosco_id, expira_at) values (p_kiosco, clock_timestamp() + interval '2 minutes')
    returning id into v_tok;
  return jsonb_build_object('ok', true, 'token', v_tok);
end $$;

-- Define o cambia el PIN (4 a 8 dígitos). Si ya había uno, exige un token vigente.
create or replace function public.pos_pin_definir(p_kiosco uuid, p_pin text, p_token uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_salt text; v_tiene boolean;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'pin_invalido'; end if;
  select pin_hash is not null into v_tiene from public.pos_config where kiosco_id = p_kiosco;
  if coalesce(v_tiene, false) and not public.pos_consumir_token(p_kiosco, p_token) then raise exception 'pin_requerido'; end if;
  v_salt := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.pos_config (kiosco_id, pin_hash, pin_salt)
    values (p_kiosco, encode(sha256(convert_to(v_salt || p_pin, 'utf8')), 'hex'), v_salt)
  on conflict (kiosco_id) do update set pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt, updated_at = clock_timestamp();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pos_pin_quitar(p_kiosco uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if not public.pos_consumir_token(p_kiosco, p_token) then raise exception 'pin_requerido'; end if;
  update public.pos_config set pin_hash = null, pin_salt = null, updated_at = clock_timestamp() where kiosco_id = p_kiosco;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.pos_pin_verificar(uuid, text), public.pos_pin_definir(uuid, text, uuid),
  public.pos_pin_quitar(uuid, uuid) from public, anon;
grant execute on function public.pos_pin_verificar(uuid, text), public.pos_pin_definir(uuid, text, uuid),
  public.pos_pin_quitar(uuid, uuid) to authenticated;

-- 6) Devoluciones parciales
create table public.devoluciones_mostrador (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  venta_id uuid not null references public.ventas_mostrador(id) on delete cascade,
  turno_id uuid not null references public.turnos_caja(id) on delete cascade,
  numero bigint generated always as identity,
  total numeric(12,2) not null check (total > 0),
  medio text not null check (medio in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'cuenta_corriente')),
  motivo text not null check (length(motivo) between 3 and 200),
  usuario_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index on public.devoluciones_mostrador (turno_id);
create index on public.devoluciones_mostrador (venta_id);
create table public.devoluciones_mostrador_items (
  id uuid primary key default gen_random_uuid(),
  devolucion_id uuid not null references public.devoluciones_mostrador(id) on delete cascade,
  item_id uuid not null references public.ventas_mostrador_items(id) on delete cascade,
  cantidad int not null check (cantidad >= 1),
  monto numeric(12,2) not null check (monto >= 0),
  repone_stock boolean not null default true
);
create index on public.devoluciones_mostrador_items (item_id);
alter table public.devoluciones_mostrador enable row level security;
alter table public.devoluciones_mostrador_items enable row level security;
create policy devoluciones_dueno on public.devoluciones_mostrador for select to authenticated using (public.es_dueno(kiosco_id));
create policy devoluciones_items_dueno on public.devoluciones_mostrador_items for select to authenticated
  using (exists (select 1 from public.devoluciones_mostrador d where d.id = devolucion_id and public.es_dueno(d.kiosco_id)));
revoke all on public.devoluciones_mostrador, public.devoluciones_mostrador_items from anon, authenticated;
grant select on public.devoluciones_mostrador, public.devoluciones_mostrador_items to authenticated;

-- 7) Cobros por medio: ahora las devoluciones del turno restan del medio con que se reembolsaron.
create or replace function public.caja_ventas_por_medio(p_turno uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype;
  v_medio text;
  v_pedidos numeric; v_mostrador numeric; v_vuelto numeric; v_dev numeric;
  r jsonb := '{}'::jsonb;
begin
  select * into v_t from public.turnos_caja where id = p_turno;
  if not found then return r; end if;
  foreach v_medio in array array['efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'cuenta_corriente'] loop
    v_pedidos := 0; v_vuelto := 0;
    if v_medio <> 'cuenta_corriente' then
      select coalesce(sum(p.total), 0) into v_pedidos
        from public.pedidos p
       where p.kiosco_id = v_t.kiosco_id and p.estado = 'entregado' and p.medio_pago = v_medio
         and p.entregado_at >= v_t.abierto_at and (v_t.cerrado_at is null or p.entregado_at <= v_t.cerrado_at)
         and not exists (select 1 from public.fiado_movimientos f where f.pedido_id = p.id);
    end if;
    select coalesce(sum(pg.monto), 0) into v_mostrador
      from public.ventas_mostrador_pagos pg
      join public.ventas_mostrador v on v.id = pg.venta_id
     where v.turno_id = p_turno and not v.anulada and pg.medio = v_medio;
    if v_medio = 'efectivo' then
      select coalesce(sum(v.vuelto), 0) into v_vuelto
        from public.ventas_mostrador v where v.turno_id = p_turno and not v.anulada;
    end if;
    select coalesce(sum(d.total), 0) into v_dev
      from public.devoluciones_mostrador d where d.turno_id = p_turno and d.medio = v_medio;
    r := r || jsonb_build_object(v_medio, round(v_pedidos + v_mostrador - v_vuelto - v_dev, 2));
  end loop;
  return r;
end $$;
revoke all on function public.caja_ventas_por_medio(uuid) from public, anon, authenticated;

-- 8) Registrar venta de mostrador (peso, promos, descuento por renglón, offline)
drop function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric);
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

-- 9) Anular venta: PIN de supervisor y sin devoluciones previas
drop function public.anular_venta_mostrador(uuid, text);
create or replace function public.anular_venta_mostrador(p_venta uuid, p_motivo text, p_token uuid default null) returns jsonb
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

-- 10) Devolución parcial. Impacta en el turno ABIERTO actual (aunque la venta sea de un turno anterior).
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

-- 11) Búsqueda de ventas (para devolver o reimprimir, también de turnos anteriores)
create or replace function public.pos_buscar_ventas(p_kiosco uuid, p_q text default null, p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), ''); v_res jsonb;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_res from (
    select jsonb_build_object(
      'id', v.id, 'numero', v.numero, 'total', v.total, 'anulada', v.anulada, 'created_at', v.created_at,
      'cliente_nombre', (select c.nombre from public.clientes c where c.id = v.cliente_id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'nombre', i.nombre, 'cantidad', i.cantidad, 'por_peso', i.por_peso, 'neto', i.neto,
          'devuelto', (select coalesce(sum(di.cantidad), 0) from public.devoluciones_mostrador_items di where di.item_id = i.id)
        ) order by i.seq), '[]'::jsonb) from public.ventas_mostrador_items i where i.venta_id = v.id)
    ) as x
      from public.ventas_mostrador v
     where v.kiosco_id = p_kiosco
       and v.created_at >= clock_timestamp() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 365))
       and (v_q is null
            or v.numero::text = v_q
            or exists (select 1 from public.clientes c where c.id = v.cliente_id and c.nombre ilike '%' || v_q || '%')
            or exists (select 1 from public.ventas_mostrador_items i where i.venta_id = v.id and i.nombre ilike '%' || v_q || '%'))
     order by v.created_at desc limit 50
  ) s;
  return v_res;
end $$;

-- 12) Resumen del turno con renglones completos y devoluciones
create or replace function public.caja_resumen(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype; v_efectivo numeric; v_neto numeric;
  v_movs jsonb; v_ventas jsonb; v_medios jsonb; v_devs jsonb;
begin
  select * into v_t from public.turnos_caja where id = p_turno;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_efectivo := public.caja_ventas_efectivo(p_turno);
  v_neto := public.caja_neto_movimientos(p_turno);
  v_medios := public.caja_ventas_por_medio(p_turno);
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'monto', monto, 'concepto', concepto, 'created_at', created_at)
                  order by created_at), '[]'::jsonb)
    into v_movs from public.movimientos_caja where turno_id = p_turno;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'venta_numero', v.numero, 'total', d.total,
           'medio', d.medio, 'motivo', d.motivo, 'created_at', d.created_at) order by d.created_at desc), '[]'::jsonb)
    into v_devs from public.devoluciones_mostrador d join public.ventas_mostrador v on v.id = d.venta_id where d.turno_id = p_turno;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_ventas from (
    select jsonb_build_object(
      'id', v.id, 'numero', v.numero, 'subtotal', v.subtotal, 'descuento', v.descuento, 'total', v.total,
      'descuento_lineas', v.descuento_lineas, 'descuento_promos', v.descuento_promos, 'descuento_pct', v.descuento_pct,
      'vuelto', v.vuelto, 'anulada', v.anulada, 'anulada_motivo', v.anulada_motivo, 'offline', v.offline_id is not null,
      'cliente_nombre', (select c.nombre from public.clientes c where c.id = v.cliente_id),
      'created_at', v.created_at,
      'pagos', (select coalesce(jsonb_agg(jsonb_build_object('medio', pg.medio, 'monto', pg.monto)), '[]'::jsonb)
                  from public.ventas_mostrador_pagos pg where pg.venta_id = v.id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'nombre', i.nombre, 'cantidad', i.cantidad,
                  'precio_unit', i.precio_unit, 'por_peso', i.por_peso, 'descuento_pct', i.descuento_pct,
                  'descuento_promo', i.descuento_promo, 'neto', i.neto) order by i.seq), '[]'::jsonb)
                  from public.ventas_mostrador_items i where i.venta_id = v.id)
    ) as x
    from public.ventas_mostrador v where v.turno_id = p_turno
  ) s;
  return jsonb_build_object(
    'turno_id', v_t.id, 'estado', v_t.estado, 'abierto_at', v_t.abierto_at, 'cerrado_at', v_t.cerrado_at,
    'monto_inicial', v_t.monto_inicial, 'ventas_efectivo', v_efectivo, 'neto_movimientos', v_neto,
    'monto_calculado', v_t.monto_inicial + v_efectivo + v_neto, 'movimientos', v_movs,
    'ventas_por_medio', v_medios, 'ventas', v_ventas, 'devoluciones', v_devs);
end $$;

-- 13) Reporte Z con devoluciones y desglose de descuentos
create or replace function public.caja_reporte_z(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.turnos_caja%rowtype; v_efectivo numeric; v_neto numeric; v_medios jsonb;
  v_ref numeric; v_sal numeric; v_vendido numeric; v_desc numeric; v_ventas int; v_anuladas int;
  v_dl numeric; v_dp numeric; v_dev numeric; v_ndev int;
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
         coalesce(sum(descuento_lineas) filter (where not anulada), 0), coalesce(sum(descuento_promos) filter (where not anulada), 0),
         count(*) filter (where not anulada), count(*) filter (where anulada)
    into v_vendido, v_desc, v_dl, v_dp, v_ventas, v_anuladas from public.ventas_mostrador where turno_id = p_turno;
  select coalesce(sum(total), 0), count(*) into v_dev, v_ndev from public.devoluciones_mostrador where turno_id = p_turno;
  return jsonb_build_object(
    'turno_id', v_t.id, 'estado', v_t.estado, 'abierto_at', v_t.abierto_at, 'cerrado_at', v_t.cerrado_at,
    'monto_inicial', v_t.monto_inicial, 'cobros_por_medio', v_medios,
    'refuerzos', v_ref, 'sangrias_y_retiros', v_sal,
    'efectivo_esperado', v_t.monto_inicial + v_efectivo + v_neto,
    'monto_declarado', v_t.monto_final_declarado, 'diferencia', v_t.diferencia,
    'total_vendido', v_vendido, 'descuentos', v_desc, 'descuentos_lineas', v_dl, 'descuentos_promos', v_dp,
    'ventas', v_ventas, 'anuladas', v_anuladas, 'devoluciones_total', v_dev, 'devoluciones', v_ndev,
    'total_neto', v_vendido - v_dev);
end $$;

revoke all on function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric, uuid, timestamptz) from public, anon;
revoke all on function public.anular_venta_mostrador(uuid, text, uuid) from public, anon;
revoke all on function public.devolver_venta_mostrador(uuid, jsonb, text, text, uuid) from public, anon;
revoke all on function public.pos_buscar_ventas(uuid, text, int) from public, anon;
revoke all on function public.caja_resumen(uuid) from public, anon;
revoke all on function public.caja_reporte_z(uuid) from public, anon;
grant execute on function public.registrar_venta_mostrador(uuid, jsonb, jsonb, uuid, numeric, uuid, timestamptz) to authenticated;
grant execute on function public.anular_venta_mostrador(uuid, text, uuid) to authenticated;
grant execute on function public.devolver_venta_mostrador(uuid, jsonb, text, text, uuid) to authenticated;
grant execute on function public.pos_buscar_ventas(uuid, text, int) to authenticated;
grant execute on function public.caja_resumen(uuid) to authenticated;
grant execute on function public.caja_reporte_z(uuid) to authenticated;
