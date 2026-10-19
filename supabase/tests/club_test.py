# Verifica el club de punta a punta (0039–0043): el QR sigue lo que configura el kiosquero, registro, toques, límites, canje,
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

# ===== 11) Cómo pagó (0043): efectivo suma directo; transferencia y Mercado Pago quedan por verificar
def libre(cli):  # corre hacia atrás los sellos del cliente para que el tope de "1 por día" no moleste en la prueba siguiente
    as_("postgres"); cur.execute("update sellos set created_at = created_at - interval '2 days' where cliente_id=%s", (cli,))
def actividad():
    as_("authenticated", A); return jsn(one("select club_actividad(%s, 72)", (ka,)))
def fila(ev): return next(f for f in actividad() if f["evento"] == ev)
as_("postgres"); cur.execute("update fidelidad_campanas set activa = true where kiosco_id=%s and tipo='visita'", (ka,))
as_("postgres"); cur.execute("update kioscos set club_max_por_dia = 1 where id=%s", (ka,))
as_("anon"); r = jsn(one("select club_unirse('kiosco-a','Dani','3415550088')")); tk = r["token"]; dani = cliente_de(tk); libre(dani)
as_("anon"); ok(has(fails("select club_sumar(%s,'bitcoin')", (tk,)), "club_medio_invalido"), "un medio de pago inventado se rechaza")
as_("anon"); ok(has(fails("select club_sumar(%s,null)", (tk,)), "club_medio_invalido"), "sin medio no se suma por la versión nueva")
as_("anon"); r = jsn(one("select club_sumar(%s,'transferencia')", (tk,))); ev_t = r["_aviso"]["evento"]
ok(r["_aviso"]["medio"] == "transferencia", "el aviso al kiosquero lleva el medio")
f = fila(ev_t); ok(f["medio"] == "transferencia" and f["verificado"] is False, "la transferencia queda por verificar")
as_("anon"); ok(has(fails("select club_sumar(%s,'mercadopago')", (tk,)), "club_limite_dia"), "el tope de 1 por día vale para cualquier medio")
as_("anon"); ok(bool(fails("select club_verificar(%s)", (ev_t,))), "anon no verifica")
as_("authenticated", CJ); ok(has(fails("select club_verificar(%s)", (ev_t,)), "no_autorizado"), "el cajero no verifica")
as_("authenticated", X); ok(has(fails("select club_verificar(%s)", (ev_t,)), "no_autorizado"), "un ajeno no verifica")
as_("authenticated", EN); r = jsn(one("select club_verificar(%s)", (ev_t,)))
ok(r["ok"] is True and r["verificados"] == 1 and fila(ev_t)["verificado"] is True, "el encargado verifica con el comprobante")
as_("postgres"); ok(one("select club_verificado_por::text from sellos where club_evento=%s limit 1", (ev_t,)) == EN, "queda registrado quién verificó")
as_("authenticated", A); ok(jsn(one("select club_verificar(%s)", (ev_t,)))["verificados"] == 1, "verificar dos veces no rompe nada")
libre(dani)
as_("anon"); r = jsn(one("select club_sumar(%s,'efectivo')", (tk,))); ev_e = r["_aviso"]["evento"]
f = fila(ev_e); ok(f["medio"] == "efectivo" and f["verificado"] is None, "el efectivo no se verifica (verificado = null)")
as_("authenticated", A); ok(jsn(one("select club_verificar(%s)", (ev_e,)))["verificados"] == 0, "verificar un sello de efectivo no hace nada")
libre(dani)
as_("anon"); r = jsn(one("select club_sumar(%s,'mercadopago')", (tk,))); ev_m = r["_aviso"]["evento"]
as_("authenticated", A); jsn(one("select club_rechazar(%s,true)", (ev_m,)))
ok(jsn(one("select club_verificar(%s)", (ev_m,)))["verificados"] == 0, "un sello rechazado no se puede verificar")
libre(dani)
as_("anon"); r = jsn(one("select club_sumar(%s)", (tk,))); ev_v = r["_aviso"]["evento"]
as_("postgres"); ok(one("select club_medio from sellos where club_evento=%s limit 1", (ev_v,)) == "efectivo", "la versión vieja de club_sumar cuenta como efectivo")


# --- 0044 · talonario de papelitos (código para efectivo) ---
libre(dani)
import re
RE_COD = re.compile(r"^[2-9A-HJKMNP-Z]{6}$")
as_("authenticated", A); gen = jsn(one("select club_generar_codigos(%s, 10)", (ka,)))
ok(gen["lote"] == 1 and len(gen["codigos"]) == 10 and all(RE_COD.match(c) for c in gen["codigos"]), "el dueño genera un lote de 10 papelitos válidos")
cods = gen["codigos"]
as_("authenticated", EN); ok(len(jsn(one("select club_generar_codigos(%s, 2)", (ka,)))["codigos"]) == 2, "el encargado también genera papelitos")
as_("authenticated", CJ); ok(has(fails("select club_generar_codigos(%s, 2)", (ka,)), "no_autorizado"), "el cajero no genera papelitos")
as_("anon"); ok(bool(fails("select club_generar_codigos(%s, 2)", (ka,))), "anon no genera papelitos")
as_("authenticated", A); ok(has(fails("select club_generar_codigos(%s, 0)", (ka,)), "club_cantidad_invalida") and has(fails("select club_generar_codigos(%s, 201)", (ka,)), "club_cantidad_invalida"), "cantidad fuera de 1..200 se rechaza")
r = jsn(one("select club_codigos_resumen(%s)", (ka,))); ok(r["generados"] == 12 and r["sin_usar"] == 12 and r["usados"] == 0, "el resumen cuenta 12 generados y ninguno usado")
ok(len(jsn(one("select club_codigos_sin_usar(%s)", (ka,)))) == 12, "sin_usar devuelve los 12 papelitos para imprimir")
as_("anon"); ok(bool(fails("select count(*) from club_codigos")), "anon no lee la tabla de papelitos")
as_("postgres"); cur.execute("update public.kioscos set club_exigir_codigo=false where id=%s", (ka,))
as_("anon"); r = jsn(one("select club_sumar(%s,'efectivo',null)", (tk,)))
ok("_error" not in r and "_aviso" in r, "sin exigir código, el efectivo suma como siempre")
as_("postgres"); libre(dani); cur.execute("update public.kioscos set club_exigir_codigo=true where id=%s", (ka,))

as_("postgres"); antes = one("select count(*) from sellos where cliente_id=%s", (dani,))
as_("anon")
r = jsn(one("select club_sumar(%s,'efectivo',null)", (tk,)))
ok(r.get("_error") == "club_codigo_requerido" and "_aviso" not in r, "con exigir código, el efectivo sin código pide el papelito")
as_("postgres"); ok(one("select count(*) from sellos where cliente_id=%s", (dani,)) == antes, "pedir el código no suma ningún sello")
as_("postgres"); ok(one("select count(*) from club_intentos where cliente_id=%s", (dani,)) == 0, "pedir el código no cuenta como intento fallido")

as_("anon"); r = jsn(one("select club_sumar(%s,'transferencia',null)", (tk,)))
ok("_aviso" in r, "transferencia no pide código aunque el local lo exija")
as_("postgres"); libre(dani)

as_("anon"); r = jsn(one("select club_sumar(%s,'efectivo',%s)", (tk, "ZZZZZZ")))
ok(r.get("_error") == "club_codigo_invalido", "un código que no existe se rechaza sin romper")
as_("postgres"); ok(one("select count(*) from club_intentos where cliente_id=%s", (dani,)) == 1, "el intento fallido queda registrado")
as_("anon"); r = jsn(one("select club_sumar(%s,'efectivo',%s)", (tk, cods[0].lower())))
ok(r.get("_error") is None and r["_aviso"]["con_codigo"] is True, "un papelito válido suma (en minúsculas también)")
as_("postgres"); ok(one("select count(*) from club_intentos where cliente_id=%s", (dani,)) == 0, "al acertar se borran los intentos fallidos")
ok(one("select usado_at is not null from club_codigos where kiosco_id=%s and codigo=%s", (ka, cods[0])), "el papelito queda marcado como usado")
libre(dani)

as_("anon"); r = jsn(one("select club_sumar(%s,'efectivo',%s)", (tk, cods[0])))
ok(r.get("_error") == "club_codigo_usado", "un papelito usado no sirve otra vez")
as_("authenticated", A); r = jsn(one("select club_codigos_resumen(%s)", (ka,)))
ok(r["usados"] == 1 and r["sin_usar"] == 11, "el resumen cuenta 1 usado y 11 sin usar")
ok(len(jsn(one("select club_codigos_sin_usar(%s)", (ka,)))) == 11, "sin_usar ya no trae el papelito gastado")

as_("anon"); r = jsn(one("select club_sumar(%s)", (tk,)))
ok(r.get("_error") == "club_codigo_requerido", "la versión de 1 parámetro también pide código si el local lo exige")
as_("anon"); r = jsn(one("select club_sumar(%s,'efectivo')", (tk,)))
ok(r.get("_error") == "club_codigo_requerido", "la versión de 2 parámetros (tarjeta vieja) también pide código")
as_("postgres"); libre(dani)

as_("anon"); pablo = jsn(one("select club_unirse('kiosco-a','Pablo','3415550099')"))["token"]; cliente_p = cliente_de(pablo); libre(cliente_p)
as_("anon")
for _ in range(5):
    jsn(one("select club_sumar(%s,'efectivo',%s)", (pablo, "ZZZZZZ")))
r = jsn(one("select club_sumar(%s,'efectivo',%s)", (pablo, cods[1])))
ok(r.get("_error") == "club_codigo_bloqueado", "tras 5 errores se frena, aunque ahora mande un papelito válido")
as_("postgres"); ok(not bool(one("select exists(select 1 from club_codigos where kiosco_id=%s and codigo=%s and usado_at is not null)", (ka, cods[1]))), "el bloqueo no gasta el papelito")
as_("anon"); r = jsn(one("select club_tarjeta(%s)", (tk,)))
ok(r.get("exige_codigo") is True, "la tarjeta avisa que el local exige código")

as_("authenticated", A); jsn(one("select club_generar_codigos(%s, 5)", (ka,)))
r = jsn(one("select club_codigos_resumen(%s)", (ka,)))
ok(r["generados"] == 17, "un segundo lote suma a los generados")
as_("postgres"); ok(one("select max(lote) from club_codigos where kiosco_id=%s", (ka,)) == 3, "cada lote toma el número siguiente (1, 2 del encargado, 3)")

# --- 0044 · tope por local y prender/apagar el papelito ---
as_("authenticated", EN); ok(has(fails("select club_configurar_codigos(%s, false)", (ka,)), "no_autorizado"), "el encargado no prende ni apaga el papelito")
as_("anon"); ok(bool(fails("select club_configurar_codigos(%s, false)", (ka,))), "anon no prende ni apaga el papelito")
as_("authenticated", A); jsn(one("select club_configurar_codigos(%s, false)", (ka,)))
as_("postgres"); ok(one("select club_exigir_codigo from kioscos where id=%s", (ka,)) is False, "el dueño apaga el papelito")
as_("authenticated", A); jsn(one("select club_configurar_codigos(%s, true)", (ka,)))
as_("postgres"); ok(one("select club_exigir_codigo from kioscos where id=%s", (ka,)) is True, "el dueño lo vuelve a prender")

def errores_local():
    as_("postgres"); return one("select count(*) from club_intentos i join clientes c on c.id=i.cliente_id where c.kiosco_id=%s and i.created_at > now() - interval '1 hour'", (ka,))
antes_local = errores_local()
tope = None
for n in range(40):
    as_("anon"); tk_n = jsn(one("select club_unirse('kiosco-a', %s, %s)", (f"Cupo{n}", f"341556{n:04d}")))["token"]
    libre(cliente_de(tk_n))  # el alta cuenta como compra de hoy: se corre para que el tope diario no tape el intento
    for _ in range(5):
        as_("anon"); rr = jsn(one("select club_sumar(%s,'efectivo',%s)", (tk_n, "ZZZZZZ")))
        if rr.get("_error") == "club_codigo_bloqueado":
            tope = errores_local(); break
        if errores_local() >= 50: break
    if tope is not None: break
ok(tope == 50, f"al llegar a 50 errores en la hora, todo el local queda frenado (hubo {tope} errores al frenar)")
as_("anon"); r = jsn(one("select club_sumar(%s,'efectivo',%s)", (tk_n, cods[2])))
ok(r.get("_error") == "club_codigo_bloqueado", "con el local frenado, ni un papelito válido sirve por un rato")
as_("postgres"); ok(not bool(one("select usado_at is not null from club_codigos where kiosco_id=%s and codigo=%s", (ka, cods[2]))), "el papelito frenado no se gasta")
as_("postgres"); cur.execute("update club_intentos set created_at = created_at - interval '2 hours'"); ok(errores_local() == 0, "pasada la hora el local vuelve a aceptar papelitos")

print("RESULTADO: " + ("OK" if bad == 0 else f"FALLARON {bad}"))
sys.exit(1 if bad else 0)
