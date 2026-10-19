-- 0055 · Sugeridas: "No por ahora" (la propuesta se oculta 14 días o lo que indique la pantalla) y sorteo con período mensual en la pantalla.
-- Aplicar DESPUÉS de 0054. Sin DROP.
--  * promo_sugerencias_descartadas: una fila por cada "No por ahora". Vale hasta la fecha indicada.
--  * promo_sugerencia_descartada(): lo consulta promo_sugerencias.
--  * promo_sugerencia_descartar(): lo registra (encargado o dueño).

create table public.promo_sugerencias_descartadas (
  id bigserial primary key,
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  clave text not null check (clave in ('reactivacion', 'regalo_cumpleanos', 'descuento_sin_movimiento')),
  producto_id uuid references public.productos(id) on delete cascade,
  hasta date not null,
  usuario uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp()
);
create index promo_sugerencias_descartadas_idx on public.promo_sugerencias_descartadas (kiosco_id, clave, hasta desc);
alter table public.promo_sugerencias_descartadas enable row level security;
revoke all on public.promo_sugerencias_descartadas from anon, authenticated;

create or replace function public.promo_sugerencia_descartada(p_kiosco uuid, p_clave text, p_producto uuid, p_hoy date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.promo_sugerencias_descartadas d
                  where d.kiosco_id = p_kiosco and d.clave = p_clave and d.hasta >= p_hoy
                    and d.producto_id is not distinct from p_producto)
$$;

create or replace function public.promo_sugerencia_descartar(p_kiosco uuid, p_clave text, p_producto uuid default null, p_dias int default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_hasta date := (now() at time zone 'America/Argentina/Buenos_Aires')::date + 14;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  if p_clave not in ('reactivacion', 'regalo_cumpleanos', 'descuento_sin_movimiento') then raise exception 'promo_no_disponible'; end if;
  if p_clave = 'descuento_sin_movimiento' and p_producto is null then raise exception 'producto_invalido'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 60 then raise exception 'promo_valor_invalido'; end if;
  v_hasta := (now() at time zone 'America/Argentina/Buenos_Aires')::date + p_dias;
  insert into public.promo_sugerencias_descartadas (kiosco_id, clave, producto_id, hasta) values (p_kiosco, p_clave, p_producto, v_hasta);
  return jsonb_build_object('ok', true, 'hasta', v_hasta);
end $$;

-- promo_sugerencias ahora respeta los "No por ahora" vigentes.
create or replace function public.promo_sugerencias(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_fact jsonb := public.promo_factibilidad(p_kiosco);
  v_out jsonb := '[]'::jsonb; v_n int; v_inactivos int; v_cumplen int; v_sin jsonb; p jsonb;
  v_mes int := extract(month from (now() at time zone 'America/Argentina/Buenos_Aires'))::int;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  if v_fact->>'estado' <> 'lista' then
    return jsonb_build_object('sugerencias', '[]'::jsonb, 'motivo', v_fact->>'motivo');
  end if;

  -- Reactivación: clientes del club que no compran hace 30 días.
  if not exists (select 1 from public.fidelidad_campanas where kiosco_id = p_kiosco and activa and tipo = 'reactivacion')
     and not public.promo_sugerencia_descartada(p_kiosco, 'reactivacion', null, v_hoy)
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
     and not public.promo_sugerencia_descartada(p_kiosco, 'regalo_cumpleanos', null, v_hoy)
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
    if p->>'liquidacion' is null and (p->>'capital') is not null and not public.promo_sugerencia_descartada(p_kiosco, 'descuento_sin_movimiento', (p->>'producto_id')::uuid, v_hoy) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('clave', 'descuento_sin_movimiento', 'titulo', 'Liquidar ' || (p->>'nombre'),
        'motivo', format('Hace %s días que no se vende y hay $%s parados. Un 20%% de descuento lo puede mover.', p->>'dias_sin_venta', round((p->>'capital')::numeric)),
        'boton', 'Activar el descuento de 20%',
        'producto_id', p->>'producto_id', 'producto', p->>'nombre', 'valor', 20));
      exit;
    end if;
  end loop;

  return jsonb_build_object('sugerencias', v_out);
end $$;

revoke all on function public.promo_sugerencia_descartada(uuid, text, uuid, date) from public, anon, authenticated;
revoke all on function public.promo_sugerencia_descartar(uuid, text, uuid, int) from public, anon;
grant execute on function public.promo_sugerencia_descartar(uuid, text, uuid, int) to authenticated;
revoke all on function public.promo_sugerencias(uuid) from public, anon;
grant execute on function public.promo_sugerencias(uuid) to authenticated;
