-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID, BOOLEAN
);
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID, BOOLEAN, TIMESTAMPTZ
);

-- ==========================================
-- FUNCIÓN: fn_registrar_venta_pos (v3.3 — fecha real de la venta offline)
-- ==========================================
-- v3.3 (2026-07-21):
--   • p_fecha (TIMESTAMPTZ, default NULL). El INSERT usa COALESCE(p_fecha, NOW()).
--     Una venta encolada offline viaja con el instante REAL en que se cobró; sin esto
--     el INSERT caía en DEFAULT NOW() = momento de sincronización, y una venta de la
--     noche sincronizada al día siguiente quedaba con la fecha equivocada (afectaba
--     resumen del día, cierre del turno e historial). El cliente manda toISOString()
--     (UTC); las queries que agrupan por día lo derivan a America/Guayaquil correctamente.
--     Online: el cliente igual manda p_fecha ≈ NOW(), sin diferencia práctica.
--
-- v3.2 (2026-07-11):
--   • Valida que cada presentacion_id de p_items pertenezca al negocio Y al producto
--     del ítem. Antes solo se validaban los productos: una presentacion_id de otro
--     producto (o de otro tenant) se insertaba tal cual en ventas_detalles y el trigger
--     fn_actualizar_stock_venta usaba su factor_conversion — stock y kardex incorrectos.
--
-- v3.1 (2026-06-10):
--   • p_permitir_stock_negativo (default false). Solo las ventas drenadas desde la
--     cola offline (SyncService) lo activan. Setea la variable de sesión transaccional
--     app.permitir_stock_negativo que el trigger fn_actualizar_stock_venta lee para
--     omitir el RAISE de stock insuficiente. El stock offline es optimista (§5).
--
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
  p_turno_id                UUID,
  p_empleado_id             UUID,
  p_cliente_id              UUID             DEFAULT NULL,
  p_tipo_comprobante        TEXT             DEFAULT 'TICKET',
  p_total                   DECIMAL(12,2)    DEFAULT 0,
  p_subtotal                DECIMAL(12,2)    DEFAULT 0,
  p_descuento               DECIMAL(12,2)    DEFAULT 0,
  p_descuento_pct           SMALLINT         DEFAULT 0,
  p_base_iva_0              DECIMAL(12,2)    DEFAULT 0,
  p_base_iva_15             DECIMAL(12,2)    DEFAULT 0,
  p_iva_valor               DECIMAL(12,2)    DEFAULT 0,
  p_metodo_pago             TEXT             DEFAULT 'EFECTIVO',
  p_items                   JSONB            DEFAULT '[]',
  p_idempotency_key         UUID             DEFAULT NULL,
  p_permitir_stock_negativo BOOLEAN          DEFAULT FALSE,
  p_fecha                   TIMESTAMPTZ      DEFAULT NULL
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

  -- Venta offline (§6): habilita stock negativo para esta transacción. El trigger
  -- fn_actualizar_stock_venta lee esta variable. is_local=true → vive solo en esta TX.
  IF p_permitir_stock_negativo THEN
    PERFORM set_config('app.permitir_stock_negativo', 'on', true);
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

  -- Validar que toda presentacion_id pertenezca al negocio Y al producto de su ítem.
  -- Sin esto, el trigger de stock leería el factor_conversion de una presentación ajena.
  v_invalid_count := (
    SELECT COUNT(*)
    FROM jsonb_array_elements(p_items) AS item
    WHERE NULLIF(item->>'presentacion_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM producto_presentaciones pp
        WHERE pp.id = (item->>'presentacion_id')::UUID
          AND pp.producto_id = (item->>'producto_id')::UUID
          AND pp.negocio_id = v_negocio_id
      )
  );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Hay % presentacion(es) que no pertenecen a este negocio o al producto indicado', v_invalid_count;
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
      id, negocio_id, turno_id, cliente_id, empleado_id, fecha,
      tipo_comprobante, numero_comprobante,
      subtotal, descuento, descuento_pct, total,
      base_iva_0, base_iva_15, iva_valor,
      metodo_pago, estado, estado_pago, idempotency_key
    ) VALUES (
      v_venta_id, v_negocio_id, p_turno_id, p_cliente_id, p_empleado_id, COALESCE(p_fecha, NOW()),
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
REVOKE EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID, BOOLEAN, TIMESTAMPTZ) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID, BOOLEAN, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_venta_pos IS
  'v3.3 — p_fecha (TIMESTAMPTZ, COALESCE con NOW()): una venta offline conserva su fecha '
  'REAL de cobro al sincronizar, no la del momento de sincronización. '
  'Multi-tenant: valida turno/cliente/empleado/productos Y presentaciones '
  '(pertenencia al negocio y al producto del ítem) del negocio. '
  'Performance: detalles insertados en batch (INSERT ... SELECT) eliminando N+1. '
  'Idempotencia por p_idempotency_key. p_permitir_stock_negativo habilita stock negativo '
  'para ventas drenadas de la cola offline (stock optimista §5/§6). '
  'Triggers de stock/kardex/caja siguen aplicando.';
