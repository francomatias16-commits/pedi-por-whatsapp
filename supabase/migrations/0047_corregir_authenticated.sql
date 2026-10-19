do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('caja_neto_movimientos','caja_ventas_efectivo','caja_ventas_por_medio','club_armar_tarjeta','club_bloqueo','club_otorgar','fiado_avisos_semanales','fiado_vencido_calc','fidelidad_aplica','fidelidad_calcular','fidelidad_inicial','fidelidad_otorgar','fidelidad_venta','fidelidad_venta_anulada','fotos_limpieza_marcar','fotos_limpieza_pendientes','fotos_usar_cupo','fuga_avisos_semanales','fuga_conteo_semanal','kiosco_abierto_ahora','kioscos_alta_miembro_dueno','kioscos_purgar_bajas','pago_confirmar','pago_estado_pedido','pago_puede_consultar','pago_vencer_pendientes','pedidos_proteger_pago','pedidos_proteger_seguimiento','pos_consumir_token','pos_exigir_pin','pos_exigir_supervisor','productos_valida_proveedor','qr_cancelar_cobro','qr_confirmar','qr_crear_cobro','qr_estado_cobro','qr_puede_consultar','qr_vencer_pendientes','reglas_avisos_diarios','reposicion_avisos_diarios','reposicion_calcular','reposicion_dias_ventana','reposicion_ventas_30d','sello_por_entrega','stock_al_consumir','stock_registrar_movimiento','ventas_pagos_exigir_qr','webhook_marcar','webhook_registrar')
  loop
    execute format('revoke execute on function %s from authenticated', r.fn);
  end loop;
end $$;