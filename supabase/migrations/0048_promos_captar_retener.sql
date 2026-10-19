-- 0048 · Promociones fase A: activar las opciones de captar y retener como campañas de fidelidad.
-- Aplicar DESPUÉS de 0047. Sin DROP. Solo el dueño activa y pausa (igual que fidelidad_campanas, que ya es solo del dueño).
--  * fidelidad_campanas.promo_clave: a qué opción del catálogo corresponde la campaña (null = campaña cargada a mano).
--  * Una sola campaña activa por opción (índice único) y una sola campaña activa por tipo: así "bienvenida" y
--    "doble primera compra" no suman dos veces el mismo sello.
--  * Valores por defecto del plan: bienvenida 1 sello; doble primera compra = 1 sello extra en la primera compra;
--    reactivación a los 30 días sin comprar; sellos dobles martes y miércoles.
--  * promo_desactivar sirve para pausar y también para el botón "Deshacer" justo después de activar.

alter table public.fidelidad_campanas add column promo_clave text references public.promo_catalogo(clave) on delete set null;
create unique index fidelidad_campanas_promo_activa on public.fidelidad_campanas (kiosco_id, promo_clave)
  where activa and promo_clave is not null;

-- Dueño: crea (o reactiva) la campaña de una opción de fase A de captar o retener.
create or replace function public.promo_activar(p_kiosco uuid, p_clave text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cat public.promo_catalogo%rowtype; v_tipo text; v_nombre text; v_id uuid;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into cat from public.promo_catalogo where clave = p_clave;
  if not found or cat.fase <> 'A' or cat.familia not in ('captar', 'retener') then raise exception 'promo_no_disponible'; end if;

  case p_clave
    when 'bienvenida' then v_tipo := 'bienvenida'; v_nombre := 'Sellos de bienvenida';
    when 'doble_primera_compra' then v_tipo := 'bienvenida'; v_nombre := 'Doble sello en la primera compra';
    when 'reactivacion' then v_tipo := 'reactivacion'; v_nombre := 'Volver a buscarlo';
    when 'sellos_dobles_dias_flojos' then v_tipo := 'multiplicador'; v_nombre := 'Sellos dobles en días flojos';
    else raise exception 'promo_no_disponible';
  end case;

  -- Ya hay una campaña activa de ese tipo (por ejemplo, la misma opción o una cargada a mano): no se duplica.
  if exists (select 1 from public.fidelidad_campanas where kiosco_id = p_kiosco and activa and tipo = v_tipo) then
    raise exception 'promo_ya_activa';
  end if;

  insert into public.fidelidad_campanas (kiosco_id, nombre, tipo, sellos, multiplicador, dias_inactivo, dias_semana, promo_clave)
  values (
    p_kiosco, v_nombre, v_tipo, 1,
    case when v_tipo = 'multiplicador' then 2 end,
    case when v_tipo = 'reactivacion' then 30 end,
    case when p_clave = 'sellos_dobles_dias_flojos' then array[2, 3] end,
    p_clave
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'clave', p_clave, 'nombre', v_nombre);
end $$;

-- Dueño: pausa la campaña de una opción (también sirve para "Deshacer").
create or replace function public.promo_desactivar(p_kiosco uuid, p_clave text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  update public.fidelidad_campanas set activa = false
   where kiosco_id = p_kiosco and promo_clave = p_clave and activa;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'pausadas', v_n);
end $$;

-- Encargado y dueño: qué opciones están activas, para mostrarlas en el panel.
create or replace function public.promo_estado(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('clave', c.promo_clave, 'campana_id', c.id, 'nombre', c.nombre, 'tipo', c.tipo) order by c.created_at)
    from public.fidelidad_campanas c
    where c.kiosco_id = p_kiosco and c.activa and c.promo_clave is not null
  ), '[]'::jsonb);
end $$;

-- Permisos: solo usuarios logueados (el chequeo de rol está dentro de cada función).
revoke all on function public.promo_activar(uuid, text) from public, anon;
grant execute on function public.promo_activar(uuid, text) to authenticated;
revoke all on function public.promo_desactivar(uuid, text) from public, anon;
grant execute on function public.promo_desactivar(uuid, text) to authenticated;
revoke all on function public.promo_estado(uuid) from public, anon;
grant execute on function public.promo_estado(uuid) to authenticated;
