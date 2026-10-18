-- 0026 (Fase 3, plan 3.3): aviso semanal de "clientes que dejaron de venir".
-- Aplicar DESPUÉS de 0025. Sin DROP ni DELETE. No toca precios ni stock.
-- NOTA: en la base de Pedí estas dos funciones y la tabla ya están aplicadas (se aplicaron como
-- "fuga_conteo_semanal" y "fuga_avisos_semanales"). Este archivo deja el repo igual que producción
-- y es seguro de volver a correr (create ... if not exists / create or replace).

-- 1) Una fila por kiosco y semana: si el cron corre dos veces, el aviso no se repite.
create table if not exists public.avisos_fuga (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  semana date not null,
  clientes int not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (kiosco_id, semana)
);
alter table public.avisos_fuga enable row level security;
revoke all on public.avisos_fuga from anon, authenticated;

-- 2) Cuántos clientes en fuga tiene cada kiosco (mismos criterios que la pestaña Radar:
--    3+ compras no anuladas en el último año y más de 45 días sin comprar). Solo el cron.
create or replace function public.fuga_conteo_semanal()
returns table (kiosco uuid, clientes int)
language sql stable security definer set search_path = public as $$
  with v as (
    select vm.kiosco_id, vm.cliente_id, count(*)::int as compras, max(vm.created_at) as ultima
      from public.ventas_mostrador vm
     where vm.cliente_id is not null and not vm.anulada
       and vm.created_at >= now() - interval '1 year'
     group by vm.kiosco_id, vm.cliente_id
  )
  select v.kiosco_id, count(*)::int
    from v
    join public.clientes c on c.id = v.cliente_id and c.kiosco_id = v.kiosco_id
   where v.compras >= 3
     and v.ultima < now() - interval '45 days'
   group by v.kiosco_id;
$$;

-- 3) Registra el aviso de la semana y devuelve SOLO los kioscos que todavía no lo tenían.
--    Idempotente: una segunda corrida en la misma semana devuelve cero filas.
create or replace function public.fuga_avisos_semanales()
returns table (kiosco uuid, clientes int)
language plpgsql security definer set search_path = public as $$
declare f record; v_ins uuid;
  v_semana date := date_trunc('week', now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  for f in select * from public.fuga_conteo_semanal() loop
    insert into public.avisos_fuga (kiosco_id, semana, clientes)
      values (f.kiosco, v_semana, f.clientes) on conflict (kiosco_id, semana) do nothing returning id into v_ins;
    if v_ins is not null then
      kiosco := f.kiosco; clientes := f.clientes; return next;
    end if;
  end loop;
end $$;

-- 4) Solo el service role del cron las puede ejecutar (ni anon ni authenticated).
revoke all on function public.fuga_conteo_semanal() from public, anon, authenticated;
revoke all on function public.fuga_avisos_semanales() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fuga_conteo_semanal(), public.fuga_avisos_semanales() to service_role;
  end if;
end $$;
