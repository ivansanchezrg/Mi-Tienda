-- =============================================================================
-- v_saldos_empleados
-- =============================================================================
-- Calcula el saldo actual de cada empleado del negocio activo (JWT).
-- Usado en: página lista de cuentas empleados, badge del sidebar.
--
-- saldo > 0 → el negocio le debe al empleado (sueldo pendiente)
-- saldo < 0 → el empleado le debe al negocio (faltantes/adelantos netos)
-- saldo = 0 → al día
--
-- IMPORTANTE:
--   - Filtra por get_negocio_id() — solo muestra empleados del negocio activo del JWT.
--     Sin este filtro, la RLS OR clause de usuario_negocios multiplica filas
--     (devuelve membresías de todos los negocios propios del admin).
--   - Solo empleados con activo = TRUE en este negocio. Los transferidos
--     (activo = FALSE) no aparecen, pero sus movimientos PENDIENTE permanecen
--     en movimientos_empleados y son consultables via query directa.
-- =============================================================================

CREATE OR REPLACE VIEW v_saldos_empleados WITH (security_barrier=true) AS
SELECT
    un.negocio_id,
    u.id   AS empleado_id,
    u.nombre,
    COALESCE(SUM(
        CASE
            WHEN m.tipo_movimiento IN ('SUELDO_BASE', 'BONO_COMISION', 'AJUSTE_ABONO')                                         THEN  m.monto
            WHEN m.tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'PAGO_NOMINA', 'AJUSTE_CARGO', 'SALDO_ARRASTRE') THEN -m.monto
        END
    ), 0) AS saldo
FROM usuario_negocios un
JOIN usuarios u ON u.id = un.usuario_id
LEFT JOIN movimientos_empleados m
    ON m.empleado_id = u.id
   AND m.negocio_id  = un.negocio_id
   AND m.estado_liquidacion = 'PENDIENTE'
WHERE un.negocio_id = public.get_negocio_id()
  AND un.activo = TRUE
GROUP BY un.negocio_id, u.id, u.nombre
ORDER BY u.nombre;

NOTIFY pgrst, 'reload schema';
