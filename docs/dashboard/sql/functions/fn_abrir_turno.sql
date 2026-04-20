-- ==========================================
-- DROP — limpia versiones anteriores con cualquier firma
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_abrir_turno(INTEGER);
DROP FUNCTION IF EXISTS public.fn_abrir_turno();

-- ==========================================
-- FUNCIÓN: fn_abrir_turno (v1.0)
-- ==========================================
-- Apertura atómica de turno de caja.
-- Reemplaza la lógica multi-query de TurnosCajaService.abrirTurno() (3 queries separadas)
-- por una sola transacción con bloqueo implícito en el INSERT.
--
-- Ventajas sobre el enfoque TypeScript anterior:
--   - Elimina la race condition TOCTOU (check-then-act sin lock)
--   - El INSERT falla automáticamente si viola algún constraint futuro (ej: UNIQUE por día)
--   - Una sola ida al servidor en vez de 3
--
-- Llamada desde: TurnosCajaService.abrirTurno()
-- Parámetros:
--   p_empleado_id — empleado que abre el turno
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_abrir_turno(
  p_empleado_id INTEGER
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
BEGIN
  -- Inicio del día en zona horaria local (mismo patrón que reparar_deficit_turno)
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );

  -- Validar que no haya turno abierto hoy
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
  END IF;

  -- Número de turno: siguiente al último del día
  v_numero_turno := (
    SELECT COUNT(*) + 1
    FROM turnos_caja
    WHERE hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
  );

  v_turno_id := gen_random_uuid();
  INSERT INTO turnos_caja (id, numero_turno, empleado_id, hora_fecha_apertura)
  VALUES (v_turno_id, v_numero_turno, p_empleado_id, NOW());

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
GRANT EXECUTE ON FUNCTION public.fn_abrir_turno(INTEGER) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_abrir_turno IS
  'v1.0 - Apertura atómica de turno de caja. '
  'Valida que no haya turno abierto hoy antes de insertar. '
  'Calcula número de turno secuencial dentro del día. '
  'Elimina la race condition TOCTOU del enfoque TypeScript anterior (check-then-act sin lock). '
  'Retorna turno_id y numero_turno. Si ya hay turno abierto, retorna success: false con mensaje.';
