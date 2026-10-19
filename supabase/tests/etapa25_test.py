# Verifica 0030 (equipo del kiosco: invitaciones, roles y matriz de permisos rol x tabla x operación).
# Uso: python3 supabase/tests/etapa25_test.py
# Con PG_HOST/PG_PORT: servidor propio (crea una base nueva por corrida). Sin eso: Postgres embebido con pgserver.
import os, psycopg2, uuid, tempfile, sys, json
if os.environ.get("PG_HOST"):
    _admin = psycopg2.connect(host=os.environ["PG_HOST"], port=os.environ.get("PG_PORT", "5432"), user="postgres", dbname="postgres")
    _admin.autocommit = True
    _db = "etapa25_" + uuid.uuid4().hex[:8]
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
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
import glob
for f in sorted(glob.glob("supabase/migrations/*.sql")):
    cur.execute(open(f).read())
A, B, EN, CJ, X, Y = (str(uuid.uuid4()) for _ in range(6))
for u, n in ((A, "dueno"), (B, "otro"), (EN, "encargado"), (CJ, "cajero"), (X, "extrano"), (Y, "nuevo")): cur.execute("insert into auth.users(id,email) values (%s,%s)", (u, n + "@test.com"))
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
def rows(sql, args=None):
    """Filas afectadas / devueltas; si la política lo rechaza con error, devuelve -1."""
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args); n = cur.rowcount; cur.execute("release savepoint s"); return n
    except Exception: cur.execute("rollback to savepoint s"); return -1
def has(err, texto): return texto in (err or "")
def jsn(v): return v if isinstance(v, (dict, list)) else json.loads(v)

# --- datos: local A (dueño A) y local B (dueño B)
as_("authenticated", A)
ka = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco A','kiosco-a','5493415551234',true) returning id", (A,))
as_("authenticated", B)
kb = one("insert into kioscos(owner_id,nombre,slug,whatsapp,abierto) values (%s,'Kiosco B','kiosco-b','5493415559999',true) returning id", (B,))
as_("authenticated", A)
p1 = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,'Alfajor',500,20,true) returning id", (ka,))
p2 = one("insert into productos(kiosco_id,nombre,precio,stock,stock_controlado) values (%s,'Gaseosa',1500,20,true) returning id", (ka,))
cli = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Ana','5493415550001') returning id", (ka,))
as_("authenticated", B)
pb = one("insert into productos(kiosco_id,nombre,precio,stock) values (%s,'Producto de B',999,5) returning id", (kb,))

# ===== 1) Dueño como miembro
as_("postgres")
ok(one("select rol from kiosco_miembros where kiosco_id=%s and user_id=%s", (ka, A)) == "dueno", "el trigger crea al dueño como miembro")
ok(one("select count(*) from kiosco_miembros where kiosco_id=%s", (ka,)) == 1, "el local nuevo arranca con un solo miembro")
as_("authenticated", A); ok(one("select rol_en(%s)", (ka,)) == "dueno", "rol_en: dueño")
as_("authenticated", X); ok(one("select rol_en(%s)", (ka,)) is None, "rol_en: un extraño no tiene rol")
as_("anon"); ok(bool(fails("select rol_en(%s)", (ka,))), "anon no puede llamar rol_en")

# ===== 2) Invitaciones
def invitar(rol, quien=A, k=None):
    as_("authenticated", quien); return jsn(one("select equipo_invitar(%s,%s)", (k or ka, rol)))
for quien, nombre in ((EN, "el encargado"), (CJ, "el cajero"), (X, "un extraño"), (B, "el dueño de otro local")):
    as_("authenticated", quien)
    ok(has(fails("select equipo_invitar(%s,'cajero')", (ka,)), "no_autorizado"), f"{nombre} no puede invitar")
as_("anon"); ok(bool(fails("select equipo_invitar(%s,'cajero')", (ka,))), "anon no puede invitar")
as_("authenticated", A)
ok(has(fails("select equipo_invitar(%s,'dueno')", (ka,)), "rol_invalido"), "no se invita a un dueño")
ok(has(fails("select equipo_invitar(%s,null)", (ka,)), "rol_invalido"), "rol nulo rechazado")
inv_c = invitar("cajero"); inv_e = invitar("encargado")
ok(len(inv_c["token"]) == 64 and inv_c["rol"] == "cajero", "el token tiene 64 caracteres hexadecimales")
as_("postgres")
ok(one("select count(*) from kiosco_invitaciones where token_hash=%s", (inv_c["token"],)) == 0, "la base no guarda el token en claro")
ok(one("select count(*) from kiosco_invitaciones where kiosco_id=%s", (ka,)) == 2, "dos invitaciones creadas")
as_("authenticated", A)
ok(rows("select * from kiosco_invitaciones") == -1, "nadie lee kiosco_invitaciones desde el navegador (dueño)")
as_("anon"); ok(rows("select * from kiosco_invitaciones") == -1, "ni anon")

# ver y aceptar
as_("anon"); ok(bool(fails("select equipo_ver_invitacion(%s)", (inv_c["token"],))), "anon no ve invitaciones")
as_("authenticated", CJ)
v = jsn(one("select equipo_ver_invitacion(%s)", (inv_c["token"],)))
ok(v["rol"] == "cajero" and v["nombre"] == "Kiosco A", "ver invitación muestra rol y local")
ok(has(fails("select equipo_ver_invitacion('abc')"), "invitacion_invalida"), "formato inválido rechazado")
ok(has(fails("select equipo_ver_invitacion(%s)", ("0" * 64,)), "invitacion_invalida"), "token inexistente rechazado")
ok(has(fails("select equipo_aceptar(%s)", (inv_c["token"].upper(),)), "invitacion_invalida"), "token en mayúsculas rechazado")
ac = jsn(one("select equipo_aceptar(%s)", (inv_c["token"],)))
ok(ac["rol"] == "cajero" and ac["kiosco_id"] == ka, "el cajero acepta y queda en el local")
ok(has(fails("select equipo_aceptar(%s)", (inv_c["token"],)), "invitacion_invalida"), "la invitación es de un solo uso")
as_("authenticated", X)
ok(has(fails("select equipo_aceptar(%s)", (inv_c["token"],)), "invitacion_invalida"), "otra persona no reusa el enlace")
as_("authenticated", B)
ok(has(fails("select equipo_aceptar(%s)", (inv_e["token"],)), "ya_tiene_local"), "quien ya tiene un local no entra a otro")
as_("authenticated", A)
ok(has(fails("select equipo_aceptar(%s)", (inv_e["token"],)), "ya_es_miembro"), "el dueño no se invita a sí mismo")
as_("authenticated", EN); ac = jsn(one("select equipo_aceptar(%s)", (inv_e["token"],)))
ok(ac["rol"] == "encargado", "el encargado acepta")
as_("postgres")
ok(one("select usado_por from kiosco_invitaciones where token_hash=encode(sha256(convert_to(%s,'utf8')),'hex')", (inv_c["token"],)) == CJ, "queda registrado quién usó la invitación")
ok(one("select invitado_por from kiosco_miembros where user_id=%s", (CJ,)) == A, "queda registrado quién invitó")

# revocada y vencida
inv_r = invitar("cajero"); inv_v = invitar("cajero")
as_("postgres")
idr = one("select id from kiosco_invitaciones where token_hash=encode(sha256(convert_to(%s,'utf8')),'hex')", (inv_r["token"],))
cur.execute("update kiosco_invitaciones set expira_at = now() - interval '1 minute' where token_hash=encode(sha256(convert_to(%s,'utf8')),'hex')", (inv_v["token"],))
as_("authenticated", EN); ok(has(fails("select equipo_revocar_invitacion(%s)", (idr,)), "no_autorizado"), "el encargado no revoca invitaciones")
as_("authenticated", A); cur.execute("select equipo_revocar_invitacion(%s)", (idr,))
as_("authenticated", Y)
ok(has(fails("select equipo_aceptar(%s)", (inv_r["token"],)), "invitacion_invalida"), "invitación revocada rechazada")
ok(has(fails("select equipo_aceptar(%s)", (inv_v["token"],)), "invitacion_invalida"), "invitación vencida rechazada")
ok(has(fails("select equipo_ver_invitacion(%s)", (inv_r["token"],)), "invitacion_invalida"), "ver: revocada rechazada")

# listar
as_("authenticated", A)
eq = jsn(one("select equipo_listar(%s)", (ka,)))
ok([m["rol"] for m in eq["miembros"]] == ["dueno", "encargado", "cajero"] or sorted(m["rol"] for m in eq["miembros"]) == ["cajero", "dueno", "encargado"], "listar: tres miembros")
ok(eq["miembros"][0]["rol"] == "dueno", "listar: el dueño primero")
ok(len(eq["invitaciones"]) == 0, "listar: sin invitaciones pendientes (usadas, revocadas o vencidas no figuran)")
for quien in (EN, CJ, X):
    as_("authenticated", quien); ok(has(fails("select equipo_listar(%s)", (ka,)), "no_autorizado"), "equipo_listar solo para el dueño")

# lectura de kiosco_miembros
as_("authenticated", CJ)
ok(rows("select * from kiosco_miembros") == 1, "el cajero ve solo su propia fila")
as_("authenticated", EN); ok(rows("select * from kiosco_miembros") == 1, "el encargado ve solo su propia fila")
as_("authenticated", A); ok(rows("select * from kiosco_miembros where kiosco_id=%s", (ka,)) == 3, "el dueño ve todo el equipo")
as_("authenticated", X); ok(rows("select * from kiosco_miembros") == 0, "un extraño no ve a nadie")
as_("authenticated", B); ok(rows("select * from kiosco_miembros where kiosco_id=%s", (ka,)) == 0, "otro dueño no ve mi equipo")
for quien in (A, CJ, EN):
    as_("authenticated", quien)
    ok(rows("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'dueno')", (ka, X)) == -1, "no se escribe kiosco_miembros desde el navegador")
    ok(rows("update kiosco_miembros set rol='dueno' where user_id=%s", (CJ,)) == -1, "no se sube de rol por UPDATE directo")

# ===== 3) Matriz de permisos
# 3a) productos: todos leen, solo encargado y dueño escriben
for quien, nombre, puede in ((A, "dueño", True), (EN, "encargado", True), (CJ, "cajero", False), (X, "extraño", False)):
    as_("authenticated", quien)
    leidos = rows("select * from productos where kiosco_id=%s", (ka,))
    ok(leidos == 2, f"productos: lectura del {nombre} (el catálogo disponible es público para la tienda)")
    ok((rows("update productos set precio=precio+1 where id=%s", (p1,)) == 1) == puede, f"productos: editar precio ({nombre})")
    ok((rows("insert into productos(kiosco_id,nombre,precio) values (%s,'Nuevo',1)", (ka,)) == 1) == puede, f"productos: crear ({nombre})")
    ok((rows("delete from productos where nombre='Nuevo' and kiosco_id=%s", (ka,)) >= 1) == puede, f"productos: borrar ({nombre})")
as_("authenticated", B)
ok(rows("update productos set precio=1 where id=%s", (p1,)) == 0, "otro dueño no toca mis productos")
as_("authenticated", A); ok(rows("update productos set precio=1 where id=%s", (pb,)) == 0, "mis roles no atraviesan al local B")
as_("authenticated", EN); ok(rows("update productos set precio=1 where id=%s", (pb,)) == 0, "el encargado de A no toca productos de B")

# 3b) ajustes de stock y precios por RPC
for quien, nombre, puede in ((A, "dueño", True), (EN, "encargado", True), (CJ, "cajero", False), (X, "extraño", False)):
    as_("authenticated", quien)
    e = fails("select ajustar_stock(%s,%s,'Conteo')", (p1, {A: 19, EN: 18, CJ: 17, X: 16}[quien]))
    ok((e is False) == puede and (puede or has(e, "no_autorizado")), f"ajustar_stock ({nombre})")
as_("authenticated", CJ)
ok(bool(fails("select sumar_stock_rapido(%s,1)", (p1,))), "el cajero no suma stock")

# 3c) pedidos: el cajero ve y confirma; no borra
as_("anon")
pid = jsn(one("select crear_pedido('kiosco-a','Ana','5493415550001','retiro',null,null,%s::jsonb,'efectivo')", (json.dumps([{"producto_id": p2, "cantidad": 1}]),)))["pedido_id"]
pid2 = jsn(one("select crear_pedido('kiosco-a','Beto','5493415550002','retiro',null,null,%s::jsonb,'efectivo')", (json.dumps([{"producto_id": p2, "cantidad": 1}]),)))["pedido_id"]
as_("authenticated", CJ)
ok(rows("select * from pedidos where kiosco_id=%s", (ka,)) == 2, "el cajero ve los pedidos")
ok(rows("select * from pedido_items where pedido_id=%s", (pid,)) == 1, "el cajero ve los ítems del pedido")
ok(rows("update pedidos set estado='confirmado' where id=%s", (pid,)) == 1, "el cajero confirma pedidos")
ok(rows("delete from pedidos where id=%s", (pid2,)) == 0, "el cajero NO borra pedidos")
as_("authenticated", X); ok(rows("select * from pedidos where kiosco_id=%s", (ka,)) == 0, "un extraño no ve pedidos")
as_("authenticated", B); ok(rows("update pedidos set estado='cancelado' where id=%s", (pid,)) == 0, "otro dueño no toca mis pedidos")
as_("authenticated", EN); ok(rows("delete from pedidos where id=%s", (pid2,)) == 1, "el encargado sí borra pedidos")

# 3d) clientes y fiado
as_("authenticated", CJ)
ok(rows("select * from clientes where kiosco_id=%s", (ka,)) >= 1, "el cajero ve clientes")
ok(rows("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Carla','5493415550003')", (ka,)) == 1, "el cajero da de alta clientes")
ok(rows("delete from clientes where nombre='Carla' and kiosco_id=%s", (ka,)) == 0, "el cajero NO borra clientes")
ok(rows("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'fiado',100)", (ka, cli)) == 1, "el cajero anota fiado")
ok(rows("update fiado_movimientos set monto=1 where cliente_id=%s", (cli,)) == 0, "el cajero NO corrige fiado")
ok(rows("delete from fiado_movimientos where cliente_id=%s", (cli,)) == 0, "el cajero NO borra fiado")
as_("authenticated", EN)
ok(rows("update fiado_movimientos set nota='ok' where cliente_id=%s", (cli,)) == 1, "el encargado corrige fiado")
as_("authenticated", X); ok(rows("insert into fiado_movimientos(kiosco_id,cliente_id,tipo,monto) values (%s,%s,'fiado',1)", (ka, cli)) == -1, "un extraño no anota fiado")

# 3e) compras, proveedores y reportes: solo encargado y dueño
as_("authenticated", EN)
prov = jsn(one("select proveedor_guardar(%s,null,'Distribuidora')", (ka,)))
prov_id = prov["id"] if isinstance(prov, dict) and "id" in prov else prov
ok(prov_id is not None, "el encargado crea proveedores")
as_("authenticated", CJ)
ok(has(fails("select proveedor_guardar(%s,null,'Otro')", (ka,)), "no_autorizado"), "el cajero NO crea proveedores")
ok(rows("select * from proveedores where kiosco_id=%s", (ka,)) == 0, "el cajero NO ve proveedores")
ok(rows("select * from compras where kiosco_id=%s", (ka,)) == 0, "el cajero NO ve compras")
ok(bool(fails("select registrar_compra(%s,%s,%s::jsonb)", (ka, prov_id, json.dumps([{"producto_id": p1, "cantidad": 1, "costo": 10}])))), "el cajero NO registra compras")
ok(bool(fails("select reporte_mermas(%s, now() - interval '1 day', now())", (ka,))), "el cajero NO ve mermas")
ok(bool(fails("select fidelidad_resumen(%s)", (ka,))), "el cajero NO ve el resumen de fidelidad")
as_("authenticated", EN)
ok(rows("select * from proveedores where kiosco_id=%s", (ka,)) == 1, "el encargado ve proveedores")
ok(fails("select registrar_compra(%s,%s,%s::jsonb)", (ka, prov_id, json.dumps([{"producto_id": p1, "cantidad": 1, "costo": 10}]))) is False, "el encargado registra compras")
ok(fails("select reporte_mermas(%s, now() - interval '1 day', now())", (ka,)) is False, "el encargado ve mermas")

# 3f) solo dueño: Mi negocio, pagos, PIN, baja, exportación, equipo
for quien, nombre in ((EN, "encargado"), (CJ, "cajero"), (X, "extraño")):
    as_("authenticated", quien)
    ok(rows("update kioscos set nombre='Hackeado' where id=%s", (ka,)) == 0, f"{nombre}: no edita Mi negocio")
    ok(has(fails("select mp_estado_conexion(%s)", (ka,)), "no_autorizado"), f"{nombre}: no ve la conexión de Mercado Pago")
    ok(has(fails("select pos_pin_definir(%s,'1234')", (ka,)), "no_autorizado"), f"{nombre}: no define el PIN")
    ok(bool(fails("select kiosco_pedir_baja(%s,'Kiosco A')", (ka,))), f"{nombre}: no pide la baja")
    ok(bool(fails("select kiosco_exportar_seccion(%s,'productos')", (ka,))), f"{nombre}: no exporta datos")
    ok(rows("select * from integraciones_pago") <= 0, f"{nombre}: no lee integraciones_pago")
    ok(has(fails("select equipo_cambiar_rol(%s,%s,'cajero')", (ka, EN)), "no_autorizado"), f"{nombre}: no cambia roles")
    ok(has(fails("select equipo_quitar(%s,%s)", (ka, CJ)), "no_autorizado"), f"{nombre}: no quita gente")
as_("authenticated", EN); ok(rows("select * from pos_config") <= 0, "el encargado no lee pos_config (guarda el hash del PIN)")
as_("authenticated", CJ); ok(rows("select * from pos_config") <= 0, "el cajero no lee pos_config")
as_("authenticated", EN); ok(rows("delete from kioscos where id=%s", (ka,)) == 0, "el encargado no borra el local")

# 3f2) borrar_cliente: encargado y dueño (igual que la política de la tabla)
as_("authenticated", A)
cl2 = one("insert into clientes(kiosco_id,nombre,telefono) values (%s,'Para borrar','5493415550077') returning id", (ka,))
as_("authenticated", CJ); ok(has(fails("select borrar_cliente(%s)", (cl2,)), "no_autorizado"), "el cajero NO usa borrar_cliente")
as_("authenticated", EN); ok(fails("select borrar_cliente(%s)", (cl2,)) is False, "el encargado usa borrar_cliente")

# 3g) Fotos: dueño y encargado
for quien, nombre, puede in ((A, "dueño", True), (EN, "encargado", True), (CJ, "cajero", False), (X, "extraño", False)):
    as_("authenticated", quien)
    ok(one("select es_dueno_de_carpeta(%s)", (f"{ka}/foto.jpg",)) == puede, f"carpeta de fotos ({nombre})")
ok(one("select es_dueno_de_carpeta('no-es-uuid/foto.jpg')") is False, "carpeta de fotos: nombre inválido")

# ===== 4) Caja: el cajero vende; la anulación pide supervisor
as_("authenticated", CJ)
turno = jsn(one("select caja_abrir_turno(%s, 1000)", (ka,)))["turno_id"]
ok(turno is not None, "el cajero abre la caja")
def vender(quien=CJ, items=None):
    as_("authenticated", quien)
    return jsn(one("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps(items or [{"producto_id": p1, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 5000}]))))
v1 = vender(); v2 = vender(); v3 = vender(EN); v4 = vender()
as_("postgres")
ok(one("select usuario_id from ventas_mostrador where id=%s", (v1["venta_id"],)) == CJ, "la venta registra quién la hizo (cajero)")
ok(one("select usuario_id from ventas_mostrador where id=%s", (v3["venta_id"],)) == EN, "la venta registra quién la hizo (encargado)")
as_("authenticated", CJ)
ok(rows("select * from ventas_mostrador where kiosco_id=%s", (ka,)) == 4, "el cajero ve las ventas")
ok(fails("select caja_resumen(%s)", (turno,)) is False, "el cajero ve el resumen de caja")
ok(fails("select caja_reporte_z(%s)", (turno,)) is False, "el cajero ve el reporte Z de su turno (lo necesita para cerrar la caja)")
as_("authenticated", X); ok(has(fails("select caja_reporte_z(%s)", (turno,)), "no_autorizado"), "un extraño NO ve el reporte Z")
as_("authenticated", CJ)
ok(rows("delete from ventas_mostrador where id=%s", (v1["venta_id"],)) <= 0, "el cajero no borra ventas")
ok(rows("update ventas_mostrador set total=1 where id=%s", (v1["venta_id"],)) <= 0, "el cajero no altera ventas")
ok(rows("update turnos_caja set monto_inicial=999999 where id=%s", (turno,)) <= 0, "el cajero no altera turnos por UPDATE directo")
as_("authenticated", EN); ok(fails("select caja_reporte_z(%s)", (turno,)) is False, "el encargado ve el reporte Z")
as_("authenticated", X)
ok(has(fails("select caja_abrir_turno(%s, 1)", (ka,)), "no_autorizado"), "un extraño no abre caja")
ok(bool(fails("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps([{"producto_id": p1, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 5000}])))), "un extraño no vende en mi caja")
as_("authenticated", B)
ok(bool(fails("select registrar_venta_mostrador(%s,%s::jsonb,%s::jsonb)", (turno, json.dumps([{"producto_id": p1, "cantidad": 1}]), json.dumps([{"medio": "efectivo", "monto": 5000}])))), "otro dueño no vende en mi caja")

# Anular: sin PIN configurado el cajero no puede
as_("authenticated", CJ)
ok(has(fails("select anular_venta_mostrador(%s,'Error de carga')", (v1["venta_id"],)), "supervisor_requerido"), "cajero sin PIN de local: no anula (supervisor_requerido)")
item1 = one("select id from ventas_mostrador_items where venta_id=%s limit 1", (v1["venta_id"],))
ok(has(fails("select devolver_venta_mostrador(%s,%s::jsonb,'efectivo','Falla')", (v1["venta_id"], json.dumps([{"item_id": item1, "cantidad": 1}]))), "supervisor_requerido"), "cajero sin PIN de local: no devuelve")
as_("authenticated", EN)
ok(fails("select anular_venta_mostrador(%s,'Error de carga')", (v3["venta_id"],)) is False, "el encargado anula sin PIN cuando el local no tiene PIN")
# El dueño define el PIN
as_("authenticated", A); cur.execute("select pos_pin_definir(%s,'4321')", (ka,))
as_("authenticated", CJ)
ok(has(fails("select anular_venta_mostrador(%s,'Error de carga')", (v1["venta_id"],)), "pin_requerido"), "cajero con PIN de local pero sin token: pin_requerido")
ok(has(fails("select anular_venta_mostrador(%s,'Error de carga',%s)", (v1["venta_id"], str(uuid.uuid4()))), "pin_requerido"), "token inventado no sirve")
r = jsn(one("select pos_pin_verificar(%s,'0000')", (ka,)))
ok(r["ok"] is False, "PIN equivocado: no da token")
r = jsn(one("select pos_pin_verificar(%s,'4321')", (ka,)))
ok(r["ok"] is True and r.get("token"), "el supervisor ingresa el PIN en la caja del cajero y obtiene un token")
tok = r["token"]
as_("authenticated", X); ok(has(fails("select pos_pin_verificar(%s,'4321')", (ka,)), "no_autorizado"), "un extraño no puede probar el PIN")
as_("authenticated", CJ)
ok(fails("select anular_venta_mostrador(%s,'Error de carga',%s)", (v1["venta_id"], tok)) is False, "con token de supervisor el cajero anula")
ok(has(fails("select anular_venta_mostrador(%s,'Error de carga',%s)", (v2["venta_id"], tok)), "pin_requerido"), "el token es de un solo uso")
tok2 = jsn(one("select pos_pin_verificar(%s,'4321')", (ka,)))["token"]
item = one("select id from ventas_mostrador_items where venta_id=%s limit 1", (v2["venta_id"],))
ok(has(fails("select devolver_venta_mostrador(%s,%s::jsonb,'efectivo','Falla')", (v2["venta_id"], json.dumps([{"item_id": item, "cantidad": 1}]))), "pin_requerido"), "devolución del cajero sin token: pin_requerido")
e = fails("select devolver_venta_mostrador(%s,%s::jsonb,'efectivo','Falla',%s)", (v2["venta_id"], json.dumps([{"item_id": item, "cantidad": 1}]), tok2))
ok(e is False, "devolución del cajero con token de supervisor" + ("" if e is False else f" ({e})"))
as_("postgres")
ok(one("select count(*) from devoluciones_mostrador where venta_id=%s", (v2["venta_id"],)) == 1, "la devolución quedó registrada")
ok(one("select usuario_id from devoluciones_mostrador where venta_id=%s", (v2["venta_id"],)) == CJ, "la devolución registra quién la hizo")

# El token no sirve entre locales
as_("authenticated", B); cur.execute("select pos_pin_definir(%s,'1111')", (kb,))
tokb = jsn(one("select pos_pin_verificar(%s,'1111')", (kb,)))["token"]
as_("authenticated", CJ)
ok(has(fails("select anular_venta_mostrador(%s,'Error de carga',%s)", (v4["venta_id"], tokb)), "pin_requerido"), "el token de otro local no sirve")

# pos_config_publica: sin secretos
as_("authenticated", CJ)
cfg = jsn(one("select pos_config_publica(%s)", (ka,)))
ok("pin_hash" not in cfg and "pin_salt" not in cfg and cfg["tiene_pin"] is True, "pos_config_publica expone tiene_pin pero no el hash ni la sal")
as_("authenticated", X); ok(has(fails("select pos_config_publica(%s)", (ka,)), "no_autorizado"), "un extraño no lee la configuración del mostrador")
as_("anon"); ok(bool(fails("select pos_config_publica(%s)", (ka,))), "anon no lee la configuración del mostrador")

# ===== 5) Cambiar rol y quitar: efecto inmediato
as_("authenticated", A)
ok(has(fails("select equipo_cambiar_rol(%s,%s,'cajero')", (ka, A)), "no_se_puede_cambiar_dueno"), "no se cambia el rol del dueño")
ok(has(fails("select equipo_quitar(%s,%s)", (ka, A)), "no_se_puede_cambiar_dueno"), "no se quita al dueño")
ok(has(fails("select equipo_cambiar_rol(%s,%s,'dueno')", (ka, CJ)), "rol_invalido"), "no se ascende a dueño")
ok(has(fails("select equipo_cambiar_rol(%s,%s,'cajero')", (ka, X)), "miembro_no_encontrado"), "cambiar rol de alguien que no es miembro")
ok(has(fails("select equipo_cambiar_rol(%s,%s,'cajero')", (kb, CJ)), "no_autorizado"), "el dueño de A no administra el equipo de B")
cur.execute("select equipo_cambiar_rol(%s,%s,'encargado')", (ka, CJ))
as_("authenticated", CJ)
ok(rows("update productos set precio=precio+1 where id=%s", (p1,)) == 1, "al subirlo a encargado puede editar productos")
as_("authenticated", A); cur.execute("select equipo_cambiar_rol(%s,%s,'cajero')", (ka, CJ))
as_("authenticated", CJ)
ok(rows("update productos set precio=precio+1 where id=%s", (p1,)) == 0, "al bajarlo a cajero lo pierde en el acto")
as_("authenticated", A); cur.execute("select equipo_quitar(%s,%s)", (ka, CJ))
as_("authenticated", CJ)
ok(rows("select * from clientes where kiosco_id=%s", (ka,)) == 0, "un miembro quitado no ve clientes")
ok(rows("update productos set precio=precio+1 where id=%s", (p1,)) == 0, "un miembro quitado no edita productos")
ok(rows("select * from pedidos where kiosco_id=%s", (ka,)) == 0, "un miembro quitado no ve pedidos")
ok(bool(fails("select caja_abrir_turno(%s, 1)", (ka,))), "un miembro quitado no abre caja")
ok(one("select rol_en(%s)", (ka,)) is None, "rol_en de un miembro quitado: nulo")
as_("authenticated", A)
ok(has(fails("select equipo_quitar(%s,%s)", (ka, CJ)), "miembro_no_encontrado"), "quitar dos veces: miembro_no_encontrado")
inv2 = invitar("encargado")
as_("authenticated", CJ); ac = jsn(one("select equipo_aceptar(%s)", (inv2["token"],)))
ok(ac["rol"] == "encargado", "quien fue quitado puede volver con una invitación nueva")
as_("postgres")
ok(one("select count(*) from kiosco_miembros where user_id=%s", (CJ,)) == 1, "reingreso: no duplica la fila de miembro")
ok(one("select count(*) from kiosco_miembros where user_id=%s and activo", (CJ,)) == 1, "una sola membresía activa por persona")
ok(bool(fails("insert into kiosco_miembros(kiosco_id,user_id,rol) values (%s,%s,'cajero')", (kb, CJ))), "el índice impide dos locales activos para una persona")

# ===== 6) Límites
as_("authenticated", A)
for _ in range(21):
    e = fails("select equipo_invitar(%s,'cajero')", (ka,))
    if e: break
ok(has(e, "demasiadas_invitaciones"), "tope de 20 invitaciones pendientes")

# ===== 7) Las funciones que no están en la matriz siguen cerradas para el equipo (falla cerrado)
as_("postgres")
cur.execute("""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) ~ 'es_dueno\\(' and p.proname not in ('es_dueno','es_dueno_de_carpeta')""")
restantes = sorted(r[0] for r in cur.fetchall())
print("   (solo dueño:", ", ".join(restantes), ")")
ok("anular_venta_mostrador" not in restantes and "registrar_venta_mostrador" not in restantes, "las funciones del mostrador ya no exigen ser dueño de la cuenta")
for f in ("mp_estado_conexion", "mp_desconectar", "pos_pin_definir", "pos_pin_quitar", "pos_pin_opciones"):
    ok(f in restantes, f"{f} queda solo para el dueño (no está en la matriz)")

cur.execute("rollback")
print(f"\n{'OK' if bad == 0 else 'HAY FALLAS'}: {bad} falla(s)")
sys.exit(1 if bad else 0)
