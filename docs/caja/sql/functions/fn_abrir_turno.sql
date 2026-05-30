-- ==========================================
-- DROP — limpia versiones anteriores con cualquier firma
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_abrir_turno(INTEGER);
DROP FUNCTION IF EXISTS public.fn_abrir_turno(UUID);
DROP FUNCTION IF EXISTS public.fn_abrir_turno();
DROP FUNCTION IF EXISTS public.fn_abrir_turno(UUID, DECIMAL);

-- ==========================================
-- FUNCIÓN: fn_abrir_turno (v3.0 — fondo de apertura libre)
-- ==========================================
-- CAMBIOS v3.0:
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
  v_inicio_dia   TIMESTAMPTZ;
  v_numero_turno INTEGER;
  v_turno_id     UUID;
  v_negocio_id   UUID;
  v_caja_id      UUID;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();

  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  IF p_fondo_apertura < 0 THEN
    RETURN json_build_object('success', false, 'error', 'El fondo de apertura no puede ser negativo');
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

  -- Validar que no haya turno abierto hoy en este negocio
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE negocio_id          = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
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

  RETURN json_build_object(
    'success',       true,
    'turno_id',      v_turno_id,
    'numero_turno',  v_numero_turno,
    'fondo_apertura', p_fondo_apertura
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_abrir_turno(UUID, DECIMAL) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_abrir_turno(UUID, DECIMAL) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_abrir_turno IS
  'v3.0 - Apertura atómica de turno de caja con fondo libre. '
  'p_fondo_apertura: monto que el empleado declara en el cajón al abrir (libre, sin valor fijo). '
  'Se guarda en turnos_caja.fondo_apertura para que el cierre lo use como referencia. '
  'UUID (multi-tenant v11). Resuelve caja_id automáticamente (CAJA_CHICA). '
  'Retorna turno_id, numero_turno y fondo_apertura.';
