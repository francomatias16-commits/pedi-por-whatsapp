-- 0029 · Etapa 1: cobro online con Mercado Pago en la tienda.
-- Aditiva: columnas y tablas nuevas, funciones nuevas y dos funciones existentes reemplazadas (crear_pedido y el trigger de stock).
--  - integraciones_pago: credencial cifrada del kiosco. Nadie la lee desde el navegador (solo el servidor, con la service role).
--  - transacciones_pago: cada intento de cobro de un pedido. payment_id único por proveedor.
--  - webhooks_recibidos: cada aviso recibido, con firma y estado. El id del evento es único (evita duplicados).
--  - pedidos.pago_estado / stock_reservado: un pedido con pago online reserva el stock al crearse y lo libera si el pago falla o vence.
--  - pago_confirmar: idempotente. Verifica monto y moneda contra el pedido y confirma el pedido una sola vez.
-- Aplicar DESPUÉS de 0001..0028.

-- 1) Columnas nuevas.
alter table public.kioscos add column if not exists cobro_online_activo boolean not null default false;

alter table public.pedidos
  add column if not exists pago_estado text not null default 'no_aplica'
    check (pago_estado in ('no_aplica', 'pendiente', 'pagado', 'fallido', 'reembolsado')),
  add column if not exists stock_reservado boolean not null default false,
  add column if not exists pago_consultado_at timestamptz;

create index if not exists pedidos_pago_pendiente on public.pedidos (created_at) where pago_estado = 'pendiente';

-- 2) Tablas.
create table public.integraciones_pago (
  kiosco_id uuid primary key references public.kioscos(id) on delete cascade,
  proveedor text not null default 'mercadopago' check (proveedor = 'mercadopago'),
  token_cifrado text not null,
  webhook_secret_cifrado text,
  token_ultimos4 text check (token_ultimos4 is null or length(token_ultimos4) <= 4),
  mp_user_id text not null,
  public_key text,
  activa boolean not null default true,
  forma_conexion text not null default 'token' check (forma_conexion in ('token', 'oauth')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transacciones_pago (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  proveedor text not null default 'mercadopago',
  preferencia_id text,
  payment_id text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'vencido', 'reembolsado')),
  monto numeric(12,2) not null check (monto >= 0),
  moneda text not null default 'ARS',
  link_pago text,
  detalle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index transacciones_pago_payment on public.transacciones_pago (proveedor, payment_id) where payment_id is not null;
create index transacciones_pago_pedido on public.transacciones_pago (pedido_id, created_at desc);

create table public.webhooks_recibidos (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null,
  evento_id text not null,
  tipo text,
  kiosco_id uuid references public.kioscos(id) on delete cascade,
  firma_valida boolean not null,
  estado text not null default 'recibido' check (estado in ('recibido', 'procesado', 'error', 'rechazado')),
  detalle text,
  intentos int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proveedor, evento_id)
);
create index webhooks_recibidos_kiosco on public.webhooks_recibidos (kiosco_id, created_at desc);

alter table public.integraciones_pago enable row level security;
alter table public.transacciones_pago enable row level security;
alter table public.webhooks_recibidos enable row level security;

-- Credenciales y avisos: sin políticas y sin permisos para anon/authenticated. Solo el servidor (service role).
revoke all on public.integraciones_pago from anon, authenticated;
revoke all on public.webhooks_recibidos from anon, authenticated;
-- Transacciones: el dueño las puede leer; nadie las escribe desde el navegador.
revoke all on public.transacciones_pago from anon, authenticated;
grant select on public.transacciones_pago to authenticated;
create policy transacciones_pago_dueno on public.transacciones_pago for select to authenticated using (public.es_dueno(kiosco_id));

-- 3) Horas que un pedido espera su pago antes de vencer (y liberar el stock). La app usa el mismo valor (lib/pagos/mp.ts).
create or replace function public.pago_horas_vencimiento() returns int language sql immutable set search_path = '' as $$ select 3 $$;

-- 4) Protección: el navegador no puede tocar el estado de pago ni la reserva, ni confirmar un pedido que espera su pago.
--    Las funciones internas fijan app.pagos_interno para poder hacerlo.
create or replace function public.pedidos_proteger_pago() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.pagos_interno', true) = '1' or auth.uid() is null then return new; end if;
  if new.pago_estado is distinct from old.pago_estado or new.stock_reservado is distinct from old.stock_reservado
     or new.pago_consultado_at is distinct from old.pago_consultado_at then
    raise exception 'pago_protegido';
  end if;
  if old.pago_estado = 'pendiente' and new.estado is distinct from old.estado and new.estado in ('confirmado', 'entregado') then
    raise exception 'pago_pendiente';
  end if;
  return new;
end $$;
revoke execute on function public.pedidos_proteger_pago() from public, anon, authenticated;

create trigger pedidos_proteger_pago before update on public.pedidos
  for each row execute function public.pedidos_proteger_pago();

-- 5) Stock: un pedido "retiene" stock si está confirmado/entregado, o si está pendiente con la reserva hecha.
--    Es la versión de 0020 con esa condición; el trigger ahora también reacciona al cambio de stock_reservado.
create or replace function public.stock_al_consumir() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_consume_old boolean := old.estado in ('confirmado', 'entregado') or (old.estado = 'pendiente' and old.stock_reservado);
  v_consume_new boolean := new.estado in ('confirmado', 'entregado') or (new.estado = 'pendiente' and new.stock_reservado);
  it record;
begin
  if v_consume_old = v_consume_new then return new; end if;
  perform set_config('app.mov_tipo', case when v_consume_new then 'pedido' else 'cancelacion_pedido' end, true);
  for it in
    select producto_id, sum(cantidad)::int as cant from public.pedido_items
    where pedido_id = new.id and producto_id is not null group by producto_id
  loop
    if v_consume_new then
      if exists (select 1 from public.productos p where p.id = it.producto_id and p.stock_controlado and p.stock < it.cant) then
        raise exception 'sin_stock';
      end if;
      update public.productos
        set stock = stock - it.cant,
            disponible = case when stock - it.cant = 0 then false else disponible end
        where id = it.producto_id and stock_controlado;
    else
      -- Al devolver el stock: si el producto había quedado sin stock (y por eso no disponible), vuelve a estar disponible.
      update public.productos set stock = stock + it.cant, disponible = case when stock = 0 then true else disponible end
        where id = it.producto_id and stock_controlado;
    end if;
  end loop;
  return new;
end $$;

create or replace trigger pedidos_stock after update of estado, stock_reservado on public.pedidos
  for each row when (old.estado is distinct from new.estado or old.stock_reservado is distinct from new.stock_reservado)
  execute function public.stock_al_consumir();

-- 6) Vencimiento: los pedidos que esperan pago hace más de p_horas se cancelan y liberan su stock.
--    Sin p_horas usa pago_horas_vencimiento(). Con p_kiosco, solo ese local (crear_pedido lo llama antes de mirar el stock).
create or replace function public.pago_vencer_pendientes(p_horas int default null, p_kiosco uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids jsonb;
begin
  perform set_config('app.pagos_interno', '1', true);
  with v as (
    update public.pedidos
       set pago_estado = 'fallido', estado = 'cancelado'
     where pago_estado = 'pendiente' and estado = 'pendiente'
       and created_at < now() - make_interval(hours => coalesce(p_horas, public.pago_horas_vencimiento()))
       and (p_kiosco is null or kiosco_id = p_kiosco)
    returning id
  ), t as (
    update public.transacciones_pago set estado = 'vencido', updated_at = now()
     where pedido_id in (select id from v) and estado = 'pendiente'
    returning 1
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from v;
  return jsonb_build_object('vencidos', v_ids);
end $$;

-- 7) crear_pedido: igual que 0009, más el cobro online. Si el medio es mercadopago y el local tiene el cobro online activo
--    (con una conexión vigente), el pedido nace esperando pago y reserva el stock.
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
  v_online boolean := false;
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

  if v_kiosco.cobro_online_activo then
    -- Antes de mirar el stock, se liberan los pedidos de este local que esperaron su pago demasiado.
    perform public.pago_vencer_pendientes(null, v_kiosco.id);
    v_online := p_medio_pago = 'mercadopago'
      and exists (select 1 from public.integraciones_pago i where i.kiosco_id = v_kiosco.id and i.activa);
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

  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, direccion, notas, total, medio_pago, costo_envio, pago_estado)
  values (v_kiosco.id, v_cliente, v_nombre, v_tel, p_modalidad,
          case when p_modalidad = 'envio' then left(trim(p_direccion), 200) end, left(p_notas, 300), 0, p_medio_pago, v_envio,
          case when v_online then 'pendiente' else 'no_aplica' end)
  returning id, numero into v_pedido, v_numero;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::int;
    if v_cant is null or v_cant < 1 or v_cant > 99 then raise exception 'cantidad_invalida'; end if;
    select * into v_prod from public.productos
      where id = (v_item->>'producto_id')::uuid and kiosco_id = v_kiosco.id and disponible;
    if not found then raise exception 'producto_no_disponible'; end if;
    if v_prod.stock_controlado and v_prod.stock < v_cant then raise exception 'sin_stock'; end if;
    insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    values (v_pedido, v_prod.id, v_prod.nombre, v_prod.precio, v_cant);
    v_subtotal := v_subtotal + v_prod.precio * v_cant;
  end loop;

  if v_subtotal < v_kiosco.pedido_minimo then raise exception 'minimo_no_alcanzado'; end if;

  update public.pedidos set total = v_subtotal + v_envio where id = v_pedido;
  if v_online then
    -- Reserva: el trigger de stock descuenta lo pedido (y falla con sin_stock si ya no alcanza).
    perform set_config('app.pagos_interno', '1', true);
    update public.pedidos set stock_reservado = true where id = v_pedido;
  end if;
  return jsonb_build_object('pedido_id', v_pedido, 'numero', v_numero, 'subtotal', v_subtotal,
                            'costo_envio', v_envio, 'total', v_subtotal + v_envio, 'pago_online', v_online);
end $$;

-- 8) pago_confirmar: aplica un pago ya consultado a Mercado Pago. Idempotente.
--    Resultados: confirmado, duplicado, pendiente, rechazado, reembolsado, monto_invalido, cancelado_con_pago,
--    pago_duplicado, pagado_sin_stock, ya_confirmado, ignorado, no_aplica.
create or replace function public.pago_confirmar(
  p_proveedor text, p_payment_id text, p_pedido uuid, p_monto numeric, p_moneda text, p_estado text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_p public.pedidos%rowtype;
  v_tx public.transacciones_pago%rowtype;
begin
  perform set_config('app.pagos_interno', '1', true);
  if p_estado is null or p_estado not in ('pendiente', 'aprobado', 'rechazado', 'vencido', 'reembolsado') then raise exception 'estado_pago_invalido'; end if;
  if coalesce(p_payment_id, '') = '' or coalesce(p_proveedor, '') = '' then raise exception 'pago_invalido'; end if;

  select * into v_p from public.pedidos where id = p_pedido for update;
  if not found then raise exception 'pedido_no_encontrado'; end if;
  if v_p.pago_estado = 'no_aplica' then return jsonb_build_object('resultado', 'no_aplica'); end if;

  -- La transacción: por payment_id; si no existe, la preferencia del pedido que aún no tiene pago; si no, una nueva.
  select * into v_tx from public.transacciones_pago where proveedor = p_proveedor and payment_id = p_payment_id for update;
  if found then
    if v_tx.pedido_id <> p_pedido then raise exception 'pago_invalido'; end if;
  else
    select * into v_tx from public.transacciones_pago
      where pedido_id = p_pedido and proveedor = p_proveedor and payment_id is null
      order by created_at desc limit 1 for update;
    if found then
      update public.transacciones_pago set payment_id = p_payment_id, updated_at = now() where id = v_tx.id returning * into v_tx;
    else
      insert into public.transacciones_pago (kiosco_id, pedido_id, proveedor, payment_id, estado, monto, moneda)
        values (v_p.kiosco_id, p_pedido, p_proveedor, p_payment_id, 'pendiente', v_p.total, 'ARS')
        returning * into v_tx;
    end if;
  end if;

  if p_estado = 'pendiente' then
    return jsonb_build_object('resultado', 'pendiente');

  elsif p_estado = 'aprobado' then
    if v_tx.estado in ('aprobado', 'reembolsado') then return jsonb_build_object('resultado', 'duplicado'); end if;
    if p_monto is null or p_monto <> v_p.total or upper(coalesce(p_moneda, '')) <> 'ARS' then
      update public.transacciones_pago set detalle = 'monto_distinto', updated_at = now() where id = v_tx.id;
      return jsonb_build_object('resultado', 'monto_invalido');
    end if;
    update public.transacciones_pago set estado = 'aprobado', detalle = null, updated_at = now() where id = v_tx.id;

    if v_p.pago_estado = 'pagado' or v_p.pago_estado = 'reembolsado' then
      return jsonb_build_object('resultado', 'pago_duplicado');            -- el pedido ya estaba pagado con otro pago
    end if;
    if v_p.estado in ('confirmado', 'entregado') then
      update public.pedidos set pago_estado = 'pagado' where id = p_pedido;
      return jsonb_build_object('resultado', 'ya_confirmado');
    end if;
    if v_p.estado = 'cancelado' and v_p.pago_estado <> 'fallido' then
      update public.pedidos set pago_estado = 'pagado' where id = p_pedido;  -- lo canceló el dueño: hay que reembolsar
      return jsonb_build_object('resultado', 'cancelado_con_pago');
    end if;
    -- Pendiente, o cancelado por falla/vencimiento del pago: se confirma (reabriéndolo si hace falta) mientras haya stock.
    begin
      update public.pedidos set pago_estado = 'pagado', estado = 'confirmado' where id = p_pedido;
      return jsonb_build_object('resultado', 'confirmado');
    exception when others then
      if sqlerrm not like '%sin_stock%' then raise; end if;
      update public.pedidos set pago_estado = 'pagado' where id = p_pedido;
      return jsonb_build_object('resultado', case when v_p.estado = 'cancelado' then 'cancelado_con_pago' else 'pagado_sin_stock' end);
    end;

  elsif p_estado in ('rechazado', 'vencido') then
    if v_tx.estado in ('aprobado', 'reembolsado') then return jsonb_build_object('resultado', 'ignorado'); end if;
    update public.transacciones_pago set estado = p_estado, updated_at = now() where id = v_tx.id;
    -- Si no hay otro intento en curso, el pedido se cancela y libera su stock.
    if v_p.pago_estado = 'pendiente' and v_p.estado = 'pendiente'
       and not exists (select 1 from public.transacciones_pago t
                        where t.pedido_id = p_pedido and t.id <> v_tx.id and t.estado = 'pendiente' and t.payment_id is not null) then
      update public.pedidos set pago_estado = 'fallido', estado = 'cancelado' where id = p_pedido;
      return jsonb_build_object('resultado', 'rechazado');
    end if;
    return jsonb_build_object('resultado', 'ignorado');

  else -- reembolsado
    update public.transacciones_pago set estado = 'reembolsado', updated_at = now() where id = v_tx.id;
    if v_p.pago_estado = 'pagado' then update public.pedidos set pago_estado = 'reembolsado' where id = p_pedido; end if;
    return jsonb_build_object('resultado', 'reembolsado');
  end if;
end $$;

-- 9) Estado público de un pedido para la pantalla de retorno. Sin datos personales. Solo el servidor la llama.
create or replace function public.pago_estado_pedido(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_p public.pedidos%rowtype; v_link text;
begin
  select * into v_p from public.pedidos where id = p_pedido;
  if not found then raise exception 'pedido_no_encontrado'; end if;
  if v_p.pago_estado = 'pendiente' then
    select link_pago into v_link from public.transacciones_pago
      where pedido_id = p_pedido and estado = 'pendiente' and link_pago is not null order by created_at desc limit 1;
  end if;
  return jsonb_build_object('pago_estado', v_p.pago_estado, 'estado', v_p.estado, 'numero', v_p.numero, 'total', v_p.total,
    'rechazado', exists (select 1 from public.transacciones_pago where pedido_id = p_pedido and estado = 'rechazado'), 'link', v_link);
end $$;

-- 10) Respaldo del webhook: ¿corresponde consultar a Mercado Pago ahora? Limita las consultas por pedido (rutas públicas).
--     Con p_segundos <= 0 (el cron) la consulta se fuerza.
create or replace function public.pago_puede_consultar(p_pedido uuid, p_segundos int default 10) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform set_config('app.pagos_interno', '1', true);
  update public.pedidos set pago_consultado_at = now()
   where id = p_pedido and pago_estado = 'pendiente'
     and (p_segundos <= 0 or pago_consultado_at is null or pago_consultado_at < now() - make_interval(secs => p_segundos))
  returning id into v_id;
  return v_id is not null;
end $$;

-- 11) Registro de avisos. Devuelve true si hay que procesarlo: es nuevo, o un reintento de uno que falló.
--     Los avisos con firma inválida se guardan (con un tope por hora) pero nunca se procesan.
create or replace function public.webhook_registrar(
  p_proveedor text, p_evento text, p_firma_valida boolean, p_tipo text, p_kiosco uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(p_evento, '') = '' then raise exception 'evento_invalido'; end if;
  if not coalesce(p_firma_valida, false) then
    if (select count(*) from public.webhooks_recibidos where kiosco_id = p_kiosco and estado = 'rechazado' and created_at > now() - interval '1 hour') < 200 then
      insert into public.webhooks_recibidos (proveedor, evento_id, tipo, kiosco_id, firma_valida, estado, detalle)
        values (p_proveedor, left(p_evento, 200), left(p_tipo, 40), p_kiosco, false, 'rechazado', 'firma_invalida')
        on conflict (proveedor, evento_id) do nothing;
    end if;
    return false;
  end if;
  insert into public.webhooks_recibidos (proveedor, evento_id, tipo, kiosco_id, firma_valida)
    values (p_proveedor, left(p_evento, 200), left(p_tipo, 40), p_kiosco, true)
    on conflict (proveedor, evento_id) do nothing
    returning id into v_id;
  if v_id is not null then return true; end if;
  update public.webhooks_recibidos
     set estado = 'recibido', firma_valida = true, kiosco_id = p_kiosco, intentos = intentos + 1, updated_at = now()
   where proveedor = p_proveedor and evento_id = left(p_evento, 200)
     and (estado in ('error', 'rechazado') or (estado = 'recibido' and updated_at < now() - interval '10 minutes'))
  returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.webhook_marcar(p_proveedor text, p_evento text, p_estado text, p_detalle text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_estado not in ('procesado', 'error') then raise exception 'estado_pago_invalido'; end if;
  update public.webhooks_recibidos set estado = p_estado, detalle = left(p_detalle, 200), updated_at = now()
   where proveedor = p_proveedor and evento_id = left(p_evento, 200);
end $$;

-- 12) Lo que ve el dueño de su conexión: solo el estado y el final del token, nunca la credencial.
create or replace function public.mp_estado_conexion(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.integraciones_pago%rowtype; v_activo boolean;
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select cobro_online_activo into v_activo from public.kioscos where id = p_kiosco;
  select * into i from public.integraciones_pago where kiosco_id = p_kiosco;
  if not found then return jsonb_build_object('conectada', false, 'cobro_online_activo', coalesce(v_activo, false)); end if;
  return jsonb_build_object('conectada', true, 'activa', i.activa, 'cobro_online_activo', coalesce(v_activo, false),
    'mp_user_id', i.mp_user_id, 'token_ultimos4', i.token_ultimos4, 'forma_conexion', i.forma_conexion,
    'sin_secreto', i.webhook_secret_cifrado is null, 'actualizada', i.updated_at,
    'pendientes', (select count(*) from public.pedidos where kiosco_id = p_kiosco and pago_estado = 'pendiente' and estado = 'pendiente'));
end $$;

create or replace function public.mp_desconectar(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  delete from public.integraciones_pago where kiosco_id = p_kiosco;
  update public.kioscos set cobro_online_activo = false where id = p_kiosco;
  return jsonb_build_object('conectada', false);
end $$;

-- 13) Permisos. Todo lo de pagos es del servidor, salvo lo que ve y hace el dueño de su propia conexión.
revoke all on function public.pago_horas_vencimiento() from public, anon;
revoke all on function public.pago_vencer_pendientes(int, uuid) from public, anon, authenticated;
revoke all on function public.pago_confirmar(text, text, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.pago_estado_pedido(uuid) from public, anon, authenticated;
revoke all on function public.pago_puede_consultar(uuid, int) from public, anon, authenticated;
revoke all on function public.webhook_registrar(text, text, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.webhook_marcar(text, text, text, text) from public, anon, authenticated;
revoke all on function public.mp_estado_conexion(uuid) from public, anon;
revoke all on function public.mp_desconectar(uuid) from public, anon;
grant execute on function public.mp_estado_conexion(uuid) to authenticated;
grant execute on function public.mp_desconectar(uuid) to authenticated;
