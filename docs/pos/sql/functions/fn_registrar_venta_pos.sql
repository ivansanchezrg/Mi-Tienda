-- ==========================================
-- DROP — la firma cambia (nuevo parámetro p_idempotency_key):
-- ejecutar UNA VEZ antes del CREATE
-- ==========================================
DROP FUNCTION IF EXISTS public.registrar_venta_pos(
  UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB
);

-- ==========================================
-- FUNCIÓN: registrar_venta_pos (v1.4)
-- ==========================================
-- Procesa una venta del POS en una transacción atómica.
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- v1.4 — Idempotencia: acepta p_idempotency_key UUID.
--   Si la clave ya existe en ventas, retorna la venta existente
--   en lugar de crear un duplicado (protege contra reintentos por
--   red inestable o doble-tap).
--
-- Flujo interno:
--   1. Si p_idempotency_key ya existe → retorna venta existente (sin efectos secundarios)
--   2. Obtiene el siguiente numero_comprobante de secuencias_comprobantes
--      usando UPDATE ... RETURNING (atómico, sin race conditions)
--   3. Inserta encabezado en `ventas` con todos los campos fiscales + numero_comprobante
--   4. Inserta ítems en `ventas_detalles`
--   5. El Trigger `trg_descontar_stock_venta` descuenta el stock automáticamente
--   6. El Trigger `trg_actualizar_caja_por_venta` sube el saldo de CAJA_CHICA si es EFECTIVO
--
-- Prerequisito: ejecutar primero secuencias_comprobantes.sql
--
-- Llamada desde: PosService.procesarVenta()
-- Parámetros:
--   p_turno_id          — UUID del turno activo (NOT NULL en ventas)
--   p_empleado_id       — ID del cajero
--   p_cliente_id        — UUID del cliente (NULL = Consumidor Final)
--   p_tipo_comprobante  — 'TICKET' | 'NOTA_VENTA' | 'FACTURA'
--   p_total             — Monto total cobrado al cliente (incluye IVA si aplica)
--   p_subtotal          — Base neta sin IVA (= total en TICKET/NOTA_VENTA, = base0+base15 en FACTURA)
--   p_base_iva_0        — Base gravada 0% (solo FACTURA, sino 0)
--   p_base_iva_15       — Base gravada 15% antes de IVA (solo FACTURA, sino 0)
--   p_iva_valor         — Valor del IVA 15% extraído (solo FACTURA, sino 0)
--   p_metodo_pago       — 'EFECTIVO' | 'DEUNA' | 'TRANSFERENCIA' | 'FIADO'
--   p_items             — JSONB array: [{producto_id, cantidad, precio_unitario, subtotal}]
--   p_idempotency_key   — UUID generado por el cliente antes del RPC (protección contra duplicados)
-- ==========================================

CREATE OR REPLACE FUNCTION public.registrar_venta_pos(
  p_turno_id         UUID,
  p_empleado_id      INTEGER,
  p_cliente_id       UUID             DEFAULT NULL,
  p_tipo_comprobante TEXT             DEFAULT 'TICKET',
  p_total            DECIMAL(12,2)    DEFAULT 0,
  p_subtotal         DECIMAL(12,2)    DEFAULT 0,
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
  v_venta_id           UUID;
  v_item               JSONB;
  v_numero_comprobante INTEGER;
  v_existing_id        UUID;
  v_existing_numero    INTEGER;
BEGIN

  -- 0. Idempotencia: si la clave ya existe, retornar la venta previa sin tocar nada.
  --    Esto protege contra reintentos cuando la red falla después de que la BD ya procesó.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, numero_comprobante
    INTO   v_existing_id, v_existing_numero
    FROM   ventas
    WHERE  idempotency_key = p_idempotency_key;

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
  --    UPDATE ... RETURNING bloquea solo la fila del tipo correspondiente
  --    por milisegundos → cero colisiones bajo concurrencia.
  UPDATE secuencias_comprobantes
  SET    ultimo_valor = ultimo_valor + 1
  WHERE  tipo_documento = p_tipo_comprobante
  RETURNING ultimo_valor INTO v_numero_comprobante;

  -- Si el tipo no existe en la tabla, abortar con mensaje claro
  IF v_numero_comprobante IS NULL THEN
    RAISE EXCEPTION 'Tipo de comprobante no registrado en secuencias_comprobantes: %', p_tipo_comprobante;
  END IF;

  -- 2. Insertar la Venta maestra con todos los campos fiscales + numero_comprobante
  BEGIN
    INSERT INTO ventas (
      turno_id,
      cliente_id,
      empleado_id,
      tipo_comprobante,
      numero_comprobante,
      subtotal,
      total,
      base_iva_0,
      base_iva_15,
      iva_valor,
      metodo_pago,
      estado,
      estado_pago,
      idempotency_key
    ) VALUES (
      p_turno_id,
      p_cliente_id,
      p_empleado_id,
      p_tipo_comprobante::tipo_comprobante_enum,
      v_numero_comprobante,
      p_subtotal,
      p_total,
      p_base_iva_0,
      p_base_iva_15,
      p_iva_valor,
      p_metodo_pago,
      'COMPLETADA',
      CASE WHEN p_metodo_pago = 'FIADO' THEN 'PENDIENTE' ELSE 'NO_APLICA' END,
      p_idempotency_key
    )
    RETURNING id INTO v_venta_id;
  EXCEPTION WHEN unique_violation THEN
    -- Race condition: otro request con la misma idempotency_key ganó entre el SELECT y el INSERT.
    -- Retornar la venta que ya se insertó.
    SELECT id, numero_comprobante
    INTO   v_existing_id, v_existing_numero
    FROM   ventas
    WHERE  idempotency_key = p_idempotency_key;

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
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO ventas_detalles (
      venta_id,
      producto_id,
      cantidad,
      precio_unitario,
      subtotal
    ) VALUES (
      v_venta_id,
      (v_item->>'producto_id')::UUID,
      (v_item->>'cantidad')::DECIMAL,
      (v_item->>'precio_unitario')::DECIMAL,
      (v_item->>'subtotal')::DECIMAL
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

-- Permisos (firma cambió — incluye p_idempotency_key)
REVOKE EXECUTE ON FUNCTION public.registrar_venta_pos(UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.registrar_venta_pos(UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.registrar_venta_pos IS
  'v1.4 — Idempotencia: acepta p_idempotency_key UUID para evitar ventas duplicadas por reintento. '
  'SELECT previo + EXCEPTION WHEN unique_violation como doble barrera contra race conditions. '
  'Registra venta completa del POS en transacción atómica. '
  'Triggers automáticos: descuento de stock (kardex) y actualización de CAJA_CHICA. '
  'Campos SRI (secuencial_sri, clave_acceso_sri, estado_sri) dormidos para fase futura.';
