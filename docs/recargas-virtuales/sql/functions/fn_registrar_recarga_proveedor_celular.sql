-- ==========================================
-- FUNCIÓN: fn_registrar_recarga_proveedor_celular
-- VERSIÓN: 2.1
-- FECHA: 2026-05-07
-- ==========================================
-- Registra la deuda con el proveedor CELULAR cuando este carga saldo virtual.
-- NO mueve dinero de cajas ni valida saldo — solo crea la deuda (pagado_proveedor=false).
-- El pago se realiza más adelante con registrar_pago_proveedor_celular.
--
-- v2.1 (2026-05-07) — FIX multi-tenant + tipos:
--   - INSERT ahora incluye negocio_id (la columna es NOT NULL — antes la función
--     fallaba en cada llamada con violación de constraint).
--   - p_empleado_id cambia de INTEGER → UUID (schema v11 usa UUID en usuarios.id).
--   - Todas las queries internas filtran por negocio_id = get_negocio_id()
--     (defensa en profundidad: aunque RLS ya filtra, el filtro explícito evita
--     que cambios futuros en RLS rompan el aislamiento de tenant).
--
-- Retorna JSON con todos los datos para actualizar la UI sin queries adicionales:
--   - success, recarga_id, monto_virtual, monto_a_pagar, ganancia
--   - saldo_virtual_celular (calculado: último_cierre + SUM post-cierre)
--   - deudas_pendientes: { cantidad, total, lista }
--
-- Parámetros:
--   p_fecha          DATE     Fecha del negocio
--   p_empleado_id    UUID     Empleado que registra
--   p_monto_virtual  NUMERIC  Monto virtual cargado por el proveedor (ej: 210.53)
-- ==========================================

-- DROP firma anterior (cambió tipo de p_empleado_id INTEGER → UUID)
DROP FUNCTION IF EXISTS public.fn_registrar_recarga_proveedor_celular(DATE, INTEGER, NUMERIC);

CREATE OR REPLACE FUNCTION public.fn_registrar_recarga_proveedor_celular(
  p_fecha         DATE,
  p_empleado_id   UUID,
  p_monto_virtual NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id                UUID;

  -- IDs de servicios
  v_tipo_celular_id           INTEGER;
  v_comision_pct              NUMERIC;

  -- Cálculos
  v_monto_a_pagar             NUMERIC;
  v_ganancia                  NUMERIC;

  -- ID generado
  v_recarga_id                UUID;

  -- Saldo virtual actualizado
  v_saldo_ultimo_cierre       NUMERIC;
  v_suma_recargas_post_cierre NUMERIC;
  v_saldo_virtual_actual      NUMERIC;
  v_fecha_ultimo_cierre       TIMESTAMP;

  -- Deudas pendientes
  v_deudas_pendientes         JSON;
  v_cantidad_deudas           INTEGER;
  v_total_deudas              NUMERIC;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();

  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- ==========================================
  -- 1. VALIDACIONES INICIALES
  -- ==========================================

  v_tipo_celular_id := (SELECT id                  FROM tipos_servicio WHERE codigo = 'CELULAR');
  v_comision_pct    := (SELECT porcentaje_comision FROM tipos_servicio WHERE codigo = 'CELULAR');

  IF v_tipo_celular_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio CELULAR no encontrado';
  END IF;

  IF p_monto_virtual <= 0 THEN
    RAISE EXCEPTION 'El monto virtual debe ser mayor a cero';
  END IF;

  -- ==========================================
  -- 2. CÁLCULOS DE MONTOS
  -- ==========================================

  -- monto_a_pagar = monto_virtual * (1 - comision/100)
  -- Ejemplo: 210.53 * 0.95 = 200.00
  v_monto_a_pagar := ROUND(p_monto_virtual * (1 - v_comision_pct / 100.0), 2);
  v_ganancia      := p_monto_virtual - v_monto_a_pagar;

  -- ==========================================
  -- 3. INSERT EN recargas_virtuales (CREAR DEUDA)
  -- ==========================================

  v_recarga_id := gen_random_uuid();

  INSERT INTO recargas_virtuales (
    id, negocio_id, fecha, tipo_servicio_id, empleado_id,
    monto_virtual, monto_a_pagar, ganancia,
    pagado_proveedor, created_at
  ) VALUES (
    v_recarga_id, v_negocio_id, p_fecha, v_tipo_celular_id, p_empleado_id,
    p_monto_virtual, v_monto_a_pagar, v_ganancia,
    false, NOW()
  );

  -- ==========================================
  -- 4. CALCULAR SALDO VIRTUAL ACTUAL
  -- Fórmula: último_cierre + SUM(recargas_virtuales posteriores)
  -- ==========================================

  v_saldo_ultimo_cierre := (
    SELECT COALESCE(saldo_virtual_actual, 0)
    FROM recargas
    WHERE negocio_id = v_negocio_id
      AND tipo_servicio_id = v_tipo_celular_id
    ORDER BY created_at DESC
    LIMIT 1
  );
  v_fecha_ultimo_cierre := (
    SELECT created_at
    FROM recargas
    WHERE negocio_id = v_negocio_id
      AND tipo_servicio_id = v_tipo_celular_id
    ORDER BY created_at DESC
    LIMIT 1
  );

  IF v_saldo_ultimo_cierre IS NULL THEN
    v_saldo_ultimo_cierre := 0;
    v_fecha_ultimo_cierre := '1900-01-01'::timestamp;
  END IF;

  v_suma_recargas_post_cierre := (
    SELECT COALESCE(SUM(monto_virtual), 0)
    FROM recargas_virtuales rv
    WHERE rv.negocio_id = v_negocio_id
      AND rv.tipo_servicio_id = v_tipo_celular_id
      AND rv.created_at > v_fecha_ultimo_cierre
  );

  v_saldo_virtual_actual := v_saldo_ultimo_cierre + v_suma_recargas_post_cierre;

  -- ==========================================
  -- 5. OBTENER LISTA DE DEUDAS PENDIENTES
  -- ==========================================

  v_deudas_pendientes := (
    SELECT json_agg(
      json_build_object(
        'id', rv.id,
        'fecha', rv.fecha,
        'monto_virtual', rv.monto_virtual,
        'monto_a_pagar', rv.monto_a_pagar,
        'ganancia', rv.ganancia,
        'created_at', rv.created_at
      ) ORDER BY rv.fecha ASC
    )
    FROM recargas_virtuales rv
    WHERE rv.negocio_id = v_negocio_id
      AND rv.tipo_servicio_id = v_tipo_celular_id
      AND rv.pagado_proveedor = false
  );

  v_cantidad_deudas := (
    SELECT COUNT(*)
    FROM recargas_virtuales
    WHERE negocio_id = v_negocio_id
      AND tipo_servicio_id = v_tipo_celular_id
      AND pagado_proveedor = false
  );
  v_total_deudas := (
    SELECT COALESCE(SUM(monto_a_pagar), 0)
    FROM recargas_virtuales
    WHERE negocio_id = v_negocio_id
      AND tipo_servicio_id = v_tipo_celular_id
      AND pagado_proveedor = false
  );

  -- ==========================================
  -- 6. RETORNAR JSON COMPLETO
  -- ==========================================

  RETURN json_build_object(
    'success',              true,
    'recarga_id',           v_recarga_id,
    'monto_virtual',        p_monto_virtual,
    'monto_a_pagar',        v_monto_a_pagar,
    'ganancia',             v_ganancia,
    'message',              'Recarga del proveedor registrada',
    'saldo_virtual_celular', v_saldo_virtual_actual,
    'deudas_pendientes', json_build_object(
      'cantidad', v_cantidad_deudas,
      'total',    v_total_deudas,
      'lista',    COALESCE(v_deudas_pendientes, '[]'::json)
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar recarga proveedor celular: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.fn_registrar_recarga_proveedor_celular IS
'v2.1 - Registra deuda con proveedor CELULAR. Solo crea la deuda (pagado_proveedor=false).
Sin transferencia de ganancia: la ganancia queda en CAJA_CELULAR como diferencia entre ventas y pago.
Multi-tenant: filtra todo por get_negocio_id() del JWT.';

REVOKE EXECUTE ON FUNCTION public.fn_registrar_recarga_proveedor_celular(DATE, UUID, NUMERIC) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_recarga_proveedor_celular(DATE, UUID, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
