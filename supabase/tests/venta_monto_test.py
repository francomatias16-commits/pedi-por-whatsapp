# Verifica el descuento en pesos exacto (0049): premios de monto, prorrateo, topes, permisos y compatibilidad.
# Uso: python3 supabase/tests/venta_monto_test.py
import os, psycopg2, uuid, tempfile, sys, json, glob
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "venta_monto_" + uuid.uuid4().hex[:8]
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
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated; grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
for f in sorted(glob.glob("supabase/migrations/*.sql")): cur.execute(open(f).read())


A, CJ, X = (str(uuid.uuid4()) for _ in range(3))
for u, n in ((A, "dueno"), (CJ, "cajero"), (X, "extrano")): cur.execute("insert into auth.users(id,email) values (%s,%s)", (u, n + "@test.com"))
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
def has(err, texto): return texto in (err or "")

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','venta-a','5493415551234',true) returning id", (A,))
as_("postgres")
cur.execute("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'cajero')", (ka, CJ))
torta = one("insert into productos(kiosco_id,nombre,precio,categoria) values (%s,'Torta',12345,'Panaderia') returning id", (ka,))
coca = one("insert into productos(kiosco_id,nombre,precio,categoria) values (%s,'Coca 500',1000,'Bebidas') returning id", (ka,))
alf = one("insert into productos(kiosco_id,nombre,precio,categoria) values (%s,'Alfajor',500,'Golosinas') returning id", (ka,))
as_("authenticated", A)
turno = one("select (caja_abrir_turno(%s, 0)->>'turno_id')::uuid", (ka,))

import json
def venta(items, monto=None, pct=0, medio_monto=None, rol=None, cliente=None):
    pagos = json.dumps([{"medio": "efectivo", "monto": medio_monto or 100000}])
    it = json.dumps(items)
    if monto is None:
        return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, %s)", (turno, it, pagos, pct))
    return one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, %s, null, null, %s)", (turno, it, pagos, pct, monto))

# 1) Monto exacto sobre un ticket de centavos "imposibles" en porcentaje
as_("authenticated", A)
r = jsn = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, null, null, 1000)", (turno, json.dumps([{"producto_id": torta, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 20000}])))
ok(float(r["descuento"]) == 1000.00 and float(r["total"]) == 11345.00, "premio de $1.000 sobre $12.345 descuenta exacto y cobra $11.345")

# 2) Prorrateo exacto entre renglones: 333,33 sobre $3.500 deja $3.166,67 y la suma de renglones coincide
r = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, null, null, 333.33)",
        (turno, json.dumps([{"producto_id": coca, "cantidad": 3}, {"producto_id": alf, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 5000}])))
ok(float(r["total"]) == 3166.67 and float(r["descuento"]) == 333.33, "descuento de $333,33 sobre $3.500 cobra exacto $3.166,67")
cur.execute("select coalesce(sum(neto),0) from ventas_mostrador_items where venta_id=%s", (r["venta_id"],))
ok(float(cur.fetchone()[0]) == 3166.67, "la suma de los renglones da lo mismo que el total (exacto)")

# 3) Monto mayor al subtotal: se topa y no da negativo
r = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, null, null, 99999)",
        (turno, json.dumps([{"producto_id": alf, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 100}])))
ok(float(r["total"]) == 0 and float(r["descuento"]) == 500 and float(r["vuelto"]) == 100, "un premio mayor al total se topa en el subtotal (cobra 0)")

# 4) Monto negativo y monto junto con porcentaje se rechazan
ok(has(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, null, null, -5)", (turno, json.dumps([{"producto_id": alf, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 500}]))), "descuento_invalido"), "un monto negativo se rechaza")
ok(has(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 10, null, null, 100)", (turno, json.dumps([{"producto_id": alf, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 500}]))), "descuento_doble"), "monto y porcentaje juntos se rechazan")

# 5) Clientes viejos (sin el parámetro nuevo) siguen igual: 10% sobre $1.000 = $900
r = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 10)", (turno, json.dumps([{"producto_id": coca, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 900}])))
ok(float(r["total"]) == 900.00, "la llamada sin monto (cliente viejo) sigue descontando el porcentaje")

# 6) El cajero también puede cobrar con monto; el ajeno y anon no
as_("authenticated", CJ)
r = one("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, null, null, 500)", (turno, json.dumps([{"producto_id": torta, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 12000}])))
ok(float(r["total"]) == 11845.00, "el cajero cobra con descuento en pesos")
as_("authenticated", X)
ok(has(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, null, null, 500)", (turno, json.dumps([{"producto_id": alf, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 500}]))), "no_autorizado"), "un ajeno no puede cobrar con descuento en pesos")
as_("anon")
ok(bool(fails("select registrar_venta_mostrador(%s, %s::jsonb, %s::jsonb, null, 0, null, null, 500)", (turno, json.dumps([{"producto_id": alf, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 500}])))), "anon no cobra")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
