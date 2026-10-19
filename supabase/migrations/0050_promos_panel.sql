-- 0050 · Promociones, panel completo: factibilidad, tope mensual, aviso previo, historial y nuevas opciones de captar/retener.
-- Aplicar DESPUÉS de 0049. Los DROP llevan "-- drop-ok".
--  * kioscos.club_aviso_previo_dias: las promociones automáticas (bienvenida, cumpleaños…) empiezan después de ese aviso (campaña.desde).
--  * promo_catalogo.lista / modo: qué opciones se pueden usar hoy y cómo se arman (un clic, por producto, por niveles o sorteo).
--  * fidelidad_campanas: tipos nuevos 'racha', 'cumpleanos', 'referido' y 'dos_producto' (+ semanas). Su cálculo está en 0052.
--  * promo_historial: registro de todo cambio en campañas, premios y ajustes (lo lee solo el dueño). Triggers + eventos explícitos.
--  * promo_costo_mes / promo_factibilidad / promo_apagado_auto: el motor del plan (stock, margen mínimo, tope mensual).
--  * promo_panel: una sola llamada para el panel; antes de responder apaga lo que superó el tope.
--  * promo_activar: ahora acepta p_confirmar_margen, respeta factibilidad y el aviso previo, y devuelve sale_el.

alter table public.kioscos
  add column club_aviso_previo_dias int not null default 1 check (club_aviso_previo_dias between 0 and 7);

-- 1) Catálogo: qué se puede usar y cómo se arma
alter table public.promo_catalogo
  add column lista boolean not null default false,
  add column modo text not null default 'directa' check (modo in ('directa', 'producto', 'niveles', 'sorteo'));
update public.promo_catalogo set lista = true;
update public.promo_catalogo set modo = 'producto' where clave in ('liquidar_sin_rotacion', 'descuento_sin_movimiento', 'llevá_dos_suma_mas');
update public.promo_catalogo set modo = 'niveles' where clave = 'premio_por_etapas';
insert into public.promo_catalogo (clave, familia, nombre, descripcion, fase, automatica, tipo_campana, orden, lista, modo) values
  ('sorteo_mensual', 'premio_etapa', 'Sorteo mensual', 'Sorteo con chances por papelitos usados: tres premios por defecto, una vez al mes.', 'C', false, null, 12, true, 'sorteo');

-- 2) Tipos nuevos de campaña
do $p$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'public.fidelidad_campanas'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%bienvenida%' and pg_get_constraintdef(oid) like '%tipo%'
             and pg_get_constraintdef(oid) like '%manual%' and pg_get_constraintdef(oid) not like '%IS NULL%'
  loop
    execute format('alter table public.fidelidad_campanas drop constraint %I', r.conname); -- drop-ok
  end loop;
end $p$;
alter table public.fidelidad_campanas add constraint fidelidad_campanas_tipo_check
  check (tipo in ('visita', 'monto', 'producto', 'categoria', 'bienvenida', 'reactivacion', 'multiplicador', 'manual', 'racha', 'cumpleanos', 'referido', 'dos_producto'));
alter table public.fidelidad_campanas
  add column semanas int check (semanas is null or semanas between 2 and 52),
  add check (tipo <> 'racha' or semanas is not null),
  add check (tipo <> 'dos_producto' or producto_id is not null);

-- 3) Historial de cambios
create table public.promo_historial (
  id bigserial primary key,
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  usuario uuid default auth.uid(),
  accion text not null,
  tabla text not null,
  promo_clave text,
  nombre text,
  detalle jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index promo_historial_idx on public.promo_historial (kiosco_id, created_at desc);
alter table public.promo_historial enable row level security;
revoke all on public.promo_historial from anon, authenticated;

create or replace function public.promo_historial_registrar(p_kiosco uuid, p_accion text, p_tabla text, p_clave text, p_nombre text, p_detalle jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.kioscos where id = p_kiosco) then return; end if;
  insert into public.promo_historial (kiosco_id, accion, tabla, promo_clave, nombre, detalle) values (p_kiosco, p_accion, p_tabla, p_clave, p_nombre, p_detalle);
end $$;

-- Trigger común. app.promo_silencio = 'on' lo calla (lo usan las funciones que registran su propio evento);
-- app.promo_motivo cambia el texto de una pausa (por ejemplo apagado_tope).
create or replace function public.promo_historial_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_accion text; v_clave text; v_nombre text; v_kiosco uuid; v_activa_old boolean; v_activa_new boolean; v_motivo text := nullif(current_setting('app.promo_motivo', true), '');
begin
  if current_setting('app.promo_silencio', true) = 'on' then return coalesce(new, old); end if;
  if tg_table_name = 'kioscos' then
    if new.club_margen_minimo is distinct from old.club_margen_minimo or new.club_tope_promos_pct is distinct from old.club_tope_promos_pct
       or new.club_aviso_previo_dias is distinct from old.club_aviso_previo_dias then
      perform public.promo_historial_registrar(new.id, 'ajustes', 'kioscos', null, null,
        jsonb_build_object('margen', new.club_margen_minimo, 'tope', new.club_tope_promos_pct, 'aviso_previo', new.club_aviso_previo_dias));
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then v_kiosco := old.kiosco_id; v_nombre := old.nombre; else v_kiosco := new.kiosco_id; v_nombre := new.nombre; end if;
  if tg_table_name = 'fidelidad_campanas' then v_clave := case when tg_op = 'DELETE' then old.promo_clave else new.promo_clave end; end if;
  if tg_op = 'INSERT' then v_accion := 'alta';
  elsif tg_op = 'DELETE' then v_accion := 'baja';
  else
    if tg_table_name = 'fidelidad_campanas' then v_activa_old := old.activa; v_activa_new := new.activa; else v_activa_old := old.activo; v_activa_new := new.activo; end if;
    v_accion := case when v_activa_old and not v_activa_new then coalesce(v_motivo, 'pausar')
                     when not v_activa_old and v_activa_new then 'activar' else 'cambio' end;
  end if;
  perform public.promo_historial_registrar(v_kiosco, v_accion, tg_table_name, v_clave, v_nombre);
  return coalesce(new, old);
end $$;
create trigger trg_hist_campanas after insert or update or delete on public.fidelidad_campanas for each row execute function public.promo_historial_trg();
create trigger trg_hist_premios after insert or update or delete on public.fidelidad_premios for each row execute function public.promo_historial_trg();
create trigger trg_hist_ajustes after update on public.kioscos for each row execute function public.promo_historial_trg();

-- Dueño: los últimos cambios.
create or replace function public.promo_historial(p_kiosco uuid, p_limite int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('cuando', h.created_at, 'accion', h.accion, 'nombre', h.nombre, 'tabla', h.tabla, 'promo_clave', h.promo_clave) order by h.created_at desc, h.id desc)
    from (select * from public.promo_historial where kiosco_id = p_kiosco order by created_at desc, id desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) h), '[]'::jsonb);
end $$;

-- 4) Costo del mes (interna). Compara lo que dieron las promociones con el tope (% de las ventas del mes).
--    El costo por sello sale del premio más barato que tenga costo conocido. Sin ventas registradas no hay base para el tope: no se supera.
create or replace function public.promo_costo_mes(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  k public.kioscos%rowtype; v_ini timestamptz := (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')) at time zone 'America/Argentina/Buenos_Aires';
  v_ventas numeric; v_sellos int; v_costo_sello numeric; v_costo numeric; v_tope numeric; v_ev jsonb; p jsonb;
begin
  select * into k from public.kioscos where id = p_kiosco;
  select coalesce(sum(t.total), 0) into v_ventas from (
    select total from public.ventas_mostrador where kiosco_id = p_kiosco and not anulada and created_at >= v_ini
    union all
    select total from public.pedidos where kiosco_id = p_kiosco and entregado_at is not null and entregado_at >= v_ini) t;
  select coalesce(sum(s.cantidad), 0)::int into v_sellos from public.sellos s
    join public.fidelidad_campanas c on c.id = s.campana_id
   where s.kiosco_id = p_kiosco and not s.anulado and s.cantidad > 0 and s.created_at >= v_ini
     and (c.promo_clave is not null or c.tipo = 'dos_producto');
  v_ev := public.club_evaluar(p_kiosco);
  for p in select * from jsonb_array_elements(v_ev->'premios') loop
    if (p->>'costo_local') is not null and (p->>'costo_sellos')::numeric > 0 then v_costo_sello := (p->>'costo_local')::numeric / (p->>'costo_sellos')::numeric; exit; end if;
  end loop;
  v_costo := round(v_sellos * coalesce(v_costo_sello, 0), 2);
  v_tope := round(v_ventas * k.club_tope_promos_pct / 100, 2);
  return jsonb_build_object('ventas_mes', v_ventas, 'sellos_promo', v_sellos, 'costo_sello', round(v_costo_sello, 2), 'costo_promos', v_costo,
    'tope_pct', k.club_tope_promos_pct, 'tope_pesos', v_tope,
    'usado_pct', case when v_tope > 0 then round(v_costo / v_tope * 100, 1) end,
    'supera', v_ventas > 0 and v_costo > 0 and v_costo >= v_tope);
end $$;

-- 5) Factibilidad (interna): stock, tope y margen del premio principal. Orden: falta stock, supera tope, reduce margen.
create or replace function public.promo_factibilidad(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ev jsonb := public.club_evaluar(p_kiosco); v_costo jsonb := public.promo_costo_mes(p_kiosco); p jsonb; q jsonb; pr public.fidelidad_premios%rowtype; pd public.productos%rowtype;
begin
  -- Premio principal: el primero con costo conocido (un premio libre no tiene costo que revisar); si ninguno lo tiene, el primero.
  p := v_ev->'premios'->0;
  for q in select * from jsonb_array_elements(v_ev->'premios') loop
    if (q->>'costo_local') is not null then p := q; exit; end if;
  end loop;
  if p is null then return jsonb_build_object('estado', 'lista', 'motivo', 'Todavía no hay un premio cargado para revisar.'); end if;
  select * into pr from public.fidelidad_premios where id = (p->>'premio_id')::uuid;
  if pr.tipo = 'producto' then
    select * into pd from public.productos where id = pr.producto_id;
    if pd.stock_controlado and pd.stock <= 0 then
      return jsonb_build_object('estado', 'falta_stock', 'motivo', format('Se agotó %s, que es parte de tu premio. Reponé stock antes de activar promociones.', pd.nombre));
    end if;
  end if;
  if (v_costo->>'supera')::boolean then
    return jsonb_build_object('estado', 'supera_tope', 'motivo', format('Este mes las promociones ya cuestan $%s, que es el tope de $%s.', round((v_costo->>'costo_promos')::numeric), round((v_costo->>'tope_pesos')::numeric)));
  end if;
  if p->>'semaforo' = 'reduce_margen' then
    return jsonb_build_object('estado', 'reduce_margen', 'motivo', p->>'frase');
  end if;
  return jsonb_build_object('estado', 'lista', 'motivo', 'Hay stock, el margen alcanza y no se llegó al tope del mes.');
end $$;

-- 6) Apagado automático (interna): al llegar al tope se pausan las promociones automáticas. (0051 la amplía con el stock de la liquidación.)
create or replace function public.promo_apagado_auto(p_kiosco uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_costo jsonb := public.promo_costo_mes(p_kiosco);
begin
  if (v_costo->>'supera')::boolean then
    perform set_config('app.promo_motivo', 'apagado_tope', true);
    update public.fidelidad_campanas c set activa = false
     where c.kiosco_id = p_kiosco and c.activa and c.promo_clave in (select clave from public.promo_catalogo where automatica);
    get diagnostics v_n = row_count;
    perform set_config('app.promo_motivo', '', true);
  end if;
  return v_n;
end $$;

-- 7) Panel: una sola llamada. Revisa el tope antes de responder.
create or replace function public.promo_panel(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.kioscos%rowtype;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  perform public.promo_apagado_auto(p_kiosco);
  select * into k from public.kioscos where id = p_kiosco;
  return jsonb_build_object(
    'activas', coalesce((select jsonb_agg(jsonb_build_object('clave', c.promo_clave, 'campana_id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'desde', c.desde) order by c.created_at)
                         from public.fidelidad_campanas c where c.kiosco_id = p_kiosco and c.activa and c.promo_clave is not null), '[]'::jsonb),
    'factibilidad', public.promo_factibilidad(p_kiosco),
    'costo_mes', public.promo_costo_mes(p_kiosco),
    'aviso_previo_dias', k.club_aviso_previo_dias);
end $$;

-- 8) Activar una opción de un clic (reemplaza la firma de 0048: ahora con p_confirmar_margen).
drop function public.promo_activar(uuid, text); -- drop-ok: cambia la firma para sumar p_confirmar_margen (el cliente viejo sigue andando por el default)
create or replace function public.promo_activar(p_kiosco uuid, p_clave text, p_confirmar_margen boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cat public.promo_catalogo%rowtype; k public.kioscos%rowtype; v_tipo text; v_nombre text; v_id uuid; v_fact jsonb; v_desde date; v_sellos int := 1; v_semanas int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into cat from public.promo_catalogo where clave = p_clave;
  if not found or not cat.lista or cat.modo <> 'directa' then raise exception 'promo_no_disponible'; end if;

  case p_clave
    when 'bienvenida' then v_tipo := 'bienvenida'; v_nombre := 'Sellos de bienvenida';
    when 'doble_primera_compra' then v_tipo := 'bienvenida'; v_nombre := 'Doble sello en la primera compra';
    when 'reactivacion' then v_tipo := 'reactivacion'; v_nombre := 'Volver a buscarlo';
    when 'sellos_dobles_dias_flojos' then v_tipo := 'multiplicador'; v_nombre := 'Sellos dobles en días flojos';
    when 'racha' then v_tipo := 'racha'; v_nombre := 'Racha de compras'; v_semanas := 4;
    when 'regalo_cumpleanos' then v_tipo := 'cumpleanos'; v_nombre := 'Regalo de cumpleaños';
    when 'referido' then v_tipo := 'referido'; v_nombre := 'Traé un amigo';
    else raise exception 'promo_no_disponible';
  end case;

  if exists (select 1 from public.fidelidad_campanas where kiosco_id = p_kiosco and activa and tipo = v_tipo) then raise exception 'promo_ya_activa'; end if;

  v_fact := public.promo_factibilidad(p_kiosco);
  case v_fact->>'estado'
    when 'falta_stock' then raise exception 'promo_falta_stock';
    when 'supera_tope' then raise exception 'promo_supera_tope';
    when 'reduce_margen' then
      if not coalesce(p_confirmar_margen, false) then raise exception 'promo_reduce_margen'; end if;
      perform public.promo_historial_registrar(p_kiosco, 'margen_confirmado', 'fidelidad_campanas', p_clave, v_nombre, jsonb_build_object('motivo', v_fact->>'motivo'));
    else null;
  end case;

  -- Las automáticas salen con aviso previo: empiezan después de los días que eligió el dueño.
  select * into k from public.kioscos where id = p_kiosco;
  if cat.automatica and k.club_aviso_previo_dias > 0 then
    v_desde := (now() at time zone 'America/Argentina/Buenos_Aires')::date + k.club_aviso_previo_dias;
  end if;

  insert into public.fidelidad_campanas (kiosco_id, nombre, tipo, sellos, multiplicador, dias_inactivo, dias_semana, semanas, desde, promo_clave)
  values (
    p_kiosco, v_nombre, v_tipo, v_sellos,
    case when v_tipo = 'multiplicador' then 2 end,
    case when v_tipo = 'reactivacion' then 30 end,
    case when p_clave = 'sellos_dobles_dias_flojos' then array[2, 3] end,
    v_semanas, v_desde, p_clave
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'clave', p_clave, 'nombre', v_nombre, 'sale_el', v_desde);
end $$;

-- Permisos: internas sin acceso desde afuera; el resto, solo usuarios logueados (el rol se revisa adentro).
revoke all on function public.promo_historial_registrar(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.promo_historial_trg() from public, anon, authenticated;
revoke all on function public.promo_costo_mes(uuid) from public, anon, authenticated;
revoke all on function public.promo_factibilidad(uuid) from public, anon, authenticated;
revoke all on function public.promo_apagado_auto(uuid) from public, anon, authenticated;
revoke all on function public.promo_historial(uuid, int) from public, anon;
grant execute on function public.promo_historial(uuid, int) to authenticated;
revoke all on function public.promo_panel(uuid) from public, anon;
grant execute on function public.promo_panel(uuid) to authenticated;
revoke all on function public.promo_activar(uuid, text, boolean) from public, anon;
grant execute on function public.promo_activar(uuid, text, boolean) to authenticated;
