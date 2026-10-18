-- Etapa 3 · cierre: horario automático, moderación de la base global, fotos de producto, Realtime.
-- Aplicar DESPUÉS de 0001..0005, en el SQL Editor de Supabase (corre todo junto: si algo falla, no queda nada a medias).

-- =====================================================================================
-- 1) Horario con apertura y cierre automático
--    horarios = {"1":[{"desde":"08:00","hasta":"13:00"},{"desde":"17:00","hasta":"22:00"}], "0":[...]}
--    Clave = día (0 domingo … 6 sábado). Sin clave = cerrado ese día. Hasta 2 tramos por día.
--    hasta < desde = el tramo cruza la medianoche (ej. 20:00 a 02:00).
--    "abierto" sigue siendo el interruptor manual: con horario automático actúa como pausa.
-- =====================================================================================
create or replace function public.horarios_validos(h jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; r jsonb;
begin
  if h is null or jsonb_typeof(h) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(h) loop
    if k !~ '^[0-6]$' then return false; end if;
    if jsonb_typeof(h -> k) <> 'array' or jsonb_array_length(h -> k) > 2 then return false; end if;
    for r in select * from jsonb_array_elements(h -> k) loop
      if jsonb_typeof(r) <> 'object'
         or coalesce(r ->> 'desde', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(r ->> 'hasta', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or r ->> 'desde' = r ->> 'hasta' then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

alter table public.kioscos
  add column horario_auto boolean not null default false,
  add column horarios jsonb not null default '{}'::jsonb check (public.horarios_validos(horarios));

-- Argentina no tiene horario de verano: UTC-3 todo el año.
create or replace function public.kiosco_abierto_ahora(p_k public.kioscos, p_ahora timestamptz default now())
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_local timestamp := p_ahora at time zone 'America/Argentina/Buenos_Aires';
  v_dow int := extract(dow from v_local)::int;
  v_min int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_ayer int := (v_dow + 6) % 7;
  r jsonb; d int; h int;
begin
  if not p_k.abierto then return false; end if;
  if not p_k.horario_auto then return true; end if;
  for r in select * from jsonb_array_elements(coalesce(p_k.horarios -> v_dow::text, '[]'::jsonb)) loop
    d := split_part(r ->> 'desde', ':', 1)::int * 60 + split_part(r ->> 'desde', ':', 2)::int;
    h := split_part(r ->> 'hasta', ':', 1)::int * 60 + split_part(r ->> 'hasta', ':', 2)::int;
    if d < h then
      if v_min >= d and v_min < h then return true; end if;
    elsif v_min >= d then return true;            -- cruza la medianoche: la parte de hoy
    end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_k.horarios -> v_ayer::text, '[]'::jsonb)) loop
    d := split_part(r ->> 'desde', ':', 1)::int * 60 + split_part(r ->> 'desde', ':', 2)::int;
    h := split_part(r ->> 'hasta', ':', 1)::int * 60 + split_part(r ->> 'hasta', ':', 2)::int;
    if d > h and v_min < h then return true; end if;  -- la parte de hoy de un tramo que empezó ayer
  end loop;
  return false;
end $$;
revoke all on function public.kiosco_abierto_ahora(public.kioscos, timestamptz) from public, anon, authenticated;

-- Slugs que chocarían con rutas de la app (/panel, /terminos, /privacidad).
alter table public.kioscos add constraint kioscos_slug_reservado
  check (slug not in ('panel', 'terminos', 'privacidad', 'api', 'manifest.webmanifest'));

-- crear_pedido: igual que en 0004, pero respeta el horario automático (error distinto: fuera_de_horario).
create or replace function public.crear_pedido(
  p_slug text, p_nombre text, p_telefono text, p_modalidad public.modalidad_pedido,
  p_direccion text, p_notas text, p_items jsonb, p_medio_pago text default 'efectivo'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kiosco public.kioscos%rowtype;
  v_pedido uuid; v_numero bigint; v_cliente uuid;
  v_subtotal numeric(12,2) := 0; v_envio numeric(12,2) := 0;
  v_item jsonb; v_prod public.productos%rowtype; v_cant int;
  v_nombre text := left(trim(p_nombre), 80);
  v_raw text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_tel text;
begin
  select * into v_kiosco from public.kioscos where slug = p_slug;
  if not found then raise exception 'kiosco_no_encontrado'; end if;
  if not v_kiosco.abierto then raise exception 'local_cerrado'; end if;
  if not public.kiosco_abierto_ahora(v_kiosco) then raise exception 'fuera_de_horario'; end if;
  if length(v_nombre) < 2 then raise exception 'nombre_invalido'; end if;
  if length(v_raw) < 8 or length(v_raw) > 15 then raise exception 'telefono_invalido'; end if;
  v_tel := public.normalizar_tel_ar(v_raw);
  if p_modalidad = 'envio' and (not v_kiosco.acepta_envio or length(coalesce(trim(p_direccion), '')) < 3) then
    raise exception 'envio_invalido';
  end if;
  if not (p_medio_pago = any (v_kiosco.medios_pago)) then raise exception 'medio_pago_invalido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;

  if (select count(*) from public.pedidos
        where kiosco_id = v_kiosco.id and cliente_telefono = v_tel and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'demasiados_pedidos';
  end if;
  if (select count(*) from public.pedidos
        where kiosco_id = v_kiosco.id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'local_saturado';
  end if;

  insert into public.clientes (kiosco_id, nombre, telefono) values (v_kiosco.id, v_nombre, v_tel)
  on conflict (kiosco_id, telefono) do update set nombre = excluded.nombre
  returning id into v_cliente;

  if p_modalidad = 'envio' then v_envio := v_kiosco.costo_envio; end if;

  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, direccion, notas, total, medio_pago, costo_envio)
  values (v_kiosco.id, v_cliente, v_nombre, v_tel, p_modalidad,
          case when p_modalidad = 'envio' then left(trim(p_direccion), 200) end, left(p_notas, 300), 0, p_medio_pago, v_envio)
  returning id, numero into v_pedido, v_numero;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::int;
    if v_cant is null or v_cant < 1 or v_cant > 99 then raise exception 'cantidad_invalida'; end if;
    select * into v_prod from public.productos
      where id = (v_item->>'producto_id')::uuid and kiosco_id = v_kiosco.id and disponible;
    if not found then raise exception 'producto_no_disponible'; end if;
    insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    values (v_pedido, v_prod.id, v_prod.nombre, v_prod.precio, v_cant);
    v_subtotal := v_subtotal + v_prod.precio * v_cant;
  end loop;

  if v_subtotal < v_kiosco.pedido_minimo then raise exception 'minimo_no_alcanzado'; end if;

  update public.pedidos set total = v_subtotal + v_envio where id = v_pedido;
  return jsonb_build_object('pedido_id', v_pedido, 'numero', v_numero, 'subtotal', v_subtotal,
                            'costo_envio', v_envio, 'total', v_subtotal + v_envio);
end $$;

-- =====================================================================================
-- 2) Moderación de la base global de productos
--    Antes: cualquier usuario logueado insertaba cualquier nombre y el primero ganaba.
--    Ahora: cada usuario aporta un nombre por código (aportes_globales); un producto pasa a la
--    base compartida (verificado) recién cuando 2 usuarios distintos coinciden en el nombre.
--    Nadie escribe directo en productos_globales: solo la función aportar_global.
-- =====================================================================================
create or replace function public.ean_valido(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n int; s int := 0; i int;
begin
  if p is null or p !~ '^(\d{8}|\d{12}|\d{13})$' then return false; end if;
  n := length(p);
  for i in 1..n - 1 loop
    s := s + substr(p, i, 1)::int * case when (n - i) % 2 = 1 then 3 else 1 end;
  end loop;
  return (10 - s % 10) % 10 = substr(p, n, 1)::int;
end $$;

create or replace function public.norm_nombre_global(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(translate(lower(p), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'), '[^a-z0-9]', '', 'g')
$$;

alter table public.productos_globales
  add column verificado boolean not null default false,
  add column creado_por uuid references auth.users(id) on delete set null;
-- Lo que ya había (cargado por el equipo durante las pruebas) se conserva como verificado.
update public.productos_globales set verificado = true;

create table public.aportes_globales (
  barcode text not null,
  usuario uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  nombre_norm text not null,
  created_at timestamptz not null default now(),
  primary key (barcode, usuario)
);
create index on public.aportes_globales (barcode, nombre_norm);
alter table public.aportes_globales enable row level security;   -- sin políticas: solo accede la función
revoke all on public.aportes_globales from anon, authenticated;

drop policy if exists globales_select on public.productos_globales;
drop policy if exists globales_insert on public.productos_globales;
create policy globales_select on public.productos_globales for select to authenticated using (verificado);
revoke insert, update, delete on public.productos_globales from anon, authenticated;

create or replace function public.aportar_global(p_barcode text, p_nombre text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text := left(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), 120);
  v_norm text;
begin
  if v_uid is null then raise exception 'no_autorizado'; end if;
  if not public.ean_valido(p_barcode) then raise exception 'codigo_invalido'; end if;
  v_norm := public.norm_nombre_global(v_nombre);
  if length(v_nombre) < 2 or length(v_norm) < 2 then raise exception 'nombre_invalido'; end if;
  if (select count(*) from public.aportes_globales where usuario = v_uid and created_at > now() - interval '1 day') >= 500 then
    raise exception 'demasiados_aportes';
  end if;

  insert into public.aportes_globales (barcode, usuario, nombre, nombre_norm) values (p_barcode, v_uid, v_nombre, v_norm)
  on conflict (barcode, usuario) do update set nombre = excluded.nombre, nombre_norm = excluded.nombre_norm, created_at = now();

  if (select count(*) from public.aportes_globales where barcode = p_barcode and nombre_norm = v_norm) >= 2 then
    insert into public.productos_globales (barcode, nombre, fuente, verificado) values (p_barcode, v_nombre, 'red', true)
    on conflict (barcode) do nothing;
    return 'verificado';
  end if;
  return 'pendiente';
end $$;
revoke all on function public.aportar_global(text, text) from public, anon;
grant execute on function public.aportar_global(text, text) to authenticated;

-- =====================================================================================
-- 3) Fotos de producto (Storage). Lectura pública; escribe solo el dueño en su carpeta <kiosco_id>/…
--    Máx. 512 KB por foto (la app las reduce antes de subir).
-- =====================================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 524288, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.es_dueno_de_carpeta(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.es_dueno(split_part(p_name, '/', 1)::uuid) else false end
$$;
revoke all on function public.es_dueno_de_carpeta(text) from public, anon;
grant execute on function public.es_dueno_de_carpeta(text) to authenticated;

drop policy if exists fotos_productos_insert on storage.objects;
drop policy if exists fotos_productos_select on storage.objects;
drop policy if exists fotos_productos_delete on storage.objects;
create policy fotos_productos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and public.es_dueno_de_carpeta(name));
create policy fotos_productos_select on storage.objects for select to authenticated
  using (bucket_id = 'productos' and public.es_dueno_de_carpeta(name));
create policy fotos_productos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and public.es_dueno_de_carpeta(name));

-- =====================================================================================
-- 4) Realtime: el panel recibe los pedidos al instante (respeta RLS: cada dueño ve solo los suyos).
-- =====================================================================================
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos') then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end $$;
