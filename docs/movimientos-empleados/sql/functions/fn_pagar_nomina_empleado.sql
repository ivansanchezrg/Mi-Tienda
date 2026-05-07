-- ==========================================
-- FUNCION: fn_pagar_nomina_empleado (v2.0 — multi-tenant UUID)
-- ==========================================
-- Liquida la cuenta corriente de un empleado como transaccion atomica.
-- El sistema elige automaticamente de que cajas sacar: VARIOS primero, luego CAJA (Tienda).
-- CAJA_CHICA no se usa — solo VARIOS y CAJA (cajas permanentes, no requieren turno).
--
-- CAMBIOS v2.0:
--   - p_empleado_id, p_beneficiario_id: INTEGER → UUID
--   - v_varios_id, v_caja_id, v_cat_salarios_id: INTEGER → UUID
--   - v_tipo_ref_id: INTEGER → INTEGER (tipos_referencia.id sigue siendo INTEGER en schema)
--   - Negocio leído del JWT (get_negocio_id()); todas las queries filtran por negocio_id
--   - operaciones_cajas y movimientos_empleados INSERT incluyen negocio_id
--   - Validacion de beneficiario activo: usa usuario_negocios (antes buscaba activo en usuarios)
--   - Fix Supabase: RETURNING id INTO → pattern gen_random_uuid() + := (SELECT ...)
--
-- HEREDA DE v1.1:
--   - No requiere turno abierto
--   - Inserta SUELDO_BASE, calcula descuentos pendientes, distribuye entre VARIOS→CAJA,
--     inserta PAGO_NOMINA, marca pendientes como LIQUIDADO
--
-- Llamada desde: MovimientosEmpleadosService.pagarNomina()
-- ==========================================

-- DROP previo necesario porque cambia la firma
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(UUID, INTEGER, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(INTEGER, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL, DATE, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL(12,2), DATE, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_pagar_nomina_empleado(
  p_empleado_id     UUID,            -- quien opera (admin que autoriza)
  p_beneficiario_id UUID,            -- a quien se le paga
  p_sueldo_base     DECIMAL(12,2),   -- sueldo bruto del periodo (ya calculado proporcional si aplica)
  p_periodo_inicio  DATE DEFAULT NULL, -- inicio del periodo cubierto (para trazabilidad)
  p_periodo_fin     DATE DEFAULT NULL, -- fin del periodo cubierto (para trazabilidad)
  p_descripcion     TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id          UUID;
  v_varios_id           UUID;
  v_caja_id             UUID;
  v_saldo_varios        DECIMAL(12,2);
  v_saldo_caja          DECIMAL(12,2);
  v_cat_salarios_id     UUID;
  v_beneficiario_nombre VARCHAR(255);

  v_total_descuentos  DECIMAL(12,2) := 0;
  v_liquido           DECIMAL(12,2);
  v_arrastre          DECIMAL(12,2) := 0;  -- deuda que supera el sueldo
  v_monto_de_varios   DECIMAL(12,2) := 0;
  v_monto_de_caja     DECIMAL(12,2) := 0;

  v_tipo_ref_id       INTEGER;
  v_op_varios_id      UUID;
  v_op_caja_id        UUID;
  v_mov_sueldo_id     UUID;
  v_mov_pago_id       UUID;
  v_mov_arrastre_id   UUID;

  v_detalle_descuentos JSON;
  v_instrucciones      JSON;
BEGIN
  -- ==========================================
  -- OBTENER NEGOCIO DEL JWT
  -- ==========================================

  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  -- ==========================================
  -- VALIDACIONES
  -- ==========================================

  IF p_sueldo_base <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El sueldo base debe ser mayor a cero');
  END IF;

  -- Validar beneficiario activo en este negocio (activo vive en usuario_negocios, no en usuarios)
  v_beneficiario_nombre := (
    SELECT u.nombre
    FROM usuarios u
    INNER JOIN usuario_negocios un ON un.usuario_id = u.id
    WHERE u.id = p_beneficiario_id
      AND un.negocio_id = v_negocio_id
      AND un.activo = TRUE
  );
  IF v_beneficiario_nombre IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no existe o no esta activo en este negocio');
  END IF;

  v_cat_salarios_id := (SELECT id FROM categorias_operaciones WHERE tipo = 'EGRESO' AND nombre = 'Salarios' AND negocio_id = v_negocio_id LIMIT 1);
  IF v_cat_salarios_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Categoria Salarios no encontrada. Ejecuta el setup de categorias de movimientos-empleados.');
  END IF;

  v_tipo_ref_id := (SELECT id FROM tipos_referencia WHERE tabla = 'movimientos_empleados');
  IF v_tipo_ref_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Tipo de referencia movimientos_empleados no encontrado');
  END IF;

  -- ==========================================
  -- 1. CALCULAR DESCUENTOS PENDIENTES
  --    (ANTES de insertar SUELDO_BASE para no contaminar el cálculo)
  -- ==========================================

  v_total_descuentos := (
    SELECT COALESCE(SUM(monto), 0)
    FROM movimientos_empleados
    WHERE empleado_id = p_beneficiario_id
      AND negocio_id  = v_negocio_id
      AND estado_liquidacion = 'PENDIENTE'
      AND tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'AJUSTE_CARGO')
  );

  v_detalle_descuentos := (
    SELECT COALESCE(json_agg(json_build_object(
      'tipo',        tipo_movimiento::TEXT,
      'monto',       monto,
      'fecha',       TO_CHAR(fecha, 'YYYY-MM-DD'),
      'descripcion', COALESCE(descripcion, '')
    ) ORDER BY fecha), '[]'::JSON)
    FROM movimientos_empleados
    WHERE empleado_id = p_beneficiario_id
      AND negocio_id  = v_negocio_id
      AND estado_liquidacion = 'PENDIENTE'
      AND tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'AJUSTE_CARGO')
  );

  -- ==========================================
  -- 2. CALCULAR LIQUIDO
  -- ==========================================

  v_liquido := p_sueldo_base - v_total_descuentos;

  -- ==========================================
  -- 3. VALIDAR FONDOS (antes de escribir cualquier registro)
  --    Solo si hay efectivo que entregar (liquido > 0)
  -- ==========================================

  IF v_liquido > 0 THEN
    v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);
    v_caja_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA'   AND negocio_id = v_negocio_id);

    PERFORM id FROM cajas WHERE id IN (v_varios_id, v_caja_id) AND negocio_id = v_negocio_id FOR UPDATE;
    v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id);
    v_saldo_caja   := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id   AND negocio_id = v_negocio_id);

    v_monto_de_varios := LEAST(v_liquido, v_saldo_varios);
    v_monto_de_caja   := v_liquido - v_monto_de_varios;

    IF v_monto_de_caja > v_saldo_caja THEN
      RETURN json_build_object(
        'success', false,
        'error', format(
          'Fondos insuficientes. Varios: $%s, Tienda: $%s, Total disponible: $%s, Liquido a pagar: $%s',
          TO_CHAR(v_saldo_varios, 'FM999990.00'),
          TO_CHAR(v_saldo_caja,   'FM999990.00'),
          TO_CHAR(v_saldo_varios + v_saldo_caja, 'FM999990.00'),
          TO_CHAR(v_liquido, 'FM999990.00')
        )
      );
    END IF;
  END IF;

  -- ==========================================
  -- 4. INSERTAR SUELDO_BASE
  --    Ahora que todas las validaciones pasaron
  -- ==========================================

  v_mov_sueldo_id := gen_random_uuid();

  INSERT INTO movimientos_empleados (
    id, negocio_id, empleado_id, tipo_movimiento, monto, descripcion, creado_por
  ) VALUES (
    v_mov_sueldo_id, v_negocio_id, p_beneficiario_id,
    'SUELDO_BASE',
    p_sueldo_base,
    COALESCE(
      p_descripcion,
      CASE
        WHEN p_periodo_inicio IS NOT NULL AND p_periodo_fin IS NOT NULL
          THEN format('Sueldo periodo %s — %s',
            TO_CHAR(p_periodo_inicio, 'DD/MM/YYYY'),
            TO_CHAR(p_periodo_fin,    'DD/MM/YYYY'))
        ELSE 'Sueldo del periodo'
      END
    ),
    p_empleado_id
  );

  -- ==========================================
  -- 5A. LIQUIDO = 0: sueldo cubre exactamente los descuentos
  -- ==========================================

  IF v_liquido = 0 THEN
    v_mov_pago_id := gen_random_uuid();

    INSERT INTO movimientos_empleados (
      id, negocio_id, empleado_id, tipo_movimiento, monto, descripcion, creado_por
    ) VALUES (
      v_mov_pago_id, v_negocio_id, p_beneficiario_id,
      'PAGO_NOMINA',
      p_sueldo_base,
      'Sueldo absorbido exactamente por descuentos — no sale efectivo de caja',
      p_empleado_id
    );

    UPDATE movimientos_empleados
    SET estado_liquidacion = 'LIQUIDADO',
        liquidado_en       = v_mov_pago_id
    WHERE empleado_id        = p_beneficiario_id
      AND negocio_id         = v_negocio_id
      AND estado_liquidacion = 'PENDIENTE';

    RETURN json_build_object(
      'success',               true,
      'caso',                  'ABSORBIDO',
      'sueldo_bruto',          p_sueldo_base,
      'total_descuentos',      v_total_descuentos,
      'detalle_descuentos',    v_detalle_descuentos,
      'liquido_pagado',        0,
      'arrastre',              0,
      'instrucciones_fisicas', '[]'::JSON,
      'operaciones_ids',       '[]'::JSON,
      'mensaje',               'Los descuentos cubren el sueldo exacto. No sale efectivo de caja.'
    );
  END IF;

  -- ==========================================
  -- 5B. LIQUIDO < 0: descuentos superan el sueldo → arrastre de deuda
  --
  -- El sueldo se liquida completamente. Los descuentos que lo superan
  -- se registran como SALDO_ARRASTRE (PENDIENTE) para el siguiente periodo.
  -- No toca cajas — no hay efectivo que entregar.
  -- ==========================================

  IF v_liquido < 0 THEN
    v_arrastre := -v_liquido;  -- monto positivo de la deuda remanente

    v_mov_pago_id := gen_random_uuid();

    INSERT INTO movimientos_empleados (
      id, negocio_id, empleado_id, tipo_movimiento, monto, descripcion, creado_por
    ) VALUES (
      v_mov_pago_id, v_negocio_id, p_beneficiario_id,
      'PAGO_NOMINA',
      p_sueldo_base,
      format('Cierre de periodo — sueldo $%s absorbido por descuentos $%s',
        TO_CHAR(p_sueldo_base,      'FM999990.00'),
        TO_CHAR(v_total_descuentos, 'FM999990.00')
      ),
      p_empleado_id
    );

    -- Liquidar TODOS los descuentos pendientes (quedaron cubiertos por el sueldo en la cuenta corriente)
    UPDATE movimientos_empleados
    SET estado_liquidacion = 'LIQUIDADO',
        liquidado_en       = v_mov_pago_id
    WHERE empleado_id        = p_beneficiario_id
      AND negocio_id         = v_negocio_id
      AND estado_liquidacion = 'PENDIENTE';

    -- Registrar la deuda remanente para el siguiente periodo
    v_mov_arrastre_id := gen_random_uuid();

    INSERT INTO movimientos_empleados (
      id, negocio_id, empleado_id, tipo_movimiento, monto, descripcion, creado_por
    ) VALUES (
      v_mov_arrastre_id, v_negocio_id, p_beneficiario_id,
      'SALDO_ARRASTRE',
      v_arrastre,
      format('Deuda pendiente del periodo anterior (descuentos $%s superaron sueldo $%s)',
        TO_CHAR(v_total_descuentos, 'FM999990.00'),
        TO_CHAR(p_sueldo_base,      'FM999990.00')
      ),
      p_empleado_id
    );

    RETURN json_build_object(
      'success',               true,
      'caso',                  'ARRASTRE',
      'sueldo_bruto',          p_sueldo_base,
      'total_descuentos',      v_total_descuentos,
      'detalle_descuentos',    v_detalle_descuentos,
      'liquido_pagado',        0,
      'arrastre',              v_arrastre,
      'instrucciones_fisicas', '[]'::JSON,
      'operaciones_ids',       '[]'::JSON,
      'mensaje',               format(
        'Los descuentos superaron el sueldo. Se registra una deuda de $%s para el siguiente periodo.',
        TO_CHAR(v_arrastre, 'FM999990.00')
      )
    );
  END IF;

  -- ==========================================
  -- 6. LIQUIDO > 0: pago normal con egreso de caja
  -- ==========================================

  v_mov_pago_id := gen_random_uuid();

  INSERT INTO movimientos_empleados (
    id, negocio_id, empleado_id, tipo_movimiento, monto, descripcion, creado_por
  ) VALUES (
    v_mov_pago_id, v_negocio_id, p_beneficiario_id,
    'PAGO_NOMINA',
    v_liquido,
    format('Pago nomina — bruto $%s, descuentos $%s, liquido $%s',
      TO_CHAR(p_sueldo_base,        'FM999990.00'),
      TO_CHAR(v_total_descuentos,   'FM999990.00'),
      TO_CHAR(v_liquido,            'FM999990.00')
    ),
    p_empleado_id
  );

  -- Egreso de VARIOS
  IF v_monto_de_varios > 0 THEN
    v_op_varios_id := gen_random_uuid();
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      v_op_varios_id, v_negocio_id, v_varios_id, p_empleado_id, 'EGRESO', v_cat_salarios_id,
      v_tipo_ref_id, v_mov_pago_id,
      v_monto_de_varios, v_saldo_varios, v_saldo_varios - v_monto_de_varios,
      format('Pago nomina a %s', v_beneficiario_nombre),
      p_comprobante_url
    );

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_varios WHERE id = v_varios_id AND negocio_id = v_negocio_id;
  END IF;

  -- Egreso de CAJA/Tienda
  IF v_monto_de_caja > 0 THEN
    v_op_caja_id := gen_random_uuid();
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      v_op_caja_id, v_negocio_id, v_caja_id, p_empleado_id, 'EGRESO', v_cat_salarios_id,
      v_tipo_ref_id, v_mov_pago_id,
      v_monto_de_caja, v_saldo_caja, v_saldo_caja - v_monto_de_caja,
      format('Pago nomina a %s', v_beneficiario_nombre),
      p_comprobante_url
    );

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_caja WHERE id = v_caja_id AND negocio_id = v_negocio_id;
  END IF;

  UPDATE movimientos_empleados
  SET estado_liquidacion = 'LIQUIDADO',
      liquidado_en = v_mov_pago_id
  WHERE empleado_id        = p_beneficiario_id
    AND negocio_id         = v_negocio_id
    AND estado_liquidacion = 'PENDIENTE';

  -- ==========================================
  -- 7. INSTRUCCIONES FISICAS
  -- ==========================================

  v_instrucciones := (
    SELECT json_agg(x)
    FROM (
      SELECT * FROM (VALUES
        ('Varios', 'VARIOS', v_monto_de_varios),
        ('Tienda', 'CAJA',   v_monto_de_caja)
      ) AS t(caja, codigo, monto)
      WHERE monto > 0
    ) x
  );

  -- ==========================================
  -- RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',                true,
    'caso',                   'PAGO_NORMAL',
    'sueldo_bruto',           p_sueldo_base,
    'total_descuentos',       v_total_descuentos,
    'detalle_descuentos',     v_detalle_descuentos,
    'liquido_pagado',         v_liquido,
    'arrastre',               0,
    'beneficiario',           v_beneficiario_nombre,
    'instrucciones_fisicas',  COALESCE(v_instrucciones, '[]'::JSON),
    'operaciones_ids',        json_build_array(v_op_varios_id, v_op_caja_id)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL, DATE, DATE, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL, DATE, DATE, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_pagar_nomina_empleado IS
  'v3.0 (arrastre de deuda) - Liquida la cuenta corriente de un empleado como transaccion atomica. No requiere turno abierto. '
  'Tres casos segun liquido: '
  'PAGO_NORMAL (liquido > 0): inserta SUELDO_BASE + PAGO_NOMINA, egresa de VARIOS→CAJA, liquida PENDIENTES. '
  'ABSORBIDO (liquido = 0): inserta SUELDO_BASE + PAGO_NOMINA, liquida PENDIENTES sin mover caja. '
  'ARRASTRE (liquido < 0): inserta SUELDO_BASE + PAGO_NOMINA, liquida PENDIENTES, inserta SALDO_ARRASTRE PENDIENTE para el proximo periodo. '
  'El SALDO_ARRASTRE evita que la deuda se pierda silenciosamente cuando los descuentos superan el sueldo. '
  'Retorna campo caso (PAGO_NORMAL/ABSORBIDO/ARRASTRE) y arrastre (monto de deuda remanente, 0 si no aplica).';
