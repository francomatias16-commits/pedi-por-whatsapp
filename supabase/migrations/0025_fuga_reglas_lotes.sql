-- 0025 (Fase 3, operación): clientes en fuga, avisos "avisame cuando" y lotes con vencimiento (FEFO virtual).
-- Aplicar DESPUÉS de 0024. Sin DROP. Ninguna función toca precios.

-- ===== 1) Clientes en fuga =====
-- Clientes identificados con al menos p_min_compras ventas (no anuladas) en el último año
-- y sin comprar hace más de p_dias_sin_comprar días. La app arma el mensaje; lo envía el dueño por WhatsApp.
create or replace function public.clientes_en_fuga(p_kiosco uuid, p_dias_sin_comprar int default 45, p_min_compras int default 3)
returns table (cliente_id uuid, nombre text, telefono text, compras int, ultima_compra timestamptz, dias_sin_comprar int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_dias_sin_comprar is null or p_dias_sin_comprar < 7 or p_dias_sin_comprar > 365 then raise exception 'dias_invalidos'; end if;
  if p_min_compras is null or p_min_compras < 1 or p_min_compras > 100 then raise exception 'minimo_compras_invalido'; end if;
  return query
    select c.id, c.nombre, c.telefono, v.compras, v.ultima,
           (extract(day from now() - v.ultima))::int
      from (select vm.cliente_id as cid, count(*)::int as compras, max(vm.created_at) as ultima
              from public.ventas_mostrador vm
             where vm.kiosco_id = p_kiosco and vm.cliente_id is not null and not vm.anulada
               and vm.created_at >= now() - interval '1 year'
             group by vm.cliente_id) v
      join public.clientes c on c.id = v.cid and c.kiosco_id = p_kiosco
     where v.compras >= p_min_compras
       and v.ultima < now() - make_interval(days => p_dias_sin_comprar)
     order by v.ultima asc;
end $$;
revoke all on function public.clientes_en_fuga(uuid, int, int) from public, anon;
grant execute on function public.clientes_en_fuga(uuid, int, int) to authenticated;

-- ===== 2) Avisos "avisame cuando" =====
-- Tipos fijos. Lo que no se reconoce no dispara (fail-closed).
--   venta_supera     : la venta de ayer (ventas no anuladas) superó el umbral. Una vez por día.
--   fiado_supera     : el total adeudado en fiado superó el umbral. Una vez por semana.
--   stock_bajo_de   : hay productos con stock controlado por debajo del umbral (unidades). Una vez por semana.
create table public.avisos_reglas (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  tipo text not null check (tipo in ('venta_supera', 'fiado_supera', 'stock_bajo_de')),
  umbral numeric(12,2) not null check (umbral > 0 and umbral < 1000000000),
  activo boolean not null default true,
  ultimo_disparo date,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.avisos_reglas (kiosco_id);
alter table public.avisos_reglas enable row level security;
revoke all on public.avisos_reglas from anon;
grant select, insert, update on public.avisos_reglas to authenticated;
create policy avisos_reglas_dueno on public.avisos_reglas for all to authenticated
  using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));

-- Crea una regla (validación del tipo y del umbral en la base, no solo en la app).
create or replace function public.regla_crear(p_kiosco uuid, p_tipo text, p_umbral numeric)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_tipo is null or p_tipo not in ('venta_supera', 'fiado_supera', 'stock_bajo_de') then raise exception 'tipo_regla_invalido'; end if;
  if p_umbral is null or p_umbral <= 0 or p_umbral >= 1000000000 then raise exception 'umbral_invalido'; end if;
  insert into public.avisos_reglas (kiosco_id, tipo, umbral) values (p_kiosco, p_tipo, p_umbral) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.regla_crear(uuid, text, numeric) from public, anon;
grant execute on function public.regla_crear(uuid, text, numeric) to authenticated;

-- Evalúa todas las reglas activas de todos los kioscos. Lo llama el cron diario (una vez por día).
-- Devuelve una fila por regla disparada; la app agrupa por kiosco y manda UNA notificación.
-- Idempotente: marca ultimo_disparo y no vuelve a disparar en el mismo período.
create or replace function public.reglas_avisos_diarios()
returns table (kiosco uuid, mensaje text)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_ayer date := v_hoy - 1;
  v_ini_ayer timestamptz := (v_ayer::timestamp) at time zone 'America/Argentina/Buenos_Aires';
  v_ini_hoy timestamptz := (v_hoy::timestamp) at time zone 'America/Argentina/Buenos_Aires';
  v_monto numeric; v_n int; v_fiado numeric;
begin
  for r in select a.* from public.avisos_reglas a where a.activo order by a.created_at loop
    if r.tipo = 'venta_supera' then
      if r.ultimo_disparo is not null and r.ultimo_disparo >= v_hoy then continue; end if;
      select coalesce(sum(vm.total), 0) into v_monto from public.ventas_mostrador vm
       where vm.kiosco_id = r.kiosco_id and not vm.anulada and vm.created_at >= v_ini_ayer and vm.created_at < v_ini_hoy;
      if v_monto > r.umbral then
        update public.avisos_reglas set ultimo_disparo = v_hoy where id = r.id;
        kiosco := r.kiosco_id; mensaje := format('Ayer vendiste $%s, superaste tu aviso de $%s.', round(v_monto), round(r.umbral));
        return next;
      end if;
    elsif r.tipo = 'fiado_supera' then
      if r.ultimo_disparo is not null and r.ultimo_disparo > v_hoy - 7 then continue; end if;
      select coalesce(sum(case when f.tipo = 'fiado' then f.monto else -f.monto end), 0) into v_fiado
        from public.fiado_movimientos f where f.kiosco_id = r.kiosco_id;
      if v_fiado > r.umbral then
        update public.avisos_reglas set ultimo_disparo = v_hoy where id = r.id;
        kiosco := r.kiosco_id; mensaje := format('Te deben $%s en fiado, más que tu aviso de $%s.', round(v_fiado), round(r.umbral));
        return next;
      end if;
    elsif r.tipo = 'stock_bajo_de' then
      if r.ultimo_disparo is not null and r.ultimo_disparo > v_hoy - 7 then continue; end if;
      select count(*)::int into v_n from public.productos p
       where p.kiosco_id = r.kiosco_id and p.stock_controlado and p.stock < r.umbral;
      if v_n > 0 then
        update public.avisos_reglas set ultimo_disparo = v_hoy where id = r.id;
        kiosco := r.kiosco_id; mensaje := format('%s producto(s) con menos de %s unidades.', v_n, round(r.umbral));
        return next;
      end if;
    end if;
    -- Cualquier otro tipo: no dispara (fail-closed).
  end loop;
end $$;
revoke all on function public.reglas_avisos_diarios() from public, anon, authenticated;

-- ===== 3) Lotes con vencimiento (FEFO virtual) =====
-- El stock actual de un producto se reparte entre los lotes desde el que vence MÁS TARDE hacia atrás:
-- se asume que se vende primero lo que vence antes. Lo que no tiene lote queda como "sin fecha".
-- La baja por vencimiento es un ajuste de stock con motivo 'vencimiento'. Nunca cambia precios.
create table public.lotes_stock (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  cantidad int not null check (cantidad > 0 and cantidad <= 9999999),
  vence date not null,
  activo boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.lotes_stock (producto_id, vence);
alter table public.lotes_stock enable row level security;
revoke all on public.lotes_stock from anon;
grant select on public.lotes_stock to authenticated;
create policy lotes_stock_lectura_dueno on public.lotes_stock for select to authenticated using (public.es_dueno(kiosco_id));

-- Registra un lote (fecha de vencimiento de mercadería que ya está en stock).
create or replace function public.lote_registrar(p_producto uuid, p_cantidad int, p_vence date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_p public.productos%rowtype; v_id uuid;
begin
  select * into v_p from public.productos where id = p_producto;
  if not found or not public.es_dueno(v_p.kiosco_id) then raise exception 'no_autorizado'; end if;
  if not v_p.stock_controlado then raise exception 'stock_no_controlado'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'cantidad_invalida'; end if;
  if p_vence is null or p_vence < (now() at time zone 'America/Argentina/Buenos_Aires')::date - 365 then raise exception 'vencimiento_invalido'; end if;
  if p_cantidad > v_p.stock then raise exception 'lote_mayor_al_stock'; end if;
  insert into public.lotes_stock (kiosco_id, producto_id, cantidad, vence)
    values (v_p.kiosco_id, p_producto, p_cantidad, p_vence) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.lote_registrar(uuid, int, date) from public, anon;
grant execute on function public.lote_registrar(uuid, int, date) to authenticated;

-- Reparto FEFO del stock actual. Una fila por lote activo (en_stock = lo que queda físicamente)
-- y, si sobra, una fila con lote_id null (sin fecha).
create or replace function public.lotes_repartir(p_producto uuid)
returns table (lote_id uuid, vence date, cantidad int, en_stock int, estado text)
language plpgsql stable security definer set search_path = public as $$
declare v_p public.productos%rowtype; v_rest int; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
        l record; v_asig int; v_sumas int := 0;
begin
  select * into v_p from public.productos where id = p_producto;
  if not found or not public.es_dueno(v_p.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_rest := greatest(coalesce(v_p.stock, 0), 0);
  for l in select lo.* from public.lotes_stock lo where lo.producto_id = p_producto and lo.activo
           order by lo.vence desc, lo.created_at desc loop
    v_asig := least(l.cantidad, v_rest);
    v_rest := v_rest - v_asig;
    lote_id := l.id; vence := l.vence; cantidad := l.cantidad; en_stock := v_asig;
    estado := case when v_asig = 0 then 'consumido'
                   when l.vence < v_hoy then 'vencido'
                   when l.vence <= v_hoy + 7 then 'por_vencer'
                   else 'vigente' end;
    v_sumas := v_sumas + v_asig;
    return next;
  end loop;
  if v_rest > 0 then
    lote_id := null; vence := null; cantidad := v_rest; en_stock := v_rest; estado := 'sin_fecha';
    return next;
  end if;
end $$;
revoke all on function public.lotes_repartir(uuid) from public, anon;
grant execute on function public.lotes_repartir(uuid) to authenticated;

-- Baja por vencimiento: solo se puede dar de baja el lote que vence primero y todavía tiene unidades en stock
-- (así el reparto FEFO queda consistente). Descuenta el stock con motivo 'vencimiento'.
create or replace function public.lote_dar_de_baja(p_lote uuid, p_cantidad int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_l public.lotes_stock%rowtype; v_p public.productos%rowtype; v_primero uuid; v_en_stock int;
begin
  select * into v_l from public.lotes_stock where id = p_lote for update;
  if not found or not v_l.activo or not public.es_dueno(v_l.kiosco_id) then raise exception 'no_autorizado'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'cantidad_invalida'; end if;
  select r.lote_id, r.en_stock into v_primero, v_en_stock
    from public.lotes_repartir(v_l.producto_id) r where r.lote_id is not null and r.en_stock > 0
    order by r.vence asc limit 1;
  if v_primero is distinct from p_lote then raise exception 'baja_fuera_de_orden'; end if;
  if p_cantidad > v_en_stock then raise exception 'cantidad_mayor_al_lote'; end if;
  select * into v_p from public.productos where id = v_l.producto_id for update;
  perform public.ajustar_stock(v_p.id, v_p.stock - p_cantidad, 'Baja por vencimiento (lote ' || to_char(v_l.vence, 'DD/MM/YYYY') || ')', 'vencimiento');
  return jsonb_build_object('stock', v_p.stock - p_cantidad, 'dado_de_baja', p_cantidad);
end $$;
revoke all on function public.lote_dar_de_baja(uuid, int) from public, anon;
grant execute on function public.lote_dar_de_baja(uuid, int) to authenticated;

-- Cerrar un lote (ya no cuenta en el reparto). No borra nada.
create or replace function public.lote_cerrar(p_lote uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_kiosco uuid;
begin
  select kiosco_id into v_kiosco from public.lotes_stock where id = p_lote;
  if v_kiosco is null or not public.es_dueno(v_kiosco) then raise exception 'no_autorizado'; end if;
  update public.lotes_stock set activo = false where id = p_lote;
end $$;
revoke all on function public.lote_cerrar(uuid) from public, anon;
grant execute on function public.lote_cerrar(uuid) to authenticated;
