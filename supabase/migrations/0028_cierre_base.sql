-- 0028 · Cierre de base (etapa 0): exportación de datos y baja de cuenta del kiosco.
-- Aditiva: una columna nueva y funciones nuevas. No toca datos existentes.
--  - kiosco_exportar_seccion: el dueño baja sus datos, una sección por llamada (JSON).
--  - kiosco_pedir_baja / kiosco_cancelar_baja: baja "suave". Cierra la tienda y marca la fecha; los datos se conservan.
--  - kioscos_purgar_bajas: borrado definitivo de bajas con más de 30 días. Solo la corre quien administra la plataforma
--    (rol service_role o SQL Editor); ni anon ni authenticated pueden llamarla.

alter table public.kioscos add column if not exists baja_solicitada_at timestamptz;

-- Secciones exportables. Las "directas" tienen kiosco_id; las "hijas" cuelgan de una tabla con kiosco_id.
create or replace function public.kiosco_exportar_seccion(p_kiosco uuid, p_seccion text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_directas text[] := array[
    'productos','clientes','pedidos','fiado_movimientos','sellos','canjes','proveedores','compras',
    'proveedor_movimientos','stock_movimientos','ventas_mostrador','devoluciones_mostrador','turnos_caja',
    'movimientos_caja','fidelidad_campanas','fidelidad_premios','pos_promos','lotes_stock','pedidos_proveedor',
    'ajustes_precios','historial_precios'
  ];
  -- tabla hija -> [tabla padre, columna que apunta al padre]
  v_hijas jsonb := '{
    "pedido_items": ["pedidos","pedido_id"],
    "ventas_mostrador_items": ["ventas_mostrador","venta_id"],
    "ventas_mostrador_pagos": ["ventas_mostrador","venta_id"],
    "compra_items": ["compras","compra_id"],
    "devoluciones_mostrador_items": ["devoluciones_mostrador","devolucion_id"],
    "pedido_proveedor_items": ["pedidos_proveedor","pedido_id"]
  }'::jsonb;
  v_res jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.kioscos where id = p_kiosco and owner_id = auth.uid()) then
    raise exception 'no_autorizado';
  end if;

  if p_seccion = 'kiosco' then
    -- Sin owner_id: es un identificador interno de la cuenta.
    select to_jsonb(k) - 'owner_id' into v_res from public.kioscos k where k.id = p_kiosco;
    return v_res;
  elsif p_seccion = any (v_directas) then
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.kiosco_id = $1', p_seccion)
      into v_res using p_kiosco;
    return v_res;
  elsif v_hijas ? p_seccion then
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where t.%I in (select id from public.%I where kiosco_id = $1)',
      p_seccion, v_hijas -> p_seccion ->> 1, v_hijas -> p_seccion ->> 0)
      into v_res using p_kiosco;
    return v_res;
  end if;
  raise exception 'seccion_invalida';
end $$;

-- Pide la baja. El dueño confirma escribiendo el nombre de su local. Cierra la tienda y desactiva el horario automático.
create or replace function public.kiosco_pedir_baja(p_kiosco uuid, p_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_k public.kioscos;
begin
  select * into v_k from public.kioscos where id = p_kiosco and owner_id = auth.uid();
  if not found then raise exception 'no_autorizado'; end if;
  if lower(btrim(coalesce(p_nombre, ''))) <> lower(btrim(v_k.nombre)) then raise exception 'confirmacion_invalida'; end if;
  update public.kioscos
     set baja_solicitada_at = coalesce(baja_solicitada_at, now()), abierto = false, horario_auto = false
   where id = p_kiosco
   returning baja_solicitada_at into v_k.baja_solicitada_at;
  return jsonb_build_object('baja_solicitada_at', v_k.baja_solicitada_at, 'borrado_desde', v_k.baja_solicitada_at + interval '30 days');
end $$;

-- Arrepentimiento: quita la marca de baja. La tienda queda cerrada; el dueño la reabre cuando quiera.
create or replace function public.kiosco_cancelar_baja(p_kiosco uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.kioscos where id = p_kiosco and owner_id = auth.uid()) then raise exception 'no_autorizado'; end if;
  update public.kioscos set baja_solicitada_at = null where id = p_kiosco;
  return jsonb_build_object('baja_solicitada_at', null);
end $$;

-- Borrado definitivo de las bajas con más de p_dias días (mínimo 30). Devuelve cuántos kioscos borró.
-- Las tablas del kiosco caen en cascada. La cuenta de Google (auth.users) no se toca.
create or replace function public.kioscos_purgar_bajas(p_dias int default 30)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_dias is null or p_dias < 30 then raise exception 'dias_invalidos'; end if;
  with b as (
    delete from public.kioscos where baja_solicitada_at is not null and baja_solicitada_at < now() - make_interval(days => p_dias) returning 1
  ) select count(*) into v_n from b;
  return v_n;
end $$;

revoke all on function public.kiosco_exportar_seccion(uuid, text) from public, anon;
revoke all on function public.kiosco_pedir_baja(uuid, text) from public, anon;
revoke all on function public.kiosco_cancelar_baja(uuid) from public, anon;
revoke all on function public.kioscos_purgar_bajas(int) from public, anon, authenticated;
grant execute on function public.kiosco_exportar_seccion(uuid, text) to authenticated;
grant execute on function public.kiosco_pedir_baja(uuid, text) to authenticated;
grant execute on function public.kiosco_cancelar_baja(uuid) to authenticated;
