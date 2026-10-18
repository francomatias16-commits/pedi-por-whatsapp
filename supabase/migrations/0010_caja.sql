-- Etapa 4 · Caja diaria (turnos de caja con arqueo).
-- Portado de distrib (turnos_caja, movimientos_caja, resumen/cerrar turno). Diferencias:
--  * Un turno por kiosco (no por caja física) y sin PIN de supervisor, reporte Z ni multi-caja.
--  * El efectivo de ventas sale de pedidos entregados con medio_pago = 'efectivo' dentro del turno,
--    excluyendo los que se anotaron en fiado.
--  * El arqueo incluye los movimientos manuales (fondo + efectivo + refuerzos − sangrías − retiros).
--    distrib 075 dejó de contarlos; acá se restauran, como indica su documentación.
-- Aplicar DESPUÉS de 0001..0009.

-- 1) Momento de entrega: sirve para saber en qué turno cayó cada cobro.
alter table public.pedidos add column entregado_at timestamptz;
update public.pedidos set entregado_at = created_at where estado = 'entregado' and entregado_at is null;

create or replace function public.registrar_entregado_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado = 'entregado' and old.estado is distinct from 'entregado' then
    new.entregado_at := clock_timestamp();
  end if;
  return new;
end $$;

create trigger pedidos_entregado_at before update of estado on public.pedidos
  for each row execute function public.registrar_entregado_at();

-- 2) Tablas
create table public.turnos_caja (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  abierto_por uuid not null default auth.uid() references auth.users(id),
  abierto_at timestamptz not null default clock_timestamp(),
  monto_inicial numeric(12,2) not null check (monto_inicial >= 0),
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  monto_final_declarado numeric(12,2),
  monto_final_calculado numeric(12,2),
  diferencia numeric(12,2),
  cerrado_at timestamptz,
  check ((estado = 'abierto' and cerrado_at is null) or (estado = 'cerrado' and cerrado_at is not null))
);
create unique index un_turno_abierto_por_kiosco on public.turnos_caja (kiosco_id) where estado = 'abierto';

create table public.movimientos_caja (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  turno_id uuid not null references public.turnos_caja(id) on delete cascade,
  tipo text not null check (tipo in ('sangria', 'refuerzo', 'retiro_final')),
  monto numeric(12,2) not null check (monto > 0),
  concepto text,
  usuario_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index on public.movimientos_caja (turno_id);

alter table public.turnos_caja enable row level security;
alter table public.movimientos_caja enable row level security;
create policy turnos_caja_dueno on public.turnos_caja for select to authenticated using (public.es_dueno(kiosco_id));
create policy movimientos_caja_dueno on public.movimientos_caja for select to authenticated using (public.es_dueno(kiosco_id));
revoke all on public.turnos_caja, public.movimientos_caja from anon, authenticated;
grant select on public.turnos_caja, public.movimientos_caja to authenticated;

-- 3) Cálculos internos
create or replace function public.caja_ventas_efectivo(p_turno uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(p.total), 0)::numeric(12,2)
    from public.pedidos p
    join public.turnos_caja t on t.id = p_turno and t.kiosco_id = p.kiosco_id
   where p.estado = 'entregado'
     and p.medio_pago = 'efectivo'
     and p.entregado_at >= t.abierto_at
     and (t.cerrado_at is null or p.entregado_at <= t.cerrado_at)
     and not exists (select 1 from public.fiado_movimientos f where f.pedido_id = p.id)
$$;

create or replace function public.caja_neto_movimientos(p_turno uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(case when tipo = 'refuerzo' then monto else -monto end), 0)::numeric(12,2)
    from public.movimientos_caja where turno_id = p_turno
$$;

revoke all on function public.caja_ventas_efectivo(uuid) from public, anon, authenticated;
revoke all on function public.caja_neto_movimientos(uuid) from public, anon, authenticated;

-- 4) RPCs para el panel (solo el dueño del kiosco)
create or replace function public.caja_abrir_turno(p_kiosco uuid, p_monto_inicial numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_monto_inicial is null or p_monto_inicial < 0 then raise exception 'monto_invalido'; end if;
  if exists (select 1 from public.turnos_caja where kiosco_id = p_kiosco and estado = 'abierto') then
    raise exception 'turno_abierto';
  end if;
  insert into public.turnos_caja (kiosco_id, monto_inicial) values (p_kiosco, round(p_monto_inicial, 2))
    returning id into v_id;
  return jsonb_build_object('turno_id', v_id);
end $$;

create or replace function public.caja_registrar_movimiento(p_turno uuid, p_tipo text, p_monto numeric, p_concepto text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.turnos_caja%rowtype;
begin
  select * into v_t from public.turnos_caja where id = p_turno for update;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_t.estado <> 'abierto' then raise exception 'turno_cerrado'; end if;
  if p_tipo not in ('sangria', 'refuerzo', 'retiro_final') then raise exception 'tipo_invalido'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'monto_invalido'; end if;
  insert into public.movimientos_caja (kiosco_id, turno_id, tipo, monto, concepto)
    values (v_t.kiosco_id, p_turno, p_tipo, round(p_monto, 2), left(nullif(trim(coalesce(p_concepto, '')), ''), 200));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.caja_resumen(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_t public.turnos_caja%rowtype; v_efectivo numeric; v_neto numeric; v_movs jsonb;
begin
  select * into v_t from public.turnos_caja where id = p_turno;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_efectivo := public.caja_ventas_efectivo(p_turno);
  v_neto := public.caja_neto_movimientos(p_turno);
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'monto', monto, 'concepto', concepto, 'created_at', created_at)
                  order by created_at), '[]'::jsonb)
    into v_movs from public.movimientos_caja where turno_id = p_turno;
  return jsonb_build_object(
    'turno_id', v_t.id, 'estado', v_t.estado, 'abierto_at', v_t.abierto_at, 'cerrado_at', v_t.cerrado_at,
    'monto_inicial', v_t.monto_inicial, 'ventas_efectivo', v_efectivo, 'neto_movimientos', v_neto,
    'monto_calculado', v_t.monto_inicial + v_efectivo + v_neto, 'movimientos', v_movs);
end $$;

create or replace function public.caja_cerrar_turno(p_turno uuid, p_monto_declarado numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t public.turnos_caja%rowtype; v_calc numeric; v_decl numeric;
begin
  select * into v_t from public.turnos_caja where id = p_turno for update;
  if not found or not public.es_dueno(v_t.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_t.estado <> 'abierto' then raise exception 'turno_cerrado'; end if;
  if p_monto_declarado is null or p_monto_declarado < 0 then raise exception 'monto_invalido'; end if;
  v_decl := round(p_monto_declarado, 2);
  v_calc := v_t.monto_inicial + public.caja_ventas_efectivo(p_turno) + public.caja_neto_movimientos(p_turno);
  update public.turnos_caja
     set estado = 'cerrado', cerrado_at = clock_timestamp(), monto_final_declarado = v_decl,
         monto_final_calculado = v_calc, diferencia = v_decl - v_calc
   where id = p_turno;
  return jsonb_build_object('monto_calculado', v_calc, 'monto_declarado', v_decl, 'diferencia', v_decl - v_calc);
end $$;

revoke all on function public.caja_abrir_turno(uuid, numeric) from public, anon;
revoke all on function public.caja_registrar_movimiento(uuid, text, numeric, text) from public, anon;
revoke all on function public.caja_resumen(uuid) from public, anon;
revoke all on function public.caja_cerrar_turno(uuid, numeric) from public, anon;
grant execute on function public.caja_abrir_turno(uuid, numeric) to authenticated;
grant execute on function public.caja_registrar_movimiento(uuid, text, numeric, text) to authenticated;
grant execute on function public.caja_resumen(uuid) to authenticated;
grant execute on function public.caja_cerrar_turno(uuid, numeric) to authenticated;
