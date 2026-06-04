-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);

-- ==========================================
-- FUNCIÓN: fn_registrar_venta_pos (v3.0 — multi-tenant safe + performance)
-- ==========================================
-- v3.0 (2026-05-30):
--   • Valida pertenencia al negocio de: p_turno_id, p_cliente_id, p_empleado_id,
--     y de cada producto/presentacion del array p_items. Sin estas validaciones
--     un usuario podría inyectar IDs de otro tenant.
--   • Elimina N+1: el loop por ítems se reemplaza por INSERT ... SELECT con
--     JOIN a productos/producto_presentaciones, una sola operación batch.
--   • Elimina EXCEPTION WHEN OTHERS (que enmascaraba SQLSTATE).
--
-- v2.0 (schema v11): multi-tenant UUID, secuencias filtran por negocio_id.
-- v1.9: precio_costo snapshot histórico desde producto_presentaciones o productos.
-- v1.4: idempotencia con p_idempotency_key UUID.
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_registrar_venta_pos(
  p_turno_id         UUID,
  p_empleado_id      UUID,
  p_cliente_id       UUID             DEFAULT NULL,
  p_tipo_comprobante TEXT             DEFAULT 'TICKET',
  p_total            DECIMAL(12,2)    DEFAULT 0,
  p_subtotal         DECIMAL(12,2)    DEFAULT 0,
  p_descuento        DECIMAL(12,2)    DEFAULT 0,
  p_descuento_pct    SMALLINT         DEFAULT 0,
  p_base_iva_0       DECIMAL(12,2)    DEFAULT 0,
  p_base_iva_15      DECIMAL(12,2)    DEFAULT 0,
  p_iva_valor        DECIMAL(12,2)    DEFAULT 0,
  p_metodo_pago      TEXT             DEFAULT 'EFECTIVO',
  p_items            JSONB            DEFAULT '[]',
  p_idempotency_key  UUID             DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id         UUID;
  v_venta_id           UUID;
  v_numero_comprobante INTEGER;
  v_existing_id        UUID;
  v_existing_numero    INTEGER;
  v_items_count        INTEGER;
  v_invalid_count      INTEGER;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- ────────── Idempotencia ──────────
  IF p_idempotency_key IS NOT NULL THEN
    v_existing_id     := (SELECT id                 FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);
    v_existing_numero := (SELECT numero_comprobante FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);

    IF v_existing_id IS NOT NULL THEN
      RETURN json_build_object(
        'success', true, 'venta_id', v_existing_id,
        'numero_comprobante', v_existing_numero, 'duplicado', true
      );
    END IF;
  END IF;

  -- ────────── 🔒 Validaciones multi-tenant ──────────
  IF NOT EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND negocio_id = v_negocio_id) THEN
    RAISE EXCEPTION 'El turno no pertenece a este negocio';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM usuario_negocios
    WHERE usuario_id = p_empleado_id AND negocio_id = v_negocio_id AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'El empleado no pertenece a este negocio';
  END IF;

  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = p_cliente_id AND negocio_id = v_negocio_id
  ) THEN
    RAISE EXCEPTION 'El cliente no pertenece a este negocio';
  END IF;

  -- Validar que TODOS los productos del array pertenezcan al negocio
  v_items_count := jsonb_array_length(p_items);
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'La venta debe contener al menos un ítem';
  END IF;

  v_invalid_count := (
    SELECT COUNT(*)
    FROM jsonb_array_elements(p_items) AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM productos
      WHERE id = (item->>'producto_id')::UUID
        AND negocio_id = v_negocio_id
    )
  );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Hay % producto(s) que no pertenecen a este negocio', v_invalid_count;
  END IF;

  -- ────────── Número de comprobante (atómico) ──────────
  UPDATE secuencias_comprobantes
  SET    ultimo_valor = ultimo_valor + 1
  WHERE  tipo_documento = p_tipo_comprobante
    AND  negocio_id = v_negocio_id;

  v_numero_comprobante := (
    SELECT ultimo_valor FROM secuencias_comprobantes
    WHERE tipo_documento = p_tipo_comprobante AND negocio_id = v_negocio_id
  );

  IF v_numero_comprobante IS NULL THEN
    RAISE EXCEPTION 'Tipo de comprobante no registrado en secuencias_comprobantes: %', p_tipo_comprobante;
  END IF;

  -- ────────── Insert maestro ──────────
  BEGIN
    v_venta_id := gen_random_uuid();
    INSERT INTO ventas (
      id, negocio_id, turno_id, cliente_id, empleado_id,
      tipo_comprobante, numero_comprobante,
      subtotal, descuento, descuento_pct, total,
      base_iva_0, base_iva_15, iva_valor,
      metodo_pago, estado, estado_pago, idempotency_key
    ) VALUES (
      v_venta_id, v_negocio_id, p_turno_id, p_cliente_id, p_empleado_id,
      p_tipo_comprobante::tipo_comprobante_enum, v_numero_comprobante,
      p_subtotal, p_descuento, p_descuento_pct, p_total,
      p_base_iva_0, p_base_iva_15, p_iva_valor,
      p_metodo_pago, 'COMPLETADA',
      CASE WHEN p_metodo_pago = 'FIADO' THEN 'PENDIENTE' ELSE 'NO_APLICA' END,
      p_idempotency_key
    );
  EXCEPTION WHEN unique_violation THEN
    -- Race condition: otro request con la misma idempotency_key ganó
    v_existing_id     := (SELECT id                 FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);
    v_existing_numero := (SELECT numero_comprobante FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);

    RETURN json_build_object(
      'success', true, 'venta_id', v_existing_id,
      'numero_comprobante', v_existing_numero, 'duplicado', true
    );
  END;

  -- ────────── Insert detalles (batch sin N+1) ──────────
  -- Resuelve precio_costo según presentacion (si existe) o producto base, en una
  -- sola operación con LEFT JOIN. Los triggers de stock/kardex/caja se ejecutan
  -- por cada fila insertada automáticamente.
  INSERT INTO ventas_detalles (
    venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal, presentacion_id
  )
  SELECT
    v_venta_id,
    (item->>'producto_id')::UUID,
    (item->>'cantidad')::DECIMAL,
    (item->>'precio_unitario')::DECIMAL,
    COALESCE(pp.precio_costo, p.precio_costo, 0),
    (item->>'subtotal')::DECIMAL,
    NULLIF(item->>'presentacion_id', '')::UUID
  FROM jsonb_array_elements(p_items) AS item
  LEFT JOIN producto_presentaciones pp
       ON pp.id = NULLIF(item->>'presentacion_id', '')::UUID
      AND pp.negocio_id = v_negocio_id
  LEFT JOIN productos p
       ON p.id = (item->>'producto_id')::UUID
      AND p.negocio_id = v_negocio_id;

  RETURN json_build_object(
    'success', true,
    'venta_id', v_venta_id,
    'numero_comprobante', v_numero_comprobante
  );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_venta_pos IS
  'v3.0 — Multi-tenant: valida turno/cliente/empleado/productos del negocio. '
  'Performance: detalles insertados en batch (INSERT ... SELECT) eliminando N+1. '
  'Idempotencia por p_idempotency_key. Triggers de stock/kardex/caja siguen aplicando.';
