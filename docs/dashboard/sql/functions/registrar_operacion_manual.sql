-- ==========================================
-- DROP — descomentar SOLO si cambia la firma (parámetros o tipo de retorno)
-- ==========================================
-- DROP FUNCTION IF EXISTS public.registrar_operacion_manual(
--   INTEGER, INTEGER, TEXT, INTEGER, DECIMAL, TEXT, TEXT
-- );

-- ==========================================
-- FUNCIÓN: registrar_operacion_manual (v2.1)
-- ==========================================
-- Registra un INGRESO o EGRESO manual en una caja con bloqueo de concurrencia.
-- Recibe p_tipo_operacion como TEXT (no ENUM) para compatibilidad con PostgREST.
-- Castea internamente TEXT → tipo_operacion_caja_enum.
-- Valida saldo suficiente en EGRESO (saldo_nuevo >= 0).
-- ==========================================
-- Llamada desde: OperacionesCajaService.registrarOperacion()
-- Parámetros:
--   p_caja_id         — ID de la caja (1=CAJA, 2=CAJA_CHICA, 3=CAJA_CELULAR, 4=CAJA_BUS)
--   p_empleado_id     — ID del empleado que registra la operación
--   p_tipo_operacion  — 'INGRESO' o 'EGRESO' (TEXT, se castea internamente al ENUM)
--   p_categoria_id    — ID de categoría contable (categorias_operaciones)
--   p_monto           — Monto de la operación
--   p_descripcion     — Descripción opcional
--   p_comprobante_url — PATH en Storage (no URL firmada), nullable
-- ==========================================
-- NOTA: Para EGRESO de Tienda cuando hay déficit (saldo_actual = 0),
--       usar reparar_deficit_turno que omite la validación de saldo mínimo.
-- ==========================================

CREATE OR REPLACE FUNCTION public.registrar_operacion_manual(
  p_caja_id         INTEGER,
  p_empleado_id     INTEGER,
  p_tipo_operacion  TEXT,            -- TEXT (no ENUM) para compatibilidad con PostgREST
  p_categoria_id    INTEGER,
  p_monto           DECIMAL(12,2),
  p_descripcion     TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER                     -- CRÍTICO: ejecuta con permisos del creador
SET search_path = public             -- CRÍTICO: resolución explícita de schema
AS $$
DECLARE
  v_saldo_anterior DECIMAL(12,2);
  v_saldo_nuevo    DECIMAL(12,2);
  v_operacion_id   UUID;
  v_tipo           tipo_operacion_caja_enum;
BEGIN
  -- 0. Cast TEXT → ENUM con validación
  BEGIN
    v_tipo := p_tipo_operacion::tipo_operacion_caja_enum;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Tipo de operación no válido: %. Use INGRESO o EGRESO', p_tipo_operacion;
  END;

  -- 1. Obtener saldo actual de la caja (con lock para evitar race conditions)
  SELECT saldo_actual INTO v_saldo_anterior
  FROM cajas
  WHERE id = p_caja_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada con ID: %', p_caja_id;
  END IF;

  -- 2. Calcular nuevo saldo
  IF v_tipo = 'INGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior + p_monto;
  ELSIF v_tipo = 'EGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior - p_monto;
    IF v_saldo_nuevo < 0 THEN
      RAISE EXCEPTION 'Saldo insuficiente. Saldo actual: %, monto a retirar: %',
        v_saldo_anterior, p_monto;
    END IF;
  END IF;

  -- 3. Actualizar saldo de la caja
  UPDATE cajas
  SET saldo_actual = v_saldo_nuevo,
      updated_at   = NOW()
  WHERE id = p_caja_id;

  -- 4. Insertar operación
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, categoria_id, monto,
    saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    gen_random_uuid(), p_caja_id, p_empleado_id, v_tipo, p_categoria_id, p_monto,
    v_saldo_anterior, v_saldo_nuevo, p_descripcion, p_comprobante_url
  ) RETURNING id INTO v_operacion_id;

  -- 5. Retornar resultado
  RETURN json_build_object(
    'success',        true,
    'operacion_id',   v_operacion_id,
    'saldo_anterior', v_saldo_anterior,
    'saldo_nuevo',    v_saldo_nuevo
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en operación: %', SQLERRM;
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.registrar_operacion_manual(INTEGER, INTEGER, TEXT, INTEGER, DECIMAL, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_operacion_manual(INTEGER, INTEGER, TEXT, INTEGER, DECIMAL, TEXT, TEXT) TO anon;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.registrar_operacion_manual IS
  'Registra un INGRESO o EGRESO manual en una caja. '
  'Bloqueo FOR UPDATE evita race conditions. '
  'Valida saldo suficiente en EGRESO. '
  'Para EGRESO con saldo = 0 (déficit), usar reparar_deficit_turno.';
