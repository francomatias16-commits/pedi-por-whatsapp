-- 0033 · Etapa 3C: envío por zonas.
-- Aditiva. El local define zonas (nombre, barrios, costo, pedido mínimo). Con el interruptor encendido, el cliente elige una zona
-- al pedir envío y crear_pedido toma el costo y el mínimo de la zona desde la base.
--  - zonas_envio: se lee públicamente solo lo activo (la tienda lo necesita); se escribe solo por RPC (encargado y dueño).
--  - kioscos.zonas_envio_activo: interruptor por local, arranca apagado. Apagado, el envío funciona como hasta ahora (costo único).
--  - pedidos.zona_id / zona_nombre: la zona queda anotada en el pedido (el nombre se copia: no cambia si después se renombra).
--  - crear_pedido pasa a tener la zona. La versión de 8 argumentos sigue existiendo y delega (sin zona): una app vieja no se rompe
--    mientras el local no use zonas; si las usa, responde zona_requerida.
-- Aplicar DESPUÉS de 0001..0032.

alter table public.kioscos add column if not exists zonas_envio_activo boolean not null default false;

create table public.zonas_envio (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 60),
  descripcion text check (descripcion is null or length(descripcion) <= 200),
  costo numeric(12,2) not null default 0 check (costo >= 0 and costo <= 1000000),
  pedido_minimo numeric(12,2) not null default 0 check (pedido_minimo >= 0 and pedido_minimo <= 10000000),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index zonas_envio_nombre on public.zonas_envio (kiosco_id, lower(nombre));
create index zonas_envio_kiosco on public.zonas_envio (kiosco_id, activa);

alter table public.zonas_envio enable row level security;
revoke all on public.zonas_envio from anon, authenticated;
grant select on public.zonas_envio to anon, authenticated;
create policy zonas_envio_publicas on public.zonas_envio for select to anon, authenticated using (activa);
create policy zonas_envio_miembros on public.zonas_envio for select to authenticated using (public.es_miembro(kiosco_id, array['encargado', 'dueno']));

alter table public.pedidos
  add column if not exists zona_id uuid references public.zonas_envio(id) on delete set null,
  add column if not exists zona_nombre text;

-- Guardar una zona (crear si p_id es null, editar si no). Encargado y dueño.
create or replace function public.zona_guardar(p_kiosco uuid, p_id uuid, p_nombre text, p_descripcion text, p_costo numeric, p_minimo numeric, p_activa boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nombre text := left(trim(coalesce(p_nombre, '')), 60); v_id uuid;
begin
  if auth.uid() is null or not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  if length(v_nombre) < 1 then raise exception 'zona_nombre_invalido'; end if;
  if p_costo is null or p_costo < 0 or p_costo > 1000000 or round(p_costo, 2) <> p_costo
     or coalesce(p_minimo, 0) < 0 or coalesce(p_minimo, 0) > 10000000 or round(coalesce(p_minimo, 0), 2) <> coalesce(p_minimo, 0) then raise exception 'zona_costo_invalido'; end if;
  if p_id is null then
    if (select count(*) from public.zonas_envio where kiosco_id = p_kiosco) >= 30 then raise exception 'zonas_maximas'; end if;
    insert into public.zonas_envio (kiosco_id, nombre, descripcion, costo, pedido_minimo, activa)
      values (p_kiosco, v_nombre, nullif(left(trim(coalesce(p_descripcion, '')), 200), ''), p_costo, coalesce(p_minimo, 0), coalesce(p_activa, true))
      returning id into v_id;
  else
    update public.zonas_envio set nombre = v_nombre, descripcion = nullif(left(trim(coalesce(p_descripcion, '')), 200), ''), costo = p_costo,
           pedido_minimo = coalesce(p_minimo, 0), activa = coalesce(p_activa, true), updated_at = now()
     where id = p_id and kiosco_id = p_kiosco returning id into v_id;
    if v_id is null then raise exception 'zona_no_encontrada'; end if;
    -- Sin zonas activas el interruptor no puede quedar encendido.
    if not exists (select 1 from public.zonas_envio where kiosco_id = p_kiosco and activa) then
      update public.kioscos set zonas_envio_activo = false where id = p_kiosco;
    end if;
  end if;
  return jsonb_build_object('id', v_id);
exception when unique_violation then raise exception 'zona_repetida';
end $$;

-- Quitar una zona. Los pedidos que la usaron conservan su nombre.
create or replace function public.zona_quitar(p_kiosco uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  delete from public.zonas_envio where id = p_id and kiosco_id = p_kiosco returning id into v_id;
  if v_id is null then raise exception 'zona_no_encontrada'; end if;
  if not exists (select 1 from public.zonas_envio where kiosco_id = p_kiosco and activa) then
    update public.kioscos set zonas_envio_activo = false where id = p_kiosco;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Interruptor. Solo el dueño, y con al menos una zona activa.
create or replace function public.zonas_configurar_activo(p_kiosco uuid, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_activo and not exists (select 1 from public.zonas_envio where kiosco_id = p_kiosco and activa) then raise exception 'sin_zonas'; end if;
  update public.kioscos set zonas_envio_activo = coalesce(p_activo, false) where id = p_kiosco;
  return jsonb_build_object('activo', coalesce(p_activo, false));
end $$;

-- crear_pedido con zona (base: versión de 0029).
create or replace function public.crear_pedido(
  p_slug text, p_nombre text, p_telefono text, p_modalidad public.modalidad_pedido,
  p_direccion text, p_notas text, p_items jsonb, p_zona uuid, p_medio_pago text
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
  v_zona public.zonas_envio%rowtype; v_minimo numeric(12,2);
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

  v_minimo := v_kiosco.pedido_minimo;
  if p_modalidad = 'envio' then
    if v_kiosco.zonas_envio_activo then
      -- Con zonas, el costo y el mínimo salen de la zona elegida (siempre de la base, nunca del navegador).
      if p_zona is null then raise exception 'zona_requerida'; end if;
      select * into v_zona from public.zonas_envio where id = p_zona and kiosco_id = v_kiosco.id and activa;
      if not found then raise exception 'zona_invalida'; end if;
      v_envio := v_zona.costo;
      v_minimo := greatest(v_kiosco.pedido_minimo, v_zona.pedido_minimo);
    else
      v_envio := v_kiosco.costo_envio;
    end if;
  end if;

  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, direccion, notas, total, medio_pago, costo_envio, pago_estado, zona_id, zona_nombre)
  values (v_kiosco.id, v_cliente, v_nombre, v_tel, p_modalidad,
          case when p_modalidad = 'envio' then left(trim(p_direccion), 200) end, left(p_notas, 300), 0, p_medio_pago, v_envio,
          case when v_online then 'pendiente' else 'no_aplica' end,
          v_zona.id, v_zona.nombre)
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

  if v_subtotal < v_minimo then raise exception 'minimo_no_alcanzado'; end if;

  update public.pedidos set total = v_subtotal + v_envio where id = v_pedido;
  if v_online then
    -- Reserva: el trigger de stock descuenta lo pedido (y falla con sin_stock si ya no alcanza).
    perform set_config('app.pagos_interno', '1', true);
    update public.pedidos set stock_reservado = true where id = v_pedido;
  end if;
  return jsonb_build_object('pedido_id', v_pedido, 'numero', v_numero, 'subtotal', v_subtotal,
                            'costo_envio', v_envio, 'total', v_subtotal + v_envio, 'pago_online', v_online, 'zona', v_zona.nombre);
end $$;

-- Versión anterior (8 argumentos): delega sin zona. Con zonas encendidas, un envío responde zona_requerida.
create or replace function public.crear_pedido(
  p_slug text, p_nombre text, p_telefono text, p_modalidad public.modalidad_pedido,
  p_direccion text, p_notas text, p_items jsonb, p_medio_pago text default 'efectivo'
) returns jsonb language sql security definer set search_path = public as $$
  select public.crear_pedido(p_slug, p_nombre, p_telefono, p_modalidad, p_direccion, p_notas, p_items, null::uuid, p_medio_pago);
$$;

revoke all on function public.zona_guardar(uuid, uuid, text, text, numeric, numeric, boolean) from public, anon;
revoke all on function public.zona_quitar(uuid, uuid) from public, anon;
revoke all on function public.zonas_configurar_activo(uuid, boolean) from public, anon;
grant execute on function public.zona_guardar(uuid, uuid, text, text, numeric, numeric, boolean) to authenticated;
grant execute on function public.zona_quitar(uuid, uuid) to authenticated;
grant execute on function public.zonas_configurar_activo(uuid, boolean) to authenticated;
revoke all on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, uuid, text) from public;
revoke all on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, text) from public;
grant execute on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, uuid, text) to anon, authenticated;
grant execute on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, text) to anon, authenticated;
