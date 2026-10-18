-- Etapa 3 · stock numérico (opcional por producto).
--  * Un producto con stock_controlado se descuenta cuando el pedido queda confirmado o entregado,
--    y se repone si ese pedido se cancela. Si el stock llega a 0 el producto deja de estar disponible.
--  * crear_pedido no deja pedir más de lo que hay. confirmar un pedido sin stock suficiente falla con 'sin_stock'.
--  * La tienda pública (anon) NO puede leer la columna stock: solo ve disponibilidad y precio.
-- Aplicar DESPUÉS de 0001..0008.

alter table public.productos
  add column stock_controlado boolean not null default false,
  add column stock int not null default 0 check (stock >= 0);

revoke select on public.productos from anon;
grant select (id, kiosco_id, barcode, nombre, categoria, precio, disponible, imagen_url, created_at) on public.productos to anon;

create or replace function public.stock_al_consumir() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_consume_old boolean := old.estado in ('confirmado', 'entregado');
  v_consume_new boolean := new.estado in ('confirmado', 'entregado');
  it record;
begin
  if v_consume_old = v_consume_new then return new; end if;
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
      update public.productos set stock = stock + it.cant
        where id = it.producto_id and stock_controlado;
    end if;
  end loop;
  return new;
end $$;

revoke execute on function public.stock_al_consumir() from public, anon, authenticated;

create trigger pedidos_stock after update of estado on public.pedidos
  for each row when (old.estado is distinct from new.estado)
  execute function public.stock_al_consumir();



-- crear_pedido: igual que en 0006, pero rechaza productos sin stock suficiente.
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
    if v_prod.stock_controlado and v_prod.stock < v_cant then raise exception 'sin_stock'; end if;
    insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unit, cantidad)
    values (v_pedido, v_prod.id, v_prod.nombre, v_prod.precio, v_cant);
    v_subtotal := v_subtotal + v_prod.precio * v_cant;
  end loop;

  if v_subtotal < v_kiosco.pedido_minimo then raise exception 'minimo_no_alcanzado'; end if;

  update public.pedidos set total = v_subtotal + v_envio where id = v_pedido;
  return jsonb_build_object('pedido_id', v_pedido, 'numero', v_numero, 'subtotal', v_subtotal,
                            'costo_envio', v_envio, 'total', v_subtotal + v_envio);
end $$;
