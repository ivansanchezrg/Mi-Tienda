-- ==========================================
-- FUNCIÓN: registrar_compra_saldo_bus
-- VERSIÓN: 3.1
-- FECHA: 2026-02-26
-- ==========================================
-- CAMBIOS v3.1 — Fix timestamp mini cierre:
--   recargas_virtuales usa clock_timestamp() en lugar de NOW() para garantizar
--   que su created_at sea estrictamente posterior al snapshot del mini cierre.
--   NOW() es estable dentro de una transacción (mismo valor), lo que causaba
--   que getSaldoVirtualActual (filtro created_at > snapshot) no contara la compra.
--
-- CAMBIOS v3.0 — Mini cierre integrado:
--   Con p_saldo_virtual_maquina Y ventas > 0:
--     1. Busca turno abierto (requerido para crear snapshot)
--     2. INSERT en `recargas` como mini cierre (snapshot parcial del día)
--        ON CONFLICT acumula si ya hubo un mini cierre previo en el mismo turno
--     3. INGRESO CAJA_BUS por ventas acumuladas desde último cierre/mini-cierre
--     4. EGRESO CAJA_BUS por monto comprado
--     → CAJA_BUS nunca queda negativa
--     → El cierre diario usa el mini cierre como base y solo suma ventas restantes
--   Con p_saldo_virtual_maquina Y ventas = 0:
--     → Comportamiento básico (CAJA_BUS >= monto, solo EGRESO)
--   Sin p_saldo_virtual_maquina (NULL):
--     → Comportamiento básico v2.0 (CAJA_BUS >= monto, solo EGRESO)
--
-- COMPATIBILIDAD: firma idéntica a v2.0, sin cambios en TypeScript
-- ==========================================

DROP FUNCTION IF EXISTS public.registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.registrar_compra_saldo_bus(
  p_fecha                 DATE,
  p_empleado_id           INTEGER,
  p_monto                 NUMERIC,
  p_notas                 TEXT    DEFAULT NULL,
  p_saldo_virtual_maquina NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- IDs de tablas de referencia
  v_caja_bus_id              INTEGER;
  v_tipo_bus_id              INTEGER;
  v_tipo_ref_rv_id           INTEGER;  -- tipos_referencia 'RECARGAS_VIRTUALES'
  v_tipo_ref_recargas_id     INTEGER;  -- tipos_referencia 'RECARGAS'
  v_categoria_eg011_id       INTEGER;
  v_comision_pct             NUMERIC;

  -- Saldos
  v_ganancia                 NUMERIC;
  v_saldo_anterior           NUMERIC;   -- CAJA_BUS antes de cualquier operación
  v_saldo_despues_ingreso    NUMERIC;   -- CAJA_BUS después del INGRESO (antes del EGRESO)
  v_saldo_nuevo              NUMERIC;   -- CAJA_BUS final

  -- UUIDs
  v_turno_id                 UUID;
  v_mini_cierre_id           UUID;
  v_operacion_ingreso_id     UUID;
  v_operacion_egreso_id      UUID;
  v_recarga_id               UUID;

  -- Para cálculo de ventas acumuladas
  v_saldo_ultimo_cierre_bus   NUMERIC;
  v_fecha_ultimo_cierre_bus   TIMESTAMP;
  v_suma_recargas_post_cierre NUMERIC;
  v_saldo_virtual_sistema     NUMERIC;
  v_venta_bus_hoy             NUMERIC;
  v_disponible_total          NUMERIC;
BEGIN

  -- ==========================================
  -- INICIALIZACIÓN — obtener IDs y configuración
  -- ==========================================

  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS';
  SELECT id, porcentaje_comision INTO v_tipo_bus_id, v_comision_pct
    FROM tipos_servicio WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_rv_id       FROM tipos_referencia WHERE codigo = 'RECARGAS_VIRTUALES';
  SELECT id INTO v_tipo_ref_recargas_id FROM tipos_referencia WHERE codigo = 'RECARGAS';
  SELECT id INTO v_categoria_eg011_id   FROM categorias_operaciones WHERE codigo = 'EG-011';

  IF v_caja_bus_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_BUS no encontrada';
  END IF;

  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de compra debe ser mayor a cero';
  END IF;

  v_ganancia := ROUND(p_monto * (v_comision_pct / 100.0), 2);

  SELECT saldo_actual INTO v_saldo_anterior FROM cajas WHERE id = v_caja_bus_id;

  -- ==========================================
  -- VALIDACIÓN Y CÁLCULO DE VENTAS
  -- ==========================================

  IF p_saldo_virtual_maquina IS NOT NULL THEN

    -- Calcula saldo virtual del sistema (mismo algoritmo que getSaldoVirtualActual TypeScript)
    -- Usa el último registro de `recargas` como base (puede ser cierre completo o mini cierre)
    SELECT COALESCE(r.saldo_virtual_actual, 0), r.created_at
    INTO v_saldo_ultimo_cierre_bus, v_fecha_ultimo_cierre_bus
    FROM recargas r
    JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
    WHERE ts.codigo = 'BUS'
    ORDER BY r.created_at DESC
    LIMIT 1;

    IF v_saldo_ultimo_cierre_bus IS NULL THEN
      v_saldo_ultimo_cierre_bus  := 0;
      v_fecha_ultimo_cierre_bus  := '1900-01-01'::timestamp;
    END IF;

    SELECT COALESCE(SUM(rv.monto_virtual), 0)
    INTO v_suma_recargas_post_cierre
    FROM recargas_virtuales rv
    WHERE rv.tipo_servicio_id = v_tipo_bus_id
      AND rv.created_at > v_fecha_ultimo_cierre_bus;

    v_saldo_virtual_sistema := v_saldo_ultimo_cierre_bus + v_suma_recargas_post_cierre;
    v_venta_bus_hoy         := GREATEST(v_saldo_virtual_sistema - p_saldo_virtual_maquina, 0);
    v_disponible_total      := v_saldo_anterior + v_venta_bus_hoy;

    IF v_disponible_total < p_monto THEN
      RAISE EXCEPTION 'Efectivo insuficiente. Caja BUS: $% + ventas del día: $% = $%. Requerido: $%',
        v_saldo_anterior, v_venta_bus_hoy, v_disponible_total, p_monto;
    END IF;

  ELSE
    -- Modo básico: solo CAJA_BUS
    v_venta_bus_hoy := 0;
    IF v_saldo_anterior < p_monto THEN
      RAISE EXCEPTION 'Saldo insuficiente en CAJA_BUS. Disponible: $%, Requerido: $%',
        v_saldo_anterior, p_monto;
    END IF;

  END IF;

  -- ==========================================
  -- MINI CIERRE (solo si hay ventas que registrar)
  -- ==========================================

  IF v_venta_bus_hoy > 0 THEN

    -- Requiere turno abierto para crear el snapshot en `recargas`
    SELECT id INTO v_turno_id
    FROM turnos_caja
    WHERE fecha = p_fecha AND hora_cierre IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_turno_id IS NULL THEN
      RAISE EXCEPTION
        'No hay turno abierto para la fecha %. Abrí un turno antes de registrar la compra con saldo de máquina.',
        p_fecha;
    END IF;

    v_mini_cierre_id       := gen_random_uuid();
    v_operacion_ingreso_id := gen_random_uuid();

    -- Snapshot parcial en `recargas`
    -- ON CONFLICT: si ya hubo un mini cierre en este turno+BUS, acumula las ventas
    -- El cierre diario (ejecutar_cierre_diario) tiene el mismo ON CONFLICT para cerrar el día
    INSERT INTO recargas (
      id, fecha, turno_id, empleado_id, tipo_servicio_id,
      venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
      validado, created_at
    ) VALUES (
      v_mini_cierre_id, p_fecha, v_turno_id, p_empleado_id, v_tipo_bus_id,
      v_venta_bus_hoy, v_saldo_virtual_sistema, p_saldo_virtual_maquina,
      false, NOW()
    )
    ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE SET
      venta_dia            = recargas.venta_dia + EXCLUDED.venta_dia,
      saldo_virtual_actual = EXCLUDED.saldo_virtual_actual,
      validado             = false,
      created_at           = NOW()
    RETURNING id INTO v_mini_cierre_id;

    -- INGRESO CAJA_BUS por ventas acumuladas
    -- Referencia al snapshot en `recargas` para trazabilidad (igual que el cierre diario)
    v_saldo_despues_ingreso := v_saldo_anterior + v_venta_bus_hoy;

    INSERT INTO operaciones_cajas (
      id, fecha, caja_id, empleado_id,
      tipo_operacion, monto,
      saldo_anterior, saldo_actual,
      tipo_referencia_id, referencia_id,
      descripcion, created_at
    ) VALUES (
      v_operacion_ingreso_id, NOW(), v_caja_bus_id, p_empleado_id,
      'INGRESO', v_venta_bus_hoy,
      v_saldo_anterior, v_saldo_despues_ingreso,
      v_tipo_ref_recargas_id, v_mini_cierre_id,
      'Ventas Bus pre-compra saldo — ' || p_fecha,
      NOW()
    );

  ELSE
    -- Sin ventas: CAJA_BUS no necesita INGRESO previo
    v_saldo_despues_ingreso := v_saldo_anterior;
  END IF;

  -- ==========================================
  -- EGRESO + RECARGA VIRTUAL (siempre)
  -- ==========================================

  v_saldo_nuevo         := v_saldo_despues_ingreso - p_monto;
  v_operacion_egreso_id := gen_random_uuid();
  v_recarga_id          := gen_random_uuid();

  -- EGRESO debe existir ANTES de recargas_virtuales (FK: operacion_pago_id)
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id, referencia_id,
    descripcion, created_at
  ) VALUES (
    v_operacion_egreso_id, NOW(), v_caja_bus_id, p_empleado_id,
    'EGRESO', p_monto,
    v_saldo_despues_ingreso, v_saldo_nuevo,
    v_categoria_eg011_id, v_tipo_ref_rv_id, v_recarga_id,
    COALESCE(p_notas, 'Compra saldo virtual Bus — ' || p_fecha),
    NOW()
  );

  INSERT INTO recargas_virtuales (
    id, fecha, tipo_servicio_id, empleado_id,
    monto_virtual, monto_a_pagar, ganancia,
    pagado, fecha_pago, operacion_pago_id,
    notas, created_at
  ) VALUES (
    v_recarga_id, p_fecha, v_tipo_bus_id, p_empleado_id,
    p_monto, p_monto, v_ganancia,
    true, p_fecha, v_operacion_egreso_id,
    p_notas, clock_timestamp()  -- clock_timestamp() avanza en tiempo real (NOW() es estable en transacción)
    -- Garantiza created_at > snapshot del mini cierre → getSaldoVirtualActual lo cuenta correctamente
  );

  UPDATE cajas
  SET saldo_actual = v_saldo_nuevo, updated_at = NOW()
  WHERE id = v_caja_bus_id;

  -- ==========================================
  -- RETORNAR RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',            true,
    'recarga_id',         v_recarga_id,
    'operacion_id',       v_operacion_egreso_id,
    'monto',              p_monto,
    'ganancia',           v_ganancia,
    'saldo_anterior',     v_saldo_anterior,
    'saldo_nuevo',        v_saldo_nuevo,
    'venta_bus_incluida', v_venta_bus_hoy,
    'mini_cierre',        (v_venta_bus_hoy > 0),
    'message',            CASE
      WHEN v_venta_bus_hoy > 0
        THEN 'Compra saldo Bus $' || p_monto ||
             ' — Ventas registradas: $' || v_venta_bus_hoy ||
             ' — Ganancia a liquidar: $' || v_ganancia
      ELSE
        'Compra saldo Bus $' || p_monto ||
        ' — Ganancia a liquidar: $' || v_ganancia
    END
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar compra saldo bus: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.registrar_compra_saldo_bus IS
'v3.1 - Fix timestamp: recargas_virtuales usa clock_timestamp() para que
getSaldoVirtualActual (filtro created_at > snapshot) cuente la compra correctamente.
v3.0 - Mini cierre integrado. Con p_saldo_virtual_maquina y ventas > 0:
crea snapshot en `recargas` (ON CONFLICT acumula), registra INGRESO por ventas
acumuladas y EGRESO por compra. CAJA_BUS nunca queda negativa.
Sin ese parámetro o con ventas = 0: comportamiento básico (CAJA_BUS >= monto).
El cierre diario (ejecutar_cierre_diario v4.8) usa ON CONFLICT para acumular
las ventas restantes del día sobre el snapshot del mini cierre.';

GRANT EXECUTE ON FUNCTION public.registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC) TO anon;

NOTIFY pgrst, 'reload schema';
