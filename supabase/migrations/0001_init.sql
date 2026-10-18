-- Pedí por WhatsApp · v1: kioscos, productos, clientes, pedidos
-- RLS: cada dueño ve solo lo suyo. El público (anon) lee tienda y crea pedidos solo vía RPC.


create table public.kioscos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null check (length(nombre) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  whatsapp text not null,
  direccion text,
  acepta_envio boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.kioscos(owner_id);

create table public.productos_globales (
  barcode text primary key,
  nombre text not null,
  marca text,
  imagen_url text,
  fuente text not null default 'kiosco',
  created_at timestamptz not null default now()
);

create table public.productos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  barcode text,
  nombre text not null,
  categoria text not null default 'General',
  precio numeric(12,2) not null check (precio >= 0),
  disponible boolean not null default true,
  imagen_url text,
  created_at timestamptz not null default now(),
  unique (kiosco_id, barcode)
);
create index on public.productos(kiosco_id, categoria);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  nombre text not null,
  telefono text not null,
  created_at timestamptz not null default now(),
  unique (kiosco_id, telefono)
);

create type public.modalidad_pedido as enum ('retiro', 'envio');
create type public.estado_pedido as enum ('pendiente', 'confirmado', 'entregado', 'cancelado');

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nombre text not null,
  cliente_telefono text not null,
  modalidad public.modalidad_pedido not null,
  direccion text,
  notas text,
  total numeric(12,2) not null,
  estado public.estado_pedido not null default 'pendiente',
  created_at timestamptz not null default now()
);
create index on public.pedidos(kiosco_id, created_at desc);

create table public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  nombre text not null,
  precio_unit numeric(12,2) not null,
  cantidad int not null check (cantidad > 0)
);
create index on public.pedido_items(pedido_id);

create or replace function public.es_dueno(p_kiosco uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kioscos k where k.id = p_kiosco and k.owner_id = auth.uid());
$$;

alter table public.kioscos enable row level security;
alter table public.productos enable row level security;
alter table public.productos_globales enable row level security;
alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

create policy kioscos_select_publico on public.kioscos for select using (true);
create policy kioscos_insert_dueno on public.kioscos for insert to authenticated with check (owner_id = auth.uid());
create policy kioscos_update_dueno on public.kioscos for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy kioscos_delete_dueno on public.kioscos for delete to authenticated using (owner_id = auth.uid());

create policy productos_select_publico on public.productos for select using (disponible);
create policy productos_select_dueno on public.productos for select to authenticated using (public.es_dueno(kiosco_id));
create policy productos_insert_dueno on public.productos for insert to authenticated with check (public.es_dueno(kiosco_id));
create policy productos_update_dueno on public.productos for update to authenticated using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
create policy productos_delete_dueno on public.productos for delete to authenticated using (public.es_dueno(kiosco_id));

create policy globales_select on public.productos_globales for select to authenticated using (true);
create policy globales_insert on public.productos_globales for insert to authenticated with check (true);

create policy clientes_dueno on public.clientes for all to authenticated using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
create policy pedidos_dueno on public.pedidos for all to authenticated using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
create policy items_dueno on public.pedido_items for all to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id and public.es_dueno(p.kiosco_id)))
  with check (exists (select 1 from public.pedidos p where p.id = pedido_id and public.es_dueno(p.kiosco_id)));

-- RPC pública: recalcula precios en el servidor. p_items: [{"producto_id": "...", "cantidad": 2}]
create or replace function public.crear_pedido(
  p_slug text, p_nombre text, p_telefono text, p_modalidad public.modalidad_pedido,
  p_direccion text, p_notas text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kiosco public.kioscos%rowtype;
  v_pedido uuid; v_cliente uuid; v_total numeric(12,2) := 0;
  v_item jsonb; v_prod public.productos%rowtype; v_cant int;
  v_nombre text := left(trim(p_nombre), 80);
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
begin
  select * into v_kiosco from public.kioscos where slug = p_slug;
  if not found then raise exception 'kiosco_no_encontrado'; end if;
  if length(v_nombre) < 2 then raise exception 'nombre_invalido'; end if;
  if length(v_tel) < 8 or length(v_tel) > 15 then raise exception 'telefono_invalido'; end if;
  if p_modalidad = 'envio' and (not v_kiosco.acepta_envio or length(coalesce(trim(p_direccion), '')) < 3) then
    raise exception 'envio_invalido';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;

  insert into public.clientes (kiosco_id, nombre, telefono)
  values (v_kiosco.id, v_nombre, v_tel)
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

revoke all on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb) from public;
grant execute on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb) to anon, authenticated;
revoke all on function public.es_dueno(uuid) from public;
grant execute on function public.es_dueno(uuid) to anon, authenticated;
