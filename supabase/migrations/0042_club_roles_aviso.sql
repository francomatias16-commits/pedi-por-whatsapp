-- 0042 · Club: quién puede ver y rechazar, rastro de los rechazos y cuántos sellos suma cada compra.
-- Aplicar DESPUÉS de 0041. Sin DROP; las funciones se reemplazan y conservan sus permisos.
--  * club_actividad, club_rechazar y club_reenviar las usan también el encargado (antes solo el dueño: veía la pantalla y la base lo rechazaba).
--    El cajero sigue sin acceso, igual que a Puntos. El reporte por empleado (0041) sigue siendo solo del dueño.
--  * sellos.anulado_por / anulado_at: quién rechazó cada sello del club y cuándo.
--  * club_rechazar avisa (descubierto) si ya se canjeó un premio con los sellos que se rechazan.
--  * club_datos y club_armar_tarjeta devuelven por_compra: cuántos sellos suma hoy una compra, según las campañas activas (incluye sellos dobles).
--    club_datos además devuelve bienvenida (sellos extra por registrarse), separados para que el QR no prometa de más.

alter table public.sellos add column anulado_por uuid references auth.users(id) on delete set null, add column anulado_at timestamptz;

create or replace function public.club_datos(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k public.kioscos%rowtype; v_premio text; v_meta int; v_por int; v_bien int;
begin
  select * into k from public.kioscos where slug = p_slug;
  if not found or not k.club_activo then return null; end if;
  select p.nombre, p.costo_sellos into v_premio, v_meta from public.fidelidad_premios p
    where p.kiosco_id = k.id and p.activo order by p.costo_sellos, p.created_at limit 1;
  -- Lo que promete el QR: sellos por compra (sin la bienvenida, que se da una sola vez) y, aparte, el regalo de bienvenida.
  select coalesce(sum(r.cantidad) filter (where f.tipo is distinct from 'bienvenida'), 0)::int,
         coalesce(sum(r.cantidad) filter (where f.tipo = 'bienvenida'), 0)::int into v_por, v_bien
    from public.fidelidad_calcular(k.id, null, 'mostrador', 0, null, '[]'::jsonb, now()) r
    left join public.fidelidad_campanas f on f.id = r.campana_id;
  return jsonb_build_object('nombre', k.nombre, 'slug', k.slug, 'whatsapp', k.whatsapp, 'premio', v_premio, 'meta', v_meta, 'por_compra', v_por, 'bienvenida', v_bien);
end $$;

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
    'puede_sumar', v_bloq is null, 'bloqueo', v_bloq, 'historial', v_hist, 'por_compra', v_por);
end $$;

create or replace function public.club_actividad(p_kiosco uuid, p_horas int default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
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

create or replace function public.club_rechazar(p_evento uuid, p_rechazar boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_k uuid; v_c uuid; v_rech boolean := coalesce(p_rechazar, true); v_ganados int; v_canjeados int;
begin
  select kiosco_id, cliente_id into v_k, v_c from public.sellos where club_evento = p_evento limit 1;
  if v_k is null or not public.es_miembro(v_k, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  perform 1 from public.clientes where id = v_c for update; -- se ordena con un canje que esté pasando justo ahora
  update public.sellos set anulado = v_rech,
         anulado_por = case when v_rech then auth.uid() end,
         anulado_at = case when v_rech then now() end
   where club_evento = p_evento;
  select coalesce(sum(cantidad), 0) into v_ganados from public.sellos where cliente_id = v_c and not anulado;
  select coalesce(sum(sellos), 0) into v_canjeados from public.canjes where cliente_id = v_c and not anulado;
  -- descubierto > 0: ya se canjeó un premio con sellos que acaban de rechazarse (el saldo del cliente queda en 0, no en negativo)
  return jsonb_build_object('ok', true, 'descubierto', greatest(v_canjeados - v_ganados, 0));
end $$;

create or replace function public.club_reenviar(p_cliente uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c public.clientes%rowtype; v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into c from public.clientes where id = p_cliente for update;
  if not found or not public.es_miembro(c.kiosco_id, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  update public.clientes set club_token = v_token, club_alta_at = coalesce(club_alta_at, now()) where id = p_cliente;
  return v_token;
end $$;
