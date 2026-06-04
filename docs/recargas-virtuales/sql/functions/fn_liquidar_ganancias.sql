-- ==========================================
-- FUNCION: fn_liquidar_ganancias
-- VERSION: 2.3 (2026-05-30)
-- ==========================================
-- Liquida la ganancia pendiente de CELULAR o BUS en un solo paso atomico.
-- Ambos servicios funcionan igual: pagado_proveedor=true AND ganancia_liquidada=false.
--
-- v2.3 — CORRECTITUD (race condition fix):
--   - SELECT FOR UPDATE sobre las filas a liquidar ANTES del cálculo.
--   - Almacena los IDs en un array (v_filas_ids) y usa esos IDs específicos
--     en el UPDATE final, en vez de repetir el WHERE genérico.
--   - Garantiza: lo que se calcula es exactamente lo que se liquida, sin
--     que filas nuevas registradas concurrentemente "se cuelen" al UPDATE.
--   - Valida que p_empleado_id tenga membresía activa en el negocio.
--
-- v2.2 — Ambos servicios filtran pagado_proveedor=true AND ganancia_liquidada=false.
--   - CELULAR: pagado_proveedor=true via fn_pagar_proveedor_celular
--   - BUS: pagado_proveedor=true desde el momento del registro (fn_registrar_compra_saldo_bus)
--
-- v2.0 — CELULAR unificado con BUS:
--   - Ya no existe etapa intermedia "pagar al proveedor" para CELULAR.
--   - Ambos servicios filtran pagado_proveedor=false y marcan
--     pagado_proveedor=true + ganancia_liquidada=true en la misma operacion.
--
-- LÓGICA DE NEGOCIO:
--   - Caja origen: CAJA_CELULAR (CELULAR) o CAJA_BUS (BUS)
--   - Caja destino automatica: VARIOS si caja_varios_activa=true, sino CAJA
--   - Valida saldo suficiente en caja origen ANTES de la transferencia
--   - Atomico todo-o-nada: si falla cualquier paso, rollback completo
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_celular(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_celular(UUID, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_celular(UUID);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(INTEGER);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(UUID, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(UUID);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_liquidar_ganancias(
  p_servicio    TEXT,  -- 'CELULAR' | 'BUS'
  p_empleado_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id       UUID;
  v_tipo_id          INTEGER;
  v_caja_origen      TEXT;
  v_caja_destino     TEXT;
  v_caja_saldo       NUMERIC;
  v_filas_ids        UUID[];
  v_total_ganancia   NUMERIC;
  v_filas_afectadas  INTEGER;
  v_transfer_result  JSON;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  IF p_servicio NOT IN ('CELULAR', 'BUS') THEN
    RAISE EXCEPTION 'Servicio invalido: %. Debe ser CELULAR o BUS', p_servicio;
  END IF;

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- 🔒 Multi-tenant: validar empleado pertenece al negocio activo
  IF NOT EXISTS (
    SELECT 1 FROM usuario_negocios
    WHERE usuario_id = p_empleado_id
      AND negocio_id = v_negocio_id
      AND activo     = TRUE
  ) THEN
    RAISE EXCEPTION 'El empleado no pertenece a este negocio';
  END IF;

  v_tipo_id := (SELECT id FROM tipos_servicio WHERE codigo = p_servicio);
  IF v_tipo_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio % no encontrado', p_servicio;
  END IF;

  v_caja_origen := CASE p_servicio
    WHEN 'CELULAR' THEN 'CAJA_CELULAR'
    WHEN 'BUS'     THEN 'CAJA_BUS'
  END;

  -- ════════════════════════════════════════════════════════════════
  -- 1. SELECCIONAR Y BLOQUEAR las filas pendientes (FOR UPDATE)
  --    Esto evita que otra transacción inserte/modifique filas que
  --    pertenecerían al cálculo entre el SUM y el UPDATE final.
  --    Capturamos IDs y total en una sola pasada.
  --
  -- ⚠️ Patrón Supabase: SELECT ... INTO no funciona (ver CLAUDE.md).
  --    Usamos := (SELECT ...) por separado. El SELECT interno con FOR UPDATE
  --    bloquea las filas; el array_agg/SUM agregan sobre el set bloqueado.
  -- ════════════════════════════════════════════════════════════════
  v_filas_ids := (
    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
    FROM (
      SELECT id
      FROM recargas_virtuales
      WHERE negocio_id       = v_negocio_id
        AND tipo_servicio_id = v_tipo_id
        AND pagado_proveedor   = true
        AND ganancia_liquidada = false
      FOR UPDATE
    ) locked
  );

  v_total_ganancia := (
    SELECT COALESCE(SUM(ganancia), 0)
    FROM recargas_virtuales
    WHERE id = ANY(v_filas_ids)
  );

  -- Validar que haya algo a liquidar
  IF v_filas_ids IS NULL OR array_length(v_filas_ids, 1) = 0 OR v_total_ganancia <= 0 THEN
    RAISE EXCEPTION 'No hay ganancias % pendientes de liquidar', p_servicio;
  END IF;

  -- ════════════════════════════════════════════════════════════════
  -- 2. VALIDAR saldo de la caja origen (lock implícito en transferencia)
  --    Lectura sin FOR UPDATE aquí — el lock real lo hace fn_crear_transferencia.
  -- ════════════════════════════════════════════════════════════════
  v_caja_saldo := (
    SELECT saldo_actual FROM cajas
    WHERE codigo = v_caja_origen AND negocio_id = v_negocio_id
  );

  IF v_caja_saldo IS NULL THEN
    RAISE EXCEPTION 'Caja % no encontrada en este negocio', v_caja_origen;
  END IF;

  IF v_caja_saldo < v_total_ganancia THEN
    RAISE EXCEPTION 'Saldo insuficiente en %. Disponible: $%, Requerido: $%',
      v_caja_origen, v_caja_saldo, v_total_ganancia;
  END IF;

  -- ════════════════════════════════════════════════════════════════
  -- 3. DETERMINAR caja destino
  --    VARIOS si está activa, sino CAJA (Tienda)
  -- ════════════════════════════════════════════════════════════════
  v_caja_destino := CASE
    WHEN (SELECT valor = 'true' FROM configuraciones
          WHERE clave = 'caja_varios_activa' AND negocio_id = v_negocio_id)
    THEN 'VARIOS'
    ELSE 'CAJA'
  END;

  -- ════════════════════════════════════════════════════════════════
  -- 4. TRANSFERENCIA atómica: caja origen → caja destino
  --    fn_crear_transferencia v3.0 hace FOR UPDATE en ambas cajas.
  -- ════════════════════════════════════════════════════════════════
  v_transfer_result := public.fn_crear_transferencia(
    v_caja_origen,
    v_caja_destino,
    v_total_ganancia,
    p_empleado_id,
    'Liquidacion ganancia ' || p_servicio
  );

  IF NOT (v_transfer_result->>'success')::boolean THEN
    RAISE EXCEPTION '%', v_transfer_result->>'error';
  END IF;

  -- ════════════════════════════════════════════════════════════════
  -- 5. MARCAR EXACTAMENTE las filas que se incluyeron en el cálculo
  --    Usamos v_filas_ids (array de IDs bloqueados con FOR UPDATE)
  --    en lugar de repetir el WHERE genérico que podría capturar
  --    filas insertadas concurrentemente.
  -- ════════════════════════════════════════════════════════════════
  UPDATE recargas_virtuales
  SET ganancia_liquidada         = true,
      fecha_liquidacion_ganancia = CURRENT_DATE
  WHERE id = ANY(v_filas_ids);

  GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

  RETURN json_build_object(
    'success',         true,
    'total_ganancia',  v_total_ganancia,
    'caja_destino',    v_caja_destino,
    'filas_afectadas', v_filas_afectadas,
    'message',         'Ganancia $' || v_total_ganancia || ' transferida a ' || v_caja_destino ||
                       ' (' || v_filas_afectadas || ' registros liquidados)'
  );
END;
$$;

COMMENT ON FUNCTION public.fn_liquidar_ganancias(TEXT, UUID) IS
'v2.3 (2026-05-30) — Race condition fix:
- SELECT FOR UPDATE bloquea las filas pendientes antes del cálculo.
- UPDATE final usa los IDs específicos capturados (no WHERE genérico).
- Valida empleado pertenece al negocio activo.
Liquida ganancia CELULAR o BUS de forma atómica. Filtra
pagado_proveedor=true AND ganancia_liquidada=false.
Caja origen: CAJA_CELULAR o CAJA_BUS según el servicio.
Caja destino automatica: VARIOS si esta activa, sino CAJA (Tienda).
Si la caja origen no cubre el total, RAISE EXCEPTION.';

REVOKE EXECUTE ON FUNCTION public.fn_liquidar_ganancias(TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_liquidar_ganancias(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
