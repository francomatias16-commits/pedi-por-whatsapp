-- Datos de demo FICTICIOS para el primer kiosco de la base (el más viejo).
-- Pegar en el SQL Editor de Supabase. No hace nada si el kiosco ya tiene más de 5 productos.
-- Carga: 3 proveedores, 12 productos (con stock, mínimo, objetivo, días y proveedor), 6 clientes,
-- ventas de los últimos 60 días, fiado pendiente, un turno de caja y, si la 0025 está aplicada,
-- lotes con vencimiento y reglas de aviso.
do $$
declare
  k uuid; owner uuid; t uuid; v uuid; p uuid; c uuid;
  prov_a uuid; prov_b uuid; prov_c uuid;
  cl_pedro uuid; cl_rosa uuid; cl_julian uuid; cl_ana uuid; cl_luis uuid; cl_marta uuid;
  i int; total numeric;
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  select id, owner_id into k, owner from public.kioscos order by created_at limit 1;
  if k is null then raise exception 'Primero creá tu kiosco desde el panel.'; end if;
  if (select count(*) from public.productos where kiosco_id = k) > 5 then
    raise notice 'El kiosco ya tiene productos: no se carga el demo.';
    return;
  end if;

  -- Proveedores
  insert into public.proveedores (kiosco_id, nombre, telefono) values (k, 'Distribuidora Demo Norte', '5493415550101') returning id into prov_a;
  insert into public.proveedores (kiosco_id, nombre, telefono) values (k, 'Bebidas Demo Sur', '5493415550102') returning id into prov_b;
  insert into public.proveedores (kiosco_id, nombre, telefono) values (k, 'Panificadora Demo', '5493415550103') returning id into prov_c;

  -- Productos: nombre, precio, categoría, stock, mínimo, objetivo, días de entrega, proveedor
  insert into public.productos (kiosco_id, nombre, precio, categoria, stock_controlado, stock, stock_minimo, stock_objetivo, lead_time_dias, proveedor_id) values
    (k, 'Coca-Cola 500 ml', 1500, 'Bebidas', true, 4, 6, 24, 2, prov_b),
    (k, 'Agua mineral 500 ml', 900, 'Bebidas', true, 30, 10, 30, 2, prov_b),
    (k, 'Cerveza lata 473 ml', 1800, 'Bebidas', true, 0, 12, 36, 3, prov_b),
    (k, 'Alfajor triple', 1200, 'Golosinas', true, 18, 8, 30, 4, prov_a),
    (k, 'Chocolate 100 g', 2100, 'Golosinas', true, 9, 5, 20, 4, prov_a),
    (k, 'Galletitas de agua', 1100, 'Almacén', true, 14, 6, 24, 3, prov_a),
    (k, 'Yerba 1 kg', 4200, 'Almacén', true, 5, 4, 15, 5, prov_a),
    (k, 'Pan lactal', 2600, 'Panadería', true, 2, 3, 10, 1, prov_c),
    (k, 'Medialunas x6', 3000, 'Panadería', true, 12, 6, 24, 1, prov_c),
    (k, 'Leche 1 L', 1500, 'Lácteos', true, 20, 8, 30, 2, prov_a),
    (k, 'Papas fritas 150 g', 1900, 'Snacks', true, 7, 5, 18, 3, prov_a),
    (k, 'Bolsa de hielo 3 kg', 2200, 'Varios', false, 0, 0, null, 1, null);

  -- Clientes ficticios (teléfonos de prueba)
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Pedro Sosa', '5493415550201') returning id into cl_pedro;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Rosa Benitez', '5493415550202') returning id into cl_rosa;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Julian Torres', '5493415550203') returning id into cl_julian;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Ana Gomez', '5493415550204') returning id into cl_ana;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Luis Ferreyra', '5493415550205') returning id into cl_luis;
  insert into public.clientes (kiosco_id, nombre, telefono) values (k, 'Marta Quiroga', '5493415550206') returning id into cl_marta;

  -- Turno de caja abierto (fondo ficticio)
  -- Un solo turno abierto por kiosco: si ya hay uno, se usa ese.
  select id into t from public.turnos_caja where kiosco_id = k and estado = 'abierto';
  if t is null then
    insert into public.turnos_caja (kiosco_id, abierto_por, monto_inicial) values (k, owner, 1000) returning id into t;
  end if;

  -- Ventas de los últimos 60 días. Pedro compró 3 veces hace 61 a 63 días y no volvió (cliente en fuga).
  -- Ana, Julián y Marta compran seguido hasta hace poco. Luis y Rosa compran de a ratos.
  for i in 1 .. 60 loop
    if i % 3 = 0 or i % 7 = 0 then
      total := 1500 + (i % 5) * 300;
      c := case when i % 2 = 0 then cl_ana when i % 5 = 0 then cl_luis else null end;
      if i >= 45 and i % 4 = 0 then c := cl_julian; end if;
      if i >= 45 and i % 6 = 0 then c := cl_marta; end if;
      if i >= 15 and i % 6 = 0 then c := cl_rosa; end if;
      if i in (50, 53, 58) then c := cl_pedro; end if;
      v := gen_random_uuid();
      insert into public.ventas_mostrador (id, kiosco_id, turno_id, total, cliente_id, usuario_id, created_at)
        values (v, k, t, total, c, owner, ((((hoy - i)::timestamp) + interval '12 hours') at time zone 'America/Argentina/Buenos_Aires'));
      insert into public.ventas_mostrador_pagos (venta_id, medio, monto) values (v, 'efectivo', total);
    end if;
  end loop;
  -- Pedro: 3 compras de hace 61 a 63 días, para que sea cliente en fuga
  for i in 1 .. 3 loop
    v := gen_random_uuid();
    insert into public.ventas_mostrador (id, kiosco_id, turno_id, total, cliente_id, usuario_id, created_at)
      values (v, k, t, 2400, cl_pedro, owner, ((((hoy - 60 - i)::timestamp) + interval '10 hours') at time zone 'America/Argentina/Buenos_Aires'));
    insert into public.ventas_mostrador_pagos (venta_id, medio, monto) values (v, 'efectivo', 2400);
  end loop;

  -- Fiado pendiente
  insert into public.fiado_movimientos (kiosco_id, cliente_id, tipo, monto, nota) values
    (k, cl_rosa, 'fiado', 3200, 'Demo: compra de la semana'),
    (k, cl_rosa, 'pago', 1000, 'Demo: pago parcial'),
    (k, cl_luis, 'fiado', 1800, 'Demo: fiado sin pagar');

  -- Lotes y reglas solo si la 0025 está aplicada
  if to_regclass('public.lotes_stock') is not null then
    insert into public.lotes_stock (kiosco_id, producto_id, cantidad, vence)
      select k, p.id, 4, hoy + 3 from public.productos p where p.kiosco_id = k and p.nombre = 'Pan lactal';
    insert into public.lotes_stock (kiosco_id, producto_id, cantidad, vence)
      select k, p.id, 12, hoy + 40 from public.productos p where p.kiosco_id = k and p.nombre = 'Yerba 1 kg';
    insert into public.avisos_reglas (kiosco_id, tipo, umbral) values
      (k, 'venta_supera', 15000),
      (k, 'fiado_supera', 3000),
      (k, 'stock_bajo_de', 5);
  end if;

  raise notice 'Demo cargada en el kiosco %', k;
end $$;
