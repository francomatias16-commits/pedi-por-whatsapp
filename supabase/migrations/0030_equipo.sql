-- 0030 · Etapa 2A: equipo del kiosco (cajero, encargado, dueño).
-- Aditiva. es_dueno() NO cambia: sigue significando "dueño de la cuenta". Todo lo que no se abre explícitamente a otro rol queda
-- solo para el dueño (falla cerrado). Acá se abre, por una matriz fija, lo que cada rol puede hacer:
--   cajero    vender y cobrar en el mostrador, ver y confirmar pedidos, fiado y puntos en la venta.
--   encargado además productos, precios, stock, compras, proveedores y reportes.
--   dueño     todo, incluido Mi negocio, cobros con Mercado Pago, PIN, exportar/baja y equipo.
--  - kiosco_miembros / kiosco_invitaciones: quién es parte del local. Solo se escriben por RPC.
--  - es_miembro(kiosco, roles): la función que usan las políticas y las RPC reescritas.
--  - La reescritura de políticas y funciones se hace por catálogo, con la matriz de abajo, y verifica que cada una cambió.
--  - pos_exigir_supervisor: un cajero solo anula o devuelve con un PIN de supervisor vigente (y el local debe tener PIN).
-- Aplicar DESPUÉS de 0001..0029.

-- 1) Tablas.
create table public.kiosco_miembros (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('cajero', 'encargado', 'dueno')),
  activo boolean not null default true,
  invitado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, user_id)
);
-- El panel trabaja con un solo local por persona: una membresía activa por usuario.
create unique index kiosco_miembros_un_local_activo on public.kiosco_miembros (user_id) where activo;
create index kiosco_miembros_kiosco on public.kiosco_miembros (kiosco_id);

create table public.kiosco_invitaciones (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  rol text not null check (rol in ('cajero', 'encargado')),
  token_hash text not null unique,
  creado_por uuid not null references auth.users(id) on delete cascade,
  expira_at timestamptz not null,
  usado_at timestamptz,
  usado_por uuid references auth.users(id) on delete set null,
  revocada boolean not null default false,
  created_at timestamptz not null default now()
);
create index kiosco_invitaciones_kiosco on public.kiosco_invitaciones (kiosco_id, created_at desc);

alter table public.kiosco_miembros enable row level security;
alter table public.kiosco_invitaciones enable row level security;
revoke all on public.kiosco_miembros from anon, authenticated;
revoke all on public.kiosco_invitaciones from anon, authenticated;
grant select on public.kiosco_miembros to authenticated;
-- Cada persona ve su propia membresía (para saber su rol); el dueño ve las del local. Las invitaciones: nadie desde el navegador.
create policy kiosco_miembros_lectura on public.kiosco_miembros for select to authenticated
  using (user_id = auth.uid() or public.es_dueno(kiosco_id));

-- 2) Quién es quién. El dueño de la cuenta (kioscos.owner_id) siempre es 'dueno', exista o no su fila de miembro.
create or replace function public.rol_en(p_kiosco uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_kiosco is null then null
    when exists (select 1 from public.kioscos k where k.id = p_kiosco and k.owner_id = auth.uid()) then 'dueno'
    else (select m.rol from public.kiosco_miembros m where m.kiosco_id = p_kiosco and m.user_id = auth.uid() and m.activo)
  end
$$;

create or replace function public.es_miembro(p_kiosco uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.rol_en(p_kiosco) = any (p_roles), false)
$$;
revoke execute on function public.rol_en(uuid) from public, anon;
revoke execute on function public.es_miembro(uuid, text[]) from public, anon;
grant execute on function public.rol_en(uuid) to authenticated;
grant execute on function public.es_miembro(uuid, text[]) to authenticated;

-- 3) El dueño figura como miembro (para listarlo en el equipo). Los kioscos nuevos lo crean con un trigger.
insert into public.kiosco_miembros (kiosco_id, user_id, rol)
  select id, owner_id, 'dueno' from public.kioscos on conflict (kiosco_id, user_id) do nothing;

create or replace function public.kioscos_alta_miembro_dueno() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.kiosco_miembros (kiosco_id, user_id, rol) values (new.id, new.owner_id, 'dueno')
    on conflict (kiosco_id, user_id) do update set rol = 'dueno', activo = true;
  return new;
end $$;
revoke execute on function public.kioscos_alta_miembro_dueno() from public, anon, authenticated;
create trigger kioscos_alta_miembro_dueno after insert on public.kioscos
  for each row execute function public.kioscos_alta_miembro_dueno();

-- 4) Equipo: todo lo administra el dueño.
create or replace function public.equipo_invitar(p_kiosco uuid, p_rol text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_token text; v_exp timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_rol is null or p_rol not in ('cajero', 'encargado') then raise exception 'rol_invalido'; end if;
  if (select count(*) from public.kiosco_invitaciones where kiosco_id = p_kiosco and usado_at is null and not revocada and expira_at > now()) >= 20 then
    raise exception 'demasiadas_invitaciones';
  end if;
  if (select count(*) from public.kiosco_miembros where kiosco_id = p_kiosco and activo) >= 30 then raise exception 'equipo_lleno'; end if;
  -- 64 caracteres hexadecimales (dos UUID sin guiones).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.kiosco_invitaciones (kiosco_id, rol, token_hash, creado_por, expira_at)
    values (p_kiosco, p_rol, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), auth.uid(), v_exp);
  -- El token se devuelve una sola vez: en la base queda solo su huella.
  return jsonb_build_object('token', v_token, 'rol', p_rol, 'expira_at', v_exp);
end $$;

create or replace function public.equipo_revocar_invitacion(p_invitacion uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_k uuid;
begin
  select kiosco_id into v_k from public.kiosco_invitaciones where id = p_invitacion;
  if v_k is null or auth.uid() is null or not public.es_dueno(v_k) then raise exception 'no_autorizado'; end if;
  update public.kiosco_invitaciones set revocada = true where id = p_invitacion and usado_at is null;
end $$;

create or replace function public.equipo_listar(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  return jsonb_build_object(
    'miembros', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'rol', m.rol, 'activo', m.activo,
                 'email', u.email, 'desde', m.created_at) order by (m.rol = 'dueno') desc, m.activo desc, m.created_at)
               from public.kiosco_miembros m left join auth.users u on u.id = m.user_id where m.kiosco_id = p_kiosco), '[]'::jsonb),
    'invitaciones', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'rol', i.rol, 'expira_at', i.expira_at, 'creada', i.created_at) order by i.created_at desc)
               from public.kiosco_invitaciones i where i.kiosco_id = p_kiosco and i.usado_at is null and not i.revocada and i.expira_at > now()), '[]'::jsonb));
end $$;

create or replace function public.equipo_cambiar_rol(p_kiosco uuid, p_user uuid, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_rol is null or p_rol not in ('cajero', 'encargado') then raise exception 'rol_invalido'; end if;
  if exists (select 1 from public.kioscos where id = p_kiosco and owner_id = p_user) then raise exception 'no_se_puede_cambiar_dueno'; end if;
  update public.kiosco_miembros set rol = p_rol, updated_at = now() where kiosco_id = p_kiosco and user_id = p_user and activo;
  if not found then raise exception 'miembro_no_encontrado'; end if;
end $$;

create or replace function public.equipo_quitar(p_kiosco uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if exists (select 1 from public.kioscos where id = p_kiosco and owner_id = p_user) then raise exception 'no_se_puede_cambiar_dueno'; end if;
  update public.kiosco_miembros set activo = false, updated_at = now() where kiosco_id = p_kiosco and user_id = p_user and activo;
  if not found then raise exception 'miembro_no_encontrado'; end if;
end $$;

-- 5) Aceptar una invitación (cualquier persona logueada con el enlace). Un solo uso; vence a los 7 días.
create or replace function public.equipo_aceptar(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_i public.kiosco_invitaciones%rowtype; v_nombre text;
begin
  if auth.uid() is null then raise exception 'no_autorizado'; end if;
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then raise exception 'invitacion_invalida'; end if;
  select * into v_i from public.kiosco_invitaciones
   where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') for update;
  if not found or v_i.usado_at is not null or v_i.revocada or v_i.expira_at <= now() then raise exception 'invitacion_invalida'; end if;
  if exists (select 1 from public.kiosco_miembros where user_id = auth.uid() and activo and kiosco_id <> v_i.kiosco_id) then raise exception 'ya_tiene_local'; end if;
  if exists (select 1 from public.kiosco_miembros where user_id = auth.uid() and activo and kiosco_id = v_i.kiosco_id) then raise exception 'ya_es_miembro'; end if;
  insert into public.kiosco_miembros (kiosco_id, user_id, rol, invitado_por) values (v_i.kiosco_id, auth.uid(), v_i.rol, v_i.creado_por)
    on conflict (kiosco_id, user_id) do update set rol = excluded.rol, activo = true, invitado_por = excluded.invitado_por, updated_at = now();
  update public.kiosco_invitaciones set usado_at = now(), usado_por = auth.uid() where id = v_i.id;
  select nombre into v_nombre from public.kioscos where id = v_i.kiosco_id;
  return jsonb_build_object('kiosco_id', v_i.kiosco_id, 'rol', v_i.rol, 'nombre', v_nombre);
end $$;

-- Para mostrar "Te invitaron a X como cajero" antes de aceptar (sin consumir la invitación).
create or replace function public.equipo_ver_invitacion(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_i public.kiosco_invitaciones%rowtype;
begin
  if auth.uid() is null then raise exception 'no_autorizado'; end if;
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then raise exception 'invitacion_invalida'; end if;
  select * into v_i from public.kiosco_invitaciones where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  if not found or v_i.usado_at is not null or v_i.revocada or v_i.expira_at <= now() then raise exception 'invitacion_invalida'; end if;
  return jsonb_build_object('rol', v_i.rol, 'nombre', (select nombre from public.kioscos where id = v_i.kiosco_id));
end $$;

-- 6) Configuración del mostrador sin los secretos: pos_config guarda el hash del PIN, así que la tabla sigue solo para el dueño
--    y el cajero lee estas columnas por acá.
create or replace function public.pos_config_publica(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.pos_config%rowtype;
begin
  if not public.es_miembro(p_kiosco, array['cajero', 'encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select * into v from public.pos_config where kiosco_id = p_kiosco;
  if not found then return null; end if;
  return jsonb_build_object('sonido', v.sonido, 'imprimir_auto', v.imprimir_auto, 'abrir_cajon', v.abrir_cajon,
    'ticket_encabezado', v.ticket_encabezado, 'ticket_pie', v.ticket_pie, 'ticket_ancho', v.ticket_ancho,
    'tiene_pin', v.tiene_pin, 'pin_anular', v.pin_anular, 'pin_devolucion', v.pin_devolucion);
end $$;

-- 7) Un cajero solo anula o devuelve con un PIN de supervisor vigente. Sin PIN configurado, no puede.
--    (El encargado y el dueño siguen la regla de siempre: la opción de PIN del local.) El token se consume después, en pos_exigir_pin.
create or replace function public.pos_exigir_supervisor(p_kiosco uuid, p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.rol_en(p_kiosco) is distinct from 'cajero' then return; end if;
  if not exists (select 1 from public.pos_config where kiosco_id = p_kiosco and pin_hash is not null) then raise exception 'supervisor_requerido'; end if;
  if p_token is null or not exists (select 1 from public.pos_pin_tokens where id = p_token and kiosco_id = p_kiosco and not usado and expira_at > clock_timestamp()) then
    raise exception 'pin_requerido';
  end if;
end $$;
revoke execute on function public.pos_exigir_supervisor(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.equipo_invitar(uuid, text), public.equipo_revocar_invitacion(uuid), public.equipo_listar(uuid),
  public.equipo_cambiar_rol(uuid, uuid, text), public.equipo_quitar(uuid, uuid), public.equipo_aceptar(text), public.equipo_ver_invitacion(text),
  public.pos_config_publica(uuid) from public, anon;
grant execute on function public.equipo_invitar(uuid, text), public.equipo_revocar_invitacion(uuid), public.equipo_listar(uuid),
  public.equipo_cambiar_rol(uuid, uuid, text), public.equipo_quitar(uuid, uuid), public.equipo_aceptar(text), public.equipo_ver_invitacion(text),
  public.pos_config_publica(uuid) to authenticated;

-- 7b) Fotos de productos (bucket 'productos'): suben el dueño y el encargado. Se redefine a mano porque el cuerpo tiene paréntesis anidados.
create or replace function public.es_dueno_de_carpeta(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.es_miembro(split_part(p_name, '/', 1)::uuid, array['encargado', 'dueno']) else false end
$$;

-- 8) Matriz de permisos. Se aplica sobre las políticas y funciones que ya existen (por catálogo) y falla si alguna no cambió,
--    para que un nombre mal escrito no deje un permiso sin abrir en silencio.
do $matriz$
declare
  C text := 'array[''cajero'',''encargado'',''dueno'']';
  E text := 'array[''encargado'',''dueno'']';
  r record; k text; v_roles text; v_def text; v_new text; v_sel text; v_cmd text; v_cuenta int;
  -- política -> [roles de lectura, roles de escritura]  (C = todos, E = encargado y dueño)
  v_pol jsonb := '{
    "pedidos.pedidos_dueno": ["C","C"], "pedido_items.items_dueno": ["C","C"], "clientes.clientes_dueno": ["C","C"],
    "fiado_movimientos.fiado_dueno": ["C","C"], "sellos.sellos_dueno": ["C","E"], "canjes.canjes_select": ["C","E"],
    "productos.productos_select_dueno": ["C","C"], "productos.productos_insert_dueno": ["E","E"], "productos.productos_update_dueno": ["E","E"], "productos.productos_delete_dueno": ["E","E"],
    "stock_movimientos.stock_mov_dueno": ["E","E"],
    "ventas_mostrador.ventas_mostrador_dueno": ["C","E"], "ventas_mostrador_items.ventas_mostrador_items_dueno": ["C","E"], "ventas_mostrador_pagos.ventas_mostrador_pagos_dueno": ["C","E"],
    "devoluciones_mostrador.devoluciones_dueno": ["C","E"], "devoluciones_mostrador_items.devoluciones_items_dueno": ["C","E"],
    "turnos_caja.turnos_caja_dueno": ["C","E"], "movimientos_caja.movimientos_caja_dueno": ["C","E"],
    "pos_favoritos.pos_favoritos_dueno": ["C","E"], "pos_promos.pos_promos_dueno": ["C","E"],
    "fidelidad_campanas.fidelidad_campanas_dueno": ["C","E"], "fidelidad_premios.fidelidad_premios_dueno": ["C","E"],
    "push_suscripciones.push_dueno": ["C","C"],
    "compras.compras_dueno": ["E","E"], "compra_items.compra_items_dueno": ["E","E"], "proveedores.proveedores_dueno": ["E","E"],
    "proveedor_movimientos.prov_mov_dueno": ["E","E"], "pedidos_proveedor.pedidos_proveedor_dueno": ["E","E"], "pedido_proveedor_items.pedido_proveedor_items_dueno": ["E","E"],
    "lotes_stock.lotes_stock_lectura_dueno": ["E","E"], "conteos_sesiones.conteos_sesiones_dueno": ["E","E"], "conteos_items.conteos_items_dueno": ["E","E"],
    "avisos_reglas.avisos_reglas_dueno": ["E","E"], "config_etiquetas.config_etiquetas_dueno": ["E","E"],
    "historial_precios.historial_select": ["E","E"], "ajustes_precios.ajustes_select": ["E","E"],
    "transacciones_pago.transacciones_pago_dueno": ["E","E"]
  }';
  -- función -> roles. Las que no figuran quedan solo para el dueño.
  v_fn jsonb := '{
    "caja_abrir_turno":"C","caja_cerrar_turno":"C","caja_registrar_movimiento":"C","caja_resumen":"C","caja_reporte_z":"C",
    "registrar_venta_mostrador":"C","anular_venta_mostrador":"C","devolver_venta_mostrador":"C","pos_buscar_ventas":"C","pos_pin_verificar":"C",
    "pasar_a_fiado":"C","borrar_cliente":"E","fidelidad_dar_sellos":"C","fidelidad_canjear":"C","fidelidad_simular":"C","canjear_premio":"C",
    "fidelidad_resumen":"E","fidelidad_anular_canje":"E","fidelidad_anular_sello":"E","resumen_semana":"E",
    "ajustar_precios":"E","ajustar_precios_por_margen":"E","previsualizar_ajuste":"E","previsualizar_margen":"E","revertir_ajuste":"E",
    "ajustar_stock":"E","anular_compra":"E","registrar_compra":"E","pagar_proveedor":"E","proveedor_guardar":"E",
    "conteo_actual":"E","conteo_aplicar":"E","conteo_crear":"E","conteo_descartar":"E","conteo_diferencias":"E","conteo_guardar":"E",
    "curva_abc":"E","fiado_vencido":"E","clientes_en_fuga":"E","lote_cerrar":"E","lote_dar_de_baja":"E","lote_registrar":"E","lotes_repartir":"E",
    "regla_crear":"E","reporte_mermas":"E","reposicion_minimos_iniciales":"E","reposicion_resumen":"E","reposicion_sugerida":"E","sumar_stock_rapido":"E",
    "pedido_proveedor_cancelar":"E","pedido_proveedor_cerrar":"E","pedido_proveedor_crear":"E","pedido_proveedor_enviar":"E","pedido_proveedor_recibir":"E"
  }';
begin
  -- 8a) Políticas.
  for k in select jsonb_object_keys(v_pol) loop
    select * into r from pg_policies where schemaname = 'public' and tablename = split_part(k, '.', 1) and policyname = split_part(k, '.', 2);
    if not found then raise exception using message = format('matriz: no existe la política %', k); end if;
    v_cmd := r.cmd;                       -- ALL | SELECT | INSERT | UPDATE | DELETE
    v_roles := case when v_cmd = 'SELECT' then v_pol -> k ->> 0 else v_pol -> k ->> 1 end;
    v_sel := v_pol -> k ->> 0;
    if (r.qual is null or r.qual !~ 'es_dueno\(') and (r.with_check is null or r.with_check !~ 'es_dueno\(') then
      raise exception using message = format('matriz: la política % no usa es_dueno()', k);
    end if;
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I as permissive for %s to %s %s %s', r.policyname, r.tablename, v_cmd,
      array_to_string(r.roles, ', '),
      case when r.qual is null then '' else 'using (' || regexp_replace(r.qual, '(public\.)?es_dueno\(([^()]*)\)', 'public.es_miembro(\2, ' || case v_roles when 'C' then C else E end || ')', 'g') || ')' end,
      case when r.with_check is null then '' else 'with check (' || regexp_replace(r.with_check, '(public\.)?es_dueno\(([^()]*)\)', 'public.es_miembro(\2, ' || case v_roles when 'C' then C else E end || ')', 'g') || ')' end);
    -- Política "para todo" donde leer es más amplio que escribir: se agrega una de solo lectura.
    if v_cmd = 'ALL' and v_sel = 'C' and v_roles = 'E' then
      execute format('create policy %I on public.%I as permissive for select to authenticated using (%s)', r.policyname || '_lectura', r.tablename,
        regexp_replace(r.qual, '(public\.)?es_dueno\(([^()]*)\)', 'public.es_miembro(\2, ' || C || ')', 'g'));
    end if;
  end loop;

  -- 8b) Funciones: se cambia es_dueno(x) por es_miembro(x, roles) en su definición vigente.
  for k in select jsonb_object_keys(v_fn) loop
    v_roles := v_fn ->> k;
    v_cuenta := 0;
    for r in select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = k loop
      v_def := r.def;
      v_new := regexp_replace(v_def, '(public\.)?es_dueno\(([^()]*)\)', 'public.es_miembro(\2, ' || case v_roles when 'C' then C else E end || ')', 'g');
      if v_new = v_def then raise exception using message = format('matriz: la función % no usa es_dueno()', k); end if;
      execute v_new;
      v_cuenta := v_cuenta + 1;
    end loop;
    if v_cuenta = 0 then raise exception using message = format('matriz: no existe la función %', k); end if;
  end loop;

  -- 8c) Anular y devolver en el mostrador: el cajero necesita un supervisor.
  for k in select unnest(array['anular_venta_mostrador', 'devolver_venta_mostrador']) loop
    for r in select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = k loop
      v_new := replace(r.def, 'perform public.pos_exigir_pin(', 'perform public.pos_exigir_supervisor(v_v.kiosco_id, p_token); perform public.pos_exigir_pin(');
      if v_new = r.def then raise exception using message = format('matriz: % no llama a pos_exigir_pin', k); end if;
      execute v_new;
    end loop;
  end loop;
end
$matriz$;

-- 9) Los pedidos y los clientes no los borra un cajero (la política de pedidos es "para todo").
create policy pedidos_sin_borrar_cajero on public.pedidos as restrictive for delete to authenticated
  using (public.es_miembro(kiosco_id, array['encargado', 'dueno']));
create policy clientes_sin_borrar_cajero on public.clientes as restrictive for delete to authenticated
  using (public.es_miembro(kiosco_id, array['encargado', 'dueno']));
-- Fiado: el cajero anota deudas y cobros, pero no corrige ni borra lo ya anotado.
create policy fiado_sin_corregir_cajero on public.fiado_movimientos as restrictive for update to authenticated
  using (public.es_miembro(kiosco_id, array['encargado', 'dueno']));
create policy fiado_sin_borrar_cajero on public.fiado_movimientos as restrictive for delete to authenticated
  using (public.es_miembro(kiosco_id, array['encargado', 'dueno']));
