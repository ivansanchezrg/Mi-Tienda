-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_compensar_varios_pendiente(UUID, DECIMAL, TEXT);
DROP FUNCTION IF EXISTS public.fn_compensar_varios_pendiente(UUID, DECIMAL, INTEGER, TEXT);

-- ==========================================
-- FUNCIÓN: fn_compensar_varios_pendiente (v1.0 — 2026-07-18)
-- ==========================================
-- Compensa manualmente las transferencias diarias a VARIOS que no se realizaron
-- mientras un turno estuvo abierto varios días sin cerrar.
--
-- Contexto: la transferencia a VARIOS es "una por cierre, máximo una por día". Si un
-- turno se abre un día y se cierra días después, los días intermedios no generaron cierre
-- y por tanto VARIOS no cobró esos días. El dinero no se pierde (quedó en Tienda/CAJA),
-- pero el fondo de emergencia quedó con menos de lo previsto. La app detecta el pendiente
-- (fn_datos_cierre_diario → varios_pendiente) y ofrece esta compensación de 1 tap.
--
-- Por qué NO reutiliza fn_crear_transferencia:
--   Esa función inserta una TRANSFERENCIA_ENTRANTE en VARIOS, que los checks
--   "¿VARIOS cobró hoy?" (cierre, apertura, wizard) interpretan como la cuota del día en
--   curso. Compensar días viejos con ese asiento contaminaría la cuota de hoy y podría
--   reintroducir el bug de "la reposición cuenta como la transferencia de hoy". Por eso
--   usa categorías propias (COMP-DIA-*) que NINGÚN check de cuota diaria observa: la
--   compensación es un movimiento contable aparte, con su propia trazabilidad.
--
-- Mueve dinero real de la bóveda (CAJA) al fondo (VARIOS):
--   1. EGRESO de CAJA   — categoría COMP-DIA-RETIRAR (a1000001-...-000000000014)
--   2. INGRESO a VARIOS — categoría COMP-DIA-REPONER (a1000001-...-000000000015)
-- Ambos en una transacción atómica con validación de saldo. El monto es libre (el caller
-- envía el pendiente calculado), pero se valida > 0 y que CAJA tenga saldo suficiente.
--
-- Los códigos de categoría son abstractos a propósito (no nombran cajas): el negocio puede
-- renombrar VARIOS/CAJA. El nombre real se resuelve de cajas.nombre para las descripciones.
--
-- Multi-tenant: negocio del JWT (get_negocio_id()). Bloquea superadmin.
-- Llamada desde: TurnosCajaService.compensarVariosPendiente()
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_compensar_varios_pendiente(
  p_empleado_id UUID,
  p_monto       DECIMAL(12,2),
  p_detalle     TEXT DEFAULT NULL   -- rango de días descriptivo, ej. "2 días (15/07–16/07)"
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id    UUID;
  v_caja_id       UUID;
  v_varios_id     UUID;
  v_tienda_nombre TEXT;
  v_varios_nombre TEXT;
  v_saldo_tienda  DECIMAL(12,2);
  v_saldo_varios  DECIMAL(12,2);
  v_op_egreso_id  UUID;
  v_op_ingreso_id UUID;
  v_desc_sufijo   TEXT;
  -- UUIDs fijos de categorias_sistema
  v_cat_retirar CONSTANT UUID := 'a1000001-0000-0000-0000-000000000014';  -- COMP-DIA-RETIRAR
  v_cat_reponer CONSTANT UUID := 'a1000001-0000-0000-0000-000000000015';  -- COMP-DIA-REPONER
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto a compensar debe ser mayor a cero');
  END IF;

  -- Validar empleado pertenece al negocio (misma línea de defensa que fn_crear_transferencia)
  IF NOT EXISTS (
    SELECT 1 FROM usuario_negocios
    WHERE usuario_id = p_empleado_id AND negocio_id = v_negocio_id AND activo = TRUE
  ) THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no pertenece a este negocio');
  END IF;

  -- IDs + nombres editables de las cajas
  v_caja_id       := (SELECT id FROM cajas WHERE codigo = 'CAJA'   AND negocio_id = v_negocio_id AND activo = TRUE);
  v_varios_id     := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id AND activo = TRUE);

  IF v_caja_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Tienda');
  END IF;
  IF v_varios_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'La caja de fondo (Varios) no está activa');
  END IF;

  v_tienda_nombre := COALESCE((SELECT nombre FROM cajas WHERE id = v_caja_id),   'Tienda');
  v_varios_nombre := COALESCE((SELECT nombre FROM cajas WHERE id = v_varios_id), 'Varios');

  -- Lock + lectura del saldo de Tienda
  PERFORM id FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_tienda := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id);

  IF v_saldo_tienda < p_monto THEN
    RETURN json_build_object(
      'success', false,
      'error', FORMAT(
        'Saldo insuficiente en %s ($%s) para compensar $%s. Registra un ingreso manual en %s primero.',
        v_tienda_nombre, TO_CHAR(v_saldo_tienda, 'FM999990.00'), TO_CHAR(p_monto, 'FM999990.00'), v_tienda_nombre
      )
    );
  END IF;

  v_desc_sufijo := CASE
    WHEN TRIM(COALESCE(p_detalle, '')) <> '' THEN ' — ' || p_detalle
    ELSE ''
  END;

  -- ==========================================
  -- 1. EGRESO de CAJA (bóveda)
  -- ==========================================
  v_op_egreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_sistema_id,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_op_egreso_id, v_negocio_id, v_caja_id, p_empleado_id, 'EGRESO', v_cat_retirar,
    p_monto, v_saldo_tienda, v_saldo_tienda - p_monto,
    FORMAT('Compensación transferencias pendientes hacia %s%s', v_varios_nombre, v_desc_sufijo)
  );

  UPDATE cajas SET saldo_actual = v_saldo_tienda - p_monto
    WHERE id = v_caja_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 2. INGRESO a VARIOS (fondo emergencia)
  -- ==========================================
  PERFORM id FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id);

  v_op_ingreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_sistema_id,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_op_ingreso_id, v_negocio_id, v_varios_id, p_empleado_id, 'INGRESO', v_cat_reponer,
    p_monto, v_saldo_varios, v_saldo_varios + p_monto,
    FORMAT('Compensación transferencias pendientes desde %s%s', v_tienda_nombre, v_desc_sufijo)
  );

  UPDATE cajas SET saldo_actual = v_saldo_varios + p_monto
    WHERE id = v_varios_id AND negocio_id = v_negocio_id;

  RETURN json_build_object(
    'success',            true,
    'op_egreso_id',       v_op_egreso_id,
    'op_ingreso_id',      v_op_ingreso_id,
    'monto',              p_monto,
    'saldo_tienda_nuevo', v_saldo_tienda - p_monto,
    'saldo_varios_nuevo', v_saldo_varios + p_monto
  );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_compensar_varios_pendiente(UUID, DECIMAL, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_compensar_varios_pendiente(UUID, DECIMAL, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_compensar_varios_pendiente(UUID, DECIMAL, TEXT) IS
  'v1.0 — Compensa transferencias diarias a VARIOS no realizadas (turno abierto varios días). '
  'EGRESO de CAJA (COMP-DIA-RETIRAR) + INGRESO a VARIOS (COMP-DIA-REPONER) en transacción atómica. '
  'Usa categorías propias que NINGÚN check de cuota diaria observa — no contamina la transferencia '
  'del día en curso (a diferencia de fn_crear_transferencia). Nombres de caja resueltos de cajas.nombre. '
  'Multi-tenant (JWT); bloquea superadmin; valida saldo de CAJA.';
