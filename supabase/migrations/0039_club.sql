-- 0039 · Club de clientes: el cliente se registra una vez con el QR del local y después suma su propio sello con un toque.
-- Al kiosquero le llega un aviso por cada sello y puede rechazar el que no corresponda. Nada se aprueba antes: el sello cuenta
-- de inmediato y se anula si hace falta. Los límites (por día, espera entre sellos, horario) son opcionales y viven en el local.
--  * clientes.club_token: llave secreta de la tarjeta del cliente (32 hex). Solo se crea cuando el cliente se registra por el club.
--  * sellos.origen 'club' y sellos.club_evento: agrupa los sellos de un mismo toque (una campaña puede dar más de un renglón).
--  * Las campañas activas (por compra, sellos dobles, horarios, topes) se aplican igual que en el mostrador.
--  * Todo el acceso público es por funciones (security definer); anon no lee ni escribe tablas.
-- Aplicar DESPUÉS de 0001..0038.

-- 1) Tarjeta del cliente
alter table public.clientes
  add column club_token text,
  add column club_alta_at timestamptz;
alter table public.clientes add constraint clientes_club_token_formato check (club_token is null or club_token ~ '^[0-9a-f]{32}$');
create unique index clientes_club_token_uq on public.clientes (club_token) where club_token is not null;

-- 2) Límites del club por local (todos opcionales; por defecto, un sello por día)
alter table public.kioscos
  add column club_activo boolean not null default true,
  add column club_max_por_dia int default 1 check (club_max_por_dia is null or club_max_por_dia between 1 and 50),
  add column club_espera_min int check (club_espera_min is null or club_espera_min between 1 and 1440),
  add column club_hora_desde time,
  add column club_hora_hasta time,
  add constraint kioscos_club_horas_juntas check ((club_hora_desde is null) = (club_hora_hasta is null));

-- 3) Sellos del club
do $club$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'public.sellos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%origen = ANY%'
  loop
    execute format('alter table public.sellos drop constraint %I', r.conname); -- drop-ok
  end loop;
end $club$;
alter table public.sellos add constraint sellos_origen_check check (origen in ('pedido', 'mostrador', 'venta', 'manual', 'club'));
alter table public.sellos add column club_evento uuid;
create index sellos_club_evento_idx on public.sellos (club_evento) where club_evento is not null;
create index sellos_club_cliente_idx on public.sellos (cliente_id, created_at desc) where origen = 'club';

-- 4) El primer sello (bienvenida) y la reactivación se miran también sobre los sellos del club,
--    para que no se repitan en cada toque. Es la misma función de la 0017 con 'club' sumado al origen.
create or replace function public.fidelidad_calcular(p_kiosco uuid, p_cliente uuid, p_canal text, p_monto numeric, p_medios text[], p_items jsonb, p_cuando timestamptz)
returns table (campana_id uuid, cantidad int, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_local timestamp := p_cuando at time zone 'America/Argentina/Buenos_Aires';
  v_fecha date := v_local::date; v_dow int := extract(dow from v_local)::int; v_hora time := v_local::time;
  v_primera boolean; v_ultima timestamptz; v_base int := 0; v_n int; v_hoy int; v_res jsonb := '[]'::jsonb;
  c public.fidelidad_campanas; v_mult numeric := 1; v_mult_c public.fidelidad_campanas; v_extra int;
begin
  select max(s.created_at) into v_ultima from public.sellos s
    where p_cliente is not null and s.cliente_id = p_cliente and not s.anulado and s.origen in ('pedido', 'venta', 'club');
  v_primera := v_ultima is null;
  for c in select * from public.fidelidad_campanas f where f.kiosco_id = p_kiosco and f.activa and f.tipo not in ('manual', 'multiplicador') order by f.created_at, f.id loop
    if not public.fidelidad_aplica(c, p_canal, p_monto, p_medios, v_fecha, v_dow, v_hora) then continue; end if;
    v_n := case c.tipo
      when 'visita' then c.sellos
      when 'monto' then floor(p_monto / c.por_monto)::int * c.sellos
      when 'producto' then c.sellos * coalesce((select sum((i->>'unidades')::int) from jsonb_array_elements(coalesce(p_items, '[]')) i where (i->>'producto_id')::uuid = c.producto_id), 0)
      when 'categoria' then c.sellos * coalesce((select sum((i->>'unidades')::int) from jsonb_array_elements(coalesce(p_items, '[]')) i
                                                  join public.productos p on p.id = (i->>'producto_id')::uuid where p.categoria = c.categoria), 0)
      when 'bienvenida' then case when v_primera then c.sellos else 0 end
      when 'reactivacion' then case when v_ultima is not null and v_ultima < p_cuando - make_interval(days => c.dias_inactivo) then c.sellos else 0 end
      else 0 end;
    if v_n > 0 and c.tope_diario is not null and p_cliente is not null then
      select coalesce(sum(s.cantidad), 0) into v_hoy from public.sellos s
        where s.cliente_id = p_cliente and s.campana_id = c.id and not s.anulado and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_fecha;
      v_n := least(v_n, greatest(c.tope_diario - v_hoy, 0));
    end if;
    if v_n > 0 then
      v_res := v_res || jsonb_build_object('campana_id', c.id, 'cantidad', v_n, 'motivo', c.nombre);
      if c.tipo in ('visita', 'monto', 'producto', 'categoria') then v_base := v_base + v_n; end if;
    end if;
  end loop;
  -- "Sellos dobles": gana la campaña con el multiplicador más alto que aplique; suma lo que falta hasta ese múltiplo de la base.
  if v_base > 0 then
    for c in select * from public.fidelidad_campanas f where f.kiosco_id = p_kiosco and f.activa and f.tipo = 'multiplicador' order by f.multiplicador desc, f.created_at, f.id loop
      if public.fidelidad_aplica(c, p_canal, p_monto, p_medios, v_fecha, v_dow, v_hora) then v_mult_c := c; v_mult := c.multiplicador; exit; end if;
    end loop;
    if v_mult > 1 then
      v_extra := round(v_base * (v_mult - 1))::int;
      if v_extra > 0 then v_res := v_res || jsonb_build_object('campana_id', v_mult_c.id, 'cantidad', v_extra, 'motivo', v_mult_c.nombre); end if;
    end if;
  end if;
  return query select (e->>'campana_id')::uuid, (e->>'cantidad')::int, e->>'motivo' from jsonb_array_elements(v_res) e;
end $$;

-- 5) Interna: ¿puede sumar ahora? null = sí; si no, {codigo, espera_seg?}
create or replace function public.club_bloqueo(p_kiosco uuid, p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k public.kioscos%rowtype; v_local timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_hora time; v_hoy int; v_ultimo timestamptz;
begin
  v_hora := v_local::time;
  select * into k from public.kioscos where id = p_kiosco;
  if not found or not k.club_activo then return jsonb_build_object('codigo', 'club_inactivo'); end if;
  if k.club_hora_desde is not null and not (case when k.club_hora_desde <= k.club_hora_hasta
        then v_hora >= k.club_hora_desde and v_hora < k.club_hora_hasta
        else v_hora >= k.club_hora_desde or v_hora < k.club_hora_hasta end) then
    return jsonb_build_object('codigo', 'club_fuera_horario');
  end if;
  if k.club_max_por_dia is not null then
    select count(distinct s.club_evento) into v_hoy from public.sellos s
      where s.cliente_id = p_cliente and s.origen = 'club' and not s.anulado
        and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_local::date;
    if v_hoy >= k.club_max_por_dia then return jsonb_build_object('codigo', 'club_limite_dia'); end if;
  end if;
  if k.club_espera_min is not null then
    select max(s.created_at) into v_ultimo from public.sellos s where s.cliente_id = p_cliente and s.origen = 'club' and not s.anulado;
    if v_ultimo is not null and v_ultimo + make_interval(mins => k.club_espera_min) > now() then
      return jsonb_build_object('codigo', 'club_espera', 'espera_seg', ceil(extract(epoch from (v_ultimo + make_interval(mins => k.club_espera_min) - now())))::int);
    end if;
  end if;
  return null;
end $$;

-- 6) Interna: otorga los sellos del toque según las campañas activas (canal mostrador). Devuelve el total.
create or replace function public.club_otorgar(p_kiosco uuid, p_cliente uuid, p_evento uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_total int := 0;
begin
  for r in select * from public.fidelidad_calcular(p_kiosco, p_cliente, 'mostrador', 0, null, '[]'::jsonb, now()) loop
    if r.cantidad > 0 then
      insert into public.sellos (kiosco_id, cliente_id, origen, campana_id, cantidad, motivo, club_evento)
        values (p_kiosco, p_cliente, 'club', r.campana_id, r.cantidad, r.motivo, p_evento);
      v_total := v_total + r.cantidad;
    end if;
  end loop;
  return v_total;
end $$;

-- 7) Interna: lo que ve el cliente en su tarjeta
create or replace function public.club_armar_tarjeta(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes%rowtype; k public.kioscos%rowtype; v_premio text; v_meta int; v_saldo int; v_bloq jsonb; v_hist jsonb;
begin
  select * into c from public.clientes where id = p_cliente;
  select * into k from public.kioscos where id = c.kiosco_id;
  select p.nombre, p.costo_sellos into v_premio, v_meta from public.fidelidad_premios p
    where p.kiosco_id = c.kiosco_id and p.activo order by p.costo_sellos, p.created_at limit 1;
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = c.id;
  v_bloq := public.club_bloqueo(c.kiosco_id, c.id);
  select coalesce(jsonb_agg(jsonb_build_object('fecha', h.created_at, 'cantidad', h.cantidad) order by h.created_at desc), '[]'::jsonb) into v_hist
    from (select s.created_at, s.cantidad from public.sellos s where s.cliente_id = c.id and not s.anulado and s.cantidad > 0
          order by s.created_at desc limit 12) h;
  return jsonb_build_object('local', k.nombre, 'slug', k.slug, 'whatsapp', k.whatsapp, 'cliente', c.nombre,
    'sellos', coalesce(v_saldo, 0), 'premio', v_premio, 'meta', v_meta,
    'listo', v_meta is not null and coalesce(v_saldo, 0) >= v_meta,
    'puede_sumar', v_bloq is null, 'bloqueo', v_bloq, 'historial', v_hist);
end $$;

-- 8) Pública: datos del local para la pantalla de registro (null si no existe o tiene el club apagado)
create or replace function public.club_datos(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k public.kioscos%rowtype; v_premio text; v_meta int;
begin
  select * into k from public.kioscos where slug = p_slug;
  if not found or not k.club_activo then return null; end if;
  select p.nombre, p.costo_sellos into v_premio, v_meta from public.fidelidad_premios p
    where p.kiosco_id = k.id and p.activo order by p.costo_sellos, p.created_at limit 1;
  return jsonb_build_object('nombre', k.nombre, 'slug', k.slug, 'whatsapp', k.whatsapp, 'premio', v_premio, 'meta', v_meta);
end $$;

-- 9) Pública: registro con el QR. Si el teléfono ya tiene tarjeta no se devuelve el token (no se puede "robar" una tarjeta
--    tipeando un número ajeno): el local la reenvía desde el panel.
create or replace function public.club_unirse(p_slug text, p_nombre text, p_telefono text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.kioscos%rowtype; c public.clientes%rowtype; v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_nom text := left(trim(coalesce(p_nombre, '')), 60); v_token text := replace(gen_random_uuid()::text, '-', ''); v_evento uuid := gen_random_uuid(); v_n int;
begin
  select * into k from public.kioscos where slug = p_slug;
  if not found or not k.club_activo then raise exception 'club_no_disponible'; end if;
  if length(v_nom) < 2 then raise exception 'club_nombre_invalido'; end if;
  if length(v_tel) < 8 or length(v_tel) > 15 then raise exception 'club_telefono_invalido'; end if;
  if (select count(*) from public.clientes x where x.kiosco_id = k.id and x.club_alta_at > now() - interval '10 minutes') >= 30 then
    raise exception 'club_demasiadas_altas';
  end if;
  select * into c from public.clientes where kiosco_id = k.id and telefono = v_tel for update;
  if found then
    if c.club_token is not null then return jsonb_build_object('estado', 'ya_registrado'); end if;
    update public.clientes set club_token = v_token, club_alta_at = now() where id = c.id;
  else
    insert into public.clientes (kiosco_id, nombre, telefono, club_token, club_alta_at) values (k.id, v_nom, v_tel, v_token, now()) returning * into c;
  end if;
  v_n := public.club_otorgar(k.id, c.id, v_evento);
  return jsonb_build_object('estado', 'ok', 'token', v_token,
    '_aviso', jsonb_build_object('kiosco_id', k.id, 'cliente', c.nombre, 'cantidad', v_n, 'evento', v_evento, 'nuevo', true));
end $$;

-- 10) Pública: la tarjeta (por token)
create or replace function public.club_tarjeta(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into c from public.clientes where club_token = p_token;
  if not found then return null; end if;
  return public.club_armar_tarjeta(c.id);
end $$;

-- 11) Pública: el cliente suma su sello. La fila del cliente se bloquea: dos toques seguidos no suman dos veces.
create or replace function public.club_sumar(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype; v_bloq jsonb; v_evento uuid := gen_random_uuid(); v_n int;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then raise exception 'club_token_invalido'; end if;
  select * into c from public.clientes where club_token = p_token for update;
  if not found then raise exception 'club_token_invalido'; end if;
  v_bloq := public.club_bloqueo(c.kiosco_id, c.id);
  if v_bloq is not null then raise exception using message = v_bloq->>'codigo'; end if;
  v_n := public.club_otorgar(c.kiosco_id, c.id, v_evento);
  if v_n = 0 then raise exception 'club_sin_sellos'; end if;
  return public.club_armar_tarjeta(c.id)
    || jsonb_build_object('_aviso', jsonb_build_object('kiosco_id', c.kiosco_id, 'cliente', c.nombre, 'cantidad', v_n, 'evento', v_evento, 'nuevo', false));
end $$;

-- 12) Panel: actividad del club (cada renglón es un toque del cliente)
create or replace function public.club_actividad(p_kiosco uuid, p_horas int default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select coalesce(jsonb_agg(t.fila order by t.cuando desc), '[]'::jsonb) into v from (
    select min(s.created_at) as cuando,
           jsonb_build_object('evento', s.club_evento, 'cliente_id', s.cliente_id, 'nombre', c.nombre, 'telefono', c.telefono,
             'cantidad', sum(s.cantidad)::int, 'cuando', min(s.created_at), 'rechazado', bool_and(s.anulado),
             'nuevo', min(s.created_at) = c.club_alta_at) as fila
      from public.sellos s join public.clientes c on c.id = s.cliente_id
      where s.kiosco_id = p_kiosco and s.origen = 'club' and s.created_at > now() - make_interval(hours => least(greatest(coalesce(p_horas, 24), 1), 720))
      group by s.club_evento, s.cliente_id, c.nombre, c.telefono, c.club_alta_at
      order by min(s.created_at) desc limit 200) t;
  return v;
end $$;

-- 13) Panel: rechazar (o deshacer el rechazo de) un toque
create or replace function public.club_rechazar(p_evento uuid, p_rechazar boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_k uuid;
begin
  select kiosco_id into v_k from public.sellos where club_evento = p_evento limit 1;
  if v_k is null or not public.es_dueno(v_k) then raise exception 'no_autorizado'; end if;
  update public.sellos set anulado = coalesce(p_rechazar, true) where club_evento = p_evento;
  return jsonb_build_object('ok', true);
end $$;

-- 14) Panel: nueva llave para la tarjeta de un cliente (la anterior deja de servir). Devuelve el token para mandarle el link.
create or replace function public.club_reenviar(p_cliente uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype; v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into c from public.clientes where id = p_cliente for update;
  if not found or not public.es_dueno(c.kiosco_id) then raise exception 'no_autorizado'; end if;
  update public.clientes set club_token = v_token, club_alta_at = coalesce(club_alta_at, now()) where id = p_cliente;
  return v_token;
end $$;

-- 15) Permisos: las internas no las llama nadie desde afuera; las públicas, anon y authenticated; las de panel, solo authenticated.
revoke all on function public.club_bloqueo(uuid, uuid) from public, anon, authenticated;
revoke all on function public.club_otorgar(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.club_armar_tarjeta(uuid) from public, anon, authenticated;
revoke all on function public.club_datos(text) from public;
revoke all on function public.club_unirse(text, text, text) from public;
revoke all on function public.club_tarjeta(text) from public;
revoke all on function public.club_sumar(text) from public;
grant execute on function public.club_datos(text) to anon, authenticated;
grant execute on function public.club_unirse(text, text, text) to anon, authenticated;
grant execute on function public.club_tarjeta(text) to anon, authenticated;
grant execute on function public.club_sumar(text) to anon, authenticated;
revoke all on function public.club_actividad(uuid, int) from public, anon;
revoke all on function public.club_rechazar(uuid, boolean) from public, anon;
revoke all on function public.club_reenviar(uuid) from public, anon;
grant execute on function public.club_actividad(uuid, int) to authenticated;
grant execute on function public.club_rechazar(uuid, boolean) to authenticated;
grant execute on function public.club_reenviar(uuid) to authenticated;
