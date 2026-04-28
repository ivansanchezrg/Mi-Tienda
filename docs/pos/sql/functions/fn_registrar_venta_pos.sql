-- ==========================================
-- DROP — la firma cambia (p_empleado_id INTEGER → UUID, multi-tenant):
-- ejecutar UNA VEZ antes del CREATE
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);

-- ==========================================
-- FUNCIÓN: fn_registrar_venta_pos (v2.0 — multi-tenant UUID)
-- ==========================================
-- Procesa una venta del POS en una transacción atómica.
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- CAMBIOS v2.0 (schema v11 multi-tenant):
--   - p_empleado_id: INTEGER → UUID
--   - v_negocio_id UUID: leído de public.get_negocio_id() (JWT)
--   - secuencias_comprobantes: todas las queries filtran por negocio_id
--   - ventas INSERT incluye negocio_id
--   - DROP/GRANT usan firma UUID
--
-- HEREDA DE v1.9:
--   - Idempotencia (p_idempotency_key)
--   - Snapshot de precio_costo (presentacion o producto base)
--   - Descuentos (monto + porcentaje)
--   - Triggers automáticos: stock (kardex) + CAJA_CHICA (efectivo)
--
-- v1.9 — Fix precio_costo snapshot: si hay presentacion_id lee precio_costo de
--   producto_presentaciones (costo real del paquete); si es venta directa lee de
--   productos (costo unitario base).
--
-- v1.4 — Idempotencia: acepta p_idempotency_key UUID.
--   Si la clave ya existe en ventas, retorna la venta existente
--   en lugar de crear un duplicado (protege contra reintentos por
--   red inestable o doble-tap).
--
-- Flujo interno:
--   1. Si p_idempotency_key ya existe → retorna venta existente (sin efectos secundarios)
--   2. Obtiene el siguiente numero_comprobante de secuencias_comprobantes
--      usando UPDATE ... RETURNING atómico (filtrado por negocio_id)
--   3. Inserta encabezado en `ventas` con negocio_id y todos los campos fiscales
--   4. Inserta ítems en `ventas_detalles`
--   5. El Trigger `trg_descontar_stock_venta` descuenta el stock automáticamente
--   6. El Trigger `trg_actualizar_caja_por_venta` sube el saldo de CAJA_CHICA si es EFECTIVO
--
-- Prerequisito: ejecutar primero secuencias_comprobantes.sql
--
-- Llamada desde: PosService.procesarVenta()
-- Parámetros:
--   p_turno_id          — UUID del turno activo (NOT NULL en ventas)
--   p_empleado_id       — UUID del cajero
--   p_cliente_id        — UUID del cliente (NULL = Consumidor Final)
--   p_tipo_comprobante  — 'TICKET' | 'NOTA_VENTA' | 'FACTURA'
--   p_total             — Monto total cobrado al cliente (incluye IVA si aplica)
--   p_subtotal          — Base neta sin IVA (= total en TICKET/NOTA_VENTA, = base0+base15 en FACTURA)
--   p_descuento         — Monto de descuento aplicado (0 si no aplica o si es FIADO)
--   p_descuento_pct     — Porcentaje de descuento aplicado (0 si no aplica o si es FIADO)
--   p_base_iva_0        — Base gravada 0% (solo FACTURA, sino 0)
--   p_base_iva_15       — Base gravada 15% antes de IVA (solo FACTURA, sino 0)
--   p_iva_valor         — Valor del IVA 15% extraído (solo FACTURA, sino 0)
--   p_metodo_pago       — 'EFECTIVO' | 'DEUNA' | 'TRANSFERENCIA' | 'FIADO'
--   p_items             — JSONB array: [{producto_id, cantidad, precio_unitario, subtotal}]
--   p_idempotency_key   — UUID generado por el cliente antes del RPC (protección contra duplicados)
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
  v_item               JSONB;
  v_numero_comprobante INTEGER;
  v_existing_id        UUID;
  v_existing_numero    INTEGER;
  v_precio_costo       DECIMAL(12,2);
BEGIN
  -- Obtener negocio del JWT
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- 0. Idempotencia: si la clave ya existe, retornar la venta previa sin tocar nada.
  --    Esto protege contra reintentos cuando la red falla después de que la BD ya procesó.
  IF p_idempotency_key IS NOT NULL THEN
    v_existing_id     := (SELECT id                 FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);
    v_existing_numero := (SELECT numero_comprobante  FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);

    IF v_existing_id IS NOT NULL THEN
      RETURN json_build_object(
        'success',            true,
        'venta_id',           v_existing_id,
        'numero_comprobante', v_existing_numero,
        'duplicado',          true
      );
    END IF;
  END IF;

  -- 1. Obtener el siguiente número de comprobante de forma atómica.
  --    UPDATE bloquea solo la fila del tipo correspondiente → cero colisiones bajo concurrencia.
  --    Filtra por negocio_id para que cada tenant tenga su propia secuencia.
  UPDATE secuencias_comprobantes
  SET    ultimo_valor = ultimo_valor + 1
  WHERE  tipo_documento = p_tipo_comprobante
    AND  negocio_id = v_negocio_id;

  v_numero_comprobante := (SELECT ultimo_valor FROM secuencias_comprobantes WHERE tipo_documento = p_tipo_comprobante AND negocio_id = v_negocio_id);

  -- Si el tipo no existe en la tabla, abortar con mensaje claro
  IF v_numero_comprobante IS NULL THEN
    RAISE EXCEPTION 'Tipo de comprobante no registrado en secuencias_comprobantes: %', p_tipo_comprobante;
  END IF;

  -- 2. Insertar la Venta maestra con todos los campos fiscales + numero_comprobante
  BEGIN
    v_venta_id := gen_random_uuid();
    INSERT INTO ventas (
      id,
      negocio_id,
      turno_id,
      cliente_id,
      empleado_id,
      tipo_comprobante,
      numero_comprobante,
      subtotal,
      descuento,
      descuento_pct,
      total,
      base_iva_0,
      base_iva_15,
      iva_valor,
      metodo_pago,
      estado,
      estado_pago,
      idempotency_key
    ) VALUES (
      v_venta_id,
      v_negocio_id,
      p_turno_id,
      p_cliente_id,
      p_empleado_id,
      p_tipo_comprobante::tipo_comprobante_enum,
      v_numero_comprobante,
      p_subtotal,
      p_descuento,
      p_descuento_pct,
      p_total,
      p_base_iva_0,
      p_base_iva_15,
      p_iva_valor,
      p_metodo_pago,
      'COMPLETADA',
      CASE WHEN p_metodo_pago = 'FIADO' THEN 'PENDIENTE' ELSE 'NO_APLICA' END,
      p_idempotency_key
    );
  EXCEPTION WHEN unique_violation THEN
    -- Race condition: otro request con la misma idempotency_key ganó entre el SELECT y el INSERT.
    -- Retornar la venta que ya se insertó.
    v_existing_id     := (SELECT id                FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);
    v_existing_numero := (SELECT numero_comprobante FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);

    RETURN json_build_object(
      'success',            true,
      'venta_id',           v_existing_id,
      'numero_comprobante', v_existing_numero,
      'duplicado',          true
    );
  END;

  -- 3. Insertar los detalles (líneas de ítems)
  --    El trigger trg_descontar_stock_venta se ejecuta automáticamente
  --    por cada INSERT en ventas_detalles → descuenta stock + graba kardex
  --    precio_costo: si hay presentacion_id → costo de la presentacion (precio_costo del paquete)
  --                  si venta directa        → costo del producto base
  --    Garantiza snapshot histórico inmutable y costo correcto según la forma de venta.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'presentacion_id') IS NOT NULL THEN
      v_precio_costo := (SELECT precio_costo FROM producto_presentaciones WHERE id = (v_item->>'presentacion_id')::UUID);
    ELSE
      v_precio_costo := (SELECT precio_costo FROM productos WHERE id = (v_item->>'producto_id')::UUID);
    END IF;

    INSERT INTO ventas_detalles (
      venta_id,
      producto_id,
      cantidad,
      precio_unitario,
      precio_costo,
      subtotal,
      presentacion_id
    ) VALUES (
      v_venta_id,
      (v_item->>'producto_id')::UUID,
      (v_item->>'cantidad')::DECIMAL,
      (v_item->>'precio_unitario')::DECIMAL,
      COALESCE(v_precio_costo, 0),
      (v_item->>'subtotal')::DECIMAL,
      (v_item->>'presentacion_id')::UUID
    );
  END LOOP;

  -- 4. Retornar resultado exitoso con numero_comprobante para mostrar/imprimir
  RETURN json_build_object(
    'success',            true,
    'venta_id',           v_venta_id,
    'numero_comprobante', v_numero_comprobante
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar venta POS: %', SQLERRM;
END;
$$;

-- Permisos (firma v2.0 — p_empleado_id UUID)
REVOKE EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_venta_pos IS
  'v2.0 (multi-tenant UUID) — Registra venta completa del POS en transacción atómica. '
  'p_empleado_id UUID (era INTEGER en v1.x). Negocio leído del JWT; secuencias y ventas filtran por negocio_id. '
  'v1.9 — Fix precio_costo snapshot: venta por presentacion usa producto_presentaciones.precio_costo '
  '(costo del paquete); venta directa usa productos.precio_costo (costo unitario). '
  'v1.4 — Idempotencia: p_idempotency_key UUID para evitar duplicados por reintento. '
  'Triggers automáticos: descuento de stock (kardex) y actualización de CAJA_CHICA.';
