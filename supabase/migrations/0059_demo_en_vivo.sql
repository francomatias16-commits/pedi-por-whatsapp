-- 0059 · Demo en vivo: un kiosco público de ejemplo al que se entra con un clic (/demo) y que no se puede modificar.
-- Aditiva. Aplicar DESPUÉS de 0001..0058.
--  - kioscos.es_demo: marca el kiosco de la demo (solo uno). Su slug es 'kiosco-demo'; 'demo' queda reservado (la ruta /demo).
--  - es_usuario_demo(): ¿esta persona es miembro de un kiosco de demo? Es la única fuente de verdad del modo solo lectura.
--  - demo_bloquear_escritura(): trigger por sentencia que rechaza con 'demo_solo_lectura' cualquier INSERT/UPDATE/DELETE/TRUNCATE
--    hecho por esa persona, sea directo o desde una función SQL (security definer). El servicio (auth.uid() nulo) no se bloquea.
--  - demo_proteger_tablas(): lo instala en todas las tablas de public. Si una migración futura crea una tabla, tiene que volver a
--    llamarla (supabase/tests/demo_test.py falla si alguna tabla queda sin protección).
--  - Storage: políticas restrictivas para que tampoco suba ni borre archivos.
--  - demo_sembrar(kiosco) / demo_reiniciar(usuario): cargan los datos ficticios y los restauran (borran el kiosco demo y lo rearman).
--    Solo las puede llamar service_role (el cron diario /api/cron/demo y scripts/crear-demo.mjs).

alter table public.kioscos add column es_demo boolean not null default false;
create unique index kioscos_un_demo on public.kioscos ((true)) where es_demo;
alter table public.kioscos add constraint kioscos_slug_reservado_demo check (slug <> 'demo') not valid;

create or replace function public.es_usuario_demo(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from public.kioscos k
    where k.es_demo and (k.owner_id = p_user or exists (
      select 1 from public.kiosco_miembros m where m.kiosco_id = k.id and m.user_id = p_user and m.activo))
  )
$$;
revoke execute on function public.es_usuario_demo(uuid) from public, anon;
grant execute on function public.es_usuario_demo(uuid) to authenticated, service_role;

create or replace function public.demo_bloquear_escritura() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.es_usuario_demo(auth.uid()) then
    raise exception 'demo_solo_lectura';
  end if;
  return null;
end $$;
revoke execute on function public.demo_bloquear_escritura() from public, anon, authenticated;

create or replace function public.demo_proteger_tablas() returns integer
language plpgsql security definer set search_path = public as $$
declare t record; n integer := 0;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition loop
    execute format('drop trigger if exists demo_solo_lectura on public.%I', t.relname);
    execute format('create trigger demo_solo_lectura before insert or update or delete or truncate on public.%I for each statement execute function public.demo_bloquear_escritura()', t.relname);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.demo_proteger_tablas() from public, anon, authenticated;
select public.demo_proteger_tablas();

-- Archivos: la persona de la demo no sube ni borra nada (leer sigue permitido).
drop policy if exists demo_sin_subir on storage.objects;
drop policy if exists demo_sin_cambiar on storage.objects;
drop policy if exists demo_sin_borrar on storage.objects;
create policy demo_sin_subir on storage.objects as restrictive for insert to authenticated with check (not public.es_usuario_demo());
create policy demo_sin_cambiar on storage.objects as restrictive for update to authenticated using (not public.es_usuario_demo());
create policy demo_sin_borrar on storage.objects as restrictive for delete to authenticated using (not public.es_usuario_demo());

-- Datos ficticios del kiosco demo (mismos que supabase/seed_demo.sql + pedidos de la tienda con Mercado Pago).
create or replace function public.demo_sembrar(p_kiosco uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  k uuid := p_kiosco; owner uuid; t uuid; v uuid; p uuid; c uuid;
  prov_a uuid; prov_b uuid; prov_c uuid;
  cl_pedro uuid; cl_rosa uuid; cl_julian uuid; cl_ana uuid; cl_luis uuid; cl_marta uuid;
  i int; total numeric; ped uuid;
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select owner_id into owner from public.kioscos where id = k;
  if owner is null then raise exception 'demo_sin_kiosco'; end if;

  -- Proveedores
  insert into public.proveedores (kiosco_id, nombre, telefono) values (k, 'Distribuidora Demo Norte', '5493415550101') returning id into prov_a;
  insert into public.proveedores (kiosco_id, nombre, telefono) values (k, 'Bebidas Demo Sur', '5493415550102') returning id into prov_b;
  insert into public.proveedores (kiosco_id, nombre, telefono) values (k, 'Panificadora Demo', '5493415550103') returning id into prov_c;

  -- Productos: nombre, precio, categoría, stock, mínimo, objetivo, días de entrega, proveedor
  insert into public.productos (kiosco_id, nombre, precio, categoria, stock_controlado, stock, stock_minimo, stock_objetivo, lead_time_dias, proveedor_id) values
    (k, 'Coca-Cola 500 ml', 1500, 'Bebidas', true, 4, 6, 24, 2, prov_b),
    (k, 'Agua mineral 500 ml', 900, 'Bebidas', true, 30, 10, 30, 2, prov_b),
    (k, 'Cerveza lata 473 ml', 1800, 'Bebidas', true, 0, 12, 36, 3, prov_b),
    (k, 'Alfajor triple', 1200, 'Golosinas', true, 18, 8, 30, 4, prov_a),
    (k, 'Chocolate 100 g', 2100, 'Golosinas', true, 9, 5, 20, 4, prov_a),
    (k, 'Galletitas de agua', 1100, 'Almacén', true, 14, 6, 24, 3, prov_a),
    (k, 'Yerba 1 kg', 4200, 'Almacén', true, 5, 4, 15, 5, prov_a),
    (k, 'Pan lactal', 2600, 'Panadería', true, 2, 3, 10, 1, prov_c),
    (k, 'Medialunas x6', 3000, 'Panadería', true, 12, 6, 24, 1, prov_c),
    (k, 'Leche 1 L', 1500, 'Lácteos', true, 20, 8, 30, 2, prov_a),
    (k, 'Papas fritas 150 g', 1900, 'Snacks', true, 7, 5, 18, 3, prov_a),
    (k, 'Bolsa de hielo 3 kg', 2200, 'Varios', false, 0, 0, null, 1, null);

  -- Clientes ficticios (teléfonos de prueba)
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Pedro Sosa', '5493415550201') returning id into cl_pedro;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Rosa Benitez', '5493415550202') returning id into cl_rosa;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Julian Torres', '5493415550203') returning id into cl_julian;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Ana Gomez', '5493415550204') returning id into cl_ana;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Luis Ferreyra', '5493415550205') returning id into cl_luis;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Marta Quiroga', '5493415550206') returning id into cl_marta;

  -- Turno de caja abierto (fondo ficticio)
  -- Un solo turno abierto por kiosco: si ya hay uno, se usa ese.
  select id into t from public.turnos_caja where kiosco_id = k and estado = 'abierto';
  if t is null then
    insert into public.turnos_caja (kiosco_id, abierto_por, monto_inicial) values (k, owner, 1000) returning id into t;
  end if;

  -- Ventas de los últimos 60 días. Pedro compró 3 veces hace 61 a 63 días y no volvió (cliente en fuga).
  -- Ana, Julián y Marta compran seguido hasta hace poco. Luis y Rosa compran de a ratos.
  for i in 1 .. 60 loop
    if i % 3 = 0 or i % 7 = 0 then
      total := 1500 + (i % 5) * 300;
      c := case when i % 2 = 0 then cl_ana when i % 5 = 0 then cl_luis else null end;
      if i >= 45 and i % 4 = 0 then c := cl_julian; end if;
      if i >= 45 and i % 6 = 0 then c := cl_marta; end if;
      if i >= 15 and i % 6 = 0 then c := cl_rosa; end if;
      if i in (50, 53, 58) then c := cl_pedro; end if;
      v := gen_random_uuid();
      insert into public.ventas_mostrador (id, kiosco_id, turno_id, total, cliente_id, usuario_id, created_at)
        values (v, k, t, total, c, owner, ((((hoy - i)::timestamp) + interval '12 hours') at time zone 'America/Argentina/Buenos_Aires'));
      insert into public.ventas_mostrador_pagos (venta_id, medio, monto) values (v, 'efectivo', total);
    end if;
  end loop;
  -- Pedro: 3 compras de hace 61 a 63 días, para que sea cliente en fuga
  for i in 1 .. 3 loop
    v := gen_random_uuid();
    insert into public.ventas_mostrador (id, kiosco_id, turno_id, total, cliente_id, usuario_id, created_at)
      values (v, k, t, 2400, cl_pedro, owner, ((((hoy - 60 - i)::timestamp) + interval '10 hours') at time zone 'America/Argentina/Buenos_Aires'));
    insert into public.ventas_mostrador_pagos (venta_id, medio, monto) values (v, 'efectivo', 2400);
  end loop;

  -- Fiado pendiente
  insert into public.fiado_movimientos (kiosco_id, cliente_id, tipo, monto, nota) values
    (k, cl_rosa, 'fiado', 3200, 'Demo: compra de la semana'),
    (k, cl_rosa, 'pago', 1000, 'Demo: pago parcial'),
    (k, cl_luis, 'fiado', 1800, 'Demo: fiado sin pagar');

  -- Lotes y reglas solo si la 0025 está aplicada
  if to_regclass('public.lotes_stock') is not null then
    insert into public.lotes_stock (kiosco_id, producto_id, cantidad, vence)
      select k, p.id, 4, hoy + 3 from public.productos p where p.kiosco_id = k and p.nombre = 'Pan lactal';
    insert into public.lotes_stock (kiosco_id, producto_id, cantidad, vence)
      select k, p.id, 12, hoy + 40 from public.productos p where p.kiosco_id = k and p.nombre = 'Yerba 1 kg';
    insert into public.avisos_reglas (kiosco_id, tipo, umbral) values
      (k, 'venta_supera', 15000),
      (k, 'fiado_supera', 3000),
      (k, 'stock_bajo_de', 5);
  end if;

  -- Cobros variados en el mostrador: una parte con transferencia y otra con Mercado Pago.
  update public.ventas_mostrador_pagos set medio = 'transferencia'
   where venta_id in (select id from public.ventas_mostrador where kiosco_id = k and extract(day from created_at)::int % 5 = 1);
  update public.ventas_mostrador_pagos set medio = 'mercadopago'
   where venta_id in (select id from public.ventas_mostrador where kiosco_id = k and extract(day from created_at)::int % 5 = 3);

  -- Pedidos de la tienda online: dos entregados (uno pagado con Mercado Pago), uno confirmado y uno nuevo.
  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, direccion, total, estado, medio_pago, pago_estado, created_at)
    values (k, cl_ana, 'Ana Gomez', '5493415550204', 'envio', 'Av. Demo 456', 3000, 'pendiente', 'mercadopago', 'pagado', now() - interval '3 days') returning id into ped;
  insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    select ped, id, nombre, precio, 2 from public.productos where kiosco_id = k and nombre = 'Leche 1 L';
  update public.pedidos set estado = 'entregado' where id = ped;
  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, total, estado, medio_pago, pago_estado, created_at)
    values (k, cl_marta, 'Marta Quiroga', '5493415550206', 'retiro', 1800, 'pendiente', 'efectivo', 'no_aplica', now() - interval '1 day') returning id into ped;
  insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    select ped, id, nombre, precio, 2 from public.productos where kiosco_id = k and nombre = 'Agua mineral 500 ml';
  update public.pedidos set estado = 'entregado' where id = ped;
  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, total, estado, medio_pago, pago_estado)
    values (k, cl_julian, 'Julian Torres', '5493415550203', 'retiro', 1500, 'pendiente', 'mercadopago', 'pagado') returning id into ped;
  insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    select ped, id, nombre, precio, 1 from public.productos where kiosco_id = k and nombre = 'Leche 1 L';
  update public.pedidos set estado = 'confirmado' where id = ped;
  insert into public.pedidos (kiosco_id, cliente_nombre, cliente_telefono, modalidad, direccion, total, medio_pago, pago_estado)
    values (k, 'Lucia Perez', '5493415550207', 'envio', 'Calle Demo 789', 900, 'transferencia', 'no_aplica') returning id into ped;
  insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    select ped, id, nombre, precio, 1 from public.productos where kiosco_id = k and nombre = 'Agua mineral 500 ml';
end $$;
revoke execute on function public.demo_sembrar(uuid) from public, anon, authenticated;
grant execute on function public.demo_sembrar(uuid) to service_role;

-- Borra el kiosco demo (en cascada) y lo arma de nuevo con los datos ficticios. p_user: la persona dueña de la demo (la primera vez).
create or replace function public.demo_reiniciar(p_user uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_k uuid; v_owner uuid;
begin
  select id, owner_id into v_k, v_owner from public.kioscos where es_demo;
  v_owner := coalesce(p_user, v_owner);
  if v_owner is null or not exists (select 1 from auth.users where id = v_owner) then raise exception 'demo_sin_usuario'; end if;
  if exists (select 1 from public.kioscos where owner_id = v_owner and not es_demo) then raise exception 'demo_usuario_con_kiosco'; end if;
  if v_k is not null then delete from public.kioscos where id = v_k; end if;
  insert into public.kioscos (owner_id, nombre, slug, whatsapp, direccion, medios_pago, premio, sellos_por_premio, es_demo)
    values (v_owner, 'Kiosco Demo', 'kiosco-demo', '5493415550100', 'Av. Demo 123', array['efectivo', 'transferencia', 'mercadopago'], 'Una gaseosa de regalo', 10, true)
    returning id into v_k;
  perform public.demo_sembrar(v_k);
  return v_k;
end $$;
revoke execute on function public.demo_reiniciar(uuid) from public, anon, authenticated;
grant execute on function public.demo_reiniciar(uuid) to service_role;
