-- Etapa 18 · Conteo físico por planilla (Fase 2.4 del plan).
--  * Se arma una sesión: todos los productos que controlan stock, los que hay que reponer, o una categoría.
--  * Se cargan las cantidades contadas (pueden quedar sin contar) y se revisan las diferencias.
--  * Al aplicar, cada diferencia se compara contra el stock EN VIVO (pudo haber ventas durante el conteo) y queda
--    como ajuste con motivo 'conteo_fisico' en el historial. Los productos sin contar no se tocan.
--  * Solo una sesión abierta por kiosco.
-- Aplicar DESPUÉS de 0001..0020.

create table public.conteos_sesiones (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  estado text not null default 'abierta' check (estado in ('abierta', 'aplicada', 'descartada')),
  criterio text not null check (criterio in ('todos', 'bajo', 'categoria')),
  categoria text,
  created_at timestamptz not null default clock_timestamp(),
  cerrada_at timestamptz
);
create unique index conteos_una_abierta on public.conteos_sesiones (kiosco_id) where estado = 'abierta';

create table public.conteos_items (
  id uuid primary key default gen_random_uuid(),
  sesion_id uuid not null references public.conteos_sesiones(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  nombre text not null,
  stock_al_armar int not null,
  contado int check (contado is null or contado >= 0),
  unique (sesion_id, producto_id)
);

alter table public.conteos_sesiones enable row level security;
alter table public.conteos_items enable row level security;
create policy conteos_sesiones_dueno on public.conteos_sesiones for select to authenticated using (public.es_dueno(kiosco_id));
create policy conteos_items_dueno on public.conteos_items for select to authenticated
  using (exists (select 1 from public.conteos_sesiones s where s.id = sesion_id and public.es_dueno(s.kiosco_id)));
revoke all on public.conteos_sesiones, public.conteos_items from anon, authenticated;
grant select on public.conteos_sesiones, public.conteos_items to authenticated;

-- 1) Armar la sesión.
create or replace function public.conteo_crear(p_kiosco uuid, p_criterio text, p_categoria text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_criterio is null or p_criterio not in ('todos', 'bajo', 'categoria') then raise exception 'criterio_invalido'; end if;
  if p_criterio = 'categoria' and trim(coalesce(p_categoria, '')) = '' then raise exception 'categoria_requerida'; end if;
  if exists (select 1 from public.conteos_sesiones where kiosco_id = p_kiosco and estado = 'abierta') then raise exception 'conteo_en_curso'; end if;
  insert into public.conteos_sesiones (kiosco_id, criterio, categoria)
    values (p_kiosco, p_criterio, case when p_criterio = 'categoria' then trim(p_categoria) end)
    returning id into v_id;
  insert into public.conteos_items (sesion_id, producto_id, nombre, stock_al_armar)
  select v_id, p.id, p.nombre, p.stock from public.productos p
   where p.kiosco_id = p_kiosco and p.stock_controlado
     and (p_criterio = 'todos'
       or (p_criterio = 'categoria' and p.categoria = trim(p_categoria))
       or (p_criterio = 'bajo' and p.id in (select r.producto_id from public.reposicion_calcular(p_kiosco) r)));
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'sin_productos'; end if;
  return v_id;
end $$;

-- 2) Cargar cantidades (null o vacío = todavía no contado).
create or replace function public.conteo_guardar(p_sesion uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s public.conteos_sesiones%rowtype; it jsonb; v_c text; v_n int := 0;
begin
  select * into v_s from public.conteos_sesiones where id = p_sesion;
  if not found or not public.es_dueno(v_s.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_s.estado <> 'abierta' then raise exception 'conteo_cerrado'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_c := nullif(trim(coalesce(it->>'contado', '')), '');
    if v_c is not null and (v_c !~ '^[0-9]+$' or v_c::numeric > 99999999) then raise exception 'cantidad_invalida'; end if;
    update public.conteos_items set contado = v_c::int
     where sesion_id = p_sesion and producto_id = (it->>'producto_id')::uuid;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('guardados', v_n);
end $$;

-- 3) Sesión abierta con sus renglones (para la pantalla). Null si no hay conteo en curso.
create or replace function public.conteo_actual(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s public.conteos_sesiones%rowtype;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into v_s from public.conteos_sesiones where kiosco_id = p_kiosco and estado = 'abierta';
  if not found then return null; end if;
  return jsonb_build_object('id', v_s.id, 'criterio', v_s.criterio, 'categoria', v_s.categoria, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'producto_id', i.producto_id, 'nombre', i.nombre, 'categoria', p.categoria, 'por_peso', p.vendido_por_peso,
             'stock_al_armar', i.stock_al_armar, 'stock_actual', p.stock, 'contado', i.contado)
           order by p.categoria, i.nombre), '[]')
      from public.conteos_items i join public.productos p on p.id = i.producto_id
     where i.sesion_id = v_s.id));
end $$;

-- 4) Diferencias: lo contado que no coincide con el stock en vivo.
create or replace function public.conteo_diferencias(p_sesion uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_s public.conteos_sesiones%rowtype; v_lista jsonb; v_sin int;
begin
  select * into v_s from public.conteos_sesiones where id = p_sesion;
  if not found or not public.es_dueno(v_s.kiosco_id) then raise exception 'no_autorizado'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', d.producto_id, 'nombre', d.nombre, 'por_peso', d.por_peso,
           'stock_actual', d.stock_actual, 'contado', d.contado, 'diferencia', d.diferencia, 'costo', d.costo) order by d.nombre), '[]')
    into v_lista
    from (
      select i.producto_id, i.nombre, p.vendido_por_peso as por_peso, p.stock as stock_actual, i.contado,
             i.contado - p.stock as diferencia,
             round((i.contado - p.stock) * case when p.vendido_por_peso then coalesce(p.costo, 0) / 1000.0 else coalesce(p.costo, 0) end, 2) as costo
        from public.conteos_items i join public.productos p on p.id = i.producto_id
       where i.sesion_id = p_sesion and i.contado is not null and i.contado <> p.stock
    ) d;
  select count(*) into v_sin from public.conteos_items where sesion_id = p_sesion and contado is null;
  return jsonb_build_object('diferencias', v_lista, 'sin_contar', v_sin);
end $$;

-- 5) Aplicar: ajusta cada diferencia contra el stock en vivo y cierra la sesión.
create or replace function public.conteo_aplicar(p_sesion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s public.conteos_sesiones%rowtype; it record; v_p public.productos%rowtype; v_aj int := 0; v_ig int := 0; v_sin int := 0;
begin
  select * into v_s from public.conteos_sesiones where id = p_sesion for update;
  if not found or not public.es_dueno(v_s.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_s.estado <> 'abierta' then raise exception 'conteo_cerrado'; end if;
  for it in select i.producto_id, i.contado from public.conteos_items i where i.sesion_id = p_sesion order by i.nombre loop
    if it.contado is null then v_sin := v_sin + 1; continue; end if;
    select * into v_p from public.productos where id = it.producto_id for update;
    if not found or not v_p.stock_controlado or it.contado = v_p.stock then v_ig := v_ig + 1; continue; end if;
    update public.productos
       set stock = it.contado, disponible = case when it.contado = 0 then false else disponible end
     where id = v_p.id;
    insert into public.stock_movimientos (kiosco_id, producto_id, tipo, cantidad, stock_resultante, motivo, motivo_tipo)
      values (v_p.kiosco_id, v_p.id, 'ajuste', it.contado - v_p.stock, it.contado, 'Conteo de planilla', 'conteo_fisico');
    v_aj := v_aj + 1;
  end loop;
  update public.conteos_sesiones set estado = 'aplicada', cerrada_at = clock_timestamp() where id = p_sesion;
  return jsonb_build_object('ajustados', v_aj, 'sin_cambios', v_ig, 'sin_contar', v_sin);
end $$;

-- 6) Descartar sin tocar stock.
create or replace function public.conteo_descartar(p_sesion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s public.conteos_sesiones%rowtype;
begin
  select * into v_s from public.conteos_sesiones where id = p_sesion for update;
  if not found or not public.es_dueno(v_s.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_s.estado <> 'abierta' then raise exception 'conteo_cerrado'; end if;
  update public.conteos_sesiones set estado = 'descartada', cerrada_at = clock_timestamp() where id = p_sesion;
  return jsonb_build_object('estado', 'descartada');
end $$;

revoke all on function public.conteo_crear(uuid, text, text) from public, anon;
revoke all on function public.conteo_guardar(uuid, jsonb) from public, anon;
revoke all on function public.conteo_actual(uuid) from public, anon;
revoke all on function public.conteo_diferencias(uuid) from public, anon;
revoke all on function public.conteo_aplicar(uuid) from public, anon;
revoke all on function public.conteo_descartar(uuid) from public, anon;
grant execute on function public.conteo_crear(uuid, text, text), public.conteo_guardar(uuid, jsonb), public.conteo_actual(uuid),
  public.conteo_diferencias(uuid), public.conteo_aplicar(uuid), public.conteo_descartar(uuid) to authenticated;
