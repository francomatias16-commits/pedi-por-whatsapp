-- Etapa 3: operación diaria del kiosco.
--  * Tienda abierta/cerrada + horario (texto), pedido mínimo, costo de envío, medios de pago.
--  * Medio de pago y costo de envío quedan guardados en cada pedido (total = ítems + envío).
--  * crear_pedido con límites anti-spam y devuelve el número de pedido.
-- Aplicar DESPUÉS de 0001, 0002 y 0003.

alter table public.kioscos
  add column abierto boolean not null default true,
  add column horario text check (horario is null or length(horario) <= 120),
  add column pedido_minimo numeric(12,2) not null default 0 check (pedido_minimo >= 0),
  add column costo_envio numeric(12,2) not null default 0 check (costo_envio >= 0),
  add column medios_pago text[] not null default array['efectivo']
    check (cardinality(medios_pago) >= 1 and medios_pago <@ array['efectivo','transferencia','mercadopago']);

alter table public.pedidos
  add column medio_pago text not null default 'efectivo' check (medio_pago in ('efectivo','transferencia','mercadopago')),
  add column costo_envio numeric(12,2) not null default 0 check (costo_envio >= 0);

-- Índice para los límites de frecuencia (por teléfono y por local).
create index pedidos_tel_reciente on public.pedidos (kiosco_id, cliente_telefono, created_at desc);

-- La firma cambia (se agrega p_medio_pago): se elimina la anterior para no dejar dos versiones públicas.
drop function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb);

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

  -- Anti-spam: máx. 3 pedidos por teléfono cada 10 min, y 30 por local cada 10 min.
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

  -- Si no llega al mínimo, la excepción deshace todo el pedido (también el cliente nuevo).
  if v_subtotal < v_kiosco.pedido_minimo then raise exception 'minimo_no_alcanzado'; end if;

  update public.pedidos set total = v_subtotal + v_envio where id = v_pedido;
  return jsonb_build_object('pedido_id', v_pedido, 'numero', v_numero, 'subtotal', v_subtotal,
                            'costo_envio', v_envio, 'total', v_subtotal + v_envio);
end $$;

revoke all on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, text) from public;
grant execute on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, text) to anon, authenticated;
