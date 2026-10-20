-- 0060 · Un solo QR: el del club también lleva al catálogo, y cada producto elige si se ve en la tienda.
-- Aplicar DESPUÉS de 0059. Sin DROP ni DELETE; las funciones se reemplazan y conservan sus permisos.
--  * kioscos.tienda_activa: el local decide si tiene tienda online (por defecto sí, como hasta ahora).
--  * productos.visible_tienda: el dueño decide qué productos se muestran en la tienda. NO es lo mismo que "disponible"
--    (que significa "hay stock" y lo mueven solos las ventas y compras): ocultar un producto no lo saca de la Caja.
--  * La lectura pública de productos exige disponible Y visible_tienda; crear_pedido rechaza productos ocultos
--    y también pedidos a un local con la tienda apagada ('tienda_no_disponible').
--  * tienda_disponible(kiosco): tienda encendida, sin baja y con al menos un producto que se pueda pedir.
--    club_datos y club_armar_tarjeta devuelven 'tienda' para que el QR del club muestre (o no) el acceso al catálogo.
--  * tienda_disponible_slug(slug): lo mismo por slug, pública; la usa /{slug}/club cuando el club está apagado.
-- IMPORTANTE: columnas nuevas de kioscos que la tienda pública necesita requieren grant select a anon (ver 0038).

alter table public.kioscos add column if not exists tienda_activa boolean not null default true;
alter table public.productos add column if not exists visible_tienda boolean not null default true;

grant select (tienda_activa) on public.kioscos to anon;
grant select (visible_tienda) on public.productos to anon;

alter policy productos_select_publico on public.productos using (disponible and visible_tienda);

create index if not exists productos_tienda_idx on public.productos (kiosco_id) where disponible and visible_tienda;

create or replace function public.tienda_disponible(p_kiosco uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kioscos k where k.id = p_kiosco and k.tienda_activa and k.baja_solicitada_at is null)
     and exists (select 1 from public.productos p where p.kiosco_id = p_kiosco and p.disponible and p.visible_tienda)
$$;
revoke all on function public.tienda_disponible(uuid) from public, anon, authenticated;

create or replace function public.tienda_disponible_slug(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.tienda_disponible(k.id) from public.kioscos k where k.slug = p_slug), false)
$$;
revoke all on function public.tienda_disponible_slug(text) from public;
grant execute on function public.tienda_disponible_slug(text) to anon, authenticated;

-- crear_pedido (versión de 0036) con dos chequeos nuevos: tienda apagada y producto oculto.
create or replace function public.crear_pedido(
  p_slug text, p_nombre text, p_telefono text, p_modalidad public.modalidad_pedido,
  p_direccion text, p_notas text, p_items jsonb, p_zona uuid, p_medio_pago text, p_franja uuid
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
  v_franja public.franjas_entrega%rowtype; v_franja_txt text;
begin
  select * into v_kiosco from public.kioscos where slug = p_slug;
  if not found then raise exception 'kiosco_no_encontrado'; end if;
  if not v_kiosco.tienda_activa or v_kiosco.baja_solicitada_at is not null then raise exception 'tienda_no_disponible'; end if;
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

  -- Ventana de entrega: con franjas encendidas, un envío tiene que elegir una activa de este local (se lee de la base, no del navegador).
  if p_modalidad = 'envio' and v_kiosco.franjas_entrega_activo then
    if p_franja is null then raise exception 'franja_requerida'; end if;
    select * into v_franja from public.franjas_entrega where id = p_franja and kiosco_id = v_kiosco.id and activa;
    if not found then raise exception 'franja_invalida'; end if;
    v_franja_txt := v_franja.nombre || ' (' || to_char(v_franja.desde, 'HH24:MI') || ' a ' || to_char(v_franja.hasta, 'HH24:MI') || ')';
  end if;

  insert into public.pedidos (kiosco_id, cliente_id, cliente_nombre, cliente_telefono, modalidad, direccion, notas, total, medio_pago, costo_envio, pago_estado, zona_id, zona_nombre, franja_id, franja_nombre)
  values (v_kiosco.id, v_cliente, v_nombre, v_tel, p_modalidad,
          case when p_modalidad = 'envio' then left(trim(p_direccion), 200) end, left(p_notas, 300), 0, p_medio_pago, v_envio,
          case when v_online then 'pendiente' else 'no_aplica' end,
          v_zona.id, v_zona.nombre, v_franja.id, v_franja_txt)
  returning id, numero into v_pedido, v_numero;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::int;
    if v_cant is null or v_cant < 1 or v_cant > 99 then raise exception 'cantidad_invalida'; end if;
    select * into v_prod from public.productos
      where id = (v_item->>'producto_id')::uuid and kiosco_id = v_kiosco.id and disponible and visible_tienda;
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
                            'costo_envio', v_envio, 'total', v_subtotal + v_envio, 'pago_online', v_online, 'zona', v_zona.nombre, 'franja', v_franja_txt);
end $$;

revoke all on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, uuid, text, uuid) from public;
grant execute on function public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, uuid, text, uuid) to anon, authenticated;

-- club_datos (versión de 0042) y club_armar_tarjeta (versión de 0052), con 'tienda' en la respuesta.
create or replace function public.club_datos(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k public.kioscos%rowtype; v_premio text; v_meta int; v_por int; v_bien int;
begin
  select * into k from public.kioscos where slug = p_slug;
  if not found or not k.club_activo then return null; end if;
  select p.nombre, p.costo_sellos into v_premio, v_meta from public.fidelidad_premios p
    where p.kiosco_id = k.id and p.activo order by p.costo_sellos, p.created_at limit 1;
  -- Lo que promete el QR: sellos por compra (sin la bienvenida, que se da una sola vez) y, aparte, el regalo de bienvenida.
  select coalesce(sum(r.cantidad) filter (where f.tipo is distinct from 'bienvenida'), 0)::int,
         coalesce(sum(r.cantidad) filter (where f.tipo = 'bienvenida'), 0)::int into v_por, v_bien
    from public.fidelidad_calcular(k.id, null, 'mostrador', 0, null, '[]'::jsonb, now()) r
    left join public.fidelidad_campanas f on f.id = r.campana_id;
  return jsonb_build_object('nombre', k.nombre, 'slug', k.slug, 'whatsapp', k.whatsapp, 'premio', v_premio, 'meta', v_meta, 'por_compra', v_por, 'bienvenida', v_bien,
    'tienda', public.tienda_disponible(k.id));
end $$;

create or replace function public.club_armar_tarjeta(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes%rowtype; k public.kioscos%rowtype; v_premio text; v_meta int; v_saldo int; v_bloq jsonb; v_hist jsonb; v_por int;
  v_niveles jsonb; v_prox jsonb; v_sorteo jsonb; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select * into c from public.clientes where id = p_cliente;
  select * into k from public.kioscos where id = c.kiosco_id;
  select p.nombre, p.costo_sellos into v_premio, v_meta from public.fidelidad_premios p
    where p.kiosco_id = c.kiosco_id and p.activo order by p.costo_sellos, p.created_at limit 1;
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = c.id;
  v_saldo := coalesce(v_saldo, 0);
  v_bloq := public.club_bloqueo(c.kiosco_id, c.id);
  select coalesce(sum(r.cantidad), 0)::int into v_por from public.fidelidad_calcular(c.kiosco_id, c.id, 'mostrador', 0, null, '[]'::jsonb, now()) r;
  select coalesce(jsonb_agg(jsonb_build_object('fecha', h.created_at, 'cantidad', h.cantidad) order by h.created_at desc), '[]'::jsonb) into v_hist
    from (select s.created_at, s.cantidad from public.sellos s where s.cliente_id = c.id and not s.anulado and s.cantidad > 0
          order by s.created_at desc limit 12) h;
  select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'costo_sellos', p.costo_sellos, 'alcanzado', v_saldo >= p.costo_sellos) order by p.costo_sellos, p.created_at)
    into v_niveles from public.fidelidad_premios p where p.kiosco_id = c.kiosco_id and p.activo;
  select jsonb_build_object('nombre', p.nombre, 'costo_sellos', p.costo_sellos, 'faltan', p.costo_sellos - v_saldo) into v_prox
    from public.fidelidad_premios p where p.kiosco_id = c.kiosco_id and p.activo and p.costo_sellos > v_saldo order by p.costo_sellos, p.created_at limit 1;
  select jsonb_build_object('nombre', s.nombre, 'hasta', s.hasta, 'mis_chances', (select count(*) from public.sorteo_chances(c.kiosco_id, s.desde, s.hasta) x where x.cliente_id = c.id)) into v_sorteo
    from public.sorteos s where s.kiosco_id = c.kiosco_id and s.estado = 'borrador' and s.permiso_confirmado and s.desde <= v_hoy and s.hasta >= v_hoy
    order by s.hasta limit 1;
  return jsonb_build_object('local', k.nombre, 'slug', k.slug, 'whatsapp', k.whatsapp, 'cliente', c.nombre,
    'sellos', v_saldo, 'premio', v_premio, 'meta', v_meta,
    'listo', v_meta is not null and v_saldo >= v_meta,
    'puede_sumar', v_bloq is null, 'bloqueo', v_bloq, 'historial', v_hist, 'por_compra', v_por,
    'exige_codigo', k.club_exigir_codigo,
    'ref', c.ref_codigo, 'cumple_dia', c.cumple_dia, 'cumple_mes', c.cumple_mes,
    'hay_cumple', exists (select 1 from public.fidelidad_campanas f where f.kiosco_id = c.kiosco_id and f.activa and f.tipo = 'cumpleanos'),
    'hay_referido', exists (select 1 from public.fidelidad_campanas f where f.kiosco_id = c.kiosco_id and f.activa and f.tipo = 'referido'),
    'niveles', coalesce(v_niveles, '[]'::jsonb), 'proximo', v_prox, 'sorteo', v_sorteo,
    'tienda', public.tienda_disponible(c.kiosco_id));
end $$;
