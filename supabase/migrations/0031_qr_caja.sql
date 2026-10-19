-- 0031 · Etapa 2B: cobro con QR de Mercado Pago en la caja (mostrador).
-- Aditiva. Reusa la conexión de la Etapa 1 (integraciones_pago). Tres piezas:
--  - pos_qr_config: la sucursal y la caja que se crean una sola vez en Mercado Pago y el QR fijo del local. Solo la escribe el servidor.
--  - cobros_qr_pos: cada cobro QR del mostrador. Se escribe solo desde el servidor; los miembros del local lo leen.
--  - Trigger sobre ventas_mostrador_pagos: con el interruptor encendido, un pago "mercadopago" solo se registra si hay un cobro QR
--    aprobado del mismo monto sin usar. Así la venta nunca se anota sin plata, y la plata nunca queda sin venta por un error de pantalla.
-- Un QR fijo admite una sola orden a la vez: hay un único cobro pendiente por local (índice parcial).
-- El interruptor (kioscos.cobro_qr_activo) arranca apagado: con él apagado nada de lo anterior cambia el comportamiento de la caja.
-- Aplicar DESPUÉS de 0001..0030.

-- 1) Interruptor por local.
alter table public.kioscos add column if not exists cobro_qr_activo boolean not null default false;

-- 2) Tablas.
create table public.pos_qr_config (
  kiosco_id uuid primary key references public.kioscos(id) on delete cascade,
  mp_user_id text not null,                 -- cuenta de Mercado Pago con la que se creó; si el dueño conecta otra, hay que repetir el alta
  mp_store_id text not null,
  external_store_id text not null,
  mp_pos_id text not null,
  external_pos_id text not null,
  qr_imagen text,                           -- URL de la imagen del QR fijo (pública: es la que se imprime)
  qr_plantilla text,                        -- URL del PDF/plantilla para imprimir
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cobros_qr_pos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  turno_id uuid references public.turnos_caja(id) on delete set null,
  monto numeric(12,2) not null check (monto >= 15 and monto <= 5000000),  -- 15 es el mínimo de Mercado Pago
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'vencido', 'cancelado', 'reembolsado')),
  payment_id text,                          -- id de la orden de Mercado Pago (ORD…): una orden, un pago
  mp_order_id text,                         -- id de la orden en la API de Orders; lo guarda el servidor al crearla
  venta_id uuid references public.ventas_mostrador(id) on delete set null,
  creado_por uuid references auth.users(id) on delete set null,
  expira_at timestamptz not null,
  detalle text,                             -- aprobado_tarde, monto_distinto, intento_rechazado
  consultado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (venta_id is null or estado in ('aprobado', 'reembolsado'))
);
create unique index cobros_qr_pos_payment on public.cobros_qr_pos (payment_id) where payment_id is not null;
create unique index cobros_qr_pos_orden on public.cobros_qr_pos (mp_order_id) where mp_order_id is not null;
-- Un QR fijo, una orden a la vez.
create unique index cobros_qr_pos_uno_pendiente on public.cobros_qr_pos (kiosco_id) where estado = 'pendiente';
create index cobros_qr_pos_sin_venta on public.cobros_qr_pos (kiosco_id, created_at) where estado = 'aprobado' and venta_id is null;
create index cobros_qr_pos_kiosco on public.cobros_qr_pos (kiosco_id, created_at desc);

alter table public.pos_qr_config enable row level security;
alter table public.cobros_qr_pos enable row level security;
revoke all on public.pos_qr_config from anon, authenticated;       -- sin políticas: solo el servidor; el panel la ve por qr_estado_config()
revoke all on public.cobros_qr_pos from anon, authenticated;
grant select on public.cobros_qr_pos to authenticated;
create policy cobros_qr_pos_miembros on public.cobros_qr_pos for select to authenticated
  using (public.es_miembro(kiosco_id, array['cajero', 'encargado', 'dueno']));

-- 3) Minutos que espera un cobro QR antes de vencer. La app usa el mismo valor (lib/pagos/qr.ts).
create or replace function public.qr_minutos_vencimiento() returns int language sql immutable set search_path = '' as $$ select 5 $$;

-- 4) Vencimiento. Con p_kiosco, solo ese local.
create or replace function public.qr_vencer_pendientes(p_kiosco uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with v as (
    update public.cobros_qr_pos set estado = 'vencido', updated_at = now()
     where estado = 'pendiente' and expira_at < now() and (p_kiosco is null or kiosco_id = p_kiosco)
    returning 1
  ) select count(*) into v_n from v;
  return v_n;
end $$;

-- 5) Crear un cobro. Solo el servidor (la ruta ya comprobó el rol de quien llama y pasa su id).
create or replace function public.qr_crear_cobro(p_kiosco uuid, p_turno uuid, p_monto numeric, p_usuario uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_k public.kioscos%rowtype; v_c public.cobros_qr_pos%rowtype; v_monto numeric(12,2);
begin
  select * into v_k from public.kioscos where id = p_kiosco;
  if not found then raise exception 'kiosco_no_encontrado'; end if;
  if not v_k.cobro_qr_activo then raise exception 'qr_inactivo'; end if;
  if not exists (select 1 from public.pos_qr_config c join public.integraciones_pago i on i.kiosco_id = c.kiosco_id and i.mp_user_id = c.mp_user_id and i.activa
                  where c.kiosco_id = p_kiosco) then raise exception 'qr_sin_config'; end if;
  if not exists (select 1 from public.turnos_caja where id = p_turno and kiosco_id = p_kiosco and estado = 'abierto') then raise exception 'turno_cerrado'; end if;
  if p_monto is null or p_monto < 15 or p_monto > 5000000 or round(p_monto, 2) <> p_monto then raise exception 'qr_monto_invalido'; end if;
  v_monto := p_monto;
  perform public.qr_vencer_pendientes(p_kiosco);
  if exists (select 1 from public.cobros_qr_pos where kiosco_id = p_kiosco and estado = 'pendiente') then raise exception 'qr_ocupado'; end if;
  insert into public.cobros_qr_pos (kiosco_id, turno_id, monto, creado_por, expira_at)
    values (p_kiosco, p_turno, v_monto, p_usuario, now() + make_interval(mins => public.qr_minutos_vencimiento()))
    returning * into v_c;
  return jsonb_build_object('cobro_id', v_c.id, 'monto', v_c.monto, 'expira_at', v_c.expira_at);
end $$;

-- 6) Estado de un cobro (con vencimiento al consultarlo). Solo el servidor.
create or replace function public.qr_estado_cobro(p_cobro uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c public.cobros_qr_pos%rowtype;
begin
  select * into v_c from public.cobros_qr_pos where id = p_cobro;
  if not found then raise exception 'cobro_no_encontrado'; end if;
  if v_c.estado = 'pendiente' and v_c.expira_at < now() then
    update public.cobros_qr_pos set estado = 'vencido', updated_at = now() where id = p_cobro and estado = 'pendiente' returning * into v_c;
    if not found then select * into v_c from public.cobros_qr_pos where id = p_cobro; end if;
  end if;
  return jsonb_build_object('cobro_id', v_c.id, 'kiosco_id', v_c.kiosco_id, 'estado', v_c.estado, 'monto', v_c.monto,
    'venta_id', v_c.venta_id, 'detalle', v_c.detalle, 'expira_at', v_c.expira_at);
end $$;

-- 7) Cancelar un cobro pendiente (el cajero se arrepintió). Si ya estaba aprobado, no lo toca y devuelve su estado.
create or replace function public.qr_cancelar_cobro(p_cobro uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c public.cobros_qr_pos%rowtype;
begin
  update public.cobros_qr_pos set estado = 'cancelado', updated_at = now() where id = p_cobro and estado = 'pendiente' returning * into v_c;
  if not found then
    select * into v_c from public.cobros_qr_pos where id = p_cobro;
    if not found then raise exception 'cobro_no_encontrado'; end if;
  end if;
  return jsonb_build_object('cobro_id', v_c.id, 'estado', v_c.estado);
end $$;

-- 8) Respaldo del aviso: ¿corresponde consultar a Mercado Pago ahora? Con p_segundos <= 0 (el cron) se fuerza.
create or replace function public.qr_puede_consultar(p_cobro uuid, p_segundos int default 2) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.cobros_qr_pos set consultado_at = now()
   where id = p_cobro and estado in ('pendiente', 'vencido', 'cancelado')
     and (p_segundos <= 0 or consultado_at is null or consultado_at < now() - make_interval(secs => p_segundos))
  returning id into v_id;
  return v_id is not null;
end $$;

-- 9) Aplica un pago ya consultado a Mercado Pago. Idempotente. Solo el servidor.
--    Resultados: confirmado, aprobado_tarde, duplicado, pendiente, rechazado, vencido, reembolsado, reembolsado_con_venta, monto_invalido, ignorado.
--    Un intento rechazado NO cierra el cobro: el cliente puede reintentar con otro medio sobre la misma orden.
create or replace function public.qr_confirmar(p_payment_id text, p_cobro uuid, p_monto numeric, p_moneda text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c public.cobros_qr_pos%rowtype; v_previo text;
begin
  if p_estado is null or p_estado not in ('pendiente', 'aprobado', 'rechazado', 'vencido', 'reembolsado') then raise exception 'estado_pago_invalido'; end if;
  if coalesce(p_payment_id, '') = '' then raise exception 'pago_invalido'; end if;
  select * into v_c from public.cobros_qr_pos where id = p_cobro for update;
  if not found then raise exception 'cobro_no_encontrado'; end if;
  -- Un pago pertenece a un solo cobro.
  if exists (select 1 from public.cobros_qr_pos where payment_id = p_payment_id and id <> p_cobro) then raise exception 'pago_invalido'; end if;
  if v_c.payment_id is not null and v_c.payment_id <> p_payment_id and v_c.estado in ('aprobado', 'reembolsado') then
    return jsonb_build_object('resultado', 'ignorado');   -- ya tiene su pago; otro intento posterior no lo cambia
  end if;

  if p_estado = 'pendiente' then
    if v_c.payment_id is null and v_c.estado = 'pendiente' then update public.cobros_qr_pos set payment_id = p_payment_id, updated_at = now() where id = p_cobro; end if;
    return jsonb_build_object('resultado', 'pendiente');

  elsif p_estado = 'aprobado' then
    if v_c.estado in ('aprobado', 'reembolsado') then return jsonb_build_object('resultado', 'duplicado'); end if;
    if p_monto is null or p_monto <> v_c.monto or upper(coalesce(p_moneda, '')) <> 'ARS' then
      update public.cobros_qr_pos set detalle = 'monto_distinto', updated_at = now() where id = p_cobro;
      return jsonb_build_object('resultado', 'monto_invalido');
    end if;
    v_previo := v_c.estado;
    update public.cobros_qr_pos
       set estado = 'aprobado', payment_id = p_payment_id, updated_at = now(),
           detalle = case when v_previo in ('vencido', 'cancelado') then 'aprobado_tarde' else null end
     where id = p_cobro;
    return jsonb_build_object('resultado', case when v_previo in ('vencido', 'cancelado') then 'aprobado_tarde' else 'confirmado' end);

  elsif p_estado = 'rechazado' then
    if v_c.estado = 'pendiente' then update public.cobros_qr_pos set detalle = 'intento_rechazado', updated_at = now() where id = p_cobro; end if;
    return jsonb_build_object('resultado', case when v_c.estado in ('aprobado', 'reembolsado') then 'ignorado' else 'rechazado' end);

  elsif p_estado = 'vencido' then
    if v_c.estado in ('aprobado', 'reembolsado') then return jsonb_build_object('resultado', 'ignorado'); end if;
    update public.cobros_qr_pos set estado = 'vencido', updated_at = now() where id = p_cobro and estado = 'pendiente';
    return jsonb_build_object('resultado', 'vencido');

  else -- reembolsado
    if v_c.estado <> 'aprobado' then return jsonb_build_object('resultado', 'ignorado'); end if;
    update public.cobros_qr_pos set estado = 'reembolsado', updated_at = now() where id = p_cobro;
    return jsonb_build_object('resultado', case when v_c.venta_id is null then 'reembolsado' else 'reembolsado_con_venta' end);
  end if;
end $$;

-- 10) El trigger que ata la venta al cobro. Con el interruptor encendido, un pago "mercadopago" consume un cobro aprobado del mismo
--     monto (el más viejo primero) que no tenga venta. Sin cobro, la venta entera se rechaza (qr_sin_cobro).
--     Con el interruptor apagado no hace nada.
create or replace function public.ventas_pagos_exigir_qr() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_k uuid; v_id uuid;
begin
  if new.medio <> 'mercadopago' then return new; end if;
  select v.kiosco_id into v_k from public.ventas_mostrador v where v.id = new.venta_id;
  if v_k is null or not exists (select 1 from public.kioscos where id = v_k and cobro_qr_activo) then return new; end if;
  select c.id into v_id from public.cobros_qr_pos c
   where c.kiosco_id = v_k and c.estado = 'aprobado' and c.venta_id is null and c.monto = new.monto
     and c.created_at > now() - interval '12 hours'
   order by c.created_at limit 1 for update skip locked;
  if v_id is null then raise exception 'qr_sin_cobro'; end if;
  update public.cobros_qr_pos set venta_id = new.venta_id, updated_at = now() where id = v_id;
  return new;
end $$;
revoke execute on function public.ventas_pagos_exigir_qr() from public, anon, authenticated;
create trigger ventas_pagos_exigir_qr after insert on public.ventas_mostrador_pagos
  for each row execute function public.ventas_pagos_exigir_qr();

-- 11) Lo que ve el panel y la caja. Cualquier miembro del local puede saber si el QR está listo y ver la imagen para imprimirla.
create or replace function public.qr_estado_config(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.pos_qr_config%rowtype; v_activo boolean; v_conexion boolean; v_ok boolean;
begin
  if auth.uid() is null or not public.es_miembro(p_kiosco, array['cajero', 'encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select cobro_qr_activo into v_activo from public.kioscos where id = p_kiosco;
  select exists (select 1 from public.integraciones_pago where kiosco_id = p_kiosco and activa) into v_conexion;
  select * into c from public.pos_qr_config where kiosco_id = p_kiosco;
  if not found then return jsonb_build_object('configurado', false, 'activo', false, 'conexion', v_conexion); end if;
  -- Si el dueño conectó otra cuenta de Mercado Pago después del alta, el QR viejo ya no sirve.
  select exists (select 1 from public.integraciones_pago where kiosco_id = p_kiosco and mp_user_id = c.mp_user_id) into v_ok;
  return jsonb_build_object('configurado', v_ok, 'cuenta_distinta', not v_ok, 'activo', coalesce(v_activo, false) and v_ok and v_conexion,
    'conexion', v_conexion, 'qr_imagen', c.qr_imagen, 'qr_plantilla', c.qr_plantilla, 'minutos', public.qr_minutos_vencimiento());
end $$;

-- 12) Cobros aprobados que todavía no tienen venta (la persona cerró la pantalla, se cortó internet, etc.).
create or replace function public.qr_cobros_sin_venta(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_miembro(p_kiosco, array['cajero', 'encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'monto', c.monto, 'creado', c.created_at, 'detalle', c.detalle,
                                                        'vigente', c.created_at > now() - interval '12 hours') order by c.created_at)
                     from public.cobros_qr_pos c where c.kiosco_id = p_kiosco and c.estado = 'aprobado' and c.venta_id is null), '[]'::jsonb);
end $$;

-- 13) Encender o apagar el QR en la caja. Solo el dueño, y solo si el alta está hecha con la cuenta conectada.
create or replace function public.qr_configurar_activo(p_kiosco uuid, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_activo and not exists (select 1 from public.pos_qr_config c join public.integraciones_pago i on i.kiosco_id = c.kiosco_id and i.mp_user_id = c.mp_user_id and i.activa
                               where c.kiosco_id = p_kiosco) then raise exception 'qr_sin_config'; end if;
  update public.kioscos set cobro_qr_activo = coalesce(p_activo, false) where id = p_kiosco;
  return jsonb_build_object('activo', coalesce(p_activo, false));
end $$;

-- 14) Desconectar Mercado Pago (de 0029) también apaga el QR. La sucursal y la caja quedan creadas en Mercado Pago.
create or replace function public.mp_desconectar(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  delete from public.integraciones_pago where kiosco_id = p_kiosco;
  update public.kioscos set cobro_online_activo = false, cobro_qr_activo = false where id = p_kiosco;
  return jsonb_build_object('conectada', false);
end $$;

-- 15) Permisos. Lo del cobro es del servidor; el panel y la caja usan solo las tres funciones de lectura y el interruptor.
revoke all on function public.qr_minutos_vencimiento() from public, anon;
revoke all on function public.qr_vencer_pendientes(uuid) from public, anon, authenticated;
revoke all on function public.qr_crear_cobro(uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.qr_estado_cobro(uuid) from public, anon, authenticated;
revoke all on function public.qr_cancelar_cobro(uuid) from public, anon, authenticated;
revoke all on function public.qr_puede_consultar(uuid, int) from public, anon, authenticated;
revoke all on function public.qr_confirmar(text, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.qr_estado_config(uuid) from public, anon;
revoke all on function public.qr_cobros_sin_venta(uuid) from public, anon;
revoke all on function public.qr_configurar_activo(uuid, boolean) from public, anon;
grant execute on function public.qr_estado_config(uuid) to authenticated;
grant execute on function public.qr_cobros_sin_venta(uuid) to authenticated;
grant execute on function public.qr_configurar_activo(uuid, boolean) to authenticated;
