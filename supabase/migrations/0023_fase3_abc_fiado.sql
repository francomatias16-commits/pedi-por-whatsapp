-- Etapa 20 · Fase 3 del plan: curva ABC (3.4) y fiado vencido (3.3).
--  * curva_abc: clasifica los productos por ingreso de los últimos N días (mostrador + pedidos confirmados/entregados).
--    A = los que suman el primer 80% del ingreso, B = hasta el 95%, C = el resto. Por peso: precio por kg × gramos / 1000.
--  * fiado_vencido: clientes con saldo a favor del kiosco cuyo último movimiento tiene más de N días.
--  * fiado_avisos_semanales: lo usa el cron semanal (solo service role). Una vez por kiosco y semana; avisa solo al dueño,
--    nunca a los clientes.
-- Aplicar DESPUÉS de 0001..0022.

-- 1) Curva ABC
create or replace function public.curva_abc(p_kiosco uuid, p_dias int default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_dias is null or p_dias < 7 or p_dias > 365 then raise exception 'dias_invalidos'; end if;
  with v1 as (
    select vi.producto_id, sum(vi.cantidad)::numeric as unidades,
           sum(case when p.vendido_por_peso then vi.precio_unit * vi.cantidad / 1000.0 else vi.precio_unit * vi.cantidad end) as ingreso
      from public.ventas_mostrador_items vi
      join public.ventas_mostrador v on v.id = vi.venta_id
      join public.productos p on p.id = vi.producto_id
     where v.kiosco_id = p_kiosco and not v.anulada and v.created_at >= now() - make_interval(days => p_dias)
     group by vi.producto_id
    union all
    select pi.producto_id, sum(pi.cantidad)::numeric,
           sum(case when p.vendido_por_peso then pi.precio_unit * pi.cantidad / 1000.0 else pi.precio_unit * pi.cantidad end)
      from public.pedido_items pi
      join public.pedidos pd on pd.id = pi.pedido_id
      join public.productos p on p.id = pi.producto_id
     where pd.kiosco_id = p_kiosco and pd.estado in ('confirmado', 'entregado') and pd.created_at >= now() - make_interval(days => p_dias)
     group by pi.producto_id
  ), t as (
    select producto_id, sum(unidades) as unidades, sum(ingreso) as ingreso from v1 group by producto_id
  ), r as (
    select t.*, sum(t.ingreso) over (order by t.ingreso desc, t.producto_id rows between unbounded preceding and current row) as acum,
           sum(t.ingreso) over () as total
      from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', r.producto_id, 'nombre', p.nombre, 'unidades', r.unidades, 'ingreso', round(r.ingreso, 2),
           'clase', case when (r.acum - r.ingreso) < 0.80 * r.total then 'A'
                         when (r.acum - r.ingreso) < 0.95 * r.total then 'B' else 'C' end)
         order by r.ingreso desc, p.nombre), '[]')
    into v
    from r join public.productos p on p.id = r.producto_id;
  return v;
end $$;

-- 2) Fiado vencido: cálculo común (interno), vista del dueño y aviso del cron.
create or replace function public.fiado_vencido_calc(p_kiosco uuid, p_dias int)
returns table (n_clientes int, monto numeric) language sql stable security definer set search_path = public as $$
  select count(*)::int, coalesce(sum(s.saldo), 0)::numeric
    from public.clientes_saldo s
   where s.kiosco_id = p_kiosco and s.saldo > 0 and s.ultimo_movimiento < now() - make_interval(days => p_dias)
$$;

create or replace function public.fiado_vencido(p_kiosco uuid, p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_dias is null or p_dias < 7 or p_dias > 365 then raise exception 'dias_invalidos'; end if;
  select * into r from public.fiado_vencido_calc(p_kiosco, p_dias);
  return jsonb_build_object('clientes', r.n_clientes, 'monto', r.monto, 'dias', p_dias);
end $$;

-- 3) Aviso semanal (cron). Una fila por kiosco y semana: si el cron corre dos veces, no repite.
create table public.avisos_fiado (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  semana date not null,
  n_clientes int not null,
  monto numeric(14,2) not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (kiosco_id, semana)
);
alter table public.avisos_fiado enable row level security;
revoke all on public.avisos_fiado from anon, authenticated;

create or replace function public.fiado_avisos_semanales(p_dias int default 30)
returns table (kiosco uuid, n_clientes int, monto numeric)
language plpgsql security definer set search_path = public as $$
declare k record; r record; v_ins uuid; v_semana date := date_trunc('week', now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  for k in select id from public.kioscos loop
    select * into r from public.fiado_vencido_calc(k.id, p_dias);
    continue when r.n_clientes = 0;
    insert into public.avisos_fiado (kiosco_id, semana, n_clientes, monto)
      values (k.id, v_semana, r.n_clientes, r.monto) on conflict (kiosco_id, semana) do nothing returning id into v_ins;
    if v_ins is not null then
      kiosco := k.id; n_clientes := r.n_clientes; monto := r.monto; return next;
    end if;
  end loop;
end $$;

revoke all on function public.curva_abc(uuid, int) from public, anon;
revoke all on function public.fiado_vencido(uuid, int) from public, anon;
revoke all on function public.fiado_vencido_calc(uuid, int) from public, anon, authenticated;
revoke all on function public.fiado_avisos_semanales(int) from public, anon, authenticated;
grant execute on function public.curva_abc(uuid, int), public.fiado_vencido(uuid, int) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fiado_avisos_semanales(int) to service_role;
  end if;
end $$;
