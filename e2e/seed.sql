-- Kiosco de PRUEBA para el E2E. Pegar en el SQL Editor del proyecto de pruebas (no en producción).
-- Idempotente. Necesita al menos un usuario en auth.users (entrá una vez al panel de pruebas con Google).
do $$
declare k uuid; owner uuid;
begin
  select id into owner from auth.users order by created_at limit 1;
  if owner is null then raise exception 'Primero entrá una vez al panel de pruebas para crear un usuario.'; end if;
  select id into k from public.kioscos where slug = 'e2e-kiosco';
  if k is null then
    insert into public.kioscos (owner_id, nombre, slug, whatsapp, abierto, horario_auto, pedido_minimo)
    values (owner, 'Kiosco E2E', 'e2e-kiosco', '5493415550000', true, false, 0) returning id into k;
  else
    update public.kioscos set abierto = true, horario_auto = false, pedido_minimo = 0, baja_solicitada_at = null where id = k;
  end if;
  if not exists (select 1 from public.productos where kiosco_id = k and nombre = 'Alfajor E2E') then
    insert into public.productos (kiosco_id, nombre, categoria, precio, disponible) values (k, 'Alfajor E2E', 'Golosinas', 100, true);
  end if;
end $$;
