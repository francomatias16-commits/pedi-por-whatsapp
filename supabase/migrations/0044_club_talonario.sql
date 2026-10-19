-- 0044 · Club: talonario de papelitos con código (solo efectivo sin registrar).
-- Aplicar DESPUÉS de 0043. Sin DROP: club_sumar(text, text) se conserva y delega en la nueva club_sumar(text, text, text).
--  * kioscos.club_exigir_codigo: si está activo, "Pagué en efectivo" pide el código de un papelito. Transferencia y Mercado Pago no lo usan.
--  * club_codigos: cada papelito tiene un código único por local y se usa una sola vez. Solo se accede por las funciones de abajo (RLS sin políticas).
--  * club_intentos: códigos mal escritos por cliente; con 5 errores en una hora se frena un rato (evita adivinar códigos).
--  * Tope por local: 50 códigos mal escritos en una hora frenan el código en todo el local (aunque cada cliente tenga sus 5). No cambia lo que no es efectivo.
--  * Un código mal escrito NO hace error de SQL: devuelve {_error: ...}, porque un error desharía el registro del intento.
--  * Si el local no exige código pero el cliente manda uno válido, se acepta y se gasta igual (queda para sorteos).

alter table public.kioscos add column club_exigir_codigo boolean not null default false;

create table public.club_codigos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  codigo text not null check (codigo ~ '^[2-9A-HJKMNP-Z]{6}$'),
  lote int not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  usado_at timestamptz,
  cliente_id uuid references public.clientes(id) on delete set null,
  club_evento uuid,
  unique (kiosco_id, codigo)
);
create index club_codigos_lote_idx on public.club_codigos (kiosco_id, lote);
alter table public.club_codigos enable row level security;
revoke all on public.club_codigos from anon, authenticated;

create table public.club_intentos (
  id bigserial primary key,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index club_intentos_idx on public.club_intentos (cliente_id, created_at desc);
alter table public.club_intentos enable row level security;
revoke all on public.club_intentos from anon, authenticated;

-- Panel: genera un lote de papelitos (hasta 200 por vez) y devuelve los códigos para imprimir.
create or replace function public.club_generar_codigos(p_kiosco uuid, p_cantidad int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_alf constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; v_lote int; v_n int := 0; v_try int := 0; v_cod text; v_out text[] := '{}'; v_bytes bytea; i int;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 200 then raise exception 'club_cantidad_invalida'; end if;
  select coalesce(max(lote), 0) + 1 into v_lote from public.club_codigos where kiosco_id = p_kiosco;
  while v_n < p_cantidad and v_try < p_cantidad * 20 loop
    v_try := v_try + 1;
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_cod := '';
    for i in 0..5 loop v_cod := v_cod || substr(v_alf, (get_byte(v_bytes, i) % length(v_alf)) + 1, 1); end loop;
    insert into public.club_codigos (kiosco_id, codigo, lote) values (p_kiosco, v_cod, v_lote) on conflict (kiosco_id, codigo) do nothing;
    if found then v_n := v_n + 1; v_out := v_out || v_cod; end if;
  end loop;
  if v_n < p_cantidad then raise exception 'club_codigos_no_generados'; end if;
  return jsonb_build_object('lote', v_lote, 'codigos', to_jsonb(v_out));
end $$;

-- Panel: cuántos papelitos hay y cuántos se usaron.
create or replace function public.club_codigos_resumen(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  return (select jsonb_build_object('generados', count(*), 'usados', count(*) filter (where usado_at is not null),
                                    'sin_usar', count(*) filter (where usado_at is null))
            from public.club_codigos where kiosco_id = p_kiosco);
end $$;

-- Panel: los códigos que todavía no se usaron (para volver a imprimir).
create or replace function public.club_codigos_sin_usar(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  return coalesce((select jsonb_agg(t.codigo order by t.lote, t.created_at, t.codigo) from (
    select codigo, lote, created_at from public.club_codigos where kiosco_id = p_kiosco and usado_at is null order by lote, created_at limit 500) t), '[]'::jsonb);
end $$;

-- Panel: prender o apagar el papelito para efectivo (solo el dueño).
create or replace function public.club_configurar_codigos(p_kiosco uuid, p_exige boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['dueno']) then raise exception 'no_autorizado'; end if;
  update public.kioscos set club_exigir_codigo = coalesce(p_exige, false) where id = p_kiosco;
  return jsonb_build_object('exige', coalesce(p_exige, false));
end $$;

-- Tarjeta: se agrega exige_codigo (el resto igual que en 0042).
create or replace function public.club_armar_tarjeta(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes%rowtype; k public.kioscos%rowtype; v_premio text; v_meta int; v_saldo int; v_bloq jsonb; v_hist jsonb; v_por int;
begin
  select * into c from public.clientes where id = p_cliente;
  select * into k from public.kioscos where id = c.kiosco_id;
  select p.nombre, p.costo_sellos into v_premio, v_meta from public.fidelidad_premios p
    where p.kiosco_id = c.kiosco_id and p.activo order by p.costo_sellos, p.created_at limit 1;
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = c.id;
  v_bloq := public.club_bloqueo(c.kiosco_id, c.id);
  select coalesce(sum(r.cantidad), 0)::int into v_por from public.fidelidad_calcular(c.kiosco_id, c.id, 'mostrador', 0, null, '[]'::jsonb, now()) r;
  select coalesce(jsonb_agg(jsonb_build_object('fecha', h.created_at, 'cantidad', h.cantidad) order by h.created_at desc), '[]'::jsonb) into v_hist
    from (select s.created_at, s.cantidad from public.sellos s where s.cliente_id = c.id and not s.anulado and s.cantidad > 0
          order by s.created_at desc limit 12) h;
  return jsonb_build_object('local', k.nombre, 'slug', k.slug, 'whatsapp', k.whatsapp, 'cliente', c.nombre,
    'sellos', coalesce(v_saldo, 0), 'premio', v_premio, 'meta', v_meta,
    'listo', v_meta is not null and coalesce(v_saldo, 0) >= v_meta,
    'puede_sumar', v_bloq is null, 'bloqueo', v_bloq, 'historial', v_hist, 'por_compra', v_por,
    'exige_codigo', k.club_exigir_codigo);
end $$;

-- Pública: el cliente suma su sello indicando cómo pagó y, si corresponde, el código del papelito.
create or replace function public.club_sumar(p_token text, p_medio text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype; k public.kioscos%rowtype; v_bloq jsonb; v_evento uuid := gen_random_uuid(); v_n int;
  v_medio text := lower(trim(coalesce(p_medio, ''))); v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g')); v_id uuid; v_usado timestamptz; v_fallos int; v_fallos_local int;
begin
  if v_medio not in ('efectivo', 'transferencia', 'mercadopago') then raise exception 'club_medio_invalido'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then raise exception 'club_token_invalido'; end if;
  select * into c from public.clientes where club_token = p_token for update;
  if not found then raise exception 'club_token_invalido'; end if;
  select * into k from public.kioscos where id = c.kiosco_id;
  v_bloq := public.club_bloqueo(c.kiosco_id, c.id);
  if v_bloq is not null then raise exception using message = v_bloq->>'codigo'; end if;

  -- El código solo cuenta para efectivo. Si el local lo exige y no vino, se pide.
  if v_medio = 'efectivo' and (k.club_exigir_codigo or v_cod <> '') then
    if v_cod = '' then return jsonb_build_object('_error', 'club_codigo_requerido'); end if;
    select count(*) into v_fallos from public.club_intentos where cliente_id = c.id and created_at > now() - interval '1 hour';
    if v_fallos >= 5 then return jsonb_build_object('_error', 'club_codigo_bloqueado'); end if;
    select count(*) into v_fallos_local from public.club_intentos i join public.clientes x on x.id = i.cliente_id
      where x.kiosco_id = c.kiosco_id and i.created_at > now() - interval '1 hour';
    if v_fallos_local >= 50 then return jsonb_build_object('_error', 'club_codigo_bloqueado'); end if;
    select id, usado_at into v_id, v_usado from public.club_codigos where kiosco_id = c.kiosco_id and codigo = v_cod for update;
    if v_id is null then
      delete from public.club_intentos where created_at < now() - interval '1 day';
      insert into public.club_intentos (cliente_id) values (c.id);
      return jsonb_build_object('_error', 'club_codigo_invalido');
    end if;
    if v_usado is not null then return jsonb_build_object('_error', 'club_codigo_usado'); end if;
  end if;

  v_n := public.club_otorgar(c.kiosco_id, c.id, v_evento);
  if v_n = 0 then raise exception 'club_sin_sellos'; end if;
  update public.sellos set club_medio = v_medio where club_evento = v_evento;
  if v_id is not null then
    update public.club_codigos set usado_at = now(), cliente_id = c.id, club_evento = v_evento where id = v_id;
    delete from public.club_intentos where cliente_id = c.id;
  end if;
  return public.club_armar_tarjeta(c.id)
    || jsonb_build_object('_aviso', jsonb_build_object('kiosco_id', c.kiosco_id, 'cliente', c.nombre, 'cantidad', v_n, 'evento', v_evento, 'nuevo', false, 'medio', v_medio, 'con_codigo', v_id is not null));
end $$;

-- La versión de 2 parámetros (tarjetas abiertas antes del cambio) sigue andando; si el local exige código, la tarjeta vieja recibe "código requerido".
create or replace function public.club_sumar(p_token text, p_medio text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.club_sumar(p_token, p_medio, null);
end $$;

revoke all on function public.club_sumar(text, text, text) from public;
grant execute on function public.club_sumar(text, text, text) to anon, authenticated;
revoke all on function public.club_generar_codigos(uuid, int) from public, anon;
grant execute on function public.club_generar_codigos(uuid, int) to authenticated;
revoke all on function public.club_codigos_resumen(uuid) from public, anon;
grant execute on function public.club_codigos_resumen(uuid) to authenticated;
revoke all on function public.club_codigos_sin_usar(uuid) from public, anon;
grant execute on function public.club_codigos_sin_usar(uuid) to authenticated;
revoke all on function public.club_configurar_codigos(uuid, boolean) from public, anon;
grant execute on function public.club_configurar_codigos(uuid, boolean) to authenticated;
