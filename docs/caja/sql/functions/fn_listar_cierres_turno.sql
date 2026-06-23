-- ==========================================
-- fn_listar_cierres_turno
-- ==========================================
-- Reconstruye el resumen del cierre de cada turno cerrado en el rango de fechas
-- a partir del ledger inmutable (operaciones_cajas + recargas + ventas).
--
-- v2.1 — usa_pos ahora refleja cualquier movimiento del cajón (ventas POS,
--   ingresos manuales o egresos). Antes solo consideraba ventas POS,
--   dejando el cuadre desactivado cuando había ingresos/egresos manuales sin POS.
-- v2 — optimizaciones de correctitud y performance:
--   • Resuelve IDs (cajas, categorías, servicios, negocio) en variables locales
--     antes del query principal. Una sola query por ID, no por fila.
--   • Filtra el rango de fechas usando ventana UTC derivada de p_fecha_desde/hasta
--     para que el índice de hora_fecha_cierre se use.
--   • Fallback a saldo_actual de la caja cuando NO existe fila CIERRE/TRANSFERENCIA
--     (caso v_dinero_a_depositar = 0 → sin fila): evita reportar $0 falso.
--   • Quita el INTERVAL '5 minutes' del ajuste (era defensivo y podía arrastrar
--     ajustes del turno siguiente; ahora usa <= hora_fecha_cierre estricto).
--
-- LANGUAGE plpgsql STABLE: lectura pura. Sin fn_assert_no_superadmin
--   (el superadmin SÍ necesita poder revisar el historial).
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_listar_cierres_turno(DATE, DATE);

CREATE OR REPLACE FUNCTION public.fn_listar_cierres_turno(
    p_fecha_desde DATE,
    p_fecha_hasta DATE
)
RETURNS TABLE (
    turno_id                       UUID,
    numero_turno                   SMALLINT,
    empleado_id                    UUID,
    empleado_nombre                VARCHAR,
    hora_fecha_apertura            TIMESTAMP WITH TIME ZONE,
    hora_fecha_cierre              TIMESTAMP WITH TIME ZONE,
    fondo_apertura                 DECIMAL(12,2),
    ventas_pos_efectivo            DECIMAL(12,2),
    egresos                        DECIMAL(12,2),
    otros_ingresos                 DECIMAL(12,2),
    efectivo_fisico                DECIMAL(12,2),
    diferencia                     DECIMAL(12,2),
    deposito_caja                  DECIMAL(12,2),
    transferencia_varios           DECIMAL(12,2),
    saldo_anterior_caja            DECIMAL(12,2),
    saldo_final_caja               DECIMAL(12,2),
    saldo_anterior_varios          DECIMAL(12,2),
    saldo_final_varios             DECIMAL(12,2),
    celular_habilitado             BOOLEAN,
    saldo_anterior_celular         DECIMAL(12,2),
    saldo_final_celular            DECIMAL(12,2),
    venta_celular                  DECIMAL(12,2),
    saldo_virtual_anterior_celular DECIMAL(12,2),
    saldo_virtual_final_celular    DECIMAL(12,2),
    bus_habilitado                 BOOLEAN,
    saldo_anterior_bus             DECIMAL(12,2),
    saldo_final_bus                DECIMAL(12,2),
    venta_bus                      DECIMAL(12,2),
    saldo_virtual_anterior_bus     DECIMAL(12,2),
    saldo_virtual_final_bus        DECIMAL(12,2),
    varios_activa                  BOOLEAN,
    observaciones                  TEXT,
    usa_pos                        BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;

    -- IDs resueltos una vez
    v_caja_id              UUID;
    v_chica_id             UUID;
    v_varios_id            UUID;
    v_celular_id           UUID;
    v_bus_id               UUID;
    -- UUIDs fijos de categorias_sistema (no dependen del negocio)
    v_cat_ajuste_in      CONSTANT UUID := 'a1000001-0000-0000-0000-000000000003';  -- AJU-CONTEO-IN
    v_cat_ajuste_eg      CONSTANT UUID := 'a1000001-0000-0000-0000-000000000004';  -- AJU-CONTEO-EG
    v_cat_cierre_sin_pos CONSTANT UUID := 'a1000001-0000-0000-0000-000000000001';  -- CIE-SIN-POS
    v_tipo_celular         INTEGER;
    v_tipo_bus             INTEGER;
    v_varios_activa        BOOLEAN;

    -- Saldos actuales de las cajas (fallback cuando no hay operación en el turno)
    v_saldo_caja_act    DECIMAL(12,2);
    v_saldo_varios_act  DECIMAL(12,2);
    v_saldo_celular_act DECIMAL(12,2);
    v_saldo_bus_act     DECIMAL(12,2);

    -- Ventana UTC del rango: zona Ecuador es UTC-5, sin DST.
    -- p_fecha_desde 00:00 EC = (p_fecha_desde) 05:00 UTC
    -- p_fecha_hasta 23:59:59.999 EC = (p_fecha_hasta + 1) 04:59:59.999 UTC
    v_inicio_utc TIMESTAMPTZ;
    v_fin_utc    TIMESTAMPTZ;
BEGIN
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RETURN;
    END IF;

    -- Ventana de fechas convertida a UTC para que el índice de hora_fecha_cierre se use.
    v_inicio_utc := (p_fecha_desde::timestamp AT TIME ZONE 'America/Guayaquil');
    v_fin_utc    := ((p_fecha_hasta + 1)::timestamp AT TIME ZONE 'America/Guayaquil');

    -- Resolver IDs una sola vez
    v_caja_id    := (SELECT id FROM cajas WHERE codigo = 'CAJA'         AND negocio_id = v_negocio_id);
    v_chica_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA'   AND negocio_id = v_negocio_id);
    v_varios_id  := (SELECT id FROM cajas WHERE codigo = 'VARIOS'       AND negocio_id = v_negocio_id);
    v_celular_id := (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR' AND negocio_id = v_negocio_id);
    v_bus_id     := (SELECT id FROM cajas WHERE codigo = 'CAJA_BUS'     AND negocio_id = v_negocio_id);

    -- v_cat_ajuste_in, v_cat_ajuste_eg, v_cat_cierre_sin_pos: CONSTANT declaradas arriba

    v_tipo_celular := (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR');
    v_tipo_bus     := (SELECT id FROM tipos_servicio WHERE codigo = 'BUS');

    v_varios_activa := COALESCE(
        (SELECT valor = 'true' FROM configuraciones
          WHERE negocio_id = v_negocio_id AND clave = 'caja_varios_activa'),
        FALSE
    );

    -- Saldos actuales (fallback cuando un turno no movió esa caja)
    v_saldo_caja_act    := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_caja_id),    0);
    v_saldo_varios_act  := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_varios_id),  0);
    v_saldo_celular_act := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_celular_id), 0);
    v_saldo_bus_act     := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_bus_id),     0);

    -- Query principal
    RETURN QUERY
    WITH turnos AS (
        SELECT t.id, t.numero_turno, t.empleado_id, t.hora_fecha_apertura,
               t.hora_fecha_cierre, t.fondo_apertura, u.nombre AS emp_nombre
        FROM turnos_caja t
        JOIN usuarios u ON u.id = t.empleado_id
        WHERE t.negocio_id = v_negocio_id
          AND t.hora_fecha_cierre IS NOT NULL
          AND t.hora_fecha_cierre >= v_inicio_utc
          AND t.hora_fecha_cierre <  v_fin_utc
    ),
    -- Ventas POS efectivo del turno
    agg_ventas AS (
        SELECT v.turno_id, SUM(v.total)::DECIMAL(12,2) AS total
        FROM ventas v
        WHERE v.negocio_id   = v_negocio_id
          AND v.metodo_pago  = 'EFECTIVO'
          AND v.estado       = 'COMPLETADA'
          AND v.turno_id IN (SELECT id FROM turnos)
        GROUP BY v.turno_id
    ),
    -- Egresos del cajón durante el turno (excluyendo ajustes)
    agg_egresos AS (
        SELECT t.id AS turno_id,
               COALESCE(SUM(o.monto), 0)::DECIMAL(12,2) AS total
        FROM turnos t
        LEFT JOIN operaciones_cajas o
            ON o.negocio_id     = v_negocio_id
           AND o.caja_id        = v_chica_id
           AND o.tipo_operacion = 'EGRESO'
           AND o.fecha         >= t.hora_fecha_apertura
           AND o.fecha         <  t.hora_fecha_cierre
           AND (o.categoria_id IS NULL OR o.categoria_id <> v_cat_ajuste_eg)
        GROUP BY t.id
    ),
    -- Ajuste de conteo: +sobrante / -faltante
    agg_ajuste AS (
        SELECT t.id AS turno_id,
               COALESCE(SUM(
                   CASE
                       WHEN o.categoria_id = v_cat_ajuste_in THEN  o.monto
                       WHEN o.categoria_id = v_cat_ajuste_eg THEN -o.monto
                       ELSE 0
                   END
               ), 0)::DECIMAL(12,2) AS diferencia
        FROM turnos t
        LEFT JOIN operaciones_cajas o
            ON o.negocio_id  = v_negocio_id
           AND o.caja_id     = v_chica_id
           AND o.categoria_id IN (v_cat_ajuste_in, v_cat_ajuste_eg)
           AND o.fecha      >= t.hora_fecha_apertura
           AND o.fecha      <= t.hora_fecha_cierre
        GROUP BY t.id
    ),
    -- Depósito a CAJA al cerrar (puede no existir si todo fue a VARIOS)
    op_deposito AS (
        SELECT o.referencia_id AS turno_id,
               o.monto         AS deposito,
               o.saldo_anterior,
               o.saldo_actual,
               o.descripcion,
               o.categoria_id
        FROM operaciones_cajas o
        WHERE o.negocio_id     = v_negocio_id
          AND o.caja_id        = v_caja_id
          AND o.tipo_operacion = 'CIERRE'
          AND o.referencia_id IN (SELECT id FROM turnos)
    ),
    -- Transferencia a VARIOS (puede no existir si efectivo < transferencia diaria)
    op_transferencia AS (
        SELECT o.referencia_id AS turno_id,
               o.monto         AS transferencia,
               o.saldo_anterior,
               o.saldo_actual
        FROM operaciones_cajas o
        WHERE o.negocio_id     = v_negocio_id
          AND o.caja_id        = v_varios_id
          AND o.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
          AND o.referencia_id IN (SELECT id FROM turnos)
    ),
    rec_celular AS (
        SELECT r.turno_id, r.venta_dia,
               r.saldo_virtual_anterior, r.saldo_virtual_actual, r.saldo_caja
        FROM recargas r
        WHERE r.negocio_id       = v_negocio_id
          AND r.tipo_servicio_id = v_tipo_celular
          AND r.turno_id IN (SELECT id FROM turnos)
    ),
    rec_bus AS (
        SELECT r.turno_id, r.venta_dia,
               r.saldo_virtual_anterior, r.saldo_virtual_actual, r.saldo_caja
        FROM recargas r
        WHERE r.negocio_id       = v_negocio_id
          AND r.tipo_servicio_id = v_tipo_bus
          AND r.turno_id IN (SELECT id FROM turnos)
    )
    SELECT
        t.id,
        t.numero_turno,
        t.empleado_id,
        t.emp_nombre,
        t.hora_fecha_apertura,
        t.hora_fecha_cierre,
        t.fondo_apertura,
        COALESCE(agg_ventas.total, 0)::DECIMAL(12,2),
        COALESCE(agg_egresos.total, 0)::DECIMAL(12,2),
        -- otros_ingresos derivado:
        --   saldo_cajon_digital (antes del ajuste) = fondo + ventas + otros - egresos
        --   saldo_cajon_digital = (deposito + transferencia) - diferencia
        --   → otros = (deposito + transferencia) - diferencia - fondo - ventas + egresos
        GREATEST(
            0,
            COALESCE(op_deposito.deposito, 0)
            + COALESCE(op_transferencia.transferencia, 0)
            - COALESCE(agg_ajuste.diferencia, 0)
            - t.fondo_apertura
            - COALESCE(agg_ventas.total, 0)
            + COALESCE(agg_egresos.total, 0)
        )::DECIMAL(12,2),
        -- efectivo_fisico = depósito + transferencia
        (COALESCE(op_deposito.deposito, 0)
         + COALESCE(op_transferencia.transferencia, 0))::DECIMAL(12,2),
        COALESCE(agg_ajuste.diferencia, 0)::DECIMAL(12,2),
        COALESCE(op_deposito.deposito, 0)::DECIMAL(12,2),
        COALESCE(op_transferencia.transferencia, 0)::DECIMAL(12,2),
        -- Saldos Tienda: si no hubo depósito, usar saldo actual de la caja como
        -- aproximación (no se puede reconstruir el saldo histórico exacto sin más data).
        -- En la práctica esto solo afecta cierres sin movimiento donde la UI muestra "sin cambio".
        COALESCE(op_deposito.saldo_anterior, v_saldo_caja_act)::DECIMAL(12,2),
        COALESCE(op_deposito.saldo_actual,
                 op_deposito.saldo_anterior,
                 v_saldo_caja_act)::DECIMAL(12,2),
        COALESCE(op_transferencia.saldo_anterior, v_saldo_varios_act)::DECIMAL(12,2),
        COALESCE(op_transferencia.saldo_actual,
                 op_transferencia.saldo_anterior,
                 v_saldo_varios_act)::DECIMAL(12,2),
        (rec_celular.turno_id IS NOT NULL),
        COALESCE(rec_celular.saldo_caja - rec_celular.venta_dia, 0)::DECIMAL(12,2),
        COALESCE(rec_celular.saldo_caja, 0)::DECIMAL(12,2),
        COALESCE(rec_celular.venta_dia, 0)::DECIMAL(12,2),
        COALESCE(rec_celular.saldo_virtual_anterior, 0)::DECIMAL(12,2),
        COALESCE(rec_celular.saldo_virtual_actual, 0)::DECIMAL(12,2),
        (rec_bus.turno_id IS NOT NULL),
        COALESCE(rec_bus.saldo_caja - rec_bus.venta_dia, 0)::DECIMAL(12,2),
        COALESCE(rec_bus.saldo_caja, 0)::DECIMAL(12,2),
        COALESCE(rec_bus.venta_dia, 0)::DECIMAL(12,2),
        COALESCE(rec_bus.saldo_virtual_anterior, 0)::DECIMAL(12,2),
        COALESCE(rec_bus.saldo_virtual_actual, 0)::DECIMAL(12,2),
        v_varios_activa,
        op_deposito.descripcion::TEXT,
        -- usa_pos: true cuando el cajón tuvo cualquier movimiento durante el turno
        -- (ventas POS, ingresos manuales o egresos). Si hubo movimientos, el sistema
        -- conoce el esperado real y debe mostrar el cuadre en el historial.
        -- false = cajón sin movimientos → modo sin cuadre (solo fondo + conteo).
        (
          COALESCE(agg_ventas.total,  0) > 0
          OR COALESCE(agg_egresos.total, 0) > 0
          OR GREATEST(
               0,
               COALESCE(op_deposito.deposito, 0)
               + COALESCE(op_transferencia.transferencia, 0)
               - COALESCE(agg_ajuste.diferencia, 0)
               - t.fondo_apertura
               - COALESCE(agg_ventas.total, 0)
               + COALESCE(agg_egresos.total, 0)
             ) > 0
        )
    FROM turnos t
    LEFT JOIN agg_ventas       ON agg_ventas.turno_id       = t.id
    LEFT JOIN agg_egresos      ON agg_egresos.turno_id      = t.id
    LEFT JOIN agg_ajuste       ON agg_ajuste.turno_id       = t.id
    LEFT JOIN op_deposito      ON op_deposito.turno_id      = t.id
    LEFT JOIN op_transferencia ON op_transferencia.turno_id = t.id
    LEFT JOIN rec_celular      ON rec_celular.turno_id      = t.id
    LEFT JOIN rec_bus          ON rec_bus.turno_id          = t.id
    ORDER BY t.hora_fecha_cierre DESC;
END;
$$;

-- Índice de soporte: lookups por referencia_id en operaciones_cajas
-- Necesario para que los JOIN por turno_id (referencia_id) sean eficientes.
CREATE INDEX IF NOT EXISTS idx_operaciones_negocio_referencia
    ON operaciones_cajas (negocio_id, referencia_id)
    WHERE referencia_id IS NOT NULL;

-- Índice de soporte: cierre de turno (hora_fecha_cierre)
-- Sin esto, el rango BETWEEN escanea toda la tabla.
CREATE INDEX IF NOT EXISTS idx_turnos_negocio_cierre
    ON turnos_caja (negocio_id, hora_fecha_cierre DESC)
    WHERE hora_fecha_cierre IS NOT NULL;

REVOKE EXECUTE ON FUNCTION public.fn_listar_cierres_turno(DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_cierres_turno(DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
