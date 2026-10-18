# Verifica 0021 (conteo físico por planilla). Uso: python3 supabase/tests/etapa18_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa18_" + uuid.uuid4().hex[:8]
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
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado", "0006_cierre_etapa3", "0007_borrar_cliente", "0008_push", "0009_stock", "0010_caja", "0011_mostrador", "0012_pos", "0013_pos_avanzado", "0014_pin_opciones", "0015_proveedores_compras", "0016_etiquetas", "0017_fidelidad", "0018_reposicion", "0019_motivos_mermas", "0020_historial_stock", "0021_conteo_planilla"]:
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

# Sin movimientos de venta en este test: los ajustes del conteo son los únicos que cambian stock.
def sin_tipo(): root("select set_config('app.mov_tipo', '', true)")
init = {p: stock(p) for p in [coca, pan, galle, agot, muerto, queso, sano]}

# ── Validaciones ──
ok(has(fails("select conteo_crear(%s, 'raro')", (ka,)), "criterio_invalido"), "un criterio desconocido se rechaza")
ok(has(fails("select conteo_crear(%s, 'categoria', '  ')", (ka,)), "categoria_requerida"), "por categoría hace falta indicarla")
ok(has(fails("select conteo_crear(%s, 'categoria', 'Nada')", (ka,)), "sin_productos"), "una categoría sin productos no arma sesión")

# ── Armar: todos los controlados (7), el libre no entra ──
sid = one("select conteo_crear(%s, 'todos')", (ka,))
ok(one("select count(*) from conteos_items where sesion_id=%s", (sid,)) == 7, "conteo de todos: 7 productos con control de stock (el libre no entra)")
ok(has(fails("select conteo_crear(%s, 'todos')", (ka,)), "conteo_en_curso"), "no se puede abrir un segundo conteo mientras hay uno abierto")
ok(has(fails("select conteo_crear(%s, 'bajo')", (kb,)), "no_autorizado"), "otro dueño no arma conteos en mi kiosco")

# ── Cargar: coca ok, pan −1, galle +1, queso −100 g, sano 98, muerto 0, agot sin contar ──
items = lambda pares: json.dumps([{"producto_id": str(p), "contado": c} for p, c in pares])
one("select conteo_guardar(%s, %s::jsonb)", (sid, items([(coca, 40), (pan, 2), (galle, 16), (queso, 1900), (sano, 98), (muerto, 0)])))
ok(has(fails("select conteo_guardar(%s, %s::jsonb)", (sid, items([(pan, 1.5)]))), "cantidad_invalida"), "una cantidad con decimales se rechaza")
d = one("select conteo_diferencias(%s)", (sid,))
ok(len(d["diferencias"]) == 4 and d["sin_contar"] == 1, "diferencias: pan, galle, queso y gaseosa (la coca y el muerto coinciden; el agotado queda sin contar)")
ok(next(x for x in d["diferencias"] if x["nombre"] == "Queso")["diferencia"] == -100, "el queso se compara en gramos: −100")

# Venta durante el conteo: la gaseosa sube a 105 en vivo.
sin_tipo(); root("update productos set stock = 105 where id=%s", (sano,))

r = one("select conteo_aplicar(%s)", (sid,))
ok(r["ajustados"] == 4 and r["sin_cambios"] == 2 and r["sin_contar"] == 1, "aplicar: 4 ajustados, 2 sin cambios, 1 sin contar")
ok(stock(sano) == 98, "la gaseosa queda en lo contado (98), no en la diferencia del armado")
m = rows("select cantidad, stock_resultante, motivo_tipo from stock_movimientos where producto_id=%s order by created_at desc limit 1", (sano,))[0]
ok(m["cantidad"] == -7 and m["stock_resultante"] == 98 and m["motivo_tipo"] == "conteo_fisico", "la diferencia se calcula contra el stock en vivo (105 → 98: −7) con motivo conteo físico")
ok(stock(pan) == 2 and stock(galle) == 16 and stock(queso) == 1900 and stock(agot) == 0, "los productos sin contar no cambian; el resto queda en lo contado")
ok(one("select count(*) from stock_movimientos where motivo_tipo='conteo_fisico'") == 4, "cada ajuste del conteo deja una sola fila en el historial")
ok(one("select conteo_actual(%s)", (ka,)) is None, "al aplicar no queda conteo abierto")
ok(has(fails("select conteo_aplicar(%s)", (sid,)), "conteo_cerrado"), "una sesión aplicada no se vuelve a aplicar")

# ── Por criterio 'bajo' y descartar ──
sid2 = one("select conteo_crear(%s, 'bajo')", (ka,))
bajos = rows("select nombre from conteos_items where sesion_id=%s", (sid2,))
ok({b["nombre"] for b in bajos} == {"Galletitas", "Queso", "Agotado con mínimo", "Producto sin movimiento"} and "Gaseosa con stock" not in {b["nombre"] for b in bajos}, "conteo de lo que hay que reponer: Galletitas, Queso y los agotados; la gaseosa (98, mínimo 5) no entra")
actual = one("select conteo_actual(%s)", (ka,))
ok(actual["id"] == str(sid2) and actual["criterio"] == "bajo" and len(actual["items"]) == 4, "la pantalla recibe la sesión abierta con sus renglones")
one("select conteo_descartar(%s)", (sid2,))
ok(one("select conteo_actual(%s)", (ka,)) is None and stock(galle) == 16, "descartar cierra la sesión sin tocar el stock")
ok(has(fails("select conteo_guardar(%s, %s::jsonb)", (sid2, items([(galle, 3)]))), "conteo_cerrado"), "no se carga en un conteo descartado")

# ── Permisos ──
as_("authenticated", B)
ok(has(fails("select conteo_actual(%s)", (ka,)), "no_autorizado"), "otro dueño no ve el conteo de mi kiosco")
ok(has(fails("select conteo_guardar(%s, %s::jsonb)", (sid, items([(pan, 1)]))), "no_autorizado"), "otro dueño no carga conteos en mi kiosco")
as_("anon")
ok(bool(fails("select conteo_actual(%s)", (ka,))), "anon no ejecuta el conteo")
as_("authenticated", A)

print("\nRESULTADO: " + ("OK" if not bad else f"{bad} FALLAS"))
sys.exit(1 if bad else 0)
