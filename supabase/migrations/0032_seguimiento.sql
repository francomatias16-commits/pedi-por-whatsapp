-- 0032 · Etapa 3A: seguimiento público del pedido.
-- Aditiva. El cliente abre un link con el estado de su pedido, sin ver ningún dato personal.
--  - pedidos.token_seguimiento: 64 caracteres hexadecimales (dos UUID v4), único. Solo lo leen los miembros del local (RLS de pedidos);
--    el cliente lo recibe en el link que le manda el local.
--  - pedidos.entrega_estado: 'listo' (retiro) o 'en_camino' (envío), solo con el pedido confirmado. No se amplía el enum estado_pedido
--    para no tocar los triggers de stock y pagos.
--  - kioscos.seguimiento_activo: interruptor por local, arranca apagado. Apagado, el link no responde.
--  - seguimiento_pedido(token): función pública que devuelve solo el estado y los datos del local.
-- Aplicar DESPUÉS de 0001..0031.

-- 1) Columnas. El default volátil se evalúa por fila: los pedidos anteriores también reciben su token.
alter table public.kioscos add column if not exists seguimiento_activo boolean not null default false;
alter table public.pedidos
  add column if not exists token_seguimiento text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  add column if not exists entrega_estado text check (entrega_estado in ('listo', 'en_camino'));
create unique index if not exists pedidos_token_seguimiento on public.pedidos (token_seguimiento);
alter table public.pedidos add constraint pedidos_token_formato check (token_seguimiento ~ '^[0-9a-f]{64}$');

-- 1b) La ruta pública /seguimiento no puede ser el slug de un local. Constraint nueva y NOT VALID: no toca locales existentes ni borra nada.
alter table public.kioscos add constraint kioscos_slug_reservado_seguimiento check (slug <> 'seguimiento') not valid;

-- 2) Reglas de la etapa de entrega y token inmutable desde el navegador.
create or replace function public.pedidos_proteger_seguimiento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.token_seguimiento is distinct from old.token_seguimiento then
    raise exception 'token_protegido';
  end if;
  if new.entrega_estado is distinct from old.entrega_estado and new.entrega_estado is not null then
    if new.estado <> 'confirmado' then raise exception 'entrega_estado_invalido'; end if;
    if new.entrega_estado = 'listo' and new.modalidad <> 'retiro' then raise exception 'entrega_estado_invalido'; end if;
    if new.entrega_estado = 'en_camino' and new.modalidad <> 'envio' then raise exception 'entrega_estado_invalido'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.pedidos_proteger_seguimiento() from public, anon, authenticated;
create trigger pedidos_proteger_seguimiento before update on public.pedidos
  for each row execute function public.pedidos_proteger_seguimiento();

-- 3) Consulta pública. Una sola respuesta (null) para token mal formado, inexistente o con el seguimiento apagado.
create or replace function public.seguimiento_pedido(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_p public.pedidos%rowtype; v_k public.kioscos%rowtype; v_etapa text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_p from public.pedidos where token_seguimiento = p_token;
  if not found then return null; end if;
  select * into v_k from public.kioscos where id = v_p.kiosco_id;
  if not found or not v_k.seguimiento_activo then return null; end if;
  v_etapa := case
    when v_p.estado = 'cancelado' then 'cancelado'
    when v_p.estado = 'entregado' then 'entregado'
    when v_p.estado = 'pendiente' and v_p.pago_estado = 'pendiente' then 'esperando_pago'
    when v_p.estado = 'pendiente' then 'recibido'
    when v_p.entrega_estado is not null then v_p.entrega_estado
    else 'confirmado' end;
  return jsonb_build_object('numero', v_p.numero, 'etapa', v_etapa, 'modalidad', v_p.modalidad, 'creado', v_p.created_at,
    'local', v_k.nombre, 'tienda', v_k.slug, 'whatsapp', v_k.whatsapp);
end $$;

-- 4) Interruptor. Solo el dueño.
create or replace function public.seguimiento_configurar_activo(p_kiosco uuid, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  update public.kioscos set seguimiento_activo = coalesce(p_activo, false) where id = p_kiosco;
  return jsonb_build_object('activo', coalesce(p_activo, false));
end $$;

revoke all on function public.seguimiento_pedido(text) from public;
revoke all on function public.seguimiento_configurar_activo(uuid, boolean) from public, anon;
grant execute on function public.seguimiento_pedido(text) to anon, authenticated;
grant execute on function public.seguimiento_configurar_activo(uuid, boolean) to authenticated;
