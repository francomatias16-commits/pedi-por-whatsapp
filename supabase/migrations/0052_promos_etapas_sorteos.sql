-- 0052 · Promociones fase C y retención: premios por etapas, sorteos, racha, cumpleaños y "Traé un amigo".
-- Aplicar DESPUÉS de 0051. Sin DROP.
--  * clientes: cumple_dia/cumple_mes, ref_codigo (código para invitar) y referido_por.
--  * fidelidad_calcular: suma los tipos nuevos (racha, cumpleaños, llevá dos). El referido se premia al registrarse (club_unirse con p_ref).
--  * Premios por etapas: promo_etapas_guardar (2 a 6 niveles crecientes; pausa los premios anteriores).
--  * Sorteos: chances = papelitos usados dentro del período. Se hacen una sola vez, con semilla y chances guardadas, y se pueden verificar.
--    No se realizan sin que el dueño confirme el permiso legal (queda quién y cuándo). No es asesoramiento legal.
--  * club_armar_tarjeta: niveles, próximo premio, sorteo vigente, cumpleaños, código de invitación.

-- 1) Datos del cliente
alter table public.clientes
  add column cumple_dia smallint check (cumple_dia is null or cumple_dia between 1 and 31),
  add column cumple_mes smallint check (cumple_mes is null or cumple_mes between 1 and 12),
  add column ref_codigo text check (ref_codigo is null or ref_codigo ~ '^[2-9A-HJKMNP-Z]{6}$'),
  add column referido_por uuid references public.clientes(id) on delete set null,
  add check ((cumple_dia is null) = (cumple_mes is null));
create unique index clientes_ref_codigo_uq on public.clientes (kiosco_id, ref_codigo) where ref_codigo is not null;

create or replace function public.club_nuevo_ref(p_kiosco uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_abc text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; v_cod text; i int; j int;
begin
  for i in 1..30 loop
    v_cod := '';
    for j in 1..6 loop v_cod := v_cod || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1); end loop;
    if not exists (select 1 from public.clientes where kiosco_id = p_kiosco and ref_codigo = v_cod) then return v_cod; end if;
  end loop;
  raise exception 'club_codigos_no_generados';
end $$;

do $b$
declare r record;
begin
  for r in select id, kiosco_id from public.clientes where club_token is not null and ref_codigo is null loop
    update public.clientes set ref_codigo = public.club_nuevo_ref(r.kiosco_id) where id = r.id;
  end loop;
end $b$;

-- 2) Cálculo de sellos con los tipos nuevos (es la función de 0039 con tres ramas más)
create or replace function public.fidelidad_calcular(p_kiosco uuid, p_cliente uuid, p_canal text, p_monto numeric, p_medios text[], p_items jsonb, p_cuando timestamptz)
returns table (campana_id uuid, cantidad int, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_local timestamp := p_cuando at time zone 'America/Argentina/Buenos_Aires';
  v_fecha date := v_local::date; v_dow int := extract(dow from v_local)::int; v_hora time := v_local::time;
  v_primera boolean; v_ultima timestamptz; v_base int := 0; v_n int; v_hoy int; v_res jsonb := '[]'::jsonb;
  c public.fidelidad_campanas; v_mult numeric := 1; v_mult_c public.fidelidad_campanas; v_extra int;
  v_cmes int; v_sem date := date_trunc('week', v_local)::date; v_semanas date[]; v_racha int; w date;
begin
  select max(s.created_at) into v_ultima from public.sellos s
    where p_cliente is not null and s.cliente_id = p_cliente and not s.anulado and s.origen in ('pedido', 'venta', 'club');
  v_primera := v_ultima is null;
  if p_cliente is not null then select cumple_mes into v_cmes from public.clientes where id = p_cliente; end if;
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
      -- Llevá dos: dos o más unidades del producto en la misma compra.
      when 'dos_producto' then case when coalesce((select sum((i->>'unidades')::int) from jsonb_array_elements(coalesce(p_items, '[]')) i where (i->>'producto_id')::uuid = c.producto_id), 0) >= 2 then c.sellos else 0 end
      -- Cumpleaños: en el mes del cumpleaños, una vez por año.
      when 'cumpleanos' then case when v_cmes = extract(month from v_local)::int
        and not exists (select 1 from public.sellos s where s.cliente_id = p_cliente and s.campana_id = c.id and not s.anulado
                          and extract(year from s.created_at at time zone 'America/Argentina/Buenos_Aires') = extract(year from v_local)) then c.sellos else 0 end
      else 0 end;
    -- Racha: compras en semanas seguidas (esta semana cuenta). Cada N semanas seguidas suma, una vez por semana.
    if c.tipo = 'racha' and p_cliente is not null then
      select array_agg(distinct date_trunc('week', s.created_at at time zone 'America/Argentina/Buenos_Aires')::date) into v_semanas
        from public.sellos s where s.cliente_id = p_cliente and not s.anulado and s.cantidad > 0 and s.origen in ('pedido', 'venta', 'club')
         and s.created_at > p_cuando - interval '53 weeks';
      v_racha := 1;
      for i in 1..52 loop
        w := v_sem - 7 * i;
        exit when v_semanas is null or not (w = any (v_semanas));
        v_racha := v_racha + 1;
      end loop;
      if v_racha % c.semanas = 0
         and not exists (select 1 from public.sellos s where s.cliente_id = p_cliente and s.campana_id = c.id and not s.anulado
                           and date_trunc('week', s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_sem) then
        v_n := c.sellos;
      end if;
    end if;
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

-- 3) Registro con código de un amigo. Sin p_ref sigue la función de siempre (QR viejos).
--    El referido solo se premia si el que se registra es nuevo (sin sellos), no es el mismo que invita, y quien invita
--    no pasó de 10 invitados en 30 días. Los dos suman los sellos de la campaña "Traé un amigo" si está activa.
create or replace function public.club_unirse(p_slug text, p_nombre text, p_telefono text, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.kioscos%rowtype; c public.clientes%rowtype; v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_nom text := left(trim(coalesce(p_nombre, '')), 60); v_token text := replace(gen_random_uuid()::text, '-', ''); v_evento uuid := gen_random_uuid(); v_n int;
  v_ref public.clientes%rowtype; v_camp public.fidelidad_campanas%rowtype; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; v_sin_sellos boolean := true;
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
    v_sin_sellos := not exists (select 1 from public.sellos where cliente_id = c.id);
    update public.clientes set club_token = v_token, club_alta_at = now(), ref_codigo = coalesce(ref_codigo, public.club_nuevo_ref(k.id)) where id = c.id;
  else
    insert into public.clientes (kiosco_id, nombre, telefono, club_token, club_alta_at, ref_codigo) values (k.id, v_nom, v_tel, v_token, now(), public.club_nuevo_ref(k.id)) returning * into c;
  end if;
  v_n := public.club_otorgar(k.id, c.id, v_evento);

  if p_ref is not null and v_sin_sellos then
    select * into v_ref from public.clientes where kiosco_id = k.id and ref_codigo = upper(regexp_replace(p_ref, '[^A-Za-z0-9]', '', 'g')) and club_token is not null and id <> c.id;
    select * into v_camp from public.fidelidad_campanas where kiosco_id = k.id and activa and tipo = 'referido'
      and (desde is null or desde <= v_hoy) and (hasta is null or hasta >= v_hoy) order by created_at limit 1;
    if v_ref.id is not null and v_camp.id is not null
       and (select count(*) from public.clientes z where z.referido_por = v_ref.id and z.club_alta_at > now() - interval '30 days') < 10 then
      update public.clientes set referido_por = v_ref.id where id = c.id;
      insert into public.sellos (kiosco_id, cliente_id, origen, campana_id, cantidad, motivo, club_evento) values (k.id, c.id, 'club', v_camp.id, v_camp.sellos, 'Te invitó un amigo', v_evento);
      insert into public.sellos (kiosco_id, cliente_id, origen, campana_id, cantidad, motivo, club_evento) values (k.id, v_ref.id, 'club', v_camp.id, v_camp.sellos, 'Invitaste a un amigo', gen_random_uuid());
      v_n := v_n + v_camp.sellos;
    end if;
  end if;
  return jsonb_build_object('estado', 'ok', 'token', v_token,
    '_aviso', jsonb_build_object('kiosco_id', k.id, 'cliente', c.nombre, 'cantidad', v_n, 'evento', v_evento, 'nuevo', true));
end $$;

create or replace function public.club_unirse(p_slug text, p_nombre text, p_telefono text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.club_unirse(p_slug, p_nombre, p_telefono, null::text);
end $$;

-- 4) El cliente carga su cumpleaños (día y mes). Se puede corregir; el regalo es uno por año.
create or replace function public.club_guardar_cumple(p_token text, p_dia int, p_mes int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then raise exception 'club_token_invalido'; end if;
  select * into c from public.clientes where club_token = p_token for update;
  if not found then raise exception 'club_token_invalido'; end if;
  if p_dia is null or p_mes is null or p_mes < 1 or p_mes > 12 or p_dia < 1 or p_dia > 31 then raise exception 'club_cumple_invalido'; end if;
  begin
    perform make_date(2024, p_mes, p_dia);
  exception when others then raise exception 'club_cumple_invalido';
  end;
  update public.clientes set cumple_dia = p_dia, cumple_mes = p_mes where id = c.id;
  return public.club_armar_tarjeta(c.id);
end $$;

-- 5) Sorteos
create table public.sorteos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 80),
  desde date not null,
  hasta date not null,
  estado text not null default 'borrador' check (estado in ('borrador', 'realizado', 'cancelado')),
  permiso_confirmado boolean not null default false,
  permiso_confirmado_at timestamptz,
  permiso_confirmado_por uuid default null,
  permiso_nota text check (permiso_nota is null or length(permiso_nota) <= 300),
  semilla text,
  chances_ids uuid[],
  realizado_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  check (desde <= hasta),
  check (estado <> 'realizado' or (permiso_confirmado and semilla is not null and chances_ids is not null and realizado_at is not null))
);
create index sorteos_kiosco on public.sorteos (kiosco_id, created_at desc);
alter table public.sorteos enable row level security;
revoke all on public.sorteos from anon, authenticated;

create table public.sorteo_premios (
  sorteo_id uuid not null references public.sorteos(id) on delete cascade,
  etapa int not null check (etapa between 1 and 10),
  premio text not null check (length(trim(premio)) between 1 and 80),
  primary key (sorteo_id, etapa)
);
alter table public.sorteo_premios enable row level security;
revoke all on public.sorteo_premios from anon, authenticated;

create table public.sorteo_ganadores (
  sorteo_id uuid not null references public.sorteos(id) on delete cascade,
  etapa int not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  codigo text not null,
  primary key (sorteo_id, etapa)
);
alter table public.sorteo_ganadores enable row level security;
revoke all on public.sorteo_ganadores from anon, authenticated;

-- Interna: las chances del período = papelitos usados por clientes, sin contar los de sellos anulados (rechazados).
create or replace function public.sorteo_chances(p_kiosco uuid, p_desde date, p_hasta date) returns table (chance_id uuid, cliente_id uuid, codigo text)
language sql stable security definer set search_path = public as $$
  select cc.id, cc.cliente_id, cc.codigo from public.club_codigos cc
   where cc.kiosco_id = p_kiosco and cc.usado_at is not null and cc.cliente_id is not null
     and (cc.usado_at at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
     and exists (select 1 from public.sellos s where s.club_evento = cc.club_evento and not s.anulado)
$$;

-- Interna y determinística: con las mismas chances y la misma semilla, siempre salen los mismos ganadores.
-- Cada premio se saca por el menor md5(semilla:etapa:chance) entre los clientes que todavía no ganaron.
create or replace function public.sorteo_elegir(p_ids uuid[], p_semilla text, p_n int) returns table (etapa int, cliente_id uuid, codigo text)
language plpgsql stable security definer set search_path = public as $$
declare i int; r record; v_g uuid[] := '{}';
begin
  for i in 1..p_n loop
    select cc.cliente_id as cid, cc.codigo as cod into r from public.club_codigos cc
     where cc.id = any (p_ids) and not (cc.cliente_id = any (v_g))
     order by md5(p_semilla || ':' || i || ':' || cc.id::text), cc.id limit 1;
    if not found then raise exception 'sorteo_pocos_participantes'; end if;
    v_g := v_g || r.cid;
    etapa := i; cliente_id := r.cid; codigo := r.cod; return next;
  end loop;
end $$;

create or replace function public.sorteo_chances_resumen(p_kiosco uuid, p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  return (select jsonb_build_object('chances', count(*), 'clientes', count(distinct x.cliente_id)) from public.sorteo_chances(p_kiosco, p_desde, p_hasta) x);
end $$;

create or replace function public.sorteo_crear(p_kiosco uuid, p_nombre text, p_premios jsonb, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int; i int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_nombre is null or length(trim(p_nombre)) < 1 or length(trim(p_nombre)) > 80 then raise exception 'sorteo_nombre_invalido'; end if;
  if p_premios is null or jsonb_typeof(p_premios) <> 'array' then raise exception 'sorteo_premios_invalidos'; end if;
  v_n := jsonb_array_length(p_premios);
  if v_n < 1 or v_n > 10 then raise exception 'sorteo_premios_invalidos'; end if;
  for i in 0..v_n - 1 loop
    if jsonb_typeof(p_premios->i) <> 'string' or length(trim(p_premios->>i)) < 1 or length(trim(p_premios->>i)) > 80 then raise exception 'sorteo_premios_invalidos'; end if;
  end loop;
  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta - p_desde > 366 then raise exception 'sorteo_fechas_invalidas'; end if;
  insert into public.sorteos (kiosco_id, nombre, desde, hasta) values (p_kiosco, trim(p_nombre), p_desde, p_hasta) returning id into v_id;
  for i in 0..v_n - 1 loop insert into public.sorteo_premios (sorteo_id, etapa, premio) values (v_id, i + 1, trim(p_premios->>i)); end loop;
  perform public.promo_historial_registrar(p_kiosco, 'sorteo_creado', 'sorteos', 'sorteo_mensual', trim(p_nombre), jsonb_build_object('premios', v_n, 'desde', p_desde, 'hasta', p_hasta));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.sorteo_listar(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'nombre', s.nombre, 'desde', s.desde, 'hasta', s.hasta, 'estado', s.estado,
      'etapas', (select count(*) from public.sorteo_premios sp where sp.sorteo_id = s.id),
      'permiso_confirmado', s.permiso_confirmado, 'permiso_confirmado_at', s.permiso_confirmado_at, 'semilla', s.semilla, 'realizado_at', s.realizado_at,
      'ganadores', coalesce((select jsonb_agg(jsonb_build_object('etapa', g.etapa, 'premio', sp.premio, 'cliente', c.nombre, 'cliente_id', g.cliente_id, 'codigo', g.codigo) order by g.etapa)
                              from public.sorteo_ganadores g join public.sorteo_premios sp on sp.sorteo_id = g.sorteo_id and sp.etapa = g.etapa
                              left join public.clientes c on c.id = g.cliente_id where g.sorteo_id = s.id), '[]'::jsonb)
    ) order by s.created_at desc) from public.sorteos s where s.kiosco_id = p_kiosco), '[]'::jsonb);
end $$;

create or replace function public.sorteo_confirmar_permiso(p_kiosco uuid, p_sorteo uuid, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sorteos%rowtype;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into s from public.sorteos where id = p_sorteo and kiosco_id = p_kiosco for update;
  if not found or s.estado <> 'borrador' then raise exception 'sorteo_no_disponible'; end if;
  update public.sorteos set permiso_confirmado = true, permiso_confirmado_at = now(), permiso_confirmado_por = auth.uid(), permiso_nota = nullif(left(trim(coalesce(p_nota, '')), 300), '') where id = s.id;
  perform public.promo_historial_registrar(p_kiosco, 'permiso_confirmado', 'sorteos', 'sorteo_mensual', s.nombre, jsonb_build_object('nota', nullif(left(trim(coalesce(p_nota, '')), 300), '')));
  return jsonb_build_object('ok', true);
end $$;

-- Realiza el sorteo una sola vez: guarda la semilla y las chances usadas junto al resultado.
create or replace function public.sorteo_realizar(p_kiosco uuid, p_sorteo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sorteos%rowtype; v_ids uuid[]; v_semilla text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); v_n int; r record;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into s from public.sorteos where id = p_sorteo and kiosco_id = p_kiosco for update;
  if not found or s.estado <> 'borrador' then raise exception 'sorteo_no_disponible'; end if;
  if not s.permiso_confirmado then raise exception 'sorteo_sin_permiso'; end if;
  if s.hasta >= v_hoy then raise exception 'sorteo_periodo_abierto'; end if;
  select array_agg(x.chance_id order by x.chance_id) into v_ids from public.sorteo_chances(p_kiosco, s.desde, s.hasta) x;
  select count(*) into v_n from public.sorteo_premios where sorteo_id = s.id;
  if v_ids is null then raise exception 'sorteo_pocos_participantes'; end if;
  for r in select * from public.sorteo_elegir(v_ids, v_semilla, v_n) loop
    insert into public.sorteo_ganadores (sorteo_id, etapa, cliente_id, codigo) values (s.id, r.etapa, r.cliente_id, r.codigo);
  end loop;
  update public.sorteos set estado = 'realizado', semilla = v_semilla, chances_ids = v_ids, realizado_at = now() where id = s.id;
  perform public.promo_historial_registrar(p_kiosco, 'sorteo_realizado', 'sorteos', 'sorteo_mensual', s.nombre, jsonb_build_object('chances', cardinality(v_ids), 'premios', v_n));
  return jsonb_build_object('ok', true, 'semilla', v_semilla);
end $$;

create or replace function public.sorteo_cancelar(p_kiosco uuid, p_sorteo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sorteos%rowtype;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into s from public.sorteos where id = p_sorteo and kiosco_id = p_kiosco for update;
  if not found or s.estado <> 'borrador' then raise exception 'sorteo_no_disponible'; end if;
  update public.sorteos set estado = 'cancelado' where id = s.id;
  perform public.promo_historial_registrar(p_kiosco, 'sorteo_cancelado', 'sorteos', 'sorteo_mensual', s.nombre);
  return jsonb_build_object('ok', true);
end $$;

-- Repite el sorteo con la semilla y las chances guardadas y compara con los ganadores publicados.
create or replace function public.sorteo_verificar(p_kiosco uuid, p_sorteo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sorteos%rowtype; v_n int; v_igual boolean;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into s from public.sorteos where id = p_sorteo and kiosco_id = p_kiosco;
  if not found or s.estado <> 'realizado' then raise exception 'sorteo_no_disponible'; end if;
  select count(*) into v_n from public.sorteo_premios where sorteo_id = s.id;
  select coalesce(bool_and(g.codigo = e.codigo), false) and count(*) = v_n into v_igual
    from public.sorteo_elegir(s.chances_ids, s.semilla, v_n) e
    join public.sorteo_ganadores g on g.sorteo_id = s.id and g.etapa = e.etapa;
  return jsonb_build_object('coincide', v_igual, 'chances', cardinality(s.chances_ids));
end $$;

-- 6) Premios por etapas: 2 a 6 niveles con sellos crecientes. Los premios que había se pausan (y sus liquidaciones de regalo).
create or replace function public.promo_etapas_guardar(p_kiosco uuid, p_niveles jsonb, p_confirmar_margen boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.kioscos%rowtype; v_n int; i int; n jsonb; v_prev int := 0; v_sellos int; v_tipo text; v_prod uuid; v_val numeric; pd public.productos%rowtype; v_margen numeric; v_baja boolean := false;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_niveles is null or jsonb_typeof(p_niveles) <> 'array' then raise exception 'promo_etapas_invalidas'; end if;
  v_n := jsonb_array_length(p_niveles);
  if v_n < 2 or v_n > 6 then raise exception 'promo_etapas_cantidad'; end if;
  select * into k from public.kioscos where id = p_kiosco;

  -- Primero se valida todo; recién después se toca la base.
  for i in 0..v_n - 1 loop
    n := p_niveles->i;
    if jsonb_typeof(n) <> 'object' or length(trim(coalesce(n->>'nombre', ''))) not between 1 and 80 then raise exception 'promo_etapas_invalidas'; end if;
    begin v_sellos := (n->>'costo_sellos')::int; exception when others then raise exception 'promo_etapas_invalidas'; end;
    if v_sellos is null or v_sellos < 1 or v_sellos > 1000 or v_sellos <= v_prev then raise exception 'promo_etapas_invalidas'; end if;
    v_prev := v_sellos;
    v_tipo := n->>'tipo';
    if v_tipo is null or v_tipo not in ('libre', 'producto', 'pct', 'monto') then raise exception 'promo_etapas_invalidas'; end if;
    if v_tipo = 'producto' then
      begin v_prod := (n->>'producto_id')::uuid; exception when others then raise exception 'promo_etapas_invalidas'; end;
      select * into pd from public.productos where id = v_prod and kiosco_id = p_kiosco;
      if not found then raise exception 'producto_invalido'; end if;
      if pd.stock_controlado and pd.stock <= 0 then raise exception 'promo_falta_stock'; end if;
      if pd.costo is not null and pd.precio > 0 then
        v_margen := round((pd.precio - pd.costo) / pd.precio * 100, 1);
        if v_margen < k.club_margen_minimo then v_baja := true; end if;
      end if;
    elsif v_tipo in ('pct', 'monto') then
      begin v_val := (n->>'valor')::numeric; exception when others then raise exception 'promo_etapas_invalidas'; end;
      if v_val is null or v_val <= 0 or (v_tipo = 'pct' and v_val > 100) then raise exception 'promo_etapas_invalidas'; end if;
    end if;
  end loop;
  if v_baja then
    if not coalesce(p_confirmar_margen, false) then raise exception 'promo_reduce_margen'; end if;
    perform public.promo_historial_registrar(p_kiosco, 'margen_confirmado', 'fidelidad_premios', 'premio_por_etapas', 'Premios por etapas');
  end if;

  perform set_config('app.promo_silencio', 'on', true);
  update public.promo_liquidacion set activa = false, pausada_at = now() where kiosco_id = p_kiosco and activa and tipo = 'regalo';
  update public.fidelidad_premios set activo = false where kiosco_id = p_kiosco and activo;
  for i in 0..v_n - 1 loop
    n := p_niveles->i; v_tipo := n->>'tipo';
    insert into public.fidelidad_premios (kiosco_id, nombre, costo_sellos, tipo, producto_id, valor)
      values (p_kiosco, trim(n->>'nombre'), (n->>'costo_sellos')::int, v_tipo,
              case when v_tipo = 'producto' then (n->>'producto_id')::uuid end,
              case when v_tipo in ('pct', 'monto') then (n->>'valor')::numeric end);
  end loop;
  perform set_config('app.promo_silencio', '', true);
  perform public.promo_historial_registrar(p_kiosco, 'cambio', 'fidelidad_premios', 'premio_por_etapas', 'Premios por etapas', jsonb_build_object('niveles', v_n));
  return jsonb_build_object('ok', true, 'niveles', v_n);
end $$;

-- 7) Tarjeta del cliente: niveles, próximo premio, sorteo vigente, cumpleaños e invitación.
create or replace function public.club_armar_tarjeta(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes%rowtype; k public.kioscos%rowtype; v_premio text; v_meta int; v_saldo int; v_bloq jsonb; v_hist jsonb; v_por int;
  v_niveles jsonb; v_prox jsonb; v_sorteo jsonb; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select * into c from public.clientes where id = p_cliente;
  select * into k from public.kioscos where id = c.kiosco_id;
  select p.nombre, p.costo_sellos into v_premio, v_meta from public.fidelidad_premios p
    where p.kiosco_id = c.kiosco_id and p.activo order by p.costo_sellos, p.created_at limit 1;
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = c.id;
  v_saldo := coalesce(v_saldo, 0);
  v_bloq := public.club_bloqueo(c.kiosco_id, c.id);
  select coalesce(sum(r.cantidad), 0)::int into v_por from public.fidelidad_calcular(c.kiosco_id, c.id, 'mostrador', 0, null, '[]'::jsonb, now()) r;
  select coalesce(jsonb_agg(jsonb_build_object('fecha', h.created_at, 'cantidad', h.cantidad) order by h.created_at desc), '[]'::jsonb) into v_hist
    from (select s.created_at, s.cantidad from public.sellos s where s.cliente_id = c.id and not s.anulado and s.cantidad > 0
          order by s.created_at desc limit 12) h;
  select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'costo_sellos', p.costo_sellos, 'alcanzado', v_saldo >= p.costo_sellos) order by p.costo_sellos, p.created_at)
    into v_niveles from public.fidelidad_premios p where p.kiosco_id = c.kiosco_id and p.activo;
  select jsonb_build_object('nombre', p.nombre, 'costo_sellos', p.costo_sellos, 'faltan', p.costo_sellos - v_saldo) into v_prox
    from public.fidelidad_premios p where p.kiosco_id = c.kiosco_id and p.activo and p.costo_sellos > v_saldo order by p.costo_sellos, p.created_at limit 1;
  select jsonb_build_object('nombre', s.nombre, 'hasta', s.hasta, 'mis_chances', (select count(*) from public.sorteo_chances(c.kiosco_id, s.desde, s.hasta) x where x.cliente_id = c.id)) into v_sorteo
    from public.sorteos s where s.kiosco_id = c.kiosco_id and s.estado = 'borrador' and s.permiso_confirmado and s.desde <= v_hoy and s.hasta >= v_hoy
    order by s.hasta limit 1;
  return jsonb_build_object('local', k.nombre, 'slug', k.slug, 'whatsapp', k.whatsapp, 'cliente', c.nombre,
    'sellos', v_saldo, 'premio', v_premio, 'meta', v_meta,
    'listo', v_meta is not null and v_saldo >= v_meta,
    'puede_sumar', v_bloq is null, 'bloqueo', v_bloq, 'historial', v_hist, 'por_compra', v_por,
    'exige_codigo', k.club_exigir_codigo,
    'ref', c.ref_codigo, 'cumple_dia', c.cumple_dia, 'cumple_mes', c.cumple_mes,
    'hay_cumple', exists (select 1 from public.fidelidad_campanas f where f.kiosco_id = c.kiosco_id and f.activa and f.tipo = 'cumpleanos'),
    'hay_referido', exists (select 1 from public.fidelidad_campanas f where f.kiosco_id = c.kiosco_id and f.activa and f.tipo = 'referido'),
    'niveles', coalesce(v_niveles, '[]'::jsonb), 'proximo', v_prox, 'sorteo', v_sorteo);
end $$;

-- Permisos
revoke all on function public.club_nuevo_ref(uuid) from public, anon, authenticated;
revoke all on function public.sorteo_chances(uuid, date, date) from public, anon, authenticated;
revoke all on function public.sorteo_elegir(uuid[], text, int) from public, anon, authenticated;
revoke all on function public.club_unirse(text, text, text, text) from public;
grant execute on function public.club_unirse(text, text, text, text) to anon, authenticated;
revoke all on function public.club_guardar_cumple(text, int, int) from public;
grant execute on function public.club_guardar_cumple(text, int, int) to anon, authenticated;
do $g$
declare f text;
begin
  foreach f in array array['sorteo_chances_resumen(uuid, date, date)', 'sorteo_crear(uuid, text, jsonb, date, date)', 'sorteo_listar(uuid)', 'sorteo_confirmar_permiso(uuid, uuid, text)',
                           'sorteo_realizar(uuid, uuid)', 'sorteo_cancelar(uuid, uuid)', 'sorteo_verificar(uuid, uuid)', 'promo_etapas_guardar(uuid, jsonb, boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
