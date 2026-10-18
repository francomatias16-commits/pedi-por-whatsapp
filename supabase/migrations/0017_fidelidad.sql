-- Etapa 11 · Sistema de fidelidad con campañas y premios configurables (reemplaza al sello único de la etapa 2).
--  * Campañas: cada una define cómo se ganan sellos (por compra, por monto, por producto o categoría, bienvenida,
--    reactivación, multiplicador "sellos dobles" y acciones manuales a medida) con filtros de canal, medio de pago,
--    días, horario, vigencia, monto mínimo y tope diario por cliente. Las campañas activas se suman.
--  * Premios: catálogo propio (libre, producto gratis, % o monto de descuento), cada uno con su costo en sellos.
--  * Los sellos se otorgan solos al entregar un pedido y al cerrar una venta de la Caja con cliente. Anular la venta
--    anula sus sellos y devuelve el canje que se hizo en ella.
--  * Vencimiento opcional por inactividad: si el cliente pasa N días sin sumar sellos, su saldo vence.
--  * Todo se escribe por funciones (security definer); el cliente solo lee. Aplicar DESPUÉS de 0001..0016.

-- 1) Vencimiento por inactividad (opcional) en el kiosco
alter table public.kioscos
  add column sellos_vencen_dias int check (sellos_vencen_dias is null or sellos_vencen_dias between 30 and 1095);

-- 2) Campañas
create table public.fidelidad_campanas (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 80),
  tipo text not null check (tipo in ('visita', 'monto', 'producto', 'categoria', 'bienvenida', 'reactivacion', 'multiplicador', 'manual')),
  activa boolean not null default true,
  sellos int not null default 1 check (sellos between 1 and 100),
  multiplicador numeric(3,1) check (multiplicador is null or multiplicador between 1.5 and 10),
  por_monto numeric(12,2) check (por_monto is null or por_monto > 0),
  producto_id uuid references public.productos(id) on delete cascade,
  categoria text check (categoria is null or length(categoria) <= 60),
  dias_inactivo int check (dias_inactivo is null or dias_inactivo between 7 and 365),
  monto_minimo numeric(12,2) check (monto_minimo is null or monto_minimo >= 0),
  canales text[] not null default '{pedido,mostrador}' check (cardinality(canales) >= 1 and canales <@ array['pedido', 'mostrador']),
  medios text[] check (medios is null or (cardinality(medios) >= 1 and medios <@ array['efectivo', 'transferencia', 'mercadopago'])),
  dias_semana int[] check (dias_semana is null or (cardinality(dias_semana) >= 1 and dias_semana <@ array[0, 1, 2, 3, 4, 5, 6])),
  hora_desde time,
  hora_hasta time,
  desde date,
  hasta date,
  tope_diario int check (tope_diario is null or tope_diario between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  check ((hora_desde is null) = (hora_hasta is null)),
  check (desde is null or hasta is null or desde <= hasta),
  check (tipo <> 'monto' or por_monto is not null),
  check (tipo <> 'producto' or producto_id is not null),
  check (tipo <> 'categoria' or categoria is not null),
  check (tipo <> 'multiplicador' or multiplicador is not null),
  check (tipo <> 'reactivacion' or dias_inactivo is not null)
);
create index on public.fidelidad_campanas (kiosco_id) where activa;

-- 3) Premios
create table public.fidelidad_premios (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 80),
  descripcion text check (descripcion is null or length(descripcion) <= 200),
  costo_sellos int not null check (costo_sellos between 1 and 1000),
  tipo text not null check (tipo in ('libre', 'producto', 'pct', 'monto')),
  producto_id uuid references public.productos(id) on delete cascade,
  valor numeric(12,2),
  activo boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  check (tipo <> 'producto' or producto_id is not null),
  check (tipo <> 'pct' or (valor is not null and valor > 0 and valor <= 100)),
  check (tipo <> 'monto' or (valor is not null and valor > 0))
);
create index on public.fidelidad_premios (kiosco_id) where activo;

-- Un producto de una campaña o premio tiene que ser del mismo kiosco.
create or replace function public.fidelidad_validar() returns trigger language plpgsql as $$
begin
  if new.producto_id is not null and not exists (select 1 from public.productos p where p.id = new.producto_id and p.kiosco_id = new.kiosco_id) then
    raise exception 'producto_invalido';
  end if;
  return new;
end $$;
create trigger trg_campanas_validar before insert or update on public.fidelidad_campanas for each row execute function public.fidelidad_validar();
create trigger trg_premios_validar before insert or update on public.fidelidad_premios for each row execute function public.fidelidad_validar();

-- 4) Sellos y canjes: cantidad, campaña de origen, venta de origen, anulación de canjes
alter table public.sellos drop constraint sellos_origen_check;
alter table public.sellos drop constraint sellos_pedido_id_key;
alter table public.sellos
  add column cantidad int not null default 1 check (cantidad between -1000 and 1000 and cantidad <> 0),
  add column campana_id uuid references public.fidelidad_campanas(id) on delete set null,
  add column venta_id uuid references public.ventas_mostrador(id) on delete set null,
  add column motivo text check (motivo is null or length(motivo) <= 120),
  add check (origen in ('pedido', 'mostrador', 'venta', 'manual')),
  add check (cantidad > 0 or origen = 'manual');
create unique index sellos_pedido_campana_uq on public.sellos (pedido_id, campana_id) where pedido_id is not null and campana_id is not null;
create unique index sellos_venta_campana_uq on public.sellos (venta_id, campana_id) where venta_id is not null and campana_id is not null;
create index on public.sellos (venta_id) where venta_id is not null;

alter table public.canjes
  add column premio_id uuid references public.fidelidad_premios(id) on delete set null,
  add column premio_nombre text,
  add column venta_id uuid references public.ventas_mostrador(id) on delete set null,
  add column anulado boolean not null default false;

-- Saldo: sellos vigentes menos canjes no anulados. Con vencimiento, si el último sello es más viejo que el plazo, el saldo es 0.
create or replace view public.clientes_sellos with (security_invoker = true) as
select c.id, c.kiosco_id, c.nombre, c.telefono,
  (case when k.sellos_vencen_dias is not null and (g.ultimo is null or g.ultimo < now() - make_interval(days => k.sellos_vencen_dias)) then 0
        else greatest(coalesce(g.total, 0) - coalesce(x.canjeados, 0), 0) end)::int as sellos_disponibles,
  coalesce(g.total, 0)::int as sellos_ganados,
  coalesce(x.canjeados, 0)::int as sellos_canjeados,
  g.ultimo as ultimo_sello,
  case when k.sellos_vencen_dias is not null and g.ultimo is not null then g.ultimo + make_interval(days => k.sellos_vencen_dias) end as vence_at
from public.clientes c
join public.kioscos k on k.id = c.kiosco_id
left join lateral (select sum(s.cantidad) as total, max(s.created_at) filter (where s.cantidad > 0) as ultimo
                   from public.sellos s where s.cliente_id = c.id and not s.anulado) g on true
left join lateral (select sum(z.sellos) as canjeados from public.canjes z where z.cliente_id = c.id and not z.anulado) x on true;

-- 5) Reglas: ¿aplica esta campaña a este momento y esta compra?
create or replace function public.fidelidad_aplica(c public.fidelidad_campanas, p_canal text, p_monto numeric, p_medios text[], p_fecha date, p_dow int, p_hora time)
returns boolean language sql immutable as $$
  select c.activa
    and p_canal = any (c.canales)
    and (c.medios is null or coalesce(p_medios, '{}') && c.medios)
    and (c.desde is null or p_fecha >= c.desde) and (c.hasta is null or p_fecha <= c.hasta)
    and (c.dias_semana is null or p_dow = any (c.dias_semana))
    and (c.hora_desde is null or case when c.hora_desde <= c.hora_hasta then p_hora >= c.hora_desde and p_hora < c.hora_hasta
                                      else p_hora >= c.hora_desde or p_hora < c.hora_hasta end)
    and (c.monto_minimo is null or p_monto >= c.monto_minimo)
$$;

-- Cuántos sellos da cada campaña por una compra. Sin efectos: sirve para otorgar y para simular.
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
    where p_cliente is not null and s.cliente_id = p_cliente and not s.anulado and s.origen in ('pedido', 'venta');
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

-- Otorga los sellos de una compra (interna: solo la llaman los triggers). Idempotente por pedido o venta.
create or replace function public.fidelidad_otorgar(p_kiosco uuid, p_cliente uuid, p_canal text, p_monto numeric, p_medios text[], p_items jsonb, p_cuando timestamptz, p_pedido uuid, p_venta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_cliente is null then return; end if;
  if (p_pedido is not null and exists (select 1 from public.sellos where pedido_id = p_pedido))
     or (p_venta is not null and exists (select 1 from public.sellos where venta_id = p_venta)) then return; end if;
  for r in select * from public.fidelidad_calcular(p_kiosco, p_cliente, p_canal, p_monto, p_medios, p_items, p_cuando) loop
    insert into public.sellos (kiosco_id, cliente_id, origen, pedido_id, venta_id, campana_id, cantidad, motivo, created_at)
      values (p_kiosco, p_cliente, case when p_pedido is not null then 'pedido' else 'venta' end, p_pedido, p_venta, r.campana_id, r.cantidad, r.motivo, p_cuando);
  end loop;
end $$;

-- 6) Triggers: pedido entregado, venta de la Caja y anulación de venta
create or replace function public.sello_por_entrega() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  if new.estado = 'entregado' and old.estado is distinct from 'entregado' and new.cliente_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'unidades', i.cantidad)), '[]'::jsonb) into v_items
      from public.pedido_items i where i.pedido_id = new.id and i.producto_id is not null;
    perform public.fidelidad_otorgar(new.kiosco_id, new.cliente_id, 'pedido', greatest(new.total - new.costo_envio, 0), array[new.medio_pago], v_items, now(), new.id, null);
  end if;
  return new;
end $$;

create or replace function public.fidelidad_venta() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.ventas_mostrador%rowtype; v_medios text[]; v_items jsonb;
begin
  -- Es un trigger diferido: se relee la venta ya terminada (con renglones, pagos y total final).
  select * into v from public.ventas_mostrador where id = new.id;
  if not found or v.cliente_id is null or v.anulada then return null; end if;
  select coalesce(array_agg(distinct p.medio), '{}') into v_medios from public.ventas_mostrador_pagos p where p.venta_id = v.id;
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'unidades', case when i.por_peso then 1 else i.cantidad end)), '[]'::jsonb) into v_items
    from public.ventas_mostrador_items i where i.venta_id = v.id and i.producto_id is not null;
  perform public.fidelidad_otorgar(v.kiosco_id, v.cliente_id, 'mostrador', v.total, v_medios, v_items, coalesce(v.fecha_offline, v.created_at), null, v.id);
  return null;
end $$;
create constraint trigger trg_fidelidad_venta after insert on public.ventas_mostrador deferrable initially deferred
  for each row execute function public.fidelidad_venta();

create or replace function public.fidelidad_venta_anulada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.anulada and not old.anulada then
    update public.sellos set anulado = true where venta_id = new.id and not anulado;
    update public.canjes set anulado = true where venta_id = new.id and not anulado;
  end if;
  return new;
end $$;
create trigger trg_fidelidad_venta_anulada after update of anulada on public.ventas_mostrador for each row execute function public.fidelidad_venta_anulada();

-- 7) Funciones para el dueño
-- Sellos a mano: una acción manual configurada (campaña tipo "manual") o un ajuste libre (+ o −) con motivo.
create or replace function public.fidelidad_dar_sellos(p_cliente uuid, p_campana uuid default null, p_cantidad int default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.clientes%rowtype; v_camp public.fidelidad_campanas; v_n int; v_mot text; v_saldo int; v_hoy int;
  v_fecha date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select * into v_c from public.clientes where id = p_cliente for update;
  if not found or not public.es_dueno(v_c.kiosco_id) then raise exception 'no_autorizado'; end if;
  if p_campana is not null then
    select * into v_camp from public.fidelidad_campanas where id = p_campana and kiosco_id = v_c.kiosco_id;
    if not found or v_camp.tipo <> 'manual' then raise exception 'campana_invalida'; end if;
    if not v_camp.activa or (v_camp.desde is not null and v_fecha < v_camp.desde) or (v_camp.hasta is not null and v_fecha > v_camp.hasta) then raise exception 'campana_inactiva'; end if;
    v_n := v_camp.sellos; v_mot := v_camp.nombre;
    if v_camp.tope_diario is not null then
      select coalesce(sum(s.cantidad), 0) into v_hoy from public.sellos s
        where s.cliente_id = p_cliente and s.campana_id = p_campana and not s.anulado and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_fecha;
      if v_hoy + v_n > v_camp.tope_diario then raise exception 'tope_diario'; end if;
    end if;
  else
    v_n := p_cantidad; v_mot := left(trim(coalesce(p_motivo, '')), 120);
    if v_n is null or v_n = 0 or abs(v_n) > 1000 then raise exception 'cantidad_invalida'; end if;
    if length(v_mot) < 3 then raise exception 'motivo_requerido'; end if;
    select sellos_disponibles into v_saldo from public.clientes_sellos where id = p_cliente;
    if v_n < 0 and -v_n > v_saldo then raise exception 'sellos_insuficientes'; end if;
  end if;
  insert into public.sellos (kiosco_id, cliente_id, origen, campana_id, cantidad, motivo) values (v_c.kiosco_id, p_cliente, 'manual', p_campana, v_n, v_mot);
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = p_cliente;
  return jsonb_build_object('saldo', v_saldo, 'cantidad', v_n);
end $$;

create or replace function public.fidelidad_anular_sello(p_sello uuid, p_anular boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.sellos%rowtype; v_saldo int;
begin
  select * into v_s from public.sellos where id = p_sello for update;
  if not found or not public.es_dueno(v_s.kiosco_id) then raise exception 'no_autorizado'; end if;
  update public.sellos set anulado = p_anular where id = p_sello;
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = v_s.cliente_id;
  return jsonb_build_object('saldo', v_saldo);
end $$;

-- Canje de un premio del catálogo (opcionalmente atado a la venta de la Caja donde se aplicó).
create or replace function public.fidelidad_canjear(p_cliente uuid, p_premio uuid, p_venta uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.clientes%rowtype; v_p public.fidelidad_premios; v_saldo int; v_id uuid;
begin
  select * into v_c from public.clientes where id = p_cliente for update;
  if not found or not public.es_dueno(v_c.kiosco_id) then raise exception 'no_autorizado'; end if;
  select * into v_p from public.fidelidad_premios where id = p_premio and kiosco_id = v_c.kiosco_id and activo;
  if not found then raise exception 'premio_invalido'; end if;
  if p_venta is not null and not exists (select 1 from public.ventas_mostrador v where v.id = p_venta and v.kiosco_id = v_c.kiosco_id and v.cliente_id = p_cliente and not v.anulada) then
    raise exception 'venta_invalida';
  end if;
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = p_cliente;
  if v_saldo < v_p.costo_sellos then raise exception 'sellos_insuficientes'; end if;
  insert into public.canjes (kiosco_id, cliente_id, sellos, premio_id, premio_nombre, venta_id)
    values (v_c.kiosco_id, p_cliente, v_p.costo_sellos, v_p.id, v_p.nombre, p_venta) returning id into v_id;
  return jsonb_build_object('canje_id', v_id, 'saldo', v_saldo - v_p.costo_sellos, 'premio', v_p.nombre);
end $$;

create or replace function public.fidelidad_anular_canje(p_canje uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_x public.canjes%rowtype; v_saldo int;
begin
  select * into v_x from public.canjes where id = p_canje for update;
  if not found or not public.es_dueno(v_x.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_x.anulado then raise exception 'ya_anulado'; end if;
  update public.canjes set anulado = true where id = p_canje;
  select sellos_disponibles into v_saldo from public.clientes_sellos where id = v_x.cliente_id;
  return jsonb_build_object('saldo', v_saldo);
end $$;

-- Simulador: cuántos sellos daría una compra hipotética hoy (o en otro día y hora), con las campañas activas.
create or replace function public.fidelidad_simular(p_kiosco uuid, p_monto numeric, p_canal text default 'mostrador', p_medio text default 'efectivo',
  p_cuando timestamptz default now(), p_cliente uuid default null, p_producto uuid default null, p_unidades int default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_items jsonb := '[]'::jsonb; v_filas jsonb;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_canal not in ('pedido', 'mostrador') then raise exception 'canal_invalido'; end if;
  if p_producto is not null then v_items := jsonb_build_array(jsonb_build_object('producto_id', p_producto, 'unidades', greatest(coalesce(p_unidades, 1), 1))); end if;
  select coalesce(jsonb_agg(jsonb_build_object('campana_id', campana_id, 'cantidad', cantidad, 'motivo', motivo)), '[]'::jsonb) into v_filas
    from public.fidelidad_calcular(p_kiosco, p_cliente, p_canal, coalesce(p_monto, 0), array[p_medio], v_items, p_cuando);
  return jsonb_build_object('total', coalesce((select sum((e->>'cantidad')::int) from jsonb_array_elements(v_filas) e), 0), 'detalle', v_filas);
end $$;

-- Resumen del programa para el panel.
create or replace function public.fidelidad_resumen(p_kiosco uuid, p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 365));
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  return jsonb_build_object(
    'sellos_dados', (select coalesce(sum(cantidad), 0) from public.sellos where kiosco_id = p_kiosco and not anulado and cantidad > 0 and created_at >= v_desde),
    'canjes', (select count(*) from public.canjes where kiosco_id = p_kiosco and not anulado and created_at >= v_desde),
    'clientes_con_saldo', (select count(*) from public.clientes_sellos where kiosco_id = p_kiosco and sellos_disponibles > 0),
    'sellos_en_circulacion', (select coalesce(sum(sellos_disponibles), 0) from public.clientes_sellos where kiosco_id = p_kiosco),
    'por_campana', (select coalesce(jsonb_agg(jsonb_build_object('nombre', n, 'sellos', t) order by t desc), '[]'::jsonb) from (
        select coalesce(f.nombre, 'Sin campaña') as n, sum(s.cantidad) as t from public.sellos s left join public.fidelidad_campanas f on f.id = s.campana_id
        where s.kiosco_id = p_kiosco and not s.anulado and s.cantidad > 0 and s.created_at >= v_desde group by 1) q),
    'por_premio', (select coalesce(jsonb_agg(jsonb_build_object('nombre', n, 'canjes', t) order by t desc), '[]'::jsonb) from (
        select coalesce(premio_nombre, 'Premio') as n, count(*) as t from public.canjes where kiosco_id = p_kiosco and not anulado and created_at >= v_desde group by 1) q),
    'top_clientes', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'sellos', sellos_disponibles) order by sellos_disponibles desc), '[]'::jsonb) from (
        select nombre, sellos_disponibles from public.clientes_sellos where kiosco_id = p_kiosco and sellos_disponibles > 0 order by sellos_disponibles desc limit 5) q)
  );
end $$;

-- 8) Resumen semanal: ahora suma cantidades y no cuenta canjes anulados
create or replace function public.resumen_semana(p_kiosco uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_desde timestamptz := now() - interval '7 days'; r jsonb;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select jsonb_build_object(
    'pedidos', (select count(*) from public.pedidos where kiosco_id = p_kiosco and created_at >= v_desde and estado <> 'cancelado'),
    'monto_pedidos', (select coalesce(sum(total), 0) from public.pedidos where kiosco_id = p_kiosco and created_at >= v_desde and estado <> 'cancelado'),
    'fiado_pendiente', (select coalesce(sum(saldo), 0) from public.clientes_saldo where kiosco_id = p_kiosco and saldo > 0),
    'deudores', (select count(*) from public.clientes_saldo where kiosco_id = p_kiosco and saldo > 0),
    'sellos_semana', (select coalesce(sum(cantidad), 0) from public.sellos where kiosco_id = p_kiosco and not anulado and cantidad > 0 and created_at >= v_desde),
    'premios_semana', (select count(*) from public.canjes where kiosco_id = p_kiosco and not anulado and created_at >= v_desde),
    'ultimo_ajuste', (select max(created_at) from public.ajustes_precios where kiosco_id = p_kiosco and revertido_at is null),
    'productos', (select count(*) from public.productos where kiosco_id = p_kiosco)
  ) into r;
  return r;
end $$;

-- 9) Kioscos existentes y nuevos arrancan con una campaña y un premio equivalentes al sello anterior.
insert into public.fidelidad_campanas (kiosco_id, nombre, tipo, sellos, canales)
  select id, 'Por pedido entregado', 'visita', 1, '{pedido}' from public.kioscos;
insert into public.fidelidad_premios (kiosco_id, nombre, costo_sellos, tipo)
  select id, premio, sellos_por_premio, 'libre' from public.kioscos;

create or replace function public.fidelidad_inicial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.fidelidad_campanas (kiosco_id, nombre, tipo, sellos) values (new.id, 'Por cada compra', 'visita', 1);
  insert into public.fidelidad_premios (kiosco_id, nombre, costo_sellos, tipo) values (new.id, new.premio, new.sellos_por_premio, 'libre');
  return new;
end $$;
create trigger trg_fidelidad_inicial after insert on public.kioscos for each row execute function public.fidelidad_inicial();

-- 10) Permisos: campañas y premios los edita el dueño directo (los checks están en la tabla); los sellos y canjes solo por funciones.
alter table public.fidelidad_campanas enable row level security;
alter table public.fidelidad_premios enable row level security;
create policy fidelidad_campanas_dueno on public.fidelidad_campanas for all to authenticated using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
create policy fidelidad_premios_dueno on public.fidelidad_premios for all to authenticated using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
revoke all on public.fidelidad_campanas, public.fidelidad_premios from anon, authenticated;
grant select, insert, update, delete on public.fidelidad_campanas, public.fidelidad_premios to authenticated;
revoke insert, update, delete on public.sellos from authenticated, anon;

revoke all on function public.fidelidad_aplica(public.fidelidad_campanas, text, numeric, text[], date, int, time) from public, anon, authenticated;
revoke all on function public.fidelidad_calcular(uuid, uuid, text, numeric, text[], jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fidelidad_otorgar(uuid, uuid, text, numeric, text[], jsonb, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fidelidad_dar_sellos(uuid, uuid, int, text) from public, anon;
revoke all on function public.fidelidad_anular_sello(uuid, boolean) from public, anon;
revoke all on function public.fidelidad_canjear(uuid, uuid, uuid) from public, anon;
revoke all on function public.fidelidad_anular_canje(uuid) from public, anon;
revoke all on function public.fidelidad_simular(uuid, numeric, text, text, timestamptz, uuid, uuid, int) from public, anon;
revoke all on function public.fidelidad_resumen(uuid, int) from public, anon;
grant execute on function public.fidelidad_dar_sellos(uuid, uuid, int, text) to authenticated;
grant execute on function public.fidelidad_anular_sello(uuid, boolean) to authenticated;
grant execute on function public.fidelidad_canjear(uuid, uuid, uuid) to authenticated;
grant execute on function public.fidelidad_anular_canje(uuid) to authenticated;
grant execute on function public.fidelidad_simular(uuid, numeric, text, text, timestamptz, uuid, uuid, int) to authenticated;
grant execute on function public.fidelidad_resumen(uuid, int) to authenticated;
