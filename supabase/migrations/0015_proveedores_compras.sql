-- Etapa 9 · Proveedores, compras (ingreso de mercadería) y movimientos de stock.
-- Portado de la lógica de distrib (proveedores / compras / cc-proveedores / stock) y simplificado para un kiosco:
--  * Proveedores con cuenta corriente (compras suman deuda, pagos la restan), igual que la libreta de fiado de clientes.
--  * Una compra suma stock a los productos con stock controlado, guarda el último costo y puede pagarse en el acto o quedar a cuenta.
--  * Anular una compra repone todo; si ya se vendió parte de esa mercadería (stock insuficiente) no se deja anular.
--  * Historial de movimientos de stock de lo que pasa por acá (compras, anulaciones y ajustes manuales).
-- Todo se escribe por funciones (security definer); el cliente solo lee. Aplicar DESPUÉS de 0001..0014.

-- 1) Último costo de compra del producto (no se expone en la tienda pública: anon solo ve las columnas del grant de 0009).
alter table public.productos add column costo numeric(12,2) check (costo is null or costo >= 0);

-- 2) Proveedores
create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 80),
  telefono text check (telefono is null or length(telefono) <= 30),
  cuit text check (cuit is null or length(cuit) <= 20),
  notas text check (notas is null or length(notas) <= 300),
  activo boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (kiosco_id, id)
);
create unique index proveedores_nombre_uq on public.proveedores (kiosco_id, lower(trim(nombre)));

-- 3) Compras
create table public.compras (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  proveedor_id uuid not null,
  numero bigint generated always as identity,
  total numeric(12,2) not null check (total > 0),
  pagado numeric(12,2) not null default 0 check (pagado >= 0),
  comprobante text check (comprobante is null or length(comprobante) <= 40),
  nota text check (nota is null or length(nota) <= 200),
  anulada boolean not null default false,
  anulada_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (kiosco_id, proveedor_id) references public.proveedores(kiosco_id, id) on delete cascade,
  check (pagado <= total)
);
create index on public.compras (kiosco_id, created_at desc);
create index on public.compras (proveedor_id, created_at desc);
create table public.compra_items (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  nombre text not null,
  cantidad int not null check (cantidad >= 1),
  costo_unit numeric(12,2) not null check (costo_unit >= 0),
  sumo_stock boolean not null default false
);
create index on public.compra_items (compra_id);

-- 4) Cuenta corriente del proveedor (lo que le debés)
create type public.tipo_cc_proveedor as enum ('compra', 'pago');
create table public.proveedor_movimientos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null,
  proveedor_id uuid not null,
  tipo public.tipo_cc_proveedor not null,
  monto numeric(12,2) not null check (monto > 0),
  medio text check (medio is null or medio in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'otro')),
  nota text check (nota is null or length(nota) <= 200),
  compra_id uuid references public.compras(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (kiosco_id, proveedor_id) references public.proveedores(kiosco_id, id) on delete cascade
);
create index on public.proveedor_movimientos (proveedor_id, created_at desc);

create view public.proveedores_saldo with (security_invoker = true) as
select p.id, p.kiosco_id, p.nombre, p.telefono, p.cuit, p.notas, p.activo,
  coalesce(sum(case m.tipo when 'compra' then m.monto else -m.monto end), 0)::numeric(12,2) as saldo,
  max(m.created_at) as ultimo_movimiento
from public.proveedores p left join public.proveedor_movimientos m on m.proveedor_id = p.id
group by p.id;

-- 5) Movimientos de stock
create table public.stock_movimientos (
  id uuid primary key default gen_random_uuid(),
  kiosco_id uuid not null references public.kioscos(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  tipo text not null check (tipo in ('compra', 'anulacion_compra', 'ajuste')),
  cantidad int not null check (cantidad <> 0),
  stock_resultante int not null,
  motivo text check (motivo is null or length(motivo) <= 200),
  compra_id uuid references public.compras(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.stock_movimientos (kiosco_id, created_at desc);
create index on public.stock_movimientos (producto_id, created_at desc);

-- 6) RLS: el dueño lee; nadie escribe directo.
alter table public.proveedores enable row level security;
alter table public.compras enable row level security;
alter table public.compra_items enable row level security;
alter table public.proveedor_movimientos enable row level security;
alter table public.stock_movimientos enable row level security;
create policy proveedores_dueno on public.proveedores for select to authenticated using (public.es_dueno(kiosco_id));
create policy compras_dueno on public.compras for select to authenticated using (public.es_dueno(kiosco_id));
create policy compra_items_dueno on public.compra_items for select to authenticated
  using (exists (select 1 from public.compras c where c.id = compra_id and public.es_dueno(c.kiosco_id)));
create policy prov_mov_dueno on public.proveedor_movimientos for select to authenticated using (public.es_dueno(kiosco_id));
create policy stock_mov_dueno on public.stock_movimientos for select to authenticated using (public.es_dueno(kiosco_id));
revoke all on public.proveedores, public.compras, public.compra_items, public.proveedor_movimientos, public.stock_movimientos
  from anon, authenticated;
grant select on public.proveedores, public.compras, public.compra_items, public.proveedor_movimientos, public.stock_movimientos
  to authenticated;
revoke all on public.proveedores_saldo from anon, authenticated;
grant select on public.proveedores_saldo to authenticated;

-- 7) Alta / edición de proveedor
create or replace function public.proveedor_guardar(
  p_kiosco uuid, p_id uuid, p_nombre text, p_telefono text default null, p_cuit text default null,
  p_notas text default null, p_activo boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_nombre text := trim(coalesce(p_nombre, ''));
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if length(v_nombre) < 1 or length(v_nombre) > 80 then raise exception 'nombre_invalido'; end if;
  if p_id is null then
    insert into public.proveedores (kiosco_id, nombre, telefono, cuit, notas, activo)
      values (p_kiosco, v_nombre, nullif(trim(p_telefono), ''), nullif(trim(p_cuit), ''), nullif(trim(p_notas), ''), coalesce(p_activo, true))
      returning id into v_id;
  else
    update public.proveedores
       set nombre = v_nombre, telefono = nullif(trim(p_telefono), ''), cuit = nullif(trim(p_cuit), ''),
           notas = nullif(trim(p_notas), ''), activo = coalesce(p_activo, true)
     where id = p_id and kiosco_id = p_kiosco returning id into v_id;
    if v_id is null then raise exception 'proveedor_no_encontrado'; end if;
  end if;
  return jsonb_build_object('id', v_id);
exception when unique_violation then raise exception 'proveedor_duplicado';
end $$;

-- 8) Registrar compra: suma stock, guarda costo, deja la deuda en la cuenta del proveedor.
create or replace function public.registrar_compra(
  p_kiosco uuid, p_proveedor uuid, p_items jsonb, p_pagado numeric default 0, p_medio text default 'efectivo',
  p_comprobante text default null, p_nota text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prov public.proveedores%rowtype; v_prod public.productos%rowtype; v_x jsonb;
  v_cant int; v_costo numeric(12,2); v_total numeric(12,2) := 0; v_pagado numeric(12,2);
  v_compra uuid; v_numero bigint; v_suma boolean; v_nuevo int;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  select * into v_prov from public.proveedores where id = p_proveedor and kiosco_id = p_kiosco;
  if not found then raise exception 'proveedor_no_encontrado'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'items_invalidos';
  end if;
  v_pagado := round(coalesce(p_pagado, 0), 2);
  if v_pagado < 0 then raise exception 'monto_invalido'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'otro') then
    raise exception 'medio_pago_invalido';
  end if;

  insert into public.compras (kiosco_id, proveedor_id, total, comprobante, nota)
    values (p_kiosco, p_proveedor, 0.01, left(nullif(trim(p_comprobante), ''), 40), left(nullif(trim(p_nota), ''), 200))
    returning id, numero into v_compra, v_numero;

  for v_x in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.productos where id = (v_x->>'producto_id')::uuid and kiosco_id = p_kiosco for update;
    if not found then raise exception 'producto_no_encontrado'; end if;
    v_cant := coalesce((v_x->>'cantidad')::int, 0);
    if v_cant < 1 or v_cant > 9999999 then raise exception 'cantidad_invalida'; end if;
    v_costo := round(coalesce((v_x->>'costo')::numeric, -1), 2);
    if v_costo < 0 then raise exception 'costo_invalido'; end if;
    -- Por peso la cantidad va en gramos y el costo es por kg; por unidad el costo es por unidad.
    v_total := v_total + case when v_prod.vendido_por_peso then round(v_costo * v_cant / 1000.0, 2) else round(v_costo * v_cant, 2) end;
    v_suma := v_prod.stock_controlado;
    insert into public.compra_items (compra_id, producto_id, nombre, cantidad, costo_unit, sumo_stock)
      values (v_compra, v_prod.id, v_prod.nombre, v_cant, v_costo, v_suma);
    if v_suma then
      update public.productos set stock = stock + v_cant, costo = v_costo,
             disponible = case when stock + v_cant > 0 then true else disponible end
       where id = v_prod.id returning stock into v_nuevo;
      insert into public.stock_movimientos (kiosco_id, producto_id, tipo, cantidad, stock_resultante, motivo, compra_id)
        values (p_kiosco, v_prod.id, 'compra', v_cant, v_nuevo, 'Compra #' || v_numero || ' · ' || v_prov.nombre, v_compra);
    else
      update public.productos set costo = v_costo where id = v_prod.id;
    end if;
  end loop;

  if v_total <= 0 then raise exception 'monto_invalido'; end if;
  if v_pagado > v_total then raise exception 'pago_excede_total'; end if;
  update public.compras set total = v_total, pagado = v_pagado where id = v_compra;
  insert into public.proveedor_movimientos (kiosco_id, proveedor_id, tipo, monto, nota, compra_id)
    values (p_kiosco, p_proveedor, 'compra', v_total, 'Compra #' || v_numero, v_compra);
  if v_pagado > 0 then
    insert into public.proveedor_movimientos (kiosco_id, proveedor_id, tipo, monto, medio, nota, compra_id)
      values (p_kiosco, p_proveedor, 'pago', v_pagado, p_medio, 'Pago de la compra #' || v_numero, v_compra);
  end if;
  return jsonb_build_object('compra_id', v_compra, 'numero', v_numero, 'total', v_total, 'pagado', v_pagado, 'debe', v_total - v_pagado);
end $$;

-- 9) Pago a un proveedor (baja la deuda)
create or replace function public.pagar_proveedor(p_kiosco uuid, p_proveedor uuid, p_monto numeric, p_medio text default 'efectivo', p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m numeric(12,2) := round(coalesce(p_monto, 0), 2);
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if not exists (select 1 from public.proveedores where id = p_proveedor and kiosco_id = p_kiosco) then raise exception 'proveedor_no_encontrado'; end if;
  if v_m <= 0 then raise exception 'monto_invalido'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'mercadopago', 'tarjeta', 'otro') then raise exception 'medio_pago_invalido'; end if;
  insert into public.proveedor_movimientos (kiosco_id, proveedor_id, tipo, monto, medio, nota)
    values (p_kiosco, p_proveedor, 'pago', v_m, p_medio, left(nullif(trim(p_nota), ''), 200));
  return jsonb_build_object('ok', true);
end $$;

-- 10) Anular compra: resta el stock que había sumado y borra su deuda.
create or replace function public.anular_compra(p_compra uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c public.compras%rowtype; it record; v_nuevo int;
begin
  select * into v_c from public.compras where id = p_compra for update;
  if not found or not public.es_dueno(v_c.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_c.anulada then raise exception 'ya_anulada'; end if;
  for it in select producto_id, cantidad from public.compra_items where compra_id = p_compra and sumo_stock and producto_id is not null loop
    update public.productos set stock = stock - it.cantidad where id = it.producto_id and stock >= it.cantidad returning stock into v_nuevo;
    if not found then raise exception 'stock_insuficiente'; end if;
    insert into public.stock_movimientos (kiosco_id, producto_id, tipo, cantidad, stock_resultante, motivo, compra_id)
      values (v_c.kiosco_id, it.producto_id, 'anulacion_compra', -it.cantidad, v_nuevo, 'Anulación compra #' || v_c.numero, p_compra);
  end loop;
  delete from public.proveedor_movimientos where compra_id = p_compra;
  update public.compras set anulada = true, anulada_at = clock_timestamp() where id = p_compra;
  return jsonb_build_object('ok', true);
end $$;

-- 11) Ajuste manual de stock (conteo, rotura, vencimiento): fija el stock y deja el motivo.
create or replace function public.ajustar_stock(p_producto uuid, p_nuevo int, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_p public.productos%rowtype; v_m text := left(trim(coalesce(p_motivo, '')), 200);
begin
  select * into v_p from public.productos where id = p_producto for update;
  if not found or not public.es_dueno(v_p.kiosco_id) then raise exception 'no_autorizado'; end if;
  if not v_p.stock_controlado then raise exception 'stock_no_controlado'; end if;
  if p_nuevo is null or p_nuevo < 0 or p_nuevo > 99999999 then raise exception 'cantidad_invalida'; end if;
  if length(v_m) < 3 then raise exception 'motivo_requerido'; end if;
  if p_nuevo = v_p.stock then raise exception 'sin_cambios'; end if;
  update public.productos set stock = p_nuevo, disponible = case when p_nuevo = 0 then false else disponible end where id = p_producto;
  insert into public.stock_movimientos (kiosco_id, producto_id, tipo, cantidad, stock_resultante, motivo)
    values (v_p.kiosco_id, p_producto, 'ajuste', p_nuevo - v_p.stock, p_nuevo, v_m);
  return jsonb_build_object('stock', p_nuevo);
end $$;

revoke all on function public.proveedor_guardar(uuid, uuid, text, text, text, text, boolean) from public, anon;
revoke all on function public.registrar_compra(uuid, uuid, jsonb, numeric, text, text, text) from public, anon;
revoke all on function public.pagar_proveedor(uuid, uuid, numeric, text, text) from public, anon;
revoke all on function public.anular_compra(uuid) from public, anon;
revoke all on function public.ajustar_stock(uuid, int, text) from public, anon;
grant execute on function public.proveedor_guardar(uuid, uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.registrar_compra(uuid, uuid, jsonb, numeric, text, text, text) to authenticated;
grant execute on function public.pagar_proveedor(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.anular_compra(uuid) to authenticated;
grant execute on function public.ajustar_stock(uuid, int, text) to authenticated;
