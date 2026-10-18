# Verifica 0018 (reposición de stock). Uso: python3 supabase/tests/etapa15_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa15_" + uuid.uuid4().hex[:8]
    _admin.cursor().execute(f'create database "{_db}"')
    conn = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname=_db)
else:
    import pgserver
    conn = psycopg2.connect(pgserver.get_server(tempfile.mkdtemp()).get_uri())
conn.autocommit = True
cur = conn.cursor()
cur.execute("""
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion"]:
    cur.execute(open(f"supabase/migrations/{m}.sql").read())
A, B = str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("insert into auth.users values (%s),(%s)", (A, B))
cur.execute("begin")

def as_(role, sub=None):
    cur.execute("reset role"); cur.execute(f"set role {role}")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (sub or '',))
def fails(sql, args=None):
    cur.execute("savepoint s")
    try: cur.execute(sql, args); cur.execute("release savepoint s"); return False
    except Exception as e: cur.execute("rollback to savepoint s"); return str(e).split("\n")[0]
bad = 0
def ok(c, m):
    global bad; bad += (not c); print(("PASS " if c else "FAIL ") + m)
def one(sql, args=None): cur.execute(sql, args); return cur.fetchone()[0]
def root(sql, args=None):
    cur.execute("reset role"); cur.execute(sql, args); return cur.fetchone()[0] if cur.description else None
def rows(sql, args=None):
    cur.execute(sql, args); cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
def has(err, texto): return texto in (err or "")

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)

def prod(nombre, precio, controlado=True, stock=0, minimo=0, peso=False):
    return one("insert into productos(kiosco_id,nombre,precio,stock_controlado,stock,stock_minimo,vendido_por_peso) values (%s,%s,%s,%s,%s,%s,%s) returning id",
               (ka, nombre, precio, controlado, stock, minimo, peso))
coca = prod("Coca 500", 1000, stock=40)
pan = prod("Pan", 500, stock=3)
galle = prod("Galletitas", 800, stock=15, minimo=20)
agot = prod("Agotado con mínimo", 300, stock=0, minimo=5)
muerto = prod("Producto sin movimiento", 300, stock=0)
queso = prod("Queso", 8000, stock=2000, minimo=3000, peso=True)
sano = prod("Gaseosa con stock", 900, stock=100, minimo=5)
libre = prod("Alfajor suelto", 500, controlado=False)
stock = lambda p: one("select stock from productos where id=%s", (p,))

# El historial de ventas se mira contra productos "viejos": ventana completa de 30 días.
root("update productos set created_at = now() - interval '40 days' where kiosco_id=%s", (ka,))
as_("authenticated", A)

# ── Datos nuevos por producto ──
ok(bool(fails("update productos set stock_minimo=-1 where id=%s", (coca,))), "stock mínimo negativo se rechaza")
ok(bool(fails("update productos set stock_objetivo=-1 where id=%s", (coca,))), "stock objetivo negativo se rechaza")
ok(bool(fails("update productos set lead_time_dias=61 where id=%s", (coca,))), "días de entrega fuera de 0..60 se rechazan")
ok(one("select lead_time_dias from productos where id=%s", (coca,)) == 3, "días de entrega por defecto: 3")

pv = one("select (proveedor_guardar(%s, null, 'Distribuidora Sur', '3415550000', null, null))->>'id'", (ka,))
one("update productos set proveedor_id=%s where id=%s returning id", (pv, galle))
ok(str(one("select proveedor_id from productos where id=%s", (galle,))) == str(pv), "se asigna el proveedor habitual")
as_("authenticated", B)
pvb = one("select (proveedor_guardar(%s, null, 'Proveedor de B'))->>'id'", (kb,))
as_("authenticated", A)
ok(has(fails("update productos set proveedor_id=%s where id=%s", (pvb, coca)), "proveedor_no_encontrado"), "no se puede usar el proveedor de otro kiosco")
as_("anon")
ok(bool(fails("select stock_minimo from productos limit 1")), "anon no ve el stock mínimo")
ok(bool(fails("select proveedor_id from productos limit 1")), "anon no ve el proveedor del producto")
as_("authenticated", A)
# Si se borra el proveedor, el producto queda sin proveedor (no se borra).
tmp = root("insert into proveedores(kiosco_id,nombre) values (%s,'Temporal') returning id", (ka,))
root("update productos set proveedor_id=%s where id=%s", (tmp, agot))
root("delete from proveedores where id=%s", (tmp,))
ok(root("select proveedor_id from productos where id=%s", (agot,)) is None and root("select count(*) from productos where id=%s", (agot,)) == 1, "al borrar un proveedor el producto queda sin proveedor")
as_("authenticated", A)

# ── Ventana de días ──
ok(root("select reposicion_dias_ventana(now())") == 1, "producto de hoy: ventana de 1 día")
ok(root("select reposicion_dias_ventana(now() - interval '3 days')") == 3, "producto de 3 días: ventana de 3 días")
ok(root("select reposicion_dias_ventana(now() - interval '90 days')") == 30, "producto viejo: ventana tope de 30 días")
as_("authenticated", A)

# ── Ventas: mostrador (30), anulada (no cuenta), devolución (resta) y pedidos ──
t = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))
def vender(pid, cant, precio):
    return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0)", (t, json.dumps([{"producto_id": pid, "cantidad": cant}]), json.dumps([{"medio": "efectivo", "monto": precio * cant}])))
v1 = vender(coca, 30, 1000)
ok(stock(coca) == 10, "venta de 30 Coca: stock 10")
v2 = vender(coca, 5, 1000)
one("select anular_venta_mostrador(%s, 'Error de carga')", (v2["venta_id"],))
ok(stock(coca) == 10, "la venta anulada devuelve el stock")
# Pedidos de la tienda (entregados) de Pan: 30 unidades; uno cancelado de 100 no cuenta.
root("""with p as (insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total,estado,created_at)
         values (%s,'Ana','5493415550001','retiro',15000,'entregado', now() - interval '5 days') returning id)
        insert into pedido_items(pedido_id,producto_id,nombre,precio_unit,cantidad) select id,%s,'Pan',500,30 from p""", (ka, pan))
root("""with p as (insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total,estado,created_at)
         values (%s,'Ana','5493415550001','retiro',50000,'cancelado', now() - interval '5 days') returning id)
        insert into pedido_items(pedido_id,producto_id,nombre,precio_unit,cantidad) select id,%s,'Pan',500,100 from p""", (ka, pan))
as_("authenticated", A)

def filas():
    return {str(r["producto_id"]): {k: (float(v) if hasattr(v, "as_tuple") else v) for k, v in r.items()} for r in rows("select * from reposicion_sugerida(%s)", (ka,))}
f = filas()
ok(root("select unidades from reposicion_ventas_30d(%s) where producto_id=%s", (ka, coca)) == 30, "ventas de Coca en 30 días: 30 (la anulada no cuenta)")
ok(f[str(pan)]["velocidad_dia"] == 1.0, "velocidad de Pan: cuenta pedidos entregados y no los cancelados")

# Devolución de 6 Coca: resta de la velocidad (24 / 30 = 0,8) y repone stock.
iid = one("select id from ventas_mostrador_items where venta_id=%s", (v1["venta_id"],))
one("select devolver_venta_mostrador(%s, %s::jsonb, 'efectivo', 'Envase dañado', null)", (v1["venta_id"], json.dumps([{"item_id": iid, "cantidad": 6}])))
ok(stock(coca) == 16, "la devolución repone 6 (10 → 16)")
one("select ajustar_stock(%s, 2, 'Conteo de góndola')", (coca,))
f = filas()
ok(f[str(coca)]["velocidad_dia"] == 0.8, "la devolución resta de la velocidad (24 en 30 días = 0,8)")

# ── Qué hay que reponer ──
c = f[str(coca)]
ok(c["estado"] == "critico" and c["dias_restantes"] == 2.5 and c["cantidad_sugerida"] == 25, "Coca: crítica, 2,5 días, sugiere 25 (30 días de venta 24 + 3 de entrega − 2 que hay)")
p = f[str(pan)]
ok(p["estado"] == "bajo" and p["dias_restantes"] == 3.0 and p["cantidad_sugerida"] == 30, "Pan: bajo, 3 días, sugiere 30")
g = f[str(galle)]
ok(g["estado"] == "bajo" and g["dias_restantes"] is None and g["cantidad_sugerida"] == 25, "Galletitas: bajo el mínimo sin ventas, sugiere 25 (objetivo = 2 × mínimo)")
ok(g["proveedor_nombre"] == "Distribuidora Sur" and g["proveedor_telefono"] == "3415550000", "Galletitas trae su proveedor y teléfono")
a = f[str(agot)]
ok(a["estado"] == "agotado" and not a["sin_datos"] and a["cantidad_sugerida"] == 10, "Agotado con mínimo 5: agotado, sugiere 10")
m = f[str(muerto)]
ok(m["estado"] == "agotado" and m["sin_datos"] and m["cantidad_sugerida"] == 0, "Sin ventas ni mínimo: se lista como 'sin datos' y no inventa cantidad")
q = f[str(queso)]
ok(q["por_peso"] and q["estado"] == "bajo" and q["cantidad_sugerida"] == 4000, "Queso por peso en gramos: sugiere 4000 g")
ok(str(sano) not in f, "con stock sobre el mínimo no se lista")
ok(str(libre) not in f, "un producto sin control de stock no se lista")
orden = [str(r["producto_id"]) for r in rows("select * from reposicion_sugerida(%s)", (ka,))]
ok(set(orden[:2]) == {str(agot), str(muerto)} and orden[2] == str(coca), "orden: primero agotados, después críticos")

# ── Resumen ──
root("update productos set costo=700 where id=%s", (coca,))
root("update productos set costo=6000 where id=%s", (queso,))
as_("authenticated", A)
r = one("select reposicion_resumen(%s)", (ka,))
ok(r["agotados"] == 1 and r["bajos"] == 4 and r["sin_proveedor"] == 4 and r["sin_datos"] == 1, "resumen: 1 agotado, 4 bajos, 4 sin proveedor, 1 sin datos")
ok(float(r["plata_en_stock"]) == 2 * 700 + 2000 * 6000 / 1000, "plata en stock: 2 × 700 + 2 kg × 6000 = 13400")

# ── Mínimos iniciales ──
n = one("select reposicion_minimos_iniciales(%s)", (ka,))
ok(n["actualizados"] == 2, "mínimos iniciales: solo los que estaban en 0 y tienen ventas (Coca y Pan)")
ok(one("select stock_minimo from productos where id=%s", (coca,)) == 4 and one("select stock_minimo from productos where id=%s", (pan,)) == 5, "mínimo = venta diaria × (entrega + 2 días): Coca 4, Pan 5")
ok(one("select stock_minimo from productos where id=%s", (galle,)) == 20, "no pisa un mínimo ya cargado")
ok(one("select reposicion_minimos_iniciales(%s)", (ka,))["actualizados"] == 0, "segunda vez no cambia nada")

# ── Permisos ──
as_("authenticated", B)
for sql in ["select * from reposicion_sugerida(%s)", "select reposicion_resumen(%s)", "select reposicion_minimos_iniciales(%s)"]:
    ok(has(fails(sql, (ka,)), "no_autorizado"), f"otro dueño no puede: {sql.split('(')[0].replace('select ', '').replace('* from ', '')}")
ok(has(fails("select sumar_stock_rapido(%s, 5)", (coca,)), "no_autorizado"), "otro dueño no puede cargar stock en mi kiosco")
ok(one("select count(*) from reposicion_sugerida(%s)", (kb,)) == 0, "mi propio kiosco sin productos: nada para reponer")
as_("authenticated", A)
for sql in ["select * from reposicion_calcular(%s)", "select * from reposicion_ventas_30d(%s)"]:
    ok(bool(fails(sql, (ka,))), f"el dueño no llama directo a {sql.split('from ')[1].split('(')[0]}")
ok(bool(fails("select * from reposicion_avisos_diarios()")), "el dueño no ejecuta el aviso del cron")
ok(bool(fails("select count(*) from avisos_stock_diarios")), "el dueño no lee la tabla de avisos")
as_("anon")
ok(bool(fails("select * from reposicion_sugerida(%s)", (ka,))), "anon no ejecuta reposicion_sugerida")
ok(bool(fails("select sumar_stock_rapido(%s, 5)", (coca,))), "anon no ejecuta sumar_stock_rapido")
ok(bool(fails("select * from reposicion_avisos_diarios()")), "anon no ejecuta el aviso del cron")

# ── Aviso diario (lo corre el cron con la service role; acá, como administrador) ──
def cron():
    root("select 1"); return rows("select * from reposicion_avisos_diarios()")
r1 = [x for x in cron() if str(x["kiosco"]) == ka]
ok(len(r1) == 1 and r1[0]["n_agotados"] == 1 and r1[0]["n_bajos"] == 4 and r1[0]["n_sin_proveedor"] == 4, "primer aviso: 1 agotado, 4 bajos, 4 sin proveedor (sin contar 'sin datos')")
ok(not any(str(x["kiosco"]) == kb for x in rows("select * from reposicion_avisos_diarios()")), "el kiosco sin nada para reponer no recibe aviso")
ok(cron() == [], "el mismo día no se repite aunque el cron corra dos veces")
root("update avisos_stock_diarios set dia = dia - 1 where kiosco_id=%s", (ka,))
ok([x for x in cron() if str(x["kiosco"]) == ka] == [], "al día siguiente, si no cambió nada, no se avisa de nuevo")
root("delete from avisos_stock_diarios where kiosco_id=%s and dia = (select max(dia) from avisos_stock_diarios where kiosco_id=%s)", (ka, ka))
root("update productos set stock=500 where id=%s", (agot,))
r4 = [x for x in cron() if str(x["kiosco"]) == ka]
ok(len(r4) == 1 and r4[0]["n_agotados"] == 0 and r4[0]["n_bajos"] == 4, "si cambia lo que hay que reponer, se avisa")
root("delete from avisos_stock_diarios where kiosco_id=%s", (ka,))
ok(len([x for x in cron() if str(x["kiosco"]) == ka]) == 1, "sin aviso previo, se avisa")
root("update avisos_stock_diarios set dia = dia - 8 where kiosco_id=%s", (ka,))
ok(len([x for x in cron() if str(x["kiosco"]) == ka]) == 1, "si el problema sigue pasados 7 días, se avisa de nuevo")
root("update productos set stock=0 where id=%s", (agot,))
as_("authenticated", A)

# ── Cargar stock desde la caja ──
antes = stock(coca)
s = one("select sumar_stock_rapido(%s, 5)", (coca,))
ok(s["stock"] == antes + 5 and stock(coca) == antes + 5, "carga rápida suma al stock actual")
mov = rows("select tipo, cantidad, stock_resultante, motivo from stock_movimientos where producto_id=%s order by created_at desc limit 1", (coca,))[0]
ok(mov["tipo"] == "ajuste" and mov["cantidad"] == 5 and mov["stock_resultante"] == antes + 5 and "Carga rápida" in mov["motivo"], "queda registrada en el historial de stock")
root("update productos set disponible=false where id=%s", (agot,))
as_("authenticated", A)
one("select sumar_stock_rapido(%s, 3)", (agot,))
ok(one("select disponible from productos where id=%s", (agot,)) is True, "al cargar mercadería el producto vuelve a estar disponible")
ok(has(fails("select sumar_stock_rapido(%s, 0)", (coca,)), "cantidad_invalida"), "cantidad 0 se rechaza")
ok(has(fails("select sumar_stock_rapido(%s, 10000000)", (coca,)), "cantidad_invalida"), "cantidad enorme se rechaza")
ok(has(fails("select sumar_stock_rapido(%s, 1)", (libre,)), "stock_no_controlado"), "un producto sin control de stock no se carga")
# Con PIN de supervisor configurado, pide el token (de un solo uso).
one("select pos_pin_definir(%s, '1234')", (ka,))
ok(has(fails("select sumar_stock_rapido(%s, 1)", (coca,)), "pin_requerido"), "con PIN configurado, sin token se rechaza")
tok = one("select pos_pin_verificar(%s, '1234')->>'token'", (ka,))
ok(one("select (sumar_stock_rapido(%s, 1, %s))->>'stock'", (coca, tok)) is not None, "con el token del PIN se carga")
ok(has(fails("select sumar_stock_rapido(%s, 1, %s)", (coca, tok)), "pin_requerido"), "el token no se puede reusar")

# ── Producto nuevo: la venta de pocos días no se diluye en 30 ──
nuevo = prod("Producto de hoy", 100, stock=10)
vender(nuevo, 5, 100)
fn = filas()[str(nuevo)]
ok(fn["velocidad_dia"] == 5.0 and fn["estado"] == "critico", "producto de hoy con 5 ventas: 5 por día (no 5/30)")

print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
