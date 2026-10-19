-- 0041 · Auditoría de sellos: quién dio cada sello y quién canjeó cada premio.
-- Aplicar DESPUÉS de 0040. Sin DROP. Lo anterior queda con usuario_id null ("Sin registrar").
-- El usuario se completa solo (default auth.uid()): la app no cambia de llamada. Los sellos del club los suma el cliente (sin usuario).

alter table public.sellos add column usuario_id uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.canjes add column usuario_id uuid default auth.uid() references auth.users(id) on delete set null;
create index sellos_usuario_idx on public.sellos (kiosco_id, usuario_id, created_at desc) where usuario_id is not null;
create index canjes_usuario_idx on public.canjes (kiosco_id, usuario_id, created_at desc) where usuario_id is not null;

create or replace function public.sellos_por_empleado(p_kiosco uuid, p_desde date, p_hasta date)
returns table (dia date, usuario_id uuid, nombre text, sellos int, manuales int, anulados int, canjes int)
language plpgsql stable security definer set search_path = public as $$
declare v_desde date := least(p_desde, p_hasta); v_hasta date := greatest(p_desde, p_hasta);
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if v_desde is null or v_hasta is null then return; end if;
  if v_hasta - v_desde > 92 then v_desde := v_hasta - 92; end if;
  return query
    with mov as (
      select (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date as d, s.usuario_id as u,
             case when not s.anulado and s.cantidad > 0 then s.cantidad else 0 end as dados,
             case when not s.anulado and s.cantidad > 0 and s.origen = 'manual' then s.cantidad else 0 end as man,
             case when s.anulado and s.cantidad > 0 then 1 else 0 end as anul, 0 as canj
        from public.sellos s
       where s.kiosco_id = p_kiosco and s.origen in ('mostrador', 'venta', 'manual')
         and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date between v_desde and v_hasta
      union all
      select (x.created_at at time zone 'America/Argentina/Buenos_Aires')::date, x.usuario_id, 0, 0, 0, case when not x.anulado then 1 else 0 end
        from public.canjes x
       where x.kiosco_id = p_kiosco
         and (x.created_at at time zone 'America/Argentina/Buenos_Aires')::date between v_desde and v_hasta
    )
    select m.d, m.u, coalesce(au.email::text, 'Sin registrar'), sum(m.dados)::int, sum(m.man)::int, sum(m.anul)::int, sum(m.canj)::int
      from mov m left join auth.users au on au.id = m.u
     group by m.d, m.u, au.email
     order by m.d desc, 4 desc;
end $$;
revoke all on function public.sellos_por_empleado(uuid, date, date) from public, anon;
grant execute on function public.sellos_por_empleado(uuid, date, date) to authenticated;
