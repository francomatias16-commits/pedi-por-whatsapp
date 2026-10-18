# Verifica 0001..0006 en Postgres embebido. Uso: pip install pgserver psycopg2-binary && python3 supabase/tests/etapa5_test.py
import pgserver, psycopg2, uuid, tempfile
srv = pgserver.get_server(tempfile.mkdtemp())
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()
cur.execute("""
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
""")

# --- stubs de lo que Supabase ya trae: Storage y la publicación de Realtime ---
cur.execute("""
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
for m in ["0001_init", "0002_fiado_sellos_precios", "0003_endurecer_permisos", "0004_operacion_kiosco", "0005_pedido_a_fiado"]:
    cur.execute(open(f"supabase/migrations/{m}.sql").read())
A, B, C = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("insert into auth.users values (%s),(%s),(%s)", (A, B, C))
cur.execute("insert into productos_globales(barcode,nombre,fuente) values ('7790895000782','Dato viejo de pruebas','kiosco')")  # existía antes de 0006
cur.execute(open("supabase/migrations/0006_cierre_etapa3.sql").read())
cur.execute("begin")
import json
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
def root(sql, args=None): cur.execute("reset role"); cur.execute(sql, args); return cur.fetchone()[0] if cur.description else None

# ================= 1) HORARIO =================
HV = lambda h: root("select horarios_validos(%s::jsonb)", (json.dumps(h),))
ok(HV({}) and HV({"1": [{"desde": "08:00", "hasta": "13:00"}, {"desde": "17:00", "hasta": "22:00"}]}), "horarios válidos: vacío y dos tramos")
ok(not HV({"7": []}), "día 7 inválido")
ok(not HV({"1": [{"desde": "25:00", "hasta": "13:00"}]}), "hora 25:00 inválida")
ok(not HV({"1": [{"desde": "08:00", "hasta": "08:00"}]}), "tramo de duración cero inválido")
ok(not HV({"1": [{"desde": "08:00", "hasta": "09:00"}] * 3}), "más de 2 tramos inválido")
ok(not HV({"1": [{"desde": "8:00", "hasta": "9:00"}]}), "formato H:MM inválido (exige HH:MM)")
ok(not HV([]), "debe ser objeto")

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco A','kiosco-a','5493415551234') returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco B','kiosco-b','5493415559999') returning id", (B,))
as_("authenticated", A)
p1 = one("insert into productos(kiosco_id,nombre,precio) values (%s,'Gaseosa',1000) returning id", (ka,))
e = fails("insert into kioscos(owner_id,nombre,slug,whatsapp) values (%s,'Kiosco Panel','panel','5493415551234')", (A,))
ok(e and "kioscos_slug_reservado" in e, "slug 'panel' reservado")
e = fails("update kioscos set horarios = %s::jsonb where id=%s", (json.dumps({"9": []}), ka))
ok(e and "check constraint" in e, "la base rechaza horarios mal formados")

SEM = {"1": [{"desde": "08:00", "hasta": "13:00"}, {"desde": "17:00", "hasta": "22:00"}],
       "5": [{"desde": "20:00", "hasta": "02:00"}]}
cur.execute("update kioscos set horario_auto=true, horarios=%s::jsonb where id=%s", (json.dumps(SEM), ka))
def abierto(utc, id_=None):
    return root("select kiosco_abierto_ahora(k, %s::timestamptz) from kioscos k where id=%s", (utc, id_ or ka))
# 2026-10-19 es lunes. Hora argentina = UTC-3.
ok(abierto("2026-10-19 13:00Z") is True, "lun 10:00 AR: abierto (turno mañana)")
ok(abierto("2026-10-19 11:00Z") is True, "lun 08:00 AR: abre justo a la hora")
ok(abierto("2026-10-19 10:59Z") is False, "lun 07:59 AR: todavía cerrado")
ok(abierto("2026-10-19 16:59Z") is False, "lun 13:59 AR: corte de siesta")
ok(abierto("2026-10-19 16:00Z") is False, "lun 13:00 AR: cierra justo a la hora")
ok(abierto("2026-10-19 21:00Z") is True, "lun 18:00 AR: turno tarde")
ok(abierto("2026-10-20 01:00Z") is False, "lun 22:00 AR: cerrado")
ok(abierto("2026-10-24 02:00Z") is True, "vie 23:00 AR: tramo que cruza la medianoche (parte de hoy)")
ok(abierto("2026-10-24 04:00Z") is True, "sáb 01:00 AR: sigue abierto por el tramo del viernes")
ok(abierto("2026-10-24 05:00Z") is False, "sáb 02:00 AR: cerró")
ok(abierto("2026-10-25 15:00Z") is False, "domingo sin tramos: cerrado")
ok(abierto("2026-10-21 15:00Z") is False, "miércoles sin tramos: cerrado")
cur.execute("update kioscos set abierto=false where id=%s", (ka,))
ok(abierto("2026-10-19 13:00Z") is False, "pausa manual gana al horario")
cur.execute("update kioscos set abierto=true, horario_auto=false where id=%s", (ka,))
ok(abierto("2026-10-25 15:00Z") is True, "sin horario automático: abierto siempre (como antes)")
as_("authenticated", A)
e = fails("select kiosco_abierto_ahora(k) from kioscos k limit 1")
ok(e and "permission denied" in e, "kiosco_abierto_ahora no es llamable desde la API")

# crear_pedido respeta el horario
def pedir(slug="kiosco-a", tel="341 555 0001"):
    return one("select crear_pedido(%s,'Ana',%s,'retiro'::modalidad_pedido,'','',%s::jsonb,'efectivo')", (slug, tel, json.dumps([{"producto_id": p1, "cantidad": 1}])))
as_("authenticated", A)
cur.execute("update kioscos set horario_auto=true, horarios='{}'::jsonb where id=%s", (ka,))
as_("anon"); e = fails("select crear_pedido('kiosco-a','Ana','341 555 0001','retiro'::modalidad_pedido,'','',%s::jsonb,'efectivo')", (json.dumps([{"producto_id": p1, "cantidad": 1}]),))
ok(e and "fuera_de_horario" in e, "sin tramos: pedido rechazado con fuera_de_horario")
as_("authenticated", A)
cur.execute("update kioscos set horarios=%s::jsonb where id=%s", (json.dumps({str(d): [{"desde": "00:00", "hasta": "12:00"}, {"desde": "12:00", "hasta": "00:00"}] for d in range(7)}), ka))
as_("anon"); r = pedir()
ok(float(r["total"]) == 1000, "abierto todo el día: el pedido entra")
as_("authenticated", A); cur.execute("update kioscos set abierto=false where id=%s", (ka,))
as_("anon"); e = fails("select crear_pedido('kiosco-a','Ana','341 555 0002','retiro'::modalidad_pedido,'','',%s::jsonb,'efectivo')", (json.dumps([{"producto_id": p1, "cantidad": 1}]),))
ok(e and "local_cerrado" in e, "pausa manual: local_cerrado")
ok(root("select count(*) from pg_proc where proname='crear_pedido'") == 1, "una sola versión de crear_pedido")

# ================= 2) MODERACIÓN =================
def ean_py(p):
    import re
    if not re.fullmatch(r"\d{8}|\d{12}|\d{13}", p): return False
    d = list(map(int, p)); chk = d.pop(); s = sum(n * (3 if i % 2 == 0 else 1) for i, n in enumerate(reversed(d)))
    return (10 - s % 10) % 10 == chk
import random; random.seed(7)
muestras = ["".join(random.choice("0123456789") for _ in range(random.choice([8, 12, 13]))) for _ in range(300)] + ["7790895000782", "12345670", "123", "abcdefgh", ""]
dif = [m for m in muestras if root("select ean_valido(%s)", (m,)) != ean_py(m)]
ok(not dif, f"ean_valido (SQL) coincide con lib/ean.ts en {len(muestras)} códigos")
ok(root("select norm_nombre_global(%s)", ("Coca-Cola  2,25 L",)) == root("select norm_nombre_global(%s)", ("coca cola 2 25 l",)), "normalización ignora mayúsculas, signos y espacios")
ok(root("select norm_nombre_global('Galletitas Pepitos Ñandú')") == "galletitaspepitosnandu", "normalización quita tildes y ñ")

C1, C2 = "7791234567895", "7790001000011"
good = [c for c in (C1, C2) if ean_py(c)]
# generar dos códigos válidos seguros
def con_check(base12):
    d = list(map(int, base12)); s = sum(n * (3 if i % 2 == 0 else 1) for i, n in enumerate(reversed(d)))
    return base12 + str((10 - s % 10) % 10)
C1, C2 = con_check("779123456789"), con_check("779000100001")
as_("authenticated", A)
ok(one("select aportar_global(%s,%s)", (C1, "Coca-Cola 2,25 L")) == "pendiente", "primer aporte: queda pendiente")
as_("authenticated", C)
ok(one("select count(*) from productos_globales where barcode=%s", (C1,)) == 0, "un aporte pendiente NO lo ve nadie más")
as_("authenticated", A)
ok(one("select aportar_global(%s,%s)", (C1, "Coca-Cola 2,25 L")) == "pendiente", "el mismo usuario repitiendo no confirma su propio aporte")
as_("authenticated", B)
ok(one("select aportar_global(%s,%s)", (C1, "coca cola 2,25 l")) == "verificado", "segundo usuario coincide (aunque cambie mayúsculas/signos): verificado")
as_("authenticated", C)
ok(one("select count(*) from productos_globales where barcode=%s and verificado", (C1,)) == 1, "ya lo ve toda la red")
ok(one("select nombre from productos_globales where barcode=%s", (C1,)) == "coca cola 2,25 l", "queda el nombre del aporte que confirmó")
ok(one("select count(*) from productos_globales where barcode='7790895000782' and verificado") == 1, "lo que existía antes se conserva como verificado")
as_("authenticated", A); one("select aportar_global(%s,%s)", (C2, "Alfajor Triple"))
as_("authenticated", B)
ok(one("select aportar_global(%s,%s)", (C2, "Alfajor Simple")) == "pendiente", "nombres distintos no se confirman entre sí")
as_("authenticated", C)
ok(one("select aportar_global(%s,%s)", (C2, "alfajor  triple")) == "verificado", "un tercero que coincide con uno de los dos confirma ese nombre")
ok(one("select nombre from productos_globales where barcode=%s", (C2,)) == "alfajor triple", "gana el nombre con acuerdo, no el primero")

e = fails("select aportar_global('1234567890123','Algo')"); ok(e and "codigo_invalido" in e, "código con dígito verificador inválido se rechaza")
e = fails("select aportar_global(%s,'  ')", (C1,)); ok(e and "nombre_invalido" in e, "nombre vacío se rechaza")
e = fails("select aportar_global(%s,'!!')", (C1,)); ok(e and "nombre_invalido" in e, "nombre sin letras ni números se rechaza")
e = fails("insert into productos_globales(barcode,nombre,verificado) values ('0000000000017','Falso',true)")
ok(e and "permission denied" in e, "no se puede insertar directo en la base global")
e = fails("update productos_globales set nombre='Hackeado' where barcode=%s", (C1,)); ok(e and "permission denied" in e, "no se puede editar directo")
e = fails("select * from aportes_globales"); ok(e and "permission denied" in e, "los aportes de otros no se leen")
as_("anon"); e = fails("select aportar_global(%s,'X nombre')", (C1,)); ok(e and "permission denied" in e, "anónimo no puede aportar")
ok(one("select count(*) from productos_globales") == 0, "anónimo no ve nada de la base global (RLS)")
as_("authenticated", A)
cur.execute("reset role"); cur.execute("insert into aportes_globales(barcode,usuario,nombre,nombre_norm) select 'rel'||g, %s, 'x'||g, 'x'||g from generate_series(1,500) g", (A,))
as_("authenticated", A); e = fails("select aportar_global(%s,'Otro nombre')", (C2,)); ok(e and "demasiados_aportes" in e, "tope de 500 aportes por día")

# ================= 3) FOTOS =================
ok(root("select public from storage.buckets where id='productos'") is True and root("select file_size_limit from storage.buckets where id='productos'") == 524288, "bucket 'productos' público, máx. 512 KB")
ok(root("select allowed_mime_types from storage.buckets where id='productos'") == ["image/jpeg", "image/webp", "image/png"], "solo imágenes jpeg/webp/png")
INS = "insert into storage.objects(bucket_id,name) values ('productos',%s)"
as_("authenticated", A)
ok(fails(INS, (f"{ka}/{p1}-1.jpg",)) is False, "el dueño sube a su carpeta")
e = fails(INS, (f"{kb}/x.jpg",)); ok(e and "row-level security" in e, "no puede subir a la carpeta de otro kiosco")
e = fails(INS, ("cualquiera/x.jpg",)); ok(e and "row-level security" in e, "carpeta que no es un uuid se rechaza")
e = fails(INS, ("x.jpg",)); ok(e and "row-level security" in e, "archivo suelto en la raíz se rechaza")
e = fails("insert into storage.objects(bucket_id,name) values ('otro-bucket',%s)", (f"{ka}/x.jpg",)); ok(e and "row-level security" in e, "solo aplica al bucket productos")
as_("anon"); e = fails(INS, (f"{ka}/y.jpg",)); ok(e and "row-level security" in e, "anónimo no sube")
as_("authenticated", B)
cur.execute("delete from storage.objects where name like %s", (f"{ka}/%",)); ok(cur.rowcount == 0, "otro dueño no puede borrar mis fotos")
as_("authenticated", A)
cur.execute("delete from storage.objects where name like %s", (f"{ka}/%",)); ok(cur.rowcount == 1, "el dueño borra sus fotos")

# ================= 4) REALTIME =================
ok(root("select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='pedidos'") == 1, "pedidos está en la publicación de Realtime")

print("\nFALLOS:", bad); raise SystemExit(1 if bad else 0)
