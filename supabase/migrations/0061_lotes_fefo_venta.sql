-- 0061: lotes con vencimiento consumidos de verdad por la venta (FEFO real).
-- Idempotente: se puede volver a correr. Aplicar DESPUÉS de 0060. Ninguna función toca precios.
--  * Cada ítem de venta de mostrador consume primero el lote que vence antes (venta_lotes_consumo).
--  * Anular una venta o devolver con reposición vuelve la cantidad al lote que se había consumido.
--  * lotes_repartir pasa a ordenar por vencimiento ascendente (lo que vence antes se vende antes).

create table if not exists public.venta_lotes_consumo (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  venta_id uuid not null references public.ventas_mostrador(id) on delete cascade,
  item_id uuid not null references public.ventas_mostrador_items(id) on delete cascade,
  lote_id uuid not null references public.lotes_stock(id) on delete cascade,
  cantidad int not null check (cantidad > 0),
  devuelto int not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  check (devuelto >= 0 and devuelto <= cantidad)
);
create index if not exists venta_lotes_consumo_item on public.venta_lotes_consumo (item_id);
create index if not exists venta_lotes_consumo_venta on public.venta_lotes_consumo (venta_id);
alter table public.venta_lotes_consumo enable row level security;
revoke all on public.venta_lotes_consumo from anon, authenticated;
grant select on public.venta_lotes_consumo to authenticated;
drop policy if exists venta_lotes_consumo_lectura_dueno on public.venta_lotes_consumo; -- drop-ok: se recrea idéntica
create policy venta_lotes_consumo_lectura_dueno on public.venta_lotes_consumo for select to authenticated using (public.es_dueno(kiosco_id));

create or replace function public.lotes_repartir(p_producto uuid)
returns table (lote_id uuid, vence date, cantidad int, en_stock int, estado text)
language plpgsql stable security definer set search_path = public as $$
declare v_p public.productos%rowtype; v_rest int; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
        l record; v_asig int;
begin
  select * into v_p from public.productos where id = p_producto;
  if not found or not public.es_dueno(v_p.kiosco_id) then raise exception 'no_autorizado'; end if;
  v_rest := greatest(coalesce(v_p.stock, 0), 0);
  for l in select lo.* from public.lotes_stock lo where lo.producto_id = p_producto and lo.activo
           order by lo.vence asc, lo.created_at asc loop
    v_asig := least(l.cantidad, v_rest);
    v_rest := v_rest - v_asig;
    lote_id := l.id; vence := l.vence; cantidad := l.cantidad; en_stock := v_asig;
    estado := case when v_asig = 0 then 'consumido'
                   when l.vence < v_hoy then 'vencido'
                   when l.vence <= v_hoy + 7 then 'por_vencer'
                   else 'vigente' end;
    return next;
  end loop;
  if v_rest > 0 then
    lote_id := null; vence := null; cantidad := v_rest; en_stock := v_rest; estado := 'sin_fecha';
    return next;
  end if;
end $$;
revoke all on function public.lotes_repartir(uuid) from public, anon;
grant execute on function public.lotes_repartir(uuid) to authenticated;

create or replace function public.lotes_consumir_venta_item()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kiosco uuid; v_rest int; v_take int; l record;
begin
  if new.producto_id is null then return new; end if;
  if not exists (select 1 from public.productos where id = new.producto_id and stock_controlado) then
    return new;
  end if;
  select kiosco_id into v_kiosco from public.ventas_mostrador where id = new.venta_id;
  v_rest := new.cantidad;
  for l in
    select id, cantidad from public.lotes_stock
     where producto_id = new.producto_id and activo and cantidad > 0
     order by vence asc, created_at asc
     for update
  loop
    exit when v_rest <= 0;
    v_take := least(l.cantidad, v_rest);
    update public.lotes_stock set cantidad = cantidad - v_take where id = l.id;
    insert into public.venta_lotes_consumo (kiosco_id, venta_id, item_id, lote_id, cantidad)
      values (v_kiosco, new.venta_id, new.id, l.id, v_take);
    v_rest := v_rest - v_take;
  end loop;
  return new;
end $$;

create or replace function public.lotes_reponer_por_anulacion()
returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.anulada and not coalesce(old.anulada, false) then
    for c in
      select id, lote_id, cantidad, devuelto from public.venta_lotes_consumo
       where venta_id = new.id and devuelto < cantidad
       for update
    loop
      update public.lotes_stock set cantidad = cantidad + (c.cantidad - c.devuelto) where id = c.lote_id;
      update public.venta_lotes_consumo set devuelto = cantidad where id = c.id;
    end loop;
  end if;
  return new;
end $$;

create or replace function public.lotes_reponer_por_devolucion()
returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; v_rest int := new.cantidad; v_take int;
begin
  if not coalesce(new.repone_stock, true) then return new; end if;
  for c in
    select id, lote_id, cantidad, devuelto from public.venta_lotes_consumo
     where item_id = new.item_id and devuelto < cantidad
     order by created_at desc
     for update
  loop
    exit when v_rest <= 0;
    v_take := least(c.cantidad - c.devuelto, v_rest);
    update public.lotes_stock set cantidad = cantidad + v_take where id = c.lote_id;
    update public.venta_lotes_consumo set devuelto = devuelto + v_take where id = c.id;
    v_rest := v_rest - v_take;
  end loop;
  return new;
end $$;

drop trigger if exists ventas_items_consumir_lotes on public.ventas_mostrador_items; -- drop-ok: se recrea idéntico
create trigger ventas_items_consumir_lotes after insert on public.ventas_mostrador_items
  for each row execute function public.lotes_consumir_venta_item();
drop trigger if exists ventas_anulacion_reponer_lotes on public.ventas_mostrador; -- drop-ok: se recrea idéntico
create trigger ventas_anulacion_reponer_lotes after update of anulada on public.ventas_mostrador
  for each row execute function public.lotes_reponer_por_anulacion();
drop trigger if exists devoluciones_items_reponer_lotes on public.devoluciones_mostrador_items; -- drop-ok: se recrea idéntico
create trigger devoluciones_items_reponer_lotes after insert on public.devoluciones_mostrador_items
  for each row execute function public.lotes_reponer_por_devolucion();

create or replace function public.pos_lotes_de_venta(p_venta uuid)
returns table (item_id uuid, vence date, cantidad int)
language plpgsql stable security definer set search_path = public as $$
declare v_k uuid;
begin
  select kiosco_id into v_k from public.ventas_mostrador where id = p_venta;
  if v_k is null or not public.es_miembro(v_k, array['cajero', 'encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  return query
    select c.item_id, lo.vence, sum(c.cantidad)::int
      from public.venta_lotes_consumo c
      join public.lotes_stock lo on lo.id = c.lote_id
     where c.venta_id = p_venta
     group by c.item_id, lo.vence
     order by c.item_id, lo.vence;
end $$;
revoke all on function public.pos_lotes_de_venta(uuid) from public, anon;
grant execute on function public.pos_lotes_de_venta(uuid) to authenticated;
