-- ==========================================
-- DROP — limpia versiones anteriores con cualquier firma
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_abrir_turno(INTEGER);
DROP FUNCTION IF EXISTS public.fn_abrir_turno(UUID);
DROP FUNCTION IF EXISTS public.fn_abrir_turno();

-- ==========================================
-- FUNCIÓN: fn_abrir_turno (v2.0 — multi-tenant UUID)
-- ==========================================
-- Apertura atómica de turno de caja.
-- Reemplaza la lógica multi-query de TurnosCajaService.abrirTurno().
--
-- CAMBIOS v2.0:
--   - p_empleado_id: INTEGER → UUID (schema v11 migró PKs a UUID)
--   - RLS filtra por negocio_id del JWT automáticamente en todas las queries
--
-- Llamada desde: TurnosCajaService.abrirTurno()
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_abrir_turno(
  p_empleado_id UUID
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
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();

  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
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
  INSERT INTO turnos_caja (id, negocio_id, numero_turno, empleado_id, hora_fecha_apertura)
  VALUES (v_turno_id, v_negocio_id, v_numero_turno, p_empleado_id, NOW());

  RETURN json_build_object(
    'success',      true,
    'turno_id',     v_turno_id,
    'numero_turno', v_numero_turno
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_abrir_turno(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_abrir_turno(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_abrir_turno IS
  'v2.0 - Apertura atómica de turno de caja. UUID (multi-tenant v11). '
  'Valida negocio activo en JWT y que no haya turno abierto hoy. '
  'Calcula número de turno secuencial dentro del día por negocio. '
  'Retorna turno_id y numero_turno. Si ya hay turno abierto, retorna success: false.';
