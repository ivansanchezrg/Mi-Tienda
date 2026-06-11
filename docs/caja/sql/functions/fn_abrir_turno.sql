-- ==========================================
-- DROP — limpia versiones anteriores con cualquier firma
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_abrir_turno(INTEGER);
DROP FUNCTION IF EXISTS public.fn_abrir_turno(UUID);
DROP FUNCTION IF EXISTS public.fn_abrir_turno();
DROP FUNCTION IF EXISTS public.fn_abrir_turno(UUID, DECIMAL);

-- ==========================================
-- FUNCIÓN: fn_abrir_turno (v3.3 — validación de turno abierto sin filtro de fecha)
-- ==========================================
-- CAMBIOS v3.3:
--   - La validación de turno abierto ya no filtra por fecha: un turno de un día
--     anterior sin cerrar también bloquea la apertura con mensaje limpio (antes
--     el INSERT chocaba contra idx_un_turno_abierto_por_caja con unique_violation crudo).
--
-- HEREDA DE v3.2:
--   - Categoría FONDO-APERTURA migrada a categorias_sistema (UUID fijo).
--
-- HEREDA DE v3.0:
--   - Agrega p_fondo_apertura DECIMAL: el empleado declara cuánto efectivo
--     deja en el cajón al abrir. Se guarda en turnos_caja.fondo_apertura.
--   - Elimina lectura de caja_fondo_fijo_diario (ya no existe en configuraciones).
--   - fondo_cubierto eliminado de turnos_caja — ya no aplica sin fondo fijo.
--
-- HEREDA DE v2.1:
--   - Resuelve caja_id automáticamente (CAJA_CHICA) sin cambiar la firma base.
--   - Puebla turnos_caja.caja_id en cada INSERT.
--   - Al implementar multicaja: agregar p_caja_id UUID a la firma.
--
-- Llamada desde: TurnosCajaService.abrirTurno()
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_abrir_turno(
  p_empleado_id   UUID,
  p_fondo_apertura DECIMAL(12,2) DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inicio_dia        TIMESTAMPTZ;
  v_numero_turno      INTEGER;
  v_turno_id          UUID;
  v_negocio_id        UUID;
  v_caja_id           UUID;
  v_caja_tienda_id    UUID;
  v_saldo_tienda      DECIMAL(12,2);
  -- UUID fijo de categorias_sistema para FONDO-APERTURA
  v_cat_fondo_id      CONSTANT UUID := 'a1000001-0000-0000-0000-000000000007';
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();

  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  IF p_fondo_apertura < 0 THEN
    RETURN json_build_object('success', false, 'error', 'El fondo de apertura no puede ser negativo');
  END IF;

  -- 🔒 SEGURIDAD MULTI-TENANT: el empleado debe tener membresía activa en este negocio.
  IF NOT EXISTS (
    SELECT 1 FROM usuario_negocios
    WHERE usuario_id = p_empleado_id
      AND negocio_id = v_negocio_id
      AND activo     = TRUE
  ) THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no pertenece a este negocio');
  END IF;

  -- Resolver CAJA_CHICA del negocio (única caja operativa en modelo mono-caja).
  v_caja_id := (SELECT id FROM cajas WHERE negocio_id = v_negocio_id AND codigo = 'CAJA_CHICA' LIMIT 1);

  IF v_caja_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja operativa del negocio');
  END IF;

  -- Inicio del día en zona horaria local
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );

  -- Validar que no haya turno abierto en este negocio. Sin filtro de fecha:
  -- un turno de un día anterior sin cerrar también debe bloquear con mensaje
  -- limpio — si llegara al INSERT, idx_un_turno_abierto_por_caja lo rechazaría
  -- con un unique_violation crudo para el usuario.
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto');
  END IF;

  -- Número de turno: siguiente al último del día en este negocio
  v_numero_turno := (
    SELECT COUNT(*) + 1
    FROM turnos_caja
    WHERE negocio_id          = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
  );

  v_turno_id := gen_random_uuid();
  INSERT INTO turnos_caja (id, negocio_id, caja_id, numero_turno, empleado_id, hora_fecha_apertura, fondo_apertura)
  VALUES (v_turno_id, v_negocio_id, v_caja_id, v_numero_turno, p_empleado_id, NOW(), p_fondo_apertura);

  -- Registrar egreso de Tienda por el fondo entregado al cajón (solo si hay fondo > 0)
  IF p_fondo_apertura > 0 THEN
    v_caja_tienda_id := (SELECT id FROM cajas WHERE negocio_id = v_negocio_id AND codigo = 'CAJA' LIMIT 1);
    v_saldo_tienda   := (SELECT saldo_actual FROM cajas WHERE id = v_caja_tienda_id);

    -- Validar que Tienda tenga saldo suficiente para cubrir el fondo
    IF v_saldo_tienda < p_fondo_apertura THEN
      RAISE EXCEPTION 'Saldo insuficiente en Tienda para entregar el fondo. Saldo actual: $%, fondo solicitado: $%',
        ROUND(v_saldo_tienda, 2), ROUND(p_fondo_apertura, 2);
    END IF;

    -- Actualizar saldo de Tienda
    UPDATE cajas
    SET saldo_actual = v_saldo_tienda - p_fondo_apertura
    WHERE id = v_caja_tienda_id AND negocio_id = v_negocio_id;

    -- Registrar operación visible en el historial de Tienda
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_sistema_id, monto,
      saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_tienda_id,
      p_empleado_id,
      'EGRESO',
      v_cat_fondo_id,
      p_fondo_apertura,
      v_saldo_tienda,
      v_saldo_tienda - p_fondo_apertura,
      'Fondo entregado al cajon para apertura de turno #' || v_numero_turno
    );
  END IF;

  RETURN json_build_object(
    'success',        true,
    'turno_id',       v_turno_id,
    'numero_turno',   v_numero_turno,
    'fondo_apertura', p_fondo_apertura
  );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_abrir_turno(UUID, DECIMAL) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_abrir_turno(UUID, DECIMAL) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_abrir_turno IS
  'v3.3 — Validación de turno abierto sin filtro de fecha (cubre turno de día anterior sin cerrar). '
  'v3.2 — Categoría FONDO-APERTURA migrada a categorias_sistema (UUID fijo). '
  'v3.1 - Apertura atómica de turno de caja con fondo libre. '
  'p_fondo_apertura: monto que el empleado declara en el cajón al abrir. '
  'Si fondo > 0: valida que Tienda tenga saldo suficiente (RAISE EXCEPTION si no alcanza), '
  'luego registra EGRESO de Tienda (categoria: Fondo Apertura Turno) para '
  'que el ciclo cajón→Tienda al cierre no duplique dinero. '
  'Se guarda en turnos_caja.fondo_apertura para que el cierre calcule efectivo_esperado. '
  'UUID (multi-tenant v11). Resuelve caja_id automáticamente (CAJA_CHICA). '
  'Retorna turno_id, numero_turno y fondo_apertura.';
