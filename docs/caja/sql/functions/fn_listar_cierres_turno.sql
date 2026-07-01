-- ==========================================
-- fn_listar_cierres_turno
-- ==========================================
-- Reconstruye el resumen del cierre de cada turno cerrado en el rango de fechas
-- a partir del ledger inmutable (operaciones_cajas + movimientos_empleados + recargas + ventas).
--
-- v2.4 — Corrige `otros_ingresos`/`usa_pos` falso positivo: se derivaban de
--   una resta algebraica (deposito - fondo - ventas + egresos) que asumía que
--   cualquier excedente entre el depósito y el fondo era "ingresos manuales".
--   En turnos donde el conteo físico simplemente no coincidió con el fondo
--   (sin ninguna operación real en CAJA_CHICA), esa resta daba un sobrante
--   positivo y el historial mostraba "Ingresos manuales" inexistentes, además
--   de activar el modo "con cuadre" para un turno que el propio backend
--   (fn_ejecutar_cierre_diario_v5, v_hubo_movimientos_caja_chica) ya había
--   tratado como "sin movimientos". Ahora `usa_pos` se basa en la misma
--   condición real (EXISTS de operaciones en CAJA_CHICA durante el turno) y
--   `otros_ingresos` se fuerza a 0 cuando no hubo esas operaciones.
-- v2.3 — Corrige `diferencia` (siempre daba 0): el filtro por categoría del
--   ajuste de conteo comparaba `categoria_id` (categorías de usuario), pero
--   fn_ejecutar_cierre_diario_v5 inserta el ajuste con `categoria_sistema_id`.
--   Además, el faltante ahora se lee desde `movimientos_empleados`
--   (tipo_movimiento = 'FALTANTE_CAJA') — es la fuente de verdad de la deuda
--   real del empleado, la misma que usa "Cuentas empleados" para liquidar.
--   El sobrante (no genera deuda) se sigue leyendo del ajuste en
--   operaciones_cajas, con la columna ya corregida a categoria_sistema_id.
-- v2.2 — p_limit/p_offset paginan el CTE turnos (antes de los JOINs pesados a
--   ventas/recargas) — con el filtro "Todo" el payload ya no crece sin tope.
--   p_limit NULL → sin límite (compatibilidad; el caller siempre debe pasarlo).
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
DROP FUNCTION IF EXISTS public.fn_listar_cierres_turno(DATE, DATE, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.fn_listar_cierres_turno(
    p_fecha_desde DATE,
    p_fecha_hasta DATE,
    p_limit       INTEGER DEFAULT NULL,
    p_offset      INTEGER DEFAULT 0
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

    -- v_cat_ajuste_in, v_cat_ajuste_eg: CONSTANT declaradas arriba

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
        ORDER BY t.hora_fecha_cierre DESC
        LIMIT COALESCE(p_limit, 2147483647)
        OFFSET p_offset
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
    -- Egresos del cajón durante el turno (excluyendo el ajuste de faltante,
    -- que se contabiliza aparte en agg_ajuste/movimientos_empleados)
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
           AND (o.categoria_sistema_id IS NULL OR o.categoria_sistema_id <> v_cat_ajuste_eg)
        GROUP BY t.id
    ),
    -- Ajuste de conteo: +sobrante / -faltante.
    -- Faltante: fuente de verdad es movimientos_empleados (FALTANTE_CAJA) — la
    -- misma tabla que usa "Cuentas empleados" para liquidar la deuda real.
    -- Sobrante: no genera deuda de empleado, se lee del ajuste en operaciones_cajas
    -- (categoria_sistema_id = AJU-CONTEO-IN).
    agg_faltante AS (
        SELECT me.turno_id, SUM(me.monto)::DECIMAL(12,2) AS total
        FROM movimientos_empleados me
        WHERE me.negocio_id      = v_negocio_id
          AND me.tipo_movimiento = 'FALTANTE_CAJA'
          AND me.turno_id IN (SELECT id FROM turnos)
        GROUP BY me.turno_id
    ),
    agg_sobrante AS (
        SELECT t.id AS turno_id,
               COALESCE(SUM(o.monto), 0)::DECIMAL(12,2) AS total
        FROM turnos t
        LEFT JOIN operaciones_cajas o
            ON o.negocio_id           = v_negocio_id
           AND o.caja_id              = v_chica_id
           AND o.categoria_sistema_id = v_cat_ajuste_in
           AND o.fecha               >= t.hora_fecha_apertura
           AND o.fecha               <= t.hora_fecha_cierre
        GROUP BY t.id
    ),
    agg_ajuste AS (
        SELECT t.id AS turno_id,
               (COALESCE(agg_sobrante.total, 0) - COALESCE(agg_faltante.total, 0))::DECIMAL(12,2) AS diferencia
        FROM turnos t
        LEFT JOIN agg_sobrante  ON agg_sobrante.turno_id  = t.id
        LEFT JOIN agg_faltante  ON agg_faltante.turno_id  = t.id
    ),
    -- Replica v_hubo_movimientos_caja_chica de fn_ejecutar_cierre_diario_v5:
    -- única fuente de verdad de si el turno tuvo movimientos reales en el
    -- cajón. Sin esto, un conteo físico que no coincide con el fondo (turno
    -- sin ninguna operación real) se malinterpreta como "ingresos manuales".
    agg_hubo_movimientos AS (
        SELECT t.id AS turno_id,
               EXISTS (
                   SELECT 1 FROM operaciones_cajas o
                   WHERE o.negocio_id = v_negocio_id
                     AND o.caja_id    = v_chica_id
                     AND o.fecha     >= t.hora_fecha_apertura
                     AND o.fecha     <= t.hora_fecha_cierre
               ) AS hubo_movimientos
        FROM turnos t
    ),
    -- Depósito a CAJA al cerrar (puede no existir si todo fue a VARIOS)
    op_deposito AS (
        SELECT o.referencia_id AS turno_id,
               o.monto         AS deposito,
               o.saldo_anterior,
               o.saldo_actual,
               o.descripcion
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
        -- otros_ingresos derivado (solo si hubo movimientos reales en CAJA_CHICA
        -- durante el turno — ver agg_hubo_movimientos):
        --   saldo_cajon_digital (antes del ajuste) = fondo + ventas + otros - egresos
        --   saldo_cajon_digital = (deposito + transferencia) - diferencia
        --   → otros = (deposito + transferencia) - diferencia - fondo - ventas + egresos
        -- Sin movimientos reales, cualquier excedente entre depósito y fondo es
        -- solo un conteo físico distinto al fondo declarado, no un ingreso.
        CASE WHEN COALESCE(agg_hubo_movimientos.hubo_movimientos, FALSE) THEN
            GREATEST(
                0,
                COALESCE(op_deposito.deposito, 0)
                + COALESCE(op_transferencia.transferencia, 0)
                - COALESCE(agg_ajuste.diferencia, 0)
                - t.fondo_apertura
                - COALESCE(agg_ventas.total, 0)
                + COALESCE(agg_egresos.total, 0)
            )
        ELSE 0 END::DECIMAL(12,2),
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
        -- usa_pos: true cuando el cajón tuvo alguna operación real durante el
        -- turno (ventas POS, ingresos manuales o egresos ya registrados en
        -- operaciones_cajas — ver agg_hubo_movimientos). Si hubo movimientos,
        -- el sistema conoce el esperado real y debe mostrar el cuadre en el
        -- historial. false = cajón sin movimientos → modo sin cuadre (solo
        -- fondo + conteo), igual que decidió fn_ejecutar_cierre_diario_v5.
        COALESCE(agg_hubo_movimientos.hubo_movimientos, FALSE)
    FROM turnos t
    LEFT JOIN agg_ventas            ON agg_ventas.turno_id            = t.id
    LEFT JOIN agg_egresos           ON agg_egresos.turno_id           = t.id
    LEFT JOIN agg_ajuste            ON agg_ajuste.turno_id            = t.id
    LEFT JOIN agg_hubo_movimientos  ON agg_hubo_movimientos.turno_id  = t.id
    LEFT JOIN op_deposito           ON op_deposito.turno_id           = t.id
    LEFT JOIN op_transferencia      ON op_transferencia.turno_id      = t.id
    LEFT JOIN rec_celular           ON rec_celular.turno_id           = t.id
    LEFT JOIN rec_bus               ON rec_bus.turno_id               = t.id
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

REVOKE EXECUTE ON FUNCTION public.fn_listar_cierres_turno(DATE, DATE, INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_cierres_turno(DATE, DATE, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
