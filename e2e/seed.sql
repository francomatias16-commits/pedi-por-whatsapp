-- Kiosco de PRUEBA para el E2E. Pegar en el SQL Editor del proyecto de pruebas (no en producción).
-- Idempotente. El dueño es el usuario con el mail de abajo (el mismo de E2E_PANEL_MAIL); si no existe, el primero de auth.users.
do $$
declare k uuid; owner uuid;
  v_mail constant text := 'e2e@ejemplo.com'; -- cambialo por el mail del usuario de prueba
begin
  select id into owner from auth.users where email = v_mail;
  if owner is null then select id into owner from auth.users order by created_at limit 1; end if;
  if owner is null then raise exception 'Primero creá el usuario de prueba (mail y contraseña) en Authentication del proyecto de pruebas.'; end if;
  select id into k from public.kioscos where slug = 'e2e-kiosco';
  if k is null then
    insert into public.kioscos (owner_id, nombre, slug, whatsapp, abierto, horario_auto, pedido_minimo, club_activo)
    values (owner, 'Kiosco E2E', 'e2e-kiosco', '5493415550000', true, false, 0, true) returning id into k;
  else
    update public.kioscos set abierto = true, horario_auto = false, pedido_minimo = 0, baja_solicitada_at = null, owner_id = owner, club_activo = true where id = k;
  end if;
  if not exists (select 1 from public.productos where kiosco_id = k and nombre = 'Alfajor E2E') then
    insert into public.productos (kiosco_id, nombre, categoria, precio, disponible) values (k, 'Alfajor E2E', 'Golosinas', 100, true);
  end if;
  -- Para probar el aviso de margen mínimo: 30% de ganancia (el mínimo por defecto es 20%).
  if not exists (select 1 from public.productos where kiosco_id = k and nombre = 'Gaseosa E2E') then
    insert into public.productos (kiosco_id, nombre, categoria, precio, costo, disponible) values (k, 'Gaseosa E2E', 'Bebidas', 1000, 700, true);
  end if;
end $$;
