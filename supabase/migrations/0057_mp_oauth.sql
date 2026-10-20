-- 0057 · Mercado Pago: conectar con un clic (OAuth).
-- Aditiva. integraciones_pago ya tenía forma_conexion ('token' | 'oauth'); acá se agregan el refresh token cifrado, el vencimiento del
-- access token y un "turno" de renovación (evita que dos consultas renueven a la vez: el refresh token de Mercado Pago es de un solo uso).
-- Con OAuth no hay clave secreta por local: todos los avisos se firman con la de la aplicación (MP_WEBHOOK_SECRET, variable del servidor).
-- Aplicar DESPUÉS de 0001..0056.

alter table public.integraciones_pago
  add column if not exists refresh_token_cifrado text,
  add column if not exists token_expira_at timestamptz,
  add column if not exists renovando_hasta timestamptz;

-- Un local con OAuth necesita refresh token y vencimiento.
alter table public.integraciones_pago add constraint integraciones_pago_oauth_completa
  check (forma_conexion <> 'oauth' or (refresh_token_cifrado is not null and token_expira_at is not null)) not valid;

-- Turno de renovación: devuelve true a quien lo toma. Solo el servidor (service role) la llama.
create or replace function public.mp_renovacion_tomar(p_kiosco uuid, p_segundos int default 20) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_filas int;
begin
  update public.integraciones_pago
     set renovando_hasta = now() + make_interval(secs => greatest(5, least(p_segundos, 60)))
   where kiosco_id = p_kiosco and forma_conexion = 'oauth' and (renovando_hasta is null or renovando_hasta < now());
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end $$;
revoke all on function public.mp_renovacion_tomar(uuid, int) from public, anon, authenticated;

-- El panel muestra "Conectado con Mercado Pago" y no pide clave secreta a quien se conectó con un clic.
create or replace function public.mp_estado_conexion(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.integraciones_pago%rowtype; v_activo boolean;
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select cobro_online_activo into v_activo from public.kioscos where id = p_kiosco;
  select * into i from public.integraciones_pago where kiosco_id = p_kiosco;
  if not found then return jsonb_build_object('conectada', false, 'cobro_online_activo', coalesce(v_activo, false)); end if;
  return jsonb_build_object('conectada', true, 'activa', i.activa, 'cobro_online_activo', coalesce(v_activo, false),
    'mp_user_id', i.mp_user_id, 'token_ultimos4', case when i.forma_conexion = 'token' then i.token_ultimos4 end, 'forma_conexion', i.forma_conexion,
    'sin_secreto', i.forma_conexion = 'token' and i.webhook_secret_cifrado is null, 'actualizada', i.updated_at,
    'pendientes', (select count(*) from public.pedidos where kiosco_id = p_kiosco and pago_estado = 'pendiente' and estado = 'pendiente'));
end $$;
revoke all on function public.mp_estado_conexion(uuid) from public, anon;
grant execute on function public.mp_estado_conexion(uuid) to authenticated;
