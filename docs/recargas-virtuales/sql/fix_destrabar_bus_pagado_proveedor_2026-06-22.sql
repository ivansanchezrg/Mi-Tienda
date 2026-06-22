-- ==========================================
-- FIX PUNTUAL: destrabar ganancias BUS atrapadas (2026-06-22)
-- ==========================================
-- Contexto: fn_registrar_compra_saldo_bus insertaba pagado_proveedor=false (modelo
-- viejo) mientras fn_liquidar_ganancias (vigente desde v2.0) exige pagado_proveedor=true
-- para liquidar. Las filas BUS ya registradas antes del fix de fn_registrar_compra_saldo_bus
-- (v4.1) quedaron permanentemente fuera del filtro de liquidación.
--
-- Este UPDATE marca pagado_proveedor=true en las filas BUS no liquidadas que siguen
-- en false — el mismo estado en el que deberían haber nacido según el modelo unificado.
-- Solo afecta BUS; CELULAR no se toca (su flujo de pago a proveedor funciona aparte).
--
-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor, después de aplicar fn_registrar_compra_saldo_bus v4.1.
-- Es idempotente: si se corre dos veces, la segunda no encuentra filas que actualizar.
-- ==========================================

UPDATE recargas_virtuales rv
SET pagado_proveedor = true
WHERE rv.tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'BUS')
  AND rv.pagado_proveedor = false
  AND rv.ganancia_liquidada = false;

-- Verificación posterior (debe devolver 0 filas):
-- SELECT id, negocio_id, fecha, ganancia, pagado_proveedor, ganancia_liquidada
-- FROM recargas_virtuales
-- WHERE tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'BUS')
--   AND pagado_proveedor = false
--   AND ganancia_liquidada = false;
