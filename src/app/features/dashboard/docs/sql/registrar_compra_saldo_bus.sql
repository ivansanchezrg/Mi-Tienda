-- ==========================================
-- FUNCIÓN: registrar_compra_saldo_bus
-- VERSIÓN: 2.0
-- FECHA: 2026-02-24
-- ==========================================
-- Registra la compra de saldo virtual BUS (compra directa con depósito bancario).
-- El efectivo YA salió (fue un depósito bancario), por lo que se crea EGRESO inmediato.
-- Guarda ganancia = monto * 1% para que al fin del mes el proveedor liquide esa diferencia.
--
-- NUEVO v2.0: parámetro opcional p_saldo_virtual_maquina
--   Si se provee: validación extendida — permite depositar ventas del día antes del cierre.
--   Disponible = CAJA_BUS + ventas_del_día_calculadas
--   CAJA_BUS puede quedar negativa temporalmente → el cierre diario la corrige con INGRESO.
--   Si es NULL: validación original (CAJA_BUS >= monto).
--
-- Parámetros:
--   p_fecha                  DATE     Fecha del depósito/compra
--   p_empleado_id            INT      Empleado que registra
--   p_monto                  NUMERIC  Monto comprado/depositado (ej: 500.00)
--   p_notas                  TEXT     Notas opcionales (ej: número de depósito)
--   p_saldo_virtual_maquina  NUMERIC  Saldo que muestra la máquina ahora (opcional)
-- ==========================================

-- Descomentar solo si cambia la firma (parámetros o tipo de retorno):
-- DROP FUNCTION IF EXISTS registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT);
-- DROP FUNCTION IF EXISTS registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION registrar_compra_saldo_bus(
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
  v_caja_bus_id                  INTEGER;
  v_tipo_bus_id                  INTEGER;
  v_tipo_ref_id                  INTEGER;
  v_categoria_eg011_id           INTEGER;
  v_comision_pct                 NUMERIC;
  v_ganancia                     NUMERIC;
  v_saldo_anterior               NUMERIC;
  v_saldo_nuevo                  NUMERIC;
  v_operacion_id                 UUID;
  v_recarga_id                   UUID;
  -- Para validación extendida con ventas del día
  v_saldo_ultimo_cierre_bus      NUMERIC;
  v_fecha_ultimo_cierre_bus      TIMESTAMP;
  v_suma_recargas_post_cierre    NUMERIC;
  v_saldo_virtual_sistema        NUMERIC;
  v_venta_bus_hoy                NUMERIC;
  v_disponible_total             NUMERIC;
BEGIN
  -- Obtener IDs necesarios y comisión BUS
  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS';
  SELECT id, porcentaje_comision INTO v_tipo_bus_id, v_comision_pct
    FROM tipos_servicio WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_id        FROM tipos_referencia WHERE codigo = 'RECARGAS_VIRTUALES';
  SELECT id INTO v_categoria_eg011_id FROM categorias_operaciones WHERE codigo = 'EG-011';

  IF v_caja_bus_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_BUS no encontrada';
  END IF;

  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de compra debe ser mayor a cero';
  END IF;

  -- Calcular ganancia: el proveedor liquida 1% del monto comprado al fin del mes
  v_ganancia := ROUND(p_monto * (v_comision_pct / 100.0), 2);

  -- Obtener saldo actual de CAJA_BUS
  SELECT saldo_actual INTO v_saldo_anterior
  FROM cajas WHERE id = v_caja_bus_id;

  -- ==========================================
  -- VALIDACIÓN DE SALDO
  -- ==========================================
  IF p_saldo_virtual_maquina IS NOT NULL THEN
    -- MODO EXTENDIDO: considera también las ventas del día no cerradas
    -- Calcula saldo virtual del sistema (mismo algoritmo que getSaldoVirtualActual TypeScript)
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
    -- MODO BÁSICO: validación original solo contra CAJA_BUS
    IF v_saldo_anterior < p_monto THEN
      RAISE EXCEPTION 'Saldo insuficiente en CAJA_BUS. Disponible: $%, Requerido: $%',
        v_saldo_anterior, p_monto;
    END IF;
  END IF;

  -- CAJA_BUS puede quedar negativa en modo extendido — se corrige con INGRESO del cierre diario
  v_saldo_nuevo  := v_saldo_anterior - p_monto;
  v_operacion_id := gen_random_uuid();
  v_recarga_id   := gen_random_uuid();

  -- Crear EGRESO en operaciones_cajas PRIMERO
  -- (debe existir antes de recargas_virtuales por FK constraint operacion_pago_id)
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id, referencia_id,
    descripcion, created_at
  ) VALUES (
    v_operacion_id, NOW(), v_caja_bus_id, p_empleado_id,
    'EGRESO', p_monto,
    v_saldo_anterior, v_saldo_nuevo,
    v_categoria_eg011_id, v_tipo_ref_id, v_recarga_id,
    COALESCE(p_notas, 'Compra saldo virtual Bus — ' || p_fecha),
    NOW()
  );

  -- Registrar compra en recargas_virtuales
  INSERT INTO recargas_virtuales (
    id, fecha, tipo_servicio_id, empleado_id,
    monto_virtual, monto_a_pagar, ganancia,
    pagado, fecha_pago, operacion_pago_id,
    notas, created_at
  ) VALUES (
    v_recarga_id, p_fecha, v_tipo_bus_id, p_empleado_id,
    p_monto, p_monto, v_ganancia,
    true, p_fecha, v_operacion_id,
    p_notas, NOW()
  );

  -- Actualizar saldo CAJA_BUS (puede quedar negativo — corrección en cierre diario)
  UPDATE cajas
  SET saldo_actual = v_saldo_nuevo, updated_at = NOW()
  WHERE id = v_caja_bus_id;

  RETURN json_build_object(
    'success',           true,
    'recarga_id',        v_recarga_id,
    'operacion_id',      v_operacion_id,
    'monto',             p_monto,
    'ganancia',          v_ganancia,
    'saldo_anterior',    v_saldo_anterior,
    'saldo_nuevo',       v_saldo_nuevo,
    'venta_bus_incluida', COALESCE(v_venta_bus_hoy, 0),
    'message',           'Compra de saldo Bus registrada: $' || p_monto || ' — Ganancia a liquidar: $' || v_ganancia
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar compra saldo bus: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION registrar_compra_saldo_bus IS
'v2.0 - Registra compra directa de saldo virtual BUS (depósito bancario). Crea EGRESO inmediato en
CAJA_BUS. Con p_saldo_virtual_maquina permite depositar ventas del día antes del cierre
(CAJA_BUS puede quedar negativa temporalmente; el cierre diario la corrige). Sin ese parámetro
usa validación original.';

GRANT EXECUTE ON FUNCTION registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC) TO anon;

NOTIFY pgrst, 'reload schema';
