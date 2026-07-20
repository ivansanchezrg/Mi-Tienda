-- ==========================================
-- DROP — todas las firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL, UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(UUID, DECIMAL, UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL);

-- ==========================================
-- FUNCIÓN: fn_reparar_deficit_turno (v4.3 — referencia al turno reparado en DEF-*)
-- ==========================================
-- CAMBIOS v4.3 (bug de dinero real — la reposición "contaba" como la transferencia de hoy):
--   - El INGRESO DEF-REPONER (y el EGRESO DEF-RETIRAR, por simetría) ahora se graban
--     con tipo_referencia_id = turnos_caja + referencia_id = <turno cerrado que se repara>.
--     Antes se insertaban SIN referencia y se atribuían por fecha calendario, así que la
--     reposición ejecutada al día siguiente (caso típico: cierre de noche, reapertura a la
--     mañana) hacía que el cierre de ESE día viera "Varios ya cobró hoy" y NO transfiriera
--     lo del día en curso — perdiendo una transferencia por cada déficit reparado.
--     Con la referencia, los checks "¿Varios cobró?" atribuyen la reposición al día que
--     cubre (el del turno reparado), no al día en que se ejecuta.
--
-- HEREDA DE v4.2:
--   - La validación de turno abierto ya no filtra por fecha: un turno de un día
--     anterior sin cerrar también bloquea la apertura con mensaje limpio (antes
--     el INSERT chocaba contra idx_un_turno_abierto_por_caja con unique_violation crudo).
--
-- HEREDA DE v4.1:
--   - Validación de saldo incluye fondo de apertura (déficit + fondo).
--   - EGRESO FONDO-APERTURA de Tienda cuando p_fondo_apertura > 0.
--
-- HEREDA DE v4.0:
--   - Categorías DEF-RETIRAR y DEF-REPONER migradas a categorias_sistema (UUIDs fijos).
--
-- CAMBIOS v3.0:
--   - Elimina p_fondo_faltante: sin fondo fijo no hay fondo que reponer automáticamente.
--     El empleado declara el fondo libremente al abrir el próximo turno.
--   - Solo repara el déficit de VARIOS (transferencia diaria pendiente del turno anterior).
--   - El EGRESO de Tienda ahora es solo por p_deficit_varios.
--   - Abre el nuevo turno con p_fondo_apertura (monto libre declarado por el empleado).
--
-- HEREDA DE v2.0:
--   - Transacción atómica: EGRESO Tienda + INGRESO VARIOS + INSERT turno.
--   - Validación de saldo de Tienda antes de operar.
--   - Negocio leído del JWT (multi-tenant).
--
-- Llamada desde: TurnosCajaService.repararDeficit()
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_reparar_deficit_turno(
  p_empleado_id    UUID,
  p_deficit_varios DECIMAL(12,2),
  p_fondo_apertura DECIMAL(12,2)
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id   UUID;
  v_caja_id      UUID;
  v_varios_id    UUID;
  -- Nombres editables de las cajas (el negocio puede renombrar VARIOS/CAJA).
  -- Se usan solo en las descripciones legibles del historial, nunca en lógica.
  v_tienda_nombre TEXT;
  v_varios_nombre TEXT;
  v_saldo_tienda DECIMAL(12,2);
  v_saldo_varios DECIMAL(12,2);
  v_op_egreso_id  UUID;
  v_op_ingreso_id UUID;
  -- UUIDs fijos de categorias_sistema
  v_cat_egreso_id  CONSTANT UUID := 'a1000001-0000-0000-0000-000000000006';  -- DEF-RETIRAR
  v_cat_ingreso_id CONSTANT UUID := 'a1000001-0000-0000-0000-000000000005';  -- DEF-REPONER
  -- Apertura de turno
  v_inicio_dia   TIMESTAMPTZ;
  v_numero_turno INTEGER;
  v_turno_id     UUID;
  v_caja_chica_id UUID;
  -- Trazabilidad: el turno cerrado cuya transferencia a VARIOS se está reponiendo.
  -- Los asientos DEF-* se atan a este turno para que los checks "¿Varios cobró?"
  -- atribuyan la reposición al día que cubre, no al día en que se ejecuta.
  v_tipo_ref_turnos_id INTEGER;
  v_turno_reparado_id  UUID;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  -- Turno cuyo cierre dejó el déficit que se está reponiendo = último turno cerrado.
  -- (La reparación siempre ocurre al abrir el turno inmediatamente posterior.)
  v_tipo_ref_turnos_id := (SELECT id FROM tipos_referencia WHERE tabla = 'turnos_caja');
  v_turno_reparado_id  := (
    SELECT id FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_cierre IS NOT NULL
    ORDER BY hora_fecha_cierre DESC
    LIMIT 1
  );

  IF p_deficit_varios <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El déficit de VARIOS debe ser mayor a cero');
  END IF;

  IF p_fondo_apertura < 0 THEN
    RETURN json_build_object('success', false, 'error', 'El fondo de apertura no puede ser negativo');
  END IF;

  -- Obtener IDs de cajas por código (+ nombre editable para las descripciones)
  v_caja_id       := (SELECT id FROM cajas WHERE codigo = 'CAJA'       AND negocio_id = v_negocio_id);
  v_varios_id     := (SELECT id FROM cajas WHERE codigo = 'VARIOS'     AND negocio_id = v_negocio_id);
  v_caja_chica_id := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
  v_tienda_nombre := COALESCE((SELECT nombre FROM cajas WHERE id = v_caja_id),   'Tienda');
  v_varios_nombre := COALESCE((SELECT nombre FROM cajas WHERE id = v_varios_id), 'Varios');

  -- Obtener saldo actual de Tienda (con lock)
  PERFORM id FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_tienda := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id);
  IF v_saldo_tienda IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Tienda');
  END IF;

  -- Validar saldo suficiente para cubrir déficit + fondo de apertura
  IF v_saldo_tienda < (p_deficit_varios + p_fondo_apertura) THEN
    RETURN json_build_object(
      'success', false,
      'error', FORMAT(
        'Saldo insuficiente en Tienda ($%s) para cubrir el déficit de VARIOS ($%s) más el fondo de apertura ($%s). Registra un ingreso manual en Tienda primero.',
        TO_CHAR(v_saldo_tienda, 'FM999990.00'),
        TO_CHAR(p_deficit_varios, 'FM999990.00'),
        TO_CHAR(p_fondo_apertura, 'FM999990.00')
      )
    );
  END IF;

  -- ==========================================
  -- 1. EGRESO de Tienda (solo por déficit de VARIOS)
  -- ==========================================
  v_op_egreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_sistema_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url,
    tipo_referencia_id, referencia_id
  ) VALUES (
    v_op_egreso_id, v_negocio_id, v_caja_id, p_empleado_id, 'EGRESO', v_cat_egreso_id,
    p_deficit_varios, v_saldo_tienda, v_saldo_tienda - p_deficit_varios,
    FORMAT('Ajuste déficit turno anterior — %s: $%s', v_varios_nombre, TO_CHAR(p_deficit_varios, 'FM999990.00')),
    NULL,
    v_tipo_ref_turnos_id, v_turno_reparado_id
  );

  UPDATE cajas SET saldo_actual = v_saldo_tienda - p_deficit_varios
    WHERE id = v_caja_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 2. INGRESO a VARIOS
  -- ==========================================
  PERFORM id FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id);
  IF v_saldo_varios IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Varios');
  END IF;

  v_op_ingreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_sistema_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url,
    tipo_referencia_id, referencia_id
  ) VALUES (
    v_op_ingreso_id, v_negocio_id, v_varios_id, p_empleado_id, 'INGRESO', v_cat_ingreso_id,
    p_deficit_varios, v_saldo_varios, v_saldo_varios + p_deficit_varios,
    FORMAT('Reposición déficit turno anterior — pendiente cobrado de %s', v_tienda_nombre),
    NULL,
    v_tipo_ref_turnos_id, v_turno_reparado_id
  );

  UPDATE cajas SET saldo_actual = v_saldo_varios + p_deficit_varios
    WHERE id = v_varios_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 3. ABRIR TURNO (mismo proceso atómico)
  -- ==========================================
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );

  -- Sin filtro de fecha: un turno de un día anterior sin cerrar también bloquea
  -- (mismo criterio que fn_abrir_turno v3.3 — evita el unique_violation crudo
  -- de idx_un_turno_abierto_por_caja).
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto');
  END IF;

  v_numero_turno := (
    SELECT COUNT(*) + 1
    FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
  );

  v_turno_id := gen_random_uuid();
  INSERT INTO turnos_caja (id, negocio_id, caja_id, numero_turno, empleado_id, hora_fecha_apertura, fondo_apertura)
  VALUES (v_turno_id, v_negocio_id, v_caja_chica_id, v_numero_turno, p_empleado_id, NOW(), p_fondo_apertura);

  -- Registrar EGRESO de Tienda por el fondo entregado al cajón (solo si hay fondo > 0).
  -- Usa la misma categoría FONDO-APERTURA que fn_abrir_turno para consistencia en historial.
  -- El saldo de Tienda ya fue deducido por el déficit en el paso 1; se descuenta el fondo
  -- del saldo resultante (v_saldo_tienda - p_deficit_varios).
  IF p_fondo_apertura > 0 THEN
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_sistema_id,
      monto, saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_id,
      p_empleado_id,
      'EGRESO',
      'a1000001-0000-0000-0000-000000000007',  -- FONDO-APERTURA (mismo que fn_abrir_turno)
      p_fondo_apertura,
      v_saldo_tienda - p_deficit_varios,
      v_saldo_tienda - p_deficit_varios - p_fondo_apertura,
      'Fondo entregado al cajon para apertura de turno #' || v_numero_turno
    );

    UPDATE cajas
    SET saldo_actual = v_saldo_tienda - p_deficit_varios - p_fondo_apertura
    WHERE id = v_caja_id AND negocio_id = v_negocio_id;
  END IF;

  -- ==========================================
  -- RESULTADO
  -- ==========================================
  RETURN json_build_object(
    'success',            true,
    'turno_id',           v_turno_id,
    'op_egreso_id',       v_op_egreso_id,
    'op_ingreso_id',      v_op_ingreso_id,
    'total_retirado',     p_deficit_varios,
    'saldo_tienda_nuevo', v_saldo_tienda - p_deficit_varios - p_fondo_apertura
  );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reparar_deficit_turno IS
  'v4.3 — DEF-REPONER/DEF-RETIRAR referencian el turno reparado (tipo_referencia_id=turnos_caja). '
  'Los checks "¿Varios cobró?" atribuyen la reposición al día del turno reparado, no al día en que se ejecuta. '
  'v4.2 — Validación de turno abierto sin filtro de fecha (cubre turno de día anterior sin cerrar). '
  'v4.1 — Validación de saldo incluye fondo de apertura (p_deficit_varios + p_fondo_apertura). '
  'Agrega EGRESO FONDO-APERTURA de Tienda cuando p_fondo_apertura > 0 (mismo comportamiento que fn_abrir_turno). '
  'v4.0: Categorías migradas a categorias_sistema (UUIDs fijos). '
  'DEF-RETIRAR (EGRESO Tienda) y DEF-REPONER (INGRESO Varios) referenciados internamente. '
  'v3.0: Solo repara déficit de VARIOS (fondo libre). '
  'EGRESO de Tienda + INGRESO a VARIOS + INSERT en turnos_caja con fondo_apertura libre. '
  'Transacción atómica: si algo falla, rollback completo. '
  'Negocio leído del JWT; todas las queries filtran por negocio_id.';
