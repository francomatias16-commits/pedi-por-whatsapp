-- 0054 · Promociones: sugeridas (plan, sección 7). El sistema propone y el kiosquero confirma con un clic.
-- Aplicar DESPUÉS de 0053. Sin DROP.
--  * promo_sugerencias: hasta 3 propuestas a partir de datos reales del kiosco:
--      reactivacion     -> 5 o más clientes del club sin comprar hace 30 días, y la opción no está activa.
--      regalo_cumpleanos -> hay clientes que cumplen años este mes, y la opción no está activa.
--      descuento_sin_movimiento -> un producto parado (promo_sin_rotacion) sin liquidación.
--    Solo propone si la factibilidad del premio principal está "lista" (stock, margen y tope).
--  * Confirmar no tiene función nueva: la pantalla usa promo_activar o promo_liquidar_activar (con sus guardarraíles).

create or replace function public.promo_sugerencias(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_fact jsonb := public.promo_factibilidad(p_kiosco);
  v_out jsonb := '[]'::jsonb; v_n int; v_inactivos int; v_cumplen int; v_sin jsonb; p jsonb;
  v_mes int := extract(month from (now() at time zone 'America/Argentina/Buenos_Aires'))::int;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  if v_fact->>'estado' <> 'lista' then
    return jsonb_build_object('sugerencias', '[]'::jsonb, 'motivo', v_fact->>'motivo');
  end if;

  -- Reactivación: clientes del club que no compran hace 30 días.
  if not exists (select 1 from public.fidelidad_campanas where kiosco_id = p_kiosco and activa and tipo = 'reactivacion')
     and exists (select 1 from public.promo_catalogo where clave = 'reactivacion' and lista) then
    select count(*) into v_inactivos from public.clientes c
     where c.kiosco_id = p_kiosco and c.club_token is not null
       and (select max(s.created_at) from public.sellos s where s.cliente_id = c.id and not s.anulado) < now() - interval '30 days';
    if v_inactivos >= 5 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('clave', 'reactivacion', 'titulo', 'Volver a buscar a los que no vienen',
        'motivo', format('%s clientes no compran hace más de 30 días. Un sello extra puede traerlos de vuelta.', v_inactivos),
        'boton', 'Activar la reactivación'));
    end if;
  end if;

  -- Cumpleaños: clientes que cumplen años este mes.
  if not exists (select 1 from public.fidelidad_campanas where kiosco_id = p_kiosco and activa and tipo = 'cumpleanos')
     and exists (select 1 from public.promo_catalogo where clave = 'regalo_cumpleanos' and lista) then
    select count(*) into v_cumplen from public.clientes c
     where c.kiosco_id = p_kiosco and c.club_token is not null and c.cumple_mes = v_mes;
    if v_cumplen >= 1 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('clave', 'regalo_cumpleanos', 'titulo', 'Regalo de cumpleaños',
        'motivo', format('%s clientes cumplen años este mes. Con el regalo, cada uno suma un sello en su mes.', v_cumplen),
        'boton', 'Activar el regalo de cumpleaños'));
    end if;
  end if;

  -- Producto parado sin liquidación: el de más capital parado.
  v_sin := public.promo_sin_rotacion(p_kiosco, 30);
  for p in select * from jsonb_array_elements(v_sin) loop
    exit when jsonb_array_length(v_out) >= 3;
    if p->>'liquidacion' is null and (p->>'capital') is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('clave', 'descuento_sin_movimiento', 'titulo', 'Liquidar ' || (p->>'nombre'),
        'motivo', format('Hace %s días que no se vende y hay $%s parados. Un 20%% de descuento lo puede mover.', p->>'dias_sin_venta', round((p->>'capital')::numeric)),
        'boton', 'Activar el descuento de 20%',
        'producto_id', p->>'producto_id', 'producto', p->>'nombre', 'valor', 20));
      exit;
    end if;
  end loop;

  return jsonb_build_object('sugerencias', v_out);
end $$;

revoke all on function public.promo_sugerencias(uuid) from public, anon;
grant execute on function public.promo_sugerencias(uuid) to authenticated;
