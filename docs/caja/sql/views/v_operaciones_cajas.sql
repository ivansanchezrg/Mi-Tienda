-- ==========================================
-- VISTA: v_operaciones_cajas
-- ==========================================
-- Resuelve la categoría de cada operación con la lógica XOR de la migración de
-- categorías de sistema (2026-06-02): una operación apunta a una categoría de
-- usuario (categorias_operaciones) O a una de sistema (categorias_sistema),
-- nunca ambas. La vista expone un único objeto `categoria` con la forma que
-- consume el frontend, más `caja` y `empleado` como JSON anidado.
--
-- Consumida por: operaciones-caja.service.ts (home, historial del día,
-- historial por caja). Misma lógica de resolución que fn_home_dashboard v1.2.
--
-- security_invoker=true → la RLS de operaciones_cajas (negocio_id) aplica al
-- usuario que consulta. Sin esto la vista correría con permisos del owner y
-- expondría operaciones de todos los tenants.
--
-- ⚠️ Archivo recuperado el 2026-06-10: la definición original vivía en la
-- migración 001_categorias_sistema.sql (desmantelada) y solo existía en la BD
-- de Supabase. Reconstruida desde el contrato del frontend (OperacionCaja) y
-- fn_home_dashboard v1.2.
-- ==========================================

CREATE OR REPLACE VIEW v_operaciones_cajas WITH (security_invoker=true, security_barrier=true) AS
SELECT
    oc.id,
    oc.negocio_id,
    oc.fecha,
    oc.caja_id,
    oc.empleado_id,
    oc.tipo_operacion,
    oc.monto,
    oc.saldo_anterior,
    oc.saldo_actual,
    oc.categoria_id,
    oc.categoria_sistema_id,
    oc.tipo_referencia_id,
    oc.referencia_id,
    oc.descripcion,
    oc.comprobante_url,
    -- Orden de columnas verificado contra la vista viva (2026-06-10): categoria, caja,
    -- empleado. NO reordenar — CREATE OR REPLACE VIEW no permite cambiar el orden.
    -- Categoría unificada: usuario primero, sistema después (XOR garantizado por chk_categoria_xor)
    CASE
        WHEN cat.id   IS NOT NULL THEN json_build_object('id', cat.id,   'nombre', cat.nombre,   'codigo', cat.codigo,   'tipo', cat.tipo)
        WHEN cat_s.id IS NOT NULL THEN json_build_object('id', cat_s.id, 'nombre', cat_s.nombre, 'codigo', cat_s.codigo, 'tipo', cat_s.tipo)
        ELSE NULL
    END AS categoria,
    json_build_object('id', c.id, 'nombre', c.nombre, 'codigo', c.codigo) AS caja,
    CASE WHEN u.id IS NULL THEN NULL
         ELSE json_build_object('id', u.id, 'nombre', u.nombre)
    END AS empleado
FROM operaciones_cajas oc
INNER JOIN cajas c        ON c.id  = oc.caja_id
LEFT  JOIN usuarios u     ON u.id  = oc.empleado_id
LEFT  JOIN categorias_operaciones cat   ON cat.id   = oc.categoria_id
LEFT  JOIN categorias_sistema     cat_s ON cat_s.id = oc.categoria_sistema_id;

GRANT SELECT ON v_operaciones_cajas TO authenticated;

NOTIFY pgrst, 'reload schema';
