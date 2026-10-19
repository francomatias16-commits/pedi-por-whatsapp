-- 0043 · Club: el cliente indica cómo pagó. Efectivo suma directo (1 por día); transferencia y Mercado Pago suman pero quedan
-- "por verificar" hasta que el kiosquero los confirma con el comprobante.
-- Aplicar DESPUÉS de 0042. Sin DROP: club_sumar(text) se conserva (delega en efectivo) y se agrega club_sumar(text, text).
--  * sellos.club_medio: 'efectivo' | 'transferencia' | 'mercadopago' (null en el sello de bienvenida y en los sellos viejos).
--  * sellos.club_verificado_por / club_verificado_at: quién confirmó el sello digital y cuándo. Pendiente = medio digital sin verificar.
--  * club_actividad devuelve medio y verificado (true / false / null si no aplica).
--  * club_verificar(evento): el dueño o el encargado confirman un sello digital. Rechazar sigue siendo club_rechazar.

alter table public.sellos
  add column club_medio text,
  add column club_verificado_por uuid references auth.users(id) on delete set null,
  add column club_verificado_at timestamptz;
alter table public.sellos add constraint sellos_club_medio_check check (club_medio is null or club_medio in ('efectivo', 'transferencia', 'mercadopago'));

-- Pública: el cliente suma su sello indicando cómo pagó. Mismos límites que siempre (tope por día, espera, horario).
create or replace function public.club_sumar(p_token text, p_medio text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype; v_bloq jsonb; v_evento uuid := gen_random_uuid(); v_n int; v_medio text := lower(trim(coalesce(p_medio, '')));
begin
  if v_medio not in ('efectivo', 'transferencia', 'mercadopago') then raise exception 'club_medio_invalido'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then raise exception 'club_token_invalido'; end if;
  select * into c from public.clientes where club_token = p_token for update;
  if not found then raise exception 'club_token_invalido'; end if;
  v_bloq := public.club_bloqueo(c.kiosco_id, c.id);
  if v_bloq is not null then raise exception using message = v_bloq->>'codigo'; end if;
  v_n := public.club_otorgar(c.kiosco_id, c.id, v_evento);
  if v_n = 0 then raise exception 'club_sin_sellos'; end if;
  update public.sellos set club_medio = v_medio where club_evento = v_evento;
  return public.club_armar_tarjeta(c.id)
    || jsonb_build_object('_aviso', jsonb_build_object('kiosco_id', c.kiosco_id, 'cliente', c.nombre, 'cantidad', v_n, 'evento', v_evento, 'nuevo', false, 'medio', v_medio));
end $$;

-- La versión sin medio sigue funcionando y cuenta como efectivo (clientes con la app abierta de antes del cambio).
create or replace function public.club_sumar(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.club_sumar(p_token, 'efectivo');
end $$;

-- Panel: actividad con medio y estado de verificación.
create or replace function public.club_actividad(p_kiosco uuid, p_horas int default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select coalesce(jsonb_agg(t.fila order by t.cuando desc), '[]'::jsonb) into v from (
    select min(s.created_at) as cuando,
           jsonb_build_object('evento', s.club_evento, 'cliente_id', s.cliente_id, 'nombre', c.nombre, 'telefono', c.telefono,
             'cantidad', sum(s.cantidad)::int, 'cuando', min(s.created_at), 'rechazado', bool_and(s.anulado),
             'nuevo', min(s.created_at) = c.club_alta_at,
             'medio', min(s.club_medio),
             'verificado', case when min(s.club_medio) in ('transferencia', 'mercadopago') then bool_and(s.club_verificado_at is not null) end) as fila
      from public.sellos s join public.clientes c on c.id = s.cliente_id
      where s.kiosco_id = p_kiosco and s.origen = 'club' and s.created_at > now() - make_interval(hours => least(greatest(coalesce(p_horas, 24), 1), 720))
      group by s.club_evento, s.cliente_id, c.nombre, c.telefono, c.club_alta_at
      order by min(s.created_at) desc limit 200) t;
  return v;
end $$;

-- Panel: confirmar un sello de transferencia o Mercado Pago después de ver el comprobante.
create or replace function public.club_verificar(p_evento uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_k uuid; v_n int;
begin
  select kiosco_id into v_k from public.sellos where club_evento = p_evento limit 1;
  if v_k is null or not public.es_miembro(v_k, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  update public.sellos set club_verificado_por = auth.uid(), club_verificado_at = coalesce(club_verificado_at, now())
   where club_evento = p_evento and club_medio in ('transferencia', 'mercadopago') and not anulado;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'verificados', v_n);
end $$;

-- Permisos: club_sumar(text, text) es pública como la anterior; club_verificar, solo del panel.
revoke all on function public.club_sumar(text, text) from public;
grant execute on function public.club_sumar(text, text) to anon, authenticated;
revoke all on function public.club_verificar(uuid) from public, anon;
grant execute on function public.club_verificar(uuid) to authenticated;
