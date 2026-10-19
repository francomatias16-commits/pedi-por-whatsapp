# Verifica el club de punta a punta (0039–0042): el QR sigue lo que configura el kiosquero, registro, toques, límites, canje,
# rechazo, roles y reportes. Es el flujo que une al cliente con el panel del kiosquero.
# Uso: python3 supabase/tests/club_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json, glob
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "club_" + uuid.uuid4().hex[:8]
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

A, EN, CJ, X = (str(uuid.uuid4()) for _ in range(4))
for u, n in ((A, "dueno"), (EN, "encargado"), (CJ, "cajero"), (X, "extrano")): cur.execute("insert into auth.users(id,email) values (%s,%s)", (u, n + "@test.com"))
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
def jsn(v): return v if isinstance(v, (dict, list)) or v is None else json.loads(v)

as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("postgres")
cur.execute("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'encargado'),(%s,%s,'cajero')", (ka, EN, ka, CJ))
# El local ya nace con la campaña "Por cada compra" (1 sello): es la base del club.
# El local también nace con "Un premio de la casa" (10 sellos); el QR muestra el más barato.
cur.execute("insert into fidelidad_premios(kiosco_id,nombre,costo_sellos,tipo) values (%s,'Gaseosa',3,'libre')", (ka,))
premio = one("select id from fidelidad_premios where kiosco_id=%s and nombre='Gaseosa'", (ka,))

def datos():
    as_("anon"); return jsn(one("select club_datos('kiosco-a')"))
def tarjeta(tok):
    as_("anon"); return jsn(one("select club_tarjeta(%s)", (tok,)))
def saldo(cli):
    as_("postgres"); return one("select sellos_disponibles from clientes_sellos where id=%s", (cli,))
def cliente_de(tok):
    as_("postgres"); return one("select id from clientes where club_token=%s", (tok,))
def visita_activa(v):
    as_("postgres"); cur.execute("update fidelidad_campanas set activa=%s where kiosco_id=%s and tipo='visita'", (v, ka))

# ===== 1) El mensaje del QR sigue lo que configura el kiosquero
d = datos()
ok(d["premio"] == "Gaseosa" and d["meta"] == 3 and d["por_compra"] == 1, "el QR muestra el premio, la meta y 1 sello por compra")
as_("authenticated", A); cur.execute("update fidelidad_premios set costo_sellos = 5, nombre = 'Alfajor' where id = %s", (premio,))
d = datos(); ok(d["premio"] == "Alfajor" and d["meta"] == 5, "si el kiosquero cambia el premio y los sellos, el QR cambia")
as_("authenticated", A); cur.execute("insert into fidelidad_campanas(kiosco_id,tipo,nombre,multiplicador,canales) values (%s,'multiplicador','Sellos dobles',2,'{mostrador}')", (ka,))
ok(datos()["por_compra"] == 2, "con sellos dobles el QR dice 2 por compra")
as_("authenticated", A); cur.execute("update fidelidad_campanas set activa = false where kiosco_id = %s", (ka,))
ok(datos()["por_compra"] == 0, "sin campañas activas no promete sellos")
as_("authenticated", A); cur.execute("update fidelidad_campanas set activa = true where kiosco_id = %s and tipo = 'visita'", (ka,)); cur.execute("update fidelidad_campanas set activa = false where kiosco_id = %s and tipo = 'multiplicador'", (ka,))
as_("authenticated", A); cur.execute("update fidelidad_premios set costo_sellos = 3, nombre = 'Gaseosa' where id = %s", (premio,))
d = datos(); ok(d["por_compra"] == 1 and d["meta"] == 3, "vuelve a 1 por compra y meta 3")
as_("anon"); ok(one("select club_datos('no-existe')") is None, "un local inexistente no tiene club")
as_("authenticated", A); cur.execute("update kioscos set club_activo = false where id = %s", (ka,))
ok(datos() is None, "con el club en pausa el QR no muestra nada")
as_("authenticated", A); cur.execute("update kioscos set club_activo = true where id = %s", (ka,))

# ===== 2) Registro con el QR
as_("anon")
r = jsn(one("select club_unirse('kiosco-a','Ana','341 555-0001')"))
tok = r["token"]
ok(r["estado"] == "ok" and len(tok) == 32, "el registro crea la tarjeta")
ok(r["_aviso"]["cantidad"] == 1 and r["_aviso"]["nuevo"] is True and r["_aviso"]["kiosco_id"] == ka, "el aviso al kiosquero trae cliente nuevo y 1 sello")
as_("anon"); ok(jsn(one("select club_unirse('kiosco-a','Ana','341 555-0001')"))["estado"] == "ya_registrado", "el mismo teléfono no crea otra tarjeta")
as_("anon"); ok(has(fails("select club_unirse('kiosco-a','Ana','12')"), "club_telefono_invalido"), "teléfono inválido")
as_("anon"); ok(has(fails("select club_unirse('kiosco-a','A','3415550002')"), "club_nombre_invalido"), "nombre inválido")
as_("anon"); ok(has(fails("select club_unirse('no-existe','Ana','3415550003')"), "club_no_disponible"), "local inexistente")
ana = cliente_de(tok)
ok(saldo(ana) == 1, "el registro suma el primer sello")

# ===== 3) La tarjeta y los toques
t = tarjeta(tok)
ok(t["sellos"] == 1 and t["meta"] == 3 and t["premio"] == "Gaseosa" and t["listo"] is False and t["por_compra"] == 1, "la tarjeta muestra sellos, meta, premio y 1 por compra")
ok(t["puede_sumar"] is False and t["bloqueo"]["codigo"] == "club_limite_dia", "el mismo día no puede sumar de nuevo (tope por defecto 1)")
as_("anon"); ok(has(fails("select club_sumar(%s)", (tok,)), "club_limite_dia"), "el segundo toque del día se rechaza")
as_("anon"); ok(tarjeta("z" * 32) is None and one("select club_tarjeta('mal')") is None, "token inválido no devuelve tarjeta")
as_("authenticated", A); cur.execute("update kioscos set club_max_por_dia = 50 where id = %s", (ka,))
as_("anon"); ok(jsn(one("select club_sumar(%s)", (tok,)))["sellos"] == 2, "con más tope, el toque suma")
visita_activa(False)
as_("anon"); ok(has(fails("select club_sumar(%s)", (tok,)), "club_sin_sellos"), "sin campaña que sume, el toque no suma nada")
visita_activa(True)
as_("anon"); r = jsn(one("select club_sumar(%s)", (tok,)))
ok(r["sellos"] == 3 and r["listo"] is True and r["_aviso"]["nuevo"] is False, "al llegar a la meta la tarjeta dice que el premio está listo")

# ===== 4) Canje: el kiosquero entrega y la tarjeta del cliente lo refleja
as_("authenticated", X); ok(has(fails("select fidelidad_canjear(%s,%s)", (ana, premio)), "no_autorizado"), "alguien ajeno no canjea")
as_("authenticated", EN); c = jsn(one("select fidelidad_canjear(%s,%s)", (ana, premio)))
ok(c["saldo"] == 0 and c["premio"] == "Gaseosa", "el encargado canjea el premio")
t = tarjeta(tok); ok(t["sellos"] == 0 and t["listo"] is False, "la tarjeta del cliente ya no muestra el premio listo")
as_("authenticated", EN); ok(has(fails("select fidelidad_canjear(%s,%s)", (ana, premio)), "sellos_insuficientes"), "no se canjea dos veces el mismo premio")

# ===== 5) Quién ve la actividad
as_("anon"); [one("select club_sumar(%s)", (tok,)) for _ in range(3)]
for q, nom in ((A, "el dueño"), (EN, "el encargado")):
    as_("authenticated", q); act = jsn(one("select club_actividad(%s,24)", (ka,)))
    ok(len(act) == 6 and act[0]["nombre"] == "Ana", f"{nom} ve la actividad del club")
as_("authenticated", CJ); ok(has(fails("select club_actividad(%s,24)", (ka,)), "no_autorizado"), "el cajero no ve la actividad")
as_("authenticated", X); ok(has(fails("select club_actividad(%s,24)", (ka,)), "no_autorizado"), "un ajeno no ve la actividad")
as_("anon"); ok(bool(fails("select club_actividad(%s,24)", (ka,))), "anon no ve la actividad")
as_("authenticated", A); act = jsn(one("select club_actividad(%s,24)", (ka,)))
ok(any(e["nuevo"] for e in act), "el alta figura como cliente nuevo")

# ===== 6) Rechazar
as_("anon"); b = jsn(one("select club_unirse('kiosco-a','Beto','3415550009')")); beto = cliente_de(b["token"]); ev_b = b["_aviso"]["evento"]
ok(saldo(beto) == 1, "Beto arranca con 1 sello")
as_("authenticated", CJ); ok(has(fails("select club_rechazar(%s,true)", (ev_b,)), "no_autorizado"), "el cajero no rechaza")
as_("authenticated", X); ok(has(fails("select club_rechazar(%s,true)", (ev_b,)), "no_autorizado"), "un ajeno no rechaza")
as_("anon"); ok(bool(fails("select club_rechazar(%s,true)", (ev_b,))), "anon no rechaza")
as_("authenticated", EN); r = jsn(one("select club_rechazar(%s,true)", (ev_b,)))
ok(r["ok"] is True and r["descubierto"] == 0 and saldo(beto) == 0, "el encargado rechaza y el saldo baja")
as_("postgres"); fila = one("select anulado_por::text from sellos where club_evento=%s limit 1", (ev_b,))
ok(fila == EN and one("select anulado_at is not null from sellos where club_evento=%s limit 1", (ev_b,)), "queda registrado quién rechazó y cuándo")
as_("authenticated", A); jsn(one("select club_rechazar(%s,false)", (ev_b,)))
ok(saldo(beto) == 1, "deshacer el rechazo devuelve el sello")
as_("postgres"); ok(one("select anulado_por is null and anulado_at is null from sellos where club_evento=%s limit 1", (ev_b,)), "deshacer limpia el rastro")
# Ana: 3 toques nuevos (3 sellos) → canjea y después se rechaza un toque ya gastado
as_("postgres"); ev_a = one("select club_evento from sellos where cliente_id=%s and origen='club' and not anulado order by created_at desc limit 1", (ana,))
ok(saldo(ana) == 3, "Ana vuelve a tener 3 sellos")
as_("authenticated", EN); jsn(one("select fidelidad_canjear(%s,%s)", (ana, premio)))
ok(saldo(ana) == 0, "Ana canjea el segundo premio (saldo 0)")
as_("authenticated", EN); r = jsn(one("select club_rechazar(%s,true)", (ev_a,)))
ok(r["descubierto"] == 1, "rechazar un sello ya canjeado avisa que quedó descubierto")
ok(saldo(ana) == 0, "el saldo nunca queda negativo")

# ===== 7) Permisos de las funciones internas
for f, a in (("club_bloqueo(%s,%s)", (ka, ana)), ("club_otorgar(%s,%s,%s)", (ka, ana, str(uuid.uuid4()))), ("club_armar_tarjeta(%s)", (ana,))):
    as_("anon"); ok(bool(fails("select " + f, a)), f"anon no ejecuta {f.split('(')[0]}")
    as_("authenticated", A); ok(bool(fails("select " + f, a)), f"ni el dueño ejecuta {f.split('(')[0]} desde afuera")

# ===== 8) Rastro de quién canjeó y reporte por empleado
as_("authenticated", A)
cur.execute("select nombre, sum(canjes) from sellos_por_empleado(%s, current_date - 1, current_date + 1) group by nombre", (ka,)); filas = dict(cur.fetchall())
ok(filas.get("encargado@test.com", 0) >= 2, "el reporte muestra los canjes del encargado")
as_("authenticated", EN); ok(has(fails("select * from sellos_por_empleado(%s, current_date, current_date)", (ka,)), "no_autorizado"), "el encargado no ve el reporte por empleado")
as_("postgres"); ok(one("select count(*) from sellos where origen='club' and usuario_id is not null") == 0, "los sellos del club los suma el cliente (sin usuario)")

# ===== 9) Los toques del club cuentan como visitas para la lista de clientes que dejaron de venir
as_("postgres"); cur.execute("update sellos set created_at = now() - interval '60 days' where cliente_id=%s", (ana,))
as_("authenticated", A); cur.execute("select cliente_id from clientes_en_fuga(%s, 45, 3)", (ka,))
ok(ana in [str(x[0]) for x in cur.fetchall()], "Ana (solo club) aparece como cliente que dejó de venir")

# ===== 10) El regalo de bienvenida se anuncia aparte y no infla "por compra"
as_("authenticated", A); cur.execute("insert into fidelidad_campanas(kiosco_id,tipo,nombre,sellos,canales) values (%s,'bienvenida','Bienvenida',2,'{mostrador}')", (ka,))
d = datos(); ok(d["por_compra"] == 1 and d["bienvenida"] == 2, "el QR separa 1 por compra de 2 de bienvenida")
as_("anon"); r = jsn(one("select club_unirse('kiosco-a','Carla','3415550077')"))
ok(r["_aviso"]["cantidad"] == 3, "quien se registra recibe compra + bienvenida (3)")
ok(tarjeta(r["token"])["por_compra"] == 1, "la tarjeta ya registrada vuelve a decir 1 por compra")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
