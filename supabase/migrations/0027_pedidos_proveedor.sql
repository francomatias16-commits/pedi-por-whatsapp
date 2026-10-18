-- Pedidos a proveedor como documento (plan 1.4 / 9.5). Aplicar DESPUÉS de 0001..0026.
--  * Estados: borrador → enviada → recibida_parcial → recibida, o cancelada (solo desde borrador o enviada).
--  * Recepción estricta: no se puede recibir más de lo pendiente de cada línea.
--  * El pedido NO mueve stock ni deuda: eso lo sigue haciendo registrar_compra cuando llega la mercadería.
--    El pedido registra qué se pidió y qué llegó, para saber qué falta.
-- Por peso las cantidades van en gramos (igual que compras). Todo se escribe por funciones; el cliente solo lee.

create table public.pedidos_proveedor (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  proveedor_id uuid not null,
  numero bigint generated always as identity,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'recibida_parcial', 'recibida', 'cancelada')),
  nota text check (nota is null or length(nota) <= 200),
  created_at timestamptz not null default clock_timestamp(),
  enviada_at timestamptz,
  cerrada_at timestamptz,
  foreign key (kiosco_id, proveedor_id) references public.proveedores(kiosco_id, id) on delete cascade
);
create index on public.pedidos_proveedor (kiosco_id, created_at desc);
create index on public.pedidos_proveedor (proveedor_id, created_at desc);

create table public.pedido_proveedor_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_proveedor(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  nombre text not null,
  por_peso boolean not null default false,
  cantidad int not null check (cantidad >= 1 and cantidad <= 9999999),
  recibida int not null default 0 check (recibida >= 0),
  check (recibida <= cantidad)
);
create index on public.pedido_proveedor_items (pedido_id);

alter table public.pedidos_proveedor enable row level security;
alter table public.pedido_proveedor_items enable row level security;
create policy pedidos_proveedor_dueno on public.pedidos_proveedor for select to authenticated using (public.es_dueno(kiosco_id));
create policy pedido_proveedor_items_dueno on public.pedido_proveedor_items for select to authenticated
  using (exists (select 1 from public.pedidos_proveedor p where p.id = pedido_id and public.es_dueno(p.kiosco_id)));
revoke all on public.pedidos_proveedor, public.pedido_proveedor_items from anon, authenticated;
grant select on public.pedidos_proveedor, public.pedido_proveedor_items to authenticated;

-- Crear un pedido. p_items = [{"producto_id": uuid, "cantidad": int}]. p_enviar=true lo deja directamente como enviada.
create or replace function public.pedido_proveedor_crear(
  p_kiosco uuid, p_proveedor uuid, p_items jsonb, p_enviar boolean default false, p_nota text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_x jsonb; v_prod public.productos%rowtype; v_cant int; v_pedido uuid; v_numero bigint; v_vistos uuid[] := '{}';
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  perform 1 from public.proveedores where id = p_proveedor and kiosco_id = p_kiosco;
  if not found then raise exception 'proveedor_no_encontrado'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;
  insert into public.pedidos_proveedor (kiosco_id, proveedor_id, estado, nota, enviada_at)
    values (p_kiosco, p_proveedor, case when coalesce(p_enviar, false) then 'enviada' else 'borrador' end,
            left(nullif(trim(p_nota), ''), 200), case when coalesce(p_enviar, false) then clock_timestamp() end)
    returning id, numero into v_pedido, v_numero;
  for v_x in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.productos where id = (v_x->>'producto_id')::uuid and kiosco_id = p_kiosco;
    if not found then raise exception 'producto_no_encontrado'; end if;
    if v_prod.id = any (v_vistos) then raise exception 'items_invalidos'; end if;
    v_vistos := v_vistos || v_prod.id;
    v_cant := coalesce((v_x->>'cantidad')::int, 0);
    if v_cant < 1 or v_cant > 9999999 then raise exception 'cantidad_invalida'; end if;
    insert into public.pedido_proveedor_items (pedido_id, producto_id, nombre, por_peso, cantidad)
      values (v_pedido, v_prod.id, v_prod.nombre, v_prod.vendido_por_peso, v_cant);
  end loop;
  return jsonb_build_object('id', v_pedido, 'numero', v_numero);
end $$;

-- borrador → enviada
create or replace function public.pedido_proveedor_enviar(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.pedidos_proveedor%rowtype;
begin
  select * into v from public.pedidos_proveedor where id = p_pedido for update;
  if not found or not public.es_dueno(v.kiosco_id) then raise exception 'pedido_no_encontrado'; end if;
  if v.estado <> 'borrador' then raise exception 'pedido_estado_invalido'; end if;
  update public.pedidos_proveedor set estado = 'enviada', enviada_at = clock_timestamp() where id = p_pedido;
  return jsonb_build_object('estado', 'enviada');
end $$;

-- borrador o enviada (sin nada recibido) → cancelada
create or replace function public.pedido_proveedor_cancelar(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.pedidos_proveedor%rowtype;
begin
  select * into v from public.pedidos_proveedor where id = p_pedido for update;
  if not found or not public.es_dueno(v.kiosco_id) then raise exception 'pedido_no_encontrado'; end if;
  if v.estado not in ('borrador', 'enviada') then raise exception 'pedido_estado_invalido'; end if;
  update public.pedidos_proveedor set estado = 'cancelada', cerrada_at = clock_timestamp() where id = p_pedido;
  return jsonb_build_object('estado', 'cancelada');
end $$;

-- Recepción estricta. p_items = [{"item_id": uuid, "cantidad": int}]: lo que llegó ahora (no el acumulado).
create or replace function public.pedido_proveedor_recibir(p_pedido uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.pedidos_proveedor%rowtype; v_x jsonb; v_it public.pedido_proveedor_items%rowtype; v_cant int; v_estado text; v_vistos uuid[] := '{}';
begin
  select * into v from public.pedidos_proveedor where id = p_pedido for update;
  if not found or not public.es_dueno(v.kiosco_id) then raise exception 'pedido_no_encontrado'; end if;
  if v.estado not in ('enviada', 'recibida_parcial') then raise exception 'pedido_estado_invalido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;
  for v_x in select * from jsonb_array_elements(p_items) loop
    select * into v_it from public.pedido_proveedor_items where id = (v_x->>'item_id')::uuid and pedido_id = p_pedido for update;
    if not found then raise exception 'items_invalidos'; end if;
    if v_it.id = any (v_vistos) then raise exception 'items_invalidos'; end if;
    v_vistos := v_vistos || v_it.id;
    v_cant := coalesce((v_x->>'cantidad')::int, 0);
    if v_cant < 1 or v_cant > 9999999 then raise exception 'cantidad_invalida'; end if;
    if v_it.recibida + v_cant > v_it.cantidad then raise exception 'recepcion_excede_pendiente'; end if;
    update public.pedido_proveedor_items set recibida = recibida + v_cant where id = v_it.id;
  end loop;
  if exists (select 1 from public.pedido_proveedor_items where pedido_id = p_pedido and recibida < cantidad) then
    v_estado := 'recibida_parcial';
  else
    v_estado := 'recibida';
  end if;
  update public.pedidos_proveedor set estado = v_estado, cerrada_at = case when v_estado = 'recibida' then clock_timestamp() end
   where id = p_pedido;
  return jsonb_build_object('estado', v_estado);
end $$;

-- recibida_parcial → recibida: se da por cerrado lo que no llegó.
create or replace function public.pedido_proveedor_cerrar(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.pedidos_proveedor%rowtype;
begin
  select * into v from public.pedidos_proveedor where id = p_pedido for update;
  if not found or not public.es_dueno(v.kiosco_id) then raise exception 'pedido_no_encontrado'; end if;
  if v.estado <> 'recibida_parcial' then raise exception 'pedido_estado_invalido'; end if;
  update public.pedidos_proveedor set estado = 'recibida', cerrada_at = clock_timestamp() where id = p_pedido;
  return jsonb_build_object('estado', 'recibida');
end $$;

revoke all on function public.pedido_proveedor_crear(uuid, uuid, jsonb, boolean, text) from public, anon;
revoke all on function public.pedido_proveedor_enviar(uuid) from public, anon;
revoke all on function public.pedido_proveedor_cancelar(uuid) from public, anon;
revoke all on function public.pedido_proveedor_recibir(uuid, jsonb) from public, anon;
revoke all on function public.pedido_proveedor_cerrar(uuid) from public, anon;
grant execute on function public.pedido_proveedor_crear(uuid, uuid, jsonb, boolean, text) to authenticated;
grant execute on function public.pedido_proveedor_enviar(uuid) to authenticated;
grant execute on function public.pedido_proveedor_cancelar(uuid) to authenticated;
grant execute on function public.pedido_proveedor_recibir(uuid, jsonb) to authenticated;
grant execute on function public.pedido_proveedor_cerrar(uuid) to authenticated;
