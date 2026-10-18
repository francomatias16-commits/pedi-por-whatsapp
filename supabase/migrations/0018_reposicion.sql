-- Etapa 10 · Reposición de stock (Fase 1 del plan de stock automático).
-- Portado y simplificado de distrib (035_stock_autonomo / 071_punto_pedido_predictivo / stock-auto.js) para un kiosco:
--  * Por producto: stock mínimo, stock objetivo, días de entrega del proveedor y proveedor habitual.
--  * `reposicion_sugerida(kiosco)`: qué reponer, cuánto y a quién, según la venta de los últimos 30 días
--    (pedidos de la tienda + mostrador, menos devoluciones). Distrib solo mira pedidos; acá el mostrador pesa más.
--  * Casos que distrib aprendió a marcar y acá se marcan desde el día uno: sin proveedor y sin datos (no se inventan cantidades).
--  * `reposicion_resumen(kiosco)`: números para el panel (agotados, bajos, sin proveedor, plata en stock).
--  * `reposicion_minimos_iniciales(kiosco)`: carga un mínimo razonable donde hay historial, para que la primera corrida sirva.
--  * `reposicion_avisos_diarios()`: la usa el cron (solo service role). Una vez por día y por kiosco, y no repite el aviso si nada cambió.
--  * `sumar_stock_rapido(producto, cantidad, token)`: cargar mercadería desde la caja sin perder el carrito (pide PIN si el kiosco tiene).
-- Todo se escribe por funciones (security definer). Aplicar DESPUÉS de 0001..0017.

-- 1) Datos de reposición por producto.
--    La tienda pública (anon) no los ve: el grant de columnas de 0009 no los incluye.
alter table public.productos
  add column stock_minimo int not null default 0 check (stock_minimo >= 0),
  add column stock_objetivo int check (stock_objetivo is null or stock_objetivo >= 0),
  add column lead_time_dias int not null default 3 check (lead_time_dias between 0 and 60),
  add column proveedor_id uuid references public.proveedores(id) on delete set null;
create index productos_proveedor_idx on public.productos (proveedor_id) where proveedor_id is not null;

-- El proveedor habitual tiene que ser del mismo kiosco (el UPDATE directo del panel no lo garantiza por sí solo).
create or replace function public.productos_valida_proveedor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.proveedor_id is not null
     and not exists (select 1 from public.proveedores p where p.id = new.proveedor_id and p.kiosco_id = new.kiosco_id) then
    raise exception 'proveedor_no_encontrado';
  end if;
  return new;
end $$;
revoke execute on function public.productos_valida_proveedor() from public, anon, authenticated;
create trigger productos_valida_proveedor before insert or update of proveedor_id, kiosco_id on public.productos
  for each row when (new.proveedor_id is not null)
  execute function public.productos_valida_proveedor();

-- 2) Fila de resultado (la comparten la versión del dueño y la del cron).
create type public.reposicion_fila as (
  producto_id uuid, nombre text, categoria text, por_peso boolean,
  stock int, stock_minimo int, stock_objetivo int, lead_time_dias int,
  velocidad_dia numeric, dias_restantes numeric, cantidad_sugerida int,
  estado text,          -- 'agotado' | 'critico' (menos de 3 días) | 'bajo'
  sin_datos boolean,    -- no hay ventas ni mínimo/objetivo: no se puede calcular cuánto pedir
  proveedor_id uuid, proveedor_nombre text, proveedor_telefono text, costo numeric
);

-- 3) Auxiliares internos (no se pueden llamar desde el cliente).
-- Días que cuentan para la velocidad: hasta 30, pero no más que los que lleva el producto cargado
-- (un producto de ayer con 5 ventas no debe parecer lento por dividir en 30).
create or replace function public.reposicion_dias_ventana(p_creado timestamptz) returns numeric
language sql stable set search_path = public as $$
  select greatest(1, least(30, ceil(extract(epoch from (now() - p_creado)) / 86400)))::numeric
$$;

-- Unidades vendidas por producto en los últimos 30 días (gramos en los productos por peso, igual que el stock).
create or replace function public.reposicion_ventas_30d(p_kiosco uuid) returns table (producto_id uuid, unidades numeric)
language sql stable security definer set search_path = public as $$
  select t.producto_id, greatest(sum(t.u), 0)::numeric
  from (
    select pi.producto_id, pi.cantidad::numeric as u
      from public.pedido_items pi join public.pedidos pd on pd.id = pi.pedido_id
     where pd.kiosco_id = p_kiosco and pd.estado in ('confirmado', 'entregado')
       and pd.created_at >= now() - interval '30 days' and pi.producto_id is not null
    union all
    select vi.producto_id, vi.cantidad::numeric
      from public.ventas_mostrador_items vi join public.ventas_mostrador v on v.id = vi.venta_id
     where v.kiosco_id = p_kiosco and not v.anulada
       and v.created_at >= now() - interval '30 days' and vi.producto_id is not null
    union all
    select vi.producto_id, - di.cantidad::numeric
      from public.devoluciones_mostrador_items di
      join public.devoluciones_mostrador d on d.id = di.devolucion_id
      join public.ventas_mostrador v on v.id = d.venta_id and not v.anulada
      join public.ventas_mostrador_items vi on vi.id = di.item_id
     where d.kiosco_id = p_kiosco and di.repone_stock
       and d.created_at >= now() - interval '30 days' and vi.producto_id is not null
  ) t
  group by t.producto_id
$$;

-- El cálculo en sí, sin chequeo de dueño (lo usa el cron con la service role y el wrapper del dueño).
-- Solo devuelve lo que hay que reponer.
create or replace function public.reposicion_calcular(p_kiosco uuid) returns setof public.reposicion_fila
language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.nombre, p.categoria, p.vendido_por_peso, p.stock, p.stock_minimo, p.stock_objetivo, p.lead_time_dias,
           p.proveedor_id, p.costo, pr.nombre as prov_nombre, pr.telefono as prov_tel,
           coalesce(v.unidades, 0) / public.reposicion_dias_ventana(p.created_at) as vel
      from public.productos p
      left join public.reposicion_ventas_30d(p_kiosco) v on v.producto_id = p.id
      left join public.proveedores pr on pr.id = p.proveedor_id and pr.activo
     where p.kiosco_id = p_kiosco and p.stock_controlado
  ), calc as (
    select b.*,
           b.vel * b.lead_time_dias as consumo_lead,
           coalesce(b.stock_objetivo, greatest(ceil(b.vel * 30), b.stock_minimo * 2))::int as objetivo
      from base b
  ), fin as (
    select c.*,
           greatest(0, c.objetivo + ceil(c.consumo_lead)::int - c.stock)::int as sugerida
      from calc c
     -- Hay que reponer si está en o bajo el mínimo, o si no le alcanza para vender hasta que llegue el pedido.
     where c.stock <= c.stock_minimo or c.stock <= c.consumo_lead + c.stock_minimo
  )
  select f.id, f.nombre, f.categoria, f.vendido_por_peso,
         f.stock, f.stock_minimo, f.stock_objetivo, f.lead_time_dias,
         round(f.vel, 3),
         case when f.vel > 0 then round(f.stock / f.vel, 1) end,
         f.sugerida,
         case when f.stock <= 0 then 'agotado'
              when f.vel > 0 and f.stock / f.vel < 3 then 'critico'
              else 'bajo' end,
         (f.sugerida = 0),
         f.proveedor_id, f.prov_nombre, f.prov_tel, f.costo
    from fin f
   order by case when f.stock <= 0 then 0 when f.vel > 0 and f.stock / f.vel < 3 then 1 else 2 end,
            case when f.vel > 0 then f.stock / f.vel end nulls last, f.nombre
$$;

-- 4) Lo que usa el dueño desde el panel.
create or replace function public.reposicion_sugerida(p_kiosco uuid) returns setof public.reposicion_fila
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  return query select * from public.reposicion_calcular(p_kiosco);
end $$;

create or replace function public.reposicion_resumen(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_plata numeric(14,2);
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select jsonb_build_object(
           'agotados',      count(*) filter (where estado = 'agotado' and not sin_datos),
           'bajos',         count(*) filter (where estado <> 'agotado' and not sin_datos),
           'sin_proveedor', count(*) filter (where proveedor_id is null and not sin_datos),
           'sin_datos',     count(*) filter (where sin_datos))
    into v from public.reposicion_calcular(p_kiosco);
  -- Plata parada en mercadería: stock × último costo (por peso el stock está en gramos y el costo es por kg).
  select coalesce(round(sum(case when vendido_por_peso then stock * costo / 1000.0 else stock * costo end), 2), 0)
    into v_plata from public.productos where kiosco_id = p_kiosco and stock_controlado and costo is not null;
  return v || jsonb_build_object('plata_en_stock', v_plata);
end $$;

-- Pone un mínimo = lo que se vende durante la entrega + 2 días de colchón, solo donde hoy está en 0 y hay ventas.
create or replace function public.reposicion_minimos_iniciales(p_kiosco uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  update public.productos p
     set stock_minimo = greatest(1, ceil((v.unidades / public.reposicion_dias_ventana(p.created_at)) * (p.lead_time_dias + 2)))::int
    from public.reposicion_ventas_30d(p_kiosco) v
   where v.producto_id = p.id and p.kiosco_id = p_kiosco and p.stock_controlado
     and p.stock_minimo = 0 and v.unidades > 0;
  get diagnostics v_n = row_count;
  return jsonb_build_object('actualizados', v_n);
end $$;

-- 5) Aviso diario (cron). Una fila por kiosco y día; el aviso sale solo si cambió lo que hay que reponer
--    o si pasaron 7 días desde el último aviso y el problema sigue.
create table public.avisos_stock_diarios (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  dia date not null,
  huella text not null,
  agotados int not null,
  bajos int not null,
  sin_proveedor int not null,
  notificar boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (kiosco_id, dia)
);
alter table public.avisos_stock_diarios enable row level security;
revoke all on public.avisos_stock_diarios from anon, authenticated;

create or replace function public.reposicion_avisos_diarios()
returns table (kiosco uuid, n_agotados int, n_bajos int, n_sin_proveedor int)
language plpgsql security definer set search_path = public as $$
declare
  k record;
  v_dia date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_ag int; v_ba int; v_sp int; v_h text;
  v_prev_huella text; v_prev_aviso date; v_notif boolean; v_ins uuid;
begin
  for k in select id from public.kioscos loop
    -- Los que no tienen datos para calcular no se avisan: suelen ser productos viejos sin movimiento.
    select count(*) filter (where estado = 'agotado'),
           count(*) filter (where estado <> 'agotado'),
           count(*) filter (where proveedor_id is null),
           coalesce(md5(string_agg(producto_id::text || ':' || estado, ',' order by producto_id)), '')
      into v_ag, v_ba, v_sp, v_h
      from public.reposicion_calcular(k.id) where not sin_datos;

    select huella into v_prev_huella from public.avisos_stock_diarios where kiosco_id = k.id order by dia desc limit 1;
    select max(dia) into v_prev_aviso from public.avisos_stock_diarios where kiosco_id = k.id and notificar;
    v_notif := (v_ag + v_ba) > 0
               and (v_prev_huella is distinct from v_h or v_prev_aviso is null or v_prev_aviso <= v_dia - 7);

    insert into public.avisos_stock_diarios (kiosco_id, dia, huella, agotados, bajos, sin_proveedor, notificar)
      values (k.id, v_dia, v_h, v_ag, v_ba, v_sp, v_notif)
      on conflict (kiosco_id, dia) do nothing returning id into v_ins;
    -- Ya corrió hoy para este kiosco (el cron se disparó dos veces): no repetir.
    if v_ins is null then continue; end if;

    if v_notif then
      kiosco := k.id; n_agotados := v_ag; n_bajos := v_ba; n_sin_proveedor := v_sp;
      return next;
    end if;
  end loop;
end $$;

-- 6) Cargar mercadería desde la caja. Suma al stock, deja el movimiento y no pisa lo que se vendió en el medio
--    (por eso suma en vez de fijar el valor, como hace ajustar_stock). Pide PIN si el kiosco tiene uno.
create or replace function public.sumar_stock_rapido(p_producto uuid, p_cantidad int, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p public.productos%rowtype; v_nuevo int;
begin
  select * into v_p from public.productos where id = p_producto for update;
  if not found or not public.es_dueno(v_p.kiosco_id) then raise exception 'no_autorizado'; end if;
  if not v_p.stock_controlado then raise exception 'stock_no_controlado'; end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 9999999 then raise exception 'cantidad_invalida'; end if;
  perform public.pos_exigir_pin(v_p.kiosco_id, 'stock', p_token);
  update public.productos set stock = stock + p_cantidad, disponible = true where id = p_producto returning stock into v_nuevo;
  insert into public.stock_movimientos (kiosco_id, producto_id, tipo, cantidad, stock_resultante, motivo)
    values (v_p.kiosco_id, p_producto, 'ajuste', p_cantidad, v_nuevo, 'Carga rápida desde la caja');
  return jsonb_build_object('stock', v_nuevo);
end $$;

-- 7) Permisos. Las internas no se llaman desde el cliente; la del cron queda solo para la service role.
revoke all on function public.reposicion_dias_ventana(timestamptz) from public, anon, authenticated;
revoke all on function public.reposicion_ventas_30d(uuid) from public, anon, authenticated;
revoke all on function public.reposicion_calcular(uuid) from public, anon, authenticated;
revoke all on function public.reposicion_avisos_diarios() from public, anon, authenticated;
revoke all on function public.reposicion_sugerida(uuid) from public, anon;
revoke all on function public.reposicion_resumen(uuid) from public, anon;
revoke all on function public.reposicion_minimos_iniciales(uuid) from public, anon;
revoke all on function public.sumar_stock_rapido(uuid, int, uuid) from public, anon;
grant execute on function public.reposicion_sugerida(uuid), public.reposicion_resumen(uuid),
  public.reposicion_minimos_iniciales(uuid), public.sumar_stock_rapido(uuid, int, uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reposicion_calcular(uuid), public.reposicion_avisos_diarios() to service_role;
  end if;
end $$;
