-- 0065: la tabla venta_lotes_consumo (creada en 0061) quedó sin el bloqueo de escritura de la demo.
-- Idempotente y sin DROP: demo_proteger_tablas() reinstala el trigger en todas las tablas de public (ver 0059).
-- Aplicar DESPUÉS de 0064. No cambia datos ni el comportamiento de la app para kioscos reales.
select public.demo_proteger_tablas();
