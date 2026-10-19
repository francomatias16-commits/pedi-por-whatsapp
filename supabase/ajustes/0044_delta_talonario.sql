-- Ajuste 0044 (delta): lleva la 0044 de producción (versión original, aplicada como 0044_club_talonario)
-- a la versión final del repo. Solo agrega: tope de 50 errores por local por hora, función para prender/apagar
-- el papelito, y cierra el acceso directo de anon/authenticated a club_codigos y club_intentos.
-- No crea tablas ni columnas (ya existen). Idempotente: se puede correr dos veces.

revoke all on public.club_codigos from anon, authenticated;
revoke all on public.club_intentos from anon, authenticated;

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

revoke all on function public.club_sumar(text, text, text) from public;
grant execute on function public.club_sumar(text, text, text) to anon, authenticated;

-- Panel: prender o apagar el papelito para efectivo (solo el dueño).
create or replace function public.club_configurar_codigos(p_kiosco uuid, p_exige boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_miembro(p_kiosco, array['dueno']) then raise exception 'no_autorizado'; end if;
  update public.kioscos set club_exigir_codigo = coalesce(p_exige, false) where id = p_kiosco;
  return jsonb_build_object('exige', coalesce(p_exige, false));
end $$;

revoke all on function public.club_configurar_codigos(uuid, boolean) from public, anon;
grant execute on function public.club_configurar_codigos(uuid, boolean) to authenticated;
