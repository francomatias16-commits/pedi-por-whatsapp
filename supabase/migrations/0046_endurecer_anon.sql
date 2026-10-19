do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('crear_pedido', 'seguimiento_pedido', 'club_datos', 'club_tarjeta', 'club_sumar', 'club_unirse')
      -- no tocar lo que usan las políticas RLS: anon las necesita para leer tablas
      and not exists (
        select 1 from pg_policies pol
        where pol.schemaname = 'public'
          and (pol.qual like '%' || p.proname || '(%' or pol.with_check like '%' || p.proname || '(%')
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.fn);
    execute format('grant execute on function %s to authenticated, service_role', r.fn);
  end loop;
end $$;