-- 0058 · Facturación electrónica con ARCA (Factura C y Nota de crédito C), solo desde el mostrador.
-- Aditiva. Modelo "solo conectarse": un único certificado del proveedor firma por todos los locales y cada kiosquero delega, una sola vez,
-- el servicio de Factura Electrónica a la CUIT del proveedor desde su Administrador de Relaciones de Clave Fiscal.
--  - arca_proveedor_config: el certificado del proveedor (cifrado), una fila por ambiente. Solo servidor (service role).
--  - tokens_wsaa_proveedor: token de autenticación compartido, una fila por ambiente. Solo servidor.
--  - arca_lock_emision: candado por local + punto de venta + tipo (dos emisiones simultáneas no piden el mismo número).
--  - facturacion_config: datos fiscales del local (CUIT, punto de venta, razón social) y el estado de la delegación.
--  - comprobantes_arca: cada Factura C / Nota de crédito C, con su CAE. Una venta tiene una sola factura viva; una devolución, una sola nota.
--  - Una venta con factura no se anula sin antes emitir la nota de crédito por el saldo (trigger).
-- Aplicar DESPUÉS de 0001..0057.

-- 1) Certificado y token del proveedor (nadie del navegador los lee).
create table public.arca_proveedor_config (
  homologacion boolean primary key,
  cuit text not null check (cuit ~ '^[0-9]{11}$'),
  cert_cifrado text not null,
  key_cifrada text not null,
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.tokens_wsaa_proveedor (
  homologacion boolean primary key,
  token text not null,
  sign text not null,
  expira_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.arca_proveedor_config enable row level security;
alter table public.tokens_wsaa_proveedor enable row level security;
revoke all on public.arca_proveedor_config, public.tokens_wsaa_proveedor from anon, authenticated;

-- 2) Datos fiscales del local. El dueño los lee; se escriben desde el servidor (que valida CUIT y punto de venta).
create table public.facturacion_config (
  kiosco_id uuid primary key references public.kioscos(id) on delete cascade,
  cuit text not null check (cuit ~ '^[0-9]{11}$'),
  razon_social text not null check (length(razon_social) between 2 and 120),
  domicilio text not null check (length(domicilio) between 3 and 200),
  punto_venta int not null check (punto_venta between 1 and 99998),
  condicion_iva text not null default 'monotributo' check (condicion_iva in ('monotributo', 'exento')), -- Factura C: monotributistas y exentos
  inicio_actividades date,
  activo boolean not null default false,
  estado_delegacion text not null default 'pendiente' check (estado_delegacion in ('pendiente', 'activa', 'rechazada')),
  delegacion_verificada_at timestamptz,
  delegacion_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.facturacion_config enable row level security;
revoke all on public.facturacion_config from anon, authenticated;
grant select on public.facturacion_config to authenticated;
create policy facturacion_config_dueno on public.facturacion_config for select to authenticated using (public.es_dueno(kiosco_id));

-- 3) Comprobantes.
create table public.comprobantes_arca (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  venta_id uuid not null references public.ventas_mostrador(id) on delete restrict,
  devolucion_id uuid references public.devoluciones_mostrador(id) on delete restrict,
  asociado_id uuid references public.comprobantes_arca(id) on delete restrict,
  tipo_cbte int not null check (tipo_cbte in (11, 13)), -- 11 = Factura C, 13 = Nota de crédito C
  punto_venta int not null,
  numero bigint,
  fecha date not null,
  total numeric(12,2) not null check (total > 0),
  receptor_doc_tipo int not null default 99 check (receptor_doc_tipo in (80, 96, 99)), -- CUIT, DNI, consumidor final
  receptor_doc_nro text not null default '0' check (receptor_doc_nro ~ '^[0-9]{1,11}$'),
  receptor_nombre text check (receptor_nombre is null or length(receptor_nombre) <= 120),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'emitido', 'rechazado', 'incierto')),
  cae text,
  cae_vto date,
  error text,
  homologacion boolean not null,
  cuit_emisor text not null check (cuit_emisor ~ '^[0-9]{11}$'),
  usuario_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tipo_cbte = 11 and asociado_id is null and devolucion_id is null) or (tipo_cbte = 13 and asociado_id is not null)),
  check (estado <> 'emitido' or (numero is not null and cae is not null and cae_vto is not null))
);
create index comprobantes_arca_venta on public.comprobantes_arca (venta_id);
create index comprobantes_arca_kiosco on public.comprobantes_arca (kiosco_id, created_at desc);
-- Una factura viva por venta; una nota viva por devolución; una nota "por el saldo" (sin devolución) viva por factura.
create unique index comprobantes_factura_viva on public.comprobantes_arca (venta_id) where tipo_cbte = 11 and estado in ('pendiente', 'emitido', 'incierto');
create unique index comprobantes_nc_devolucion_viva on public.comprobantes_arca (devolucion_id) where tipo_cbte = 13 and devolucion_id is not null and estado in ('pendiente', 'emitido', 'incierto');
create unique index comprobantes_nc_saldo_viva on public.comprobantes_arca (asociado_id) where tipo_cbte = 13 and devolucion_id is null and estado in ('pendiente', 'emitido', 'incierto');
-- Un número emitido no se repite en un punto de venta y ambiente.
create unique index comprobantes_numero_unico on public.comprobantes_arca (cuit_emisor, homologacion, punto_venta, tipo_cbte, numero) where estado = 'emitido';
alter table public.comprobantes_arca enable row level security;
revoke all on public.comprobantes_arca from anon, authenticated;
grant select on public.comprobantes_arca to authenticated;
create policy comprobantes_arca_miembros on public.comprobantes_arca for select to authenticated using (public.es_miembro(kiosco_id, array['cajero', 'encargado', 'dueno']));

-- 4) Candado de emisión (solo servidor).
create table public.arca_lock_emision (
  kiosco_id uuid not null,
  punto_venta int not null,
  tipo_cbte int not null,
  locked_at timestamptz not null default now(),
  locked_token uuid not null,
  primary key (kiosco_id, punto_venta, tipo_cbte)
);
alter table public.arca_lock_emision enable row level security;
revoke all on public.arca_lock_emision from anon, authenticated;

create or replace function public.arca_lock_adquirir(p_kiosco uuid, p_punto_venta int, p_tipo int, p_stale_seconds int default 90) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_token uuid := gen_random_uuid(); v_filas int;
begin
  insert into public.arca_lock_emision (kiosco_id, punto_venta, tipo_cbte, locked_at, locked_token) values (p_kiosco, p_punto_venta, p_tipo, now(), v_token)
    on conflict (kiosco_id, punto_venta, tipo_cbte) do update set locked_at = now(), locked_token = v_token
    where public.arca_lock_emision.locked_at < now() - make_interval(secs => greatest(30, least(p_stale_seconds, 600)));
  get diagnostics v_filas = row_count;
  return case when v_filas = 1 then v_token else null end;
end $$;
create or replace function public.arca_lock_liberar(p_kiosco uuid, p_punto_venta int, p_tipo int, p_token uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.arca_lock_emision where kiosco_id = p_kiosco and punto_venta = p_punto_venta and tipo_cbte = p_tipo and locked_token = p_token
$$;

-- 5) Reservar una Factura C para una venta del mostrador. Devuelve la fila viva si ya existe (idempotente).
--    El total sale de la venta; el cliente no lo manda.
create or replace function public.arca_reservar_factura(p_kiosco uuid, p_venta uuid, p_usuario uuid, p_doc_tipo int, p_doc_nro text, p_nombre text, p_fecha date, p_homologacion boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.ventas_mostrador%rowtype; c public.facturacion_config%rowtype; x public.comprobantes_arca%rowtype; v_id uuid;
begin
  select * into v from public.ventas_mostrador where id = p_venta and kiosco_id = p_kiosco;
  if not found then raise exception 'venta_no_encontrada'; end if;
  select * into c from public.facturacion_config where kiosco_id = p_kiosco;
  if not found or not c.activo then raise exception 'arca_no_configurada'; end if;
  if c.estado_delegacion <> 'activa' then raise exception 'arca_sin_delegacion'; end if;
  select * into x from public.comprobantes_arca where venta_id = p_venta and tipo_cbte = 11 and estado in ('pendiente', 'emitido', 'incierto');
  if found then return jsonb_build_object('id', x.id, 'estado', x.estado, 'nuevo', false); end if;
  if v.anulada then raise exception 'venta_anulada'; end if;
  if v.total <= 0 then raise exception 'venta_sin_total'; end if;
  insert into public.comprobantes_arca (kiosco_id, venta_id, tipo_cbte, punto_venta, fecha, total, receptor_doc_tipo, receptor_doc_nro, receptor_nombre, homologacion, cuit_emisor, usuario_id)
    values (p_kiosco, p_venta, 11, c.punto_venta, p_fecha, v.total, coalesce(p_doc_tipo, 99), coalesce(nullif(p_doc_nro, ''), '0'), nullif(trim(p_nombre), ''), p_homologacion, c.cuit, p_usuario)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'estado', 'pendiente', 'nuevo', true);
end $$;

-- 6) Reservar una Nota de crédito C: por una devolución (su total) o, sin devolución, por el saldo de la factura (para poder anular la venta).
create or replace function public.arca_reservar_nc(p_kiosco uuid, p_venta uuid, p_devolucion uuid, p_usuario uuid, p_fecha date, p_homologacion boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.comprobantes_arca%rowtype; x public.comprobantes_arca%rowtype; d public.devoluciones_mostrador%rowtype; v_ncs numeric; v_monto numeric; v_id uuid;
begin
  select * into f from public.comprobantes_arca where venta_id = p_venta and kiosco_id = p_kiosco and tipo_cbte = 11 and estado = 'emitido';
  if not found then raise exception 'arca_sin_factura'; end if;
  if f.homologacion <> p_homologacion then raise exception 'arca_otro_ambiente'; end if;
  if p_devolucion is not null then
    select * into d from public.devoluciones_mostrador where id = p_devolucion and venta_id = p_venta and kiosco_id = p_kiosco;
    if not found then raise exception 'devolucion_no_encontrada'; end if;
    select * into x from public.comprobantes_arca where devolucion_id = p_devolucion and tipo_cbte = 13 and estado in ('pendiente', 'emitido', 'incierto');
  else
    select * into x from public.comprobantes_arca where asociado_id = f.id and devolucion_id is null and tipo_cbte = 13 and estado in ('pendiente', 'emitido', 'incierto');
  end if;
  if found then return jsonb_build_object('id', x.id, 'estado', x.estado, 'nuevo', false); end if;
  select coalesce(sum(total), 0) into v_ncs from public.comprobantes_arca where asociado_id = f.id and tipo_cbte = 13 and estado in ('pendiente', 'emitido', 'incierto');
  v_monto := case when p_devolucion is not null then d.total else f.total - v_ncs end;
  if v_monto <= 0 then raise exception 'arca_nc_sin_saldo'; end if;
  if v_ncs + v_monto > f.total then raise exception 'arca_nc_excede'; end if;
  insert into public.comprobantes_arca (kiosco_id, venta_id, devolucion_id, asociado_id, tipo_cbte, punto_venta, fecha, total, receptor_doc_tipo, receptor_doc_nro, receptor_nombre, homologacion, cuit_emisor, usuario_id)
    values (p_kiosco, p_venta, p_devolucion, f.id, 13, f.punto_venta, p_fecha, v_monto, f.receptor_doc_tipo, f.receptor_doc_nro, f.receptor_nombre, f.homologacion, f.cuit_emisor, p_usuario)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'estado', 'pendiente', 'nuevo', true);
end $$;

-- 7) Guardar el resultado de ARCA. Solo sale de pendiente/incierto (un comprobante emitido no se toca).
create or replace function public.arca_guardar_resultado(p_id uuid, p_estado text, p_numero bigint, p_cae text, p_cae_vto date, p_error text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_filas int;
begin
  if p_estado not in ('emitido', 'rechazado', 'incierto') then raise exception 'arca_estado_invalido'; end if;
  update public.comprobantes_arca set estado = p_estado, numero = coalesce(p_numero, numero), cae = p_cae, cae_vto = p_cae_vto, error = left(p_error, 500), updated_at = now()
   where id = p_id and estado in ('pendiente', 'incierto');
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end $$;

-- 8) Qué muestra la caja de una venta: su factura viva y la nota de cada devolución. Cajero, encargado y dueño.
create or replace function public.arca_comprobantes_venta(p_venta uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_kiosco uuid; v_cfg public.facturacion_config%rowtype;
begin
  select kiosco_id into v_kiosco from public.ventas_mostrador where id = p_venta;
  if v_kiosco is null or auth.uid() is null or not public.es_miembro(v_kiosco, array['cajero', 'encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select * into v_cfg from public.facturacion_config where kiosco_id = v_kiosco;
  return jsonb_build_object(
    'habilitada', coalesce(v_cfg.activo and v_cfg.estado_delegacion = 'activa', false),
    'comprobantes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo_cbte, 'punto_venta', c.punto_venta, 'numero', c.numero, 'total', c.total, 'estado', c.estado,
        'cae', c.cae, 'cae_vto', c.cae_vto, 'error', c.error, 'devolucion_id', c.devolucion_id, 'homologacion', c.homologacion, 'fecha', c.fecha) order by c.created_at)
      from public.comprobantes_arca c where c.venta_id = p_venta and c.estado <> 'rechazado'), '[]'::jsonb),
    'devoluciones', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'total', d.total) order by d.created_at)
      from public.devoluciones_mostrador d where d.venta_id = p_venta), '[]'::jsonb));
end $$;

-- 9) Una venta con factura no se anula mientras quede saldo sin nota de crédito emitida: primero la nota por el saldo.
create or replace function public.ventas_mostrador_exigir_nc() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.comprobantes_arca%rowtype; v_ncs numeric;
begin
  if not (new.anulada and not old.anulada) then return new; end if;
  select * into f from public.comprobantes_arca where venta_id = new.id and tipo_cbte = 11 and estado in ('pendiente', 'emitido', 'incierto');
  if not found then return new; end if;
  if f.estado <> 'emitido' then raise exception 'venta_factura_en_curso'; end if;
  select coalesce(sum(total), 0) into v_ncs from public.comprobantes_arca where asociado_id = f.id and tipo_cbte = 13 and estado = 'emitido';
  if v_ncs < f.total then raise exception 'venta_facturada'; end if;
  return new;
end $$;
create trigger ventas_mostrador_exigir_nc before update on public.ventas_mostrador
  for each row execute function public.ventas_mostrador_exigir_nc();

revoke all on function public.arca_lock_adquirir(uuid, int, int, int), public.arca_lock_liberar(uuid, int, int, uuid),
  public.arca_reservar_factura(uuid, uuid, uuid, int, text, text, date, boolean), public.arca_reservar_nc(uuid, uuid, uuid, uuid, date, boolean),
  public.arca_guardar_resultado(uuid, text, bigint, text, date, text), public.ventas_mostrador_exigir_nc() from public, anon, authenticated;
revoke all on function public.arca_comprobantes_venta(uuid) from public, anon;
grant execute on function public.arca_comprobantes_venta(uuid) to authenticated;
