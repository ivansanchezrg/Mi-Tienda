-- =============================================================================
-- FUNCIÓN: crear_transferencia
-- Versión: 1.0
-- Descripción: Crea una transferencia atómica entre dos cajas usando códigos.
--              Busca las cajas por código, valida saldo suficiente en el origen,
--              registra las dos operaciones y actualiza los saldos en una sola
--              transacción (todo o nada).
--
-- Llamada desde: CajasService.crearTransferencia()
-- =============================================================================
CREATE OR REPLACE FUNCTION crear_transferencia(
  p_codigo_origen    TEXT,
  p_codigo_destino   TEXT,
  p_monto            NUMERIC,
  p_empleado_id      INTEGER,
  p_descripcion      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caja_origen_id   INTEGER;
  v_caja_destino_id  INTEGER;
  v_nombre_origen    TEXT;
  v_nombre_destino   TEXT;
  v_saldo_origen     NUMERIC;
  v_saldo_destino    NUMERIC;
  v_nuevo_saldo_origen  NUMERIC;
  v_nuevo_saldo_destino NUMERIC;
BEGIN
  -- 1. Obtener caja origen por código
  SELECT id, nombre, saldo_actual
    INTO v_caja_origen_id, v_nombre_origen, v_saldo_origen
    FROM cajas
   WHERE codigo = p_codigo_origen AND activo = true;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Caja origen no encontrada: ' || p_codigo_origen);
  END IF;

  -- 2. Obtener caja destino por código
  SELECT id, nombre, saldo_actual
    INTO v_caja_destino_id, v_nombre_destino, v_saldo_destino
    FROM cajas
   WHERE codigo = p_codigo_destino AND activo = true;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Caja destino no encontrada: ' || p_codigo_destino);
  END IF;

  -- 3. Validar saldo suficiente en origen
  IF v_saldo_origen < p_monto THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Saldo insuficiente en %s. Disponible: $%s, requerido: $%s',
                      v_nombre_origen,
                      v_saldo_origen::TEXT,
                      p_monto::TEXT)
    );
  END IF;

  -- 4. Calcular nuevos saldos
  v_nuevo_saldo_origen  := v_saldo_origen  - p_monto;
  v_nuevo_saldo_destino := v_saldo_destino + p_monto;

  -- 5. Insertar operación SALIENTE en caja origen
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_caja_origen_id, p_empleado_id, 'TRANSFERENCIA_SALIENTE',
    p_monto, v_saldo_origen, v_nuevo_saldo_origen, p_descripcion
  );

  -- 6. Insertar operación ENTRANTE en caja destino
  INSERT INTO operaciones_cajas (
    caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_caja_destino_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE',
    p_monto, v_saldo_destino, v_nuevo_saldo_destino,
    p_descripcion || ' desde ' || v_nombre_origen
  );

  -- 7. Actualizar saldo origen
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_origen WHERE id = v_caja_origen_id;

  -- 8. Actualizar saldo destino
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_destino WHERE id = v_caja_destino_id;

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION crear_transferencia(TEXT, TEXT, NUMERIC, INTEGER, TEXT) IS
  'Transfiere monto entre dos cajas por código. Operación atómica con validación de saldo. v1.0';
