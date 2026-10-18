-- Etapa 2: libreta de fiado, sellos de fidelidad, ajuste de precios con historial, resumen semanal.

-- 0) Teléfono canónico argentino (54 9 + área + número), espejo de lib/whatsapp.ts
create or replace function public.normalizar_tel_ar(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); a int;
begin
  if d like '549%' then return d; end if;
  if d like '54%' then d := substr(d, 3); end if;
  d := regexp_replace(d, '^0+', '');
  if length(d) = 12 then
    for a in 2..4 loop
      if substr(d, a + 1, 2) = '15' then d := substr(d, 1, a) || substr(d, a + 3); exit; end if;
    end loop;
  end if;
  return '549' || d;
end $$;

-- 1) Configuración de fidelidad por kiosco
alter table public.kioscos
  add column sellos_por_premio int not null default 10 check (sellos_por_premio between 2 and 100),
  add column premio text not null default 'Un premio de la casa' check (length(premio) <= 120);

-- FK compuesta: fiado/sellos/canjes solo pueden apuntar a clientes del mismo kiosco
alter table public.clientes add constraint clientes_kiosco_id_id_key unique (kiosco_id, id);

-- 2) Fiado
create type public.tipo_fiado as enum ('fiado', 'pago');
create table public.fiado_movimientos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null,
  cliente_id uuid not null,
  tipo public.tipo_fiado not null,
  monto numeric(12,2) not null check (monto > 0),
  nota text check (length(nota) <= 200),
  created_at timestamptz not null default now(),
  foreign key (kiosco_id, cliente_id) references public.clientes(kiosco_id, id) on delete cascade
);
create index on public.fiado_movimientos(cliente_id, created_at desc);

create view public.clientes_saldo with (security_invoker = true) as
select c.id, c.kiosco_id, c.nombre, c.telefono,
  coalesce(sum(case m.tipo when 'fiado' then m.monto else -m.monto end), 0)::numeric(12,2) as saldo,
  max(m.created_at) as ultimo_movimiento
from public.clientes c left join public.fiado_movimientos m on m.cliente_id = c.id
group by c.id;

-- 3) Sellos
create table public.sellos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null,
  cliente_id uuid not null,
  origen text not null check (origen in ('pedido', 'mostrador')),
  pedido_id uuid unique references public.pedidos(id) on delete set null,
  anulado boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (kiosco_id, cliente_id) references public.clientes(kiosco_id, id) on delete cascade
);
create index on public.sellos(cliente_id, created_at desc);

create table public.canjes (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null,
  cliente_id uuid not null,
  sellos int not null check (sellos > 0),
  created_at timestamptz not null default now(),
  foreign key (kiosco_id, cliente_id) references public.clientes(kiosco_id, id) on delete cascade
);

create view public.clientes_sellos with (security_invoker = true) as
select c.id, c.kiosco_id, c.nombre, c.telefono,
  ((select count(*) from public.sellos s where s.cliente_id = c.id and not s.anulado)
   - coalesce((select sum(x.sellos) from public.canjes x where x.cliente_id = c.id), 0))::int as sellos_disponibles
from public.clientes c;

-- Un sello por pedido entregado (idempotente por pedido_id)
create or replace function public.sello_por_entrega() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'entregado' and old.estado is distinct from 'entregado' and new.cliente_id is not null then
    insert into public.sellos (kiosco_id, cliente_id, origen, pedido_id)
    values (new.kiosco_id, new.cliente_id, 'pedido', new.id)
    on conflict (pedido_id) do nothing;
  end if;
  return new;
end $$;
create trigger trg_sello_por_entrega after update of estado on public.pedidos
  for each row execute function public.sello_por_entrega();

create or replace function public.canjear_premio(p_cliente uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_c public.clientes%rowtype; v_k public.kioscos%rowtype; v_disp int;
begin
  select * into v_c from public.clientes where id = p_cliente for update;
  if not found or not public.es_dueno(v_c.kiosco_id) then raise exception 'no_autorizado'; end if;
  select * into v_k from public.kioscos where id = v_c.kiosco_id;
  select sellos_disponibles into v_disp from public.clientes_sellos where id = p_cliente;
  if v_disp < v_k.sellos_por_premio then raise exception 'sellos_insuficientes'; end if;
  insert into public.canjes (kiosco_id, cliente_id, sellos) values (v_c.kiosco_id, v_c.id, v_k.sellos_por_premio);
  return v_disp - v_k.sellos_por_premio;
end $$;

-- 4) Ajuste de precios por porcentaje, con vista previa, historial y deshacer
create or replace function public.precio_ajustado(p numeric, pct numeric, red int) returns numeric
language sql immutable as $$
  select case when red > 0 then greatest(round(p * (1 + pct / 100) / red) * red, 0)
              else greatest(round(p * (1 + pct / 100), 2), 0) end
$$;

create table public.ajustes_precios (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  porcentaje numeric(6,2) not null,
  categoria text,
  redondeo int not null default 0,
  cantidad int not null default 0,
  created_at timestamptz not null default now(),
  revertido_at timestamptz
);
create index on public.ajustes_precios(kiosco_id, created_at desc);

create table public.historial_precios (
  id uuid primary key default gen_random_uuid(),
  ajuste_id uuid not null references public.ajustes_precios(id) on delete cascade,
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  precio_anterior numeric(12,2) not null,
  precio_nuevo numeric(12,2) not null
);
create index on public.historial_precios(ajuste_id);

create or replace function public.previsualizar_ajuste(p_kiosco uuid, p_pct numeric, p_categoria text, p_redondeo int)
returns table (producto_id uuid, nombre text, categoria text, precio_anterior numeric, precio_nuevo numeric)
language sql stable security invoker set search_path = public as $$
  select p.id, p.nombre, p.categoria, p.precio, public.precio_ajustado(p.precio, p_pct, p_redondeo)
  from public.productos p
  where p.kiosco_id = p_kiosco and public.es_dueno(p_kiosco)
    and (p_categoria is null or p.categoria = p_categoria)
    and public.precio_ajustado(p.precio, p_pct, p_redondeo) <> p.precio
  order by p.categoria, p.nombre
$$;

create or replace function public.ajustar_precios(p_kiosco uuid, p_pct numeric, p_categoria text, p_redondeo int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_pct is null or p_pct = 0 or p_pct < -50 or p_pct > 200 then raise exception 'porcentaje_invalido'; end if;
  if p_redondeo not in (0, 1, 10, 50, 100) then raise exception 'redondeo_invalido'; end if;

  insert into public.ajustes_precios (kiosco_id, porcentaje, categoria, redondeo)
  values (p_kiosco, p_pct, p_categoria, p_redondeo) returning id into v_id;

  with cambios as (
    select p.id, p.precio, public.precio_ajustado(p.precio, p_pct, p_redondeo) as nuevo
    from public.productos p
    where p.kiosco_id = p_kiosco and (p_categoria is null or p.categoria = p_categoria)
      and public.precio_ajustado(p.precio, p_pct, p_redondeo) <> p.precio
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

-- Deshace solo los productos cuyo precio sigue siendo el que puso el ajuste (no pisa cambios manuales posteriores)
create or replace function public.revertir_ajuste(p_ajuste uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_a public.ajustes_precios%rowtype; v_n int; v_total int;
begin
  select * into v_a from public.ajustes_precios where id = p_ajuste for update;
  if not found or not public.es_dueno(v_a.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_a.revertido_at is not null then raise exception 'ya_revertido'; end if;
  select count(*) into v_total from public.historial_precios where ajuste_id = p_ajuste;
  update public.productos p set precio = h.precio_anterior
  from public.historial_precios h
  where h.ajuste_id = p_ajuste and p.id = h.producto_id and p.precio = h.precio_nuevo;
  get diagnostics v_n = row_count;
  update public.ajustes_precios set revertido_at = now() where id = p_ajuste;
  return jsonb_build_object('revertidos', v_n, 'omitidos', v_total - v_n);
end $$;

-- 5) Resumen semanal para el dueño
create or replace function public.resumen_semana(p_kiosco uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_desde timestamptz := now() - interval '7 days'; r jsonb;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select jsonb_build_object(
    'pedidos', (select count(*) from public.pedidos where kiosco_id = p_kiosco and created_at >= v_desde and estado <> 'cancelado'),
    'monto_pedidos', (select coalesce(sum(total), 0) from public.pedidos where kiosco_id = p_kiosco and created_at >= v_desde and estado <> 'cancelado'),
    'fiado_pendiente', (select coalesce(sum(saldo), 0) from public.clientes_saldo where kiosco_id = p_kiosco and saldo > 0),
    'deudores', (select count(*) from public.clientes_saldo where kiosco_id = p_kiosco and saldo > 0),
    'sellos_semana', (select count(*) from public.sellos where kiosco_id = p_kiosco and not anulado and created_at >= v_desde),
    'premios_semana', (select count(*) from public.canjes where kiosco_id = p_kiosco and created_at >= v_desde),
    'ultimo_ajuste', (select max(created_at) from public.ajustes_precios where kiosco_id = p_kiosco and revertido_at is null),
    'productos', (select count(*) from public.productos where kiosco_id = p_kiosco)
  ) into r;
  return r;
end $$;

-- 6) crear_pedido: teléfono canónico (así el mismo vecino es siempre el mismo cliente)
create or replace function public.crear_pedido(
  p_slug text, p_nombre text, p_telefono text, p_modalidad public.modalidad_pedido,
  p_direccion text, p_notas text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kiosco public.kioscos%rowtype;
  v_pedido uuid; v_cliente uuid; v_total numeric(12,2) := 0;
  v_item jsonb; v_prod public.productos%rowtype; v_cant int;
  v_nombre text := left(trim(p_nombre), 80);
  v_raw text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_tel text;
begin
  select * into v_kiosco from public.kioscos where slug = p_slug;
  if not found then raise exception 'kiosco_no_encontrado'; end if;
  if length(v_nombre) < 2 then raise exception 'nombre_invalido'; end if;
  if length(v_raw) < 8 or length(v_raw) > 15 then raise exception 'telefono_invalido'; end if;
  v_tel := public.normalizar_tel_ar(v_raw);
  if p_modalidad = 'envio' and (not v_kiosco.acepta_envio or length(coalesce(trim(p_direccion), '')) < 3) then
    raise exception 'envio_invalido';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;

  insert into public.clientes (kiosco_id, nombre, telefono) values (v_kiosco.id, v_nombre, v_tel)
  on conflict (kiosco_id, telefono) do update set nombre = excluded.nombre
  returning id into v_cliente;

  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, direccion, notas, total)
  values (v_kiosco.id, v_cliente, v_nombre, v_tel, p_modalidad,
          case when p_modalidad = 'envio' then left(trim(p_direccion), 200) end, left(p_notas, 300), 0)
  returning id into v_pedido;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::int;
    if v_cant is null or v_cant < 1 or v_cant > 99 then raise exception 'cantidad_invalida'; end if;
    select * into v_prod from public.productos
      where id = (v_item->>'producto_id')::uuid and kiosco_id = v_kiosco.id and disponible;
    if not found then raise exception 'producto_no_disponible'; end if;
    insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    values (v_pedido, v_prod.id, v_prod.nombre, v_prod.precio, v_cant);
    v_total := v_total + v_prod.precio * v_cant;
  end loop;

  update public.pedidos set total = v_total where id = v_pedido;
  return jsonb_build_object('pedido_id', v_pedido, 'total', v_total);
end $$;

-- 7) RLS
alter table public.fiado_movimientos enable row level security;
alter table public.sellos enable row level security;
alter table public.canjes enable row level security;
alter table public.ajustes_precios enable row level security;
alter table public.historial_precios enable row level security;

create policy fiado_dueno on public.fiado_movimientos for all to authenticated using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
create policy sellos_dueno on public.sellos for all to authenticated using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
-- canjes, ajustes e historial: el dueño solo lee; las escrituras van por RPC
create policy canjes_select on public.canjes for select to authenticated using (public.es_dueno(kiosco_id));
create policy ajustes_select on public.ajustes_precios for select to authenticated using (public.es_dueno(kiosco_id));
create policy historial_select on public.historial_precios for select to authenticated using (public.es_dueno(kiosco_id));

revoke insert, update, delete on public.canjes, public.ajustes_precios, public.historial_precios from authenticated, anon;
revoke all on public.fiado_movimientos, public.sellos, public.canjes, public.ajustes_precios, public.historial_precios from anon;
revoke all on public.clientes_saldo, public.clientes_sellos from anon;

revoke all on function public.canjear_premio(uuid) from public;
revoke all on function public.ajustar_precios(uuid, numeric, text, int) from public;
revoke all on function public.revertir_ajuste(uuid) from public;
revoke all on function public.previsualizar_ajuste(uuid, numeric, text, int) from public;
revoke all on function public.resumen_semana(uuid) from public;
grant execute on function public.canjear_premio(uuid) to authenticated;
grant execute on function public.ajustar_precios(uuid, numeric, text, int) to authenticated;
grant execute on function public.revertir_ajuste(uuid) to authenticated;
grant execute on function public.previsualizar_ajuste(uuid, numeric, text, int) to authenticated;
grant execute on function public.resumen_semana(uuid) to authenticated;
revoke all on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb) from public;
grant execute on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb) to anon, authenticated;
