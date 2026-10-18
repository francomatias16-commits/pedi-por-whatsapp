# Verifica 0020 (historial completo de stock). Uso: python3 supabase/tests/etapa17_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa17_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock"]:
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

# Cada RPC es su propia transacción en Supabase; acá todo corre en una sola, así que se limpia la variable antes de cada operación manual.
def sin_tipo(): root("select set_config('app.mov_tipo', '', true)")
def movs(p): return rows("select tipo, cantidad, stock_resultante from stock_movimientos where producto_id=%s order by created_at, id", (p,))
init = {p: stock(p) for p in [coca, pan, galle, agot, muerto, queso, sano]}
ok(all(not movs(p) for p in init), "al cargar productos no se genera historial")

# ── Mostrador: venta, anulación y devolución ──
t = one("select (caja_abrir_turno(%s, 1000)->>'turno_id')::uuid", (ka,))
def vender(pid, cant, precio):
    return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0)", (t, json.dumps([{"producto_id": pid, "cantidad": cant}]), json.dumps([{"medio": "efectivo", "monto": precio * cant}])))
v1 = vender(coca, 30, 1000)
m = movs(coca)[-1]
ok(m["tipo"] == "venta" and m["cantidad"] == -30 and m["stock_resultante"] == 10, "venta de 30 Coca: queda 'venta' −30, saldo 10")
v2 = vender(coca, 5, 1000)
one("select anular_venta_mostrador(%s, 'Error de carga')", (v2["venta_id"],))
m = movs(coca)
ok(m[-2]["tipo"] == "venta" and m[-2]["cantidad"] == -5 and m[-1]["tipo"] == "anulacion_venta" and m[-1]["cantidad"] == 5 and m[-1]["stock_resultante"] == 10, "venta anulada: 'venta' −5 y luego 'anulacion_venta' +5, saldo vuelve a 10")
iid = one("select id from ventas_mostrador_items where venta_id=%s", (v1["venta_id"],))
one("select devolver_venta_mostrador(%s, %s::jsonb, 'efectivo', 'Envase dañado', null)", (v1["venta_id"], json.dumps([{"item_id": iid, "cantidad": 6}])))
m = movs(coca)[-1]
ok(m["tipo"] == "devolucion" and m["cantidad"] == 6 and m["stock_resultante"] == 16, "devolución de 6: 'devolucion' +6, saldo 16")

# ── Pedidos: confirmar consume y cancelar devuelve ──
sin_tipo()
ped = root("""with p as (insert into pedidos(kiosco_id,cliente_nombre,cliente_telefono,modalidad,total,estado)
          values (%s,'Ana','5493415550001','retiro',2000,'pendiente') returning id)
        insert into pedido_items(pedido_id,producto_id,nombre,precio_unit,cantidad) select id,%s,'Pan',500,2 from p returning pedido_id""", (ka, pan))
root("update pedidos set estado='confirmado' where id=%s", (ped,))
m = movs(pan)[-1]
ok(m["tipo"] == "pedido" and m["cantidad"] == -2 and m["stock_resultante"] == 1, "pedido confirmado: 'pedido' −2 (pan 3 → 1)")
root("update pedidos set estado='cancelado' where id=%s", (ped,))
m = movs(pan)[-1]
ok(m["tipo"] == "cancelacion_pedido" and m["cantidad"] == 2 and m["stock_resultante"] == 3, "pedido cancelado: 'cancelacion_pedido' +2 (vuelve a 3)")

# ── Ajustes y cargas: una sola fila, sin duplicar ──
sin_tipo()
one("select ajustar_stock(%s, 18, 'Conteo de góndola')", (galle,))
ok([x["tipo"] for x in movs(galle)] == ["ajuste"], "un ajuste genera exactamente una fila")
sin_tipo()
one("select sumar_stock_rapido(%s, 5)", (coca,))
ok([x["tipo"] for x in movs(coca)][-1] == "ajuste" and len(movs(coca)) == 5, "carga rápida: una sola fila 'ajuste' (no se duplica)")

# ── Saldo: stock actual = stock inicial + suma de movimientos, en todos los productos ──
for p, i in init.items():
    s_calc = root("select p.stock - coalesce((select sum(cantidad) from stock_movimientos where producto_id=p.id),0) from productos p where p.id=%s", (p,))
    ok(s_calc == i, f"saldo cierra: {root('select nombre from productos where id=%s', (p,))} (inicial {i} + movimientos = actual)")

as_("authenticated", A)
print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
