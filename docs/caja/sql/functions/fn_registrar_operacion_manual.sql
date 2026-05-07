-- ==========================================
-- DROP — firma cambia en v3.0 (INTEGER → UUID, multi-tenant)
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_registrar_operacion_manual(INTEGER, INTEGER, TEXT, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_registrar_operacion_manual(UUID, UUID, TEXT, UUID, DECIMAL, TEXT, TEXT);

-- ==========================================
-- FUNCIÓN: fn_registrar_operacion_manual (v3.0 — multi-tenant UUID)
-- ==========================================
-- Registra un INGRESO o EGRESO manual en una caja con bloqueo de concurrencia.
-- Recibe p_tipo_operacion como TEXT (no ENUM) para compatibilidad con PostgREST.
-- Castea internamente TEXT → tipo_operacion_caja_enum.
-- Valida saldo suficiente en EGRESO (saldo_nuevo >= 0).
-- Para CAJA_CHICA: valida que p_empleado_id tenga turno activo hoy
--   (hora_fecha_cierre IS NULL). Solo el empleado que abrió el turno puede operar.
--
-- CAMBIOS v3.0:
--   - p_caja_id, p_empleado_id, p_categoria_id: INTEGER → UUID
--   - Negocio leído del JWT (get_negocio_id()); validaciones filtran por negocio_id
--   - operaciones_cajas INSERT incluye negocio_id
-- ==========================================
-- Llamada desde: OperacionesCajaService.registrarOperacion()
-- Parámetros:
--   p_caja_id         — UUID de la caja
--   p_empleado_id     — UUID del empleado que registra la operación
--   p_tipo_operacion  — 'INGRESO' o 'EGRESO' (TEXT, se castea internamente al ENUM)
--   p_categoria_id    — UUID de categoría contable (categorias_operaciones)
--   p_monto           — Monto de la operación
--   p_descripcion     — Descripción opcional
--   p_comprobante_url — PATH en Storage (no URL firmada), nullable
-- ==========================================
-- NOTA: Para EGRESO de Tienda cuando hay déficit (saldo_actual = 0),
--       usar reparar_deficit_turno que omite la validación de saldo mínimo.
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_registrar_operacion_manual(
  p_caja_id         UUID,
  p_empleado_id     UUID,
  p_tipo_operacion  TEXT,            -- TEXT (no ENUM) para compatibilidad con PostgREST
  p_categoria_id    UUID,
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
  v_negocio_id     UUID;
  v_saldo_anterior DECIMAL(12,2);
  v_saldo_nuevo    DECIMAL(12,2);
  v_operacion_id   UUID;
  v_tipo           tipo_operacion_caja_enum;
  v_caja_codigo    TEXT;
BEGIN
  -- 0. Verificar que no sea superadmin
  PERFORM public.fn_assert_no_superadmin();

  -- 0.1. Obtener negocio del JWT
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- 0.5. Cast TEXT → ENUM con validación
  BEGIN
    v_tipo := p_tipo_operacion::tipo_operacion_caja_enum;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Tipo de operación no válido: %. Use INGRESO o EGRESO', p_tipo_operacion;
  END;

  -- 0.7. Para CAJA_CHICA: validar que el empleado tenga turno activo hoy
  v_caja_codigo := (SELECT codigo FROM cajas WHERE id = p_caja_id AND negocio_id = v_negocio_id);

  IF v_caja_codigo = 'CAJA_CHICA' THEN
    IF NOT EXISTS (
      SELECT 1 FROM turnos_caja
      WHERE empleado_id      = p_empleado_id
        AND negocio_id       = v_negocio_id
        AND hora_fecha_cierre IS NULL
        AND hora_fecha_apertura >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')::date
        AND hora_fecha_apertura <  (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')::date + INTERVAL '1 day'
    ) THEN
      RAISE EXCEPTION 'Solo el empleado con turno activo puede operar sobre Caja Chica';
    END IF;
  END IF;

  -- 1. Obtener saldo actual de la caja (con lock para evitar race conditions)
  PERFORM id FROM cajas WHERE id = p_caja_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_anterior := (SELECT saldo_actual FROM cajas WHERE id = p_caja_id AND negocio_id = v_negocio_id);

  IF v_saldo_anterior IS NULL THEN
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
  SET saldo_actual = v_saldo_nuevo
  WHERE id = p_caja_id AND negocio_id = v_negocio_id;

  -- 4. Insertar operación
  v_operacion_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id, monto,
    saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    v_operacion_id, v_negocio_id, p_caja_id, p_empleado_id, v_tipo, p_categoria_id, p_monto,
    v_saldo_anterior, v_saldo_nuevo, p_descripcion, p_comprobante_url
  );

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
REVOKE EXECUTE ON FUNCTION public.fn_registrar_operacion_manual(UUID, UUID, TEXT, UUID, DECIMAL, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_operacion_manual(UUID, UUID, TEXT, UUID, DECIMAL, TEXT, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_operacion_manual IS
  'v3.0 (multi-tenant UUID) - Registra un INGRESO o EGRESO manual en una caja. '
  'Bloqueo FOR UPDATE evita race conditions. '
  'Valida saldo suficiente en EGRESO. '
  'Para CAJA_CHICA: solo el empleado con turno activo hoy puede operar. '
  'Para EGRESO con saldo = 0 (déficit), usar reparar_deficit_turno.';
