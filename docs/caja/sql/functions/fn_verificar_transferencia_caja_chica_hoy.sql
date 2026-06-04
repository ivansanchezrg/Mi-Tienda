-- ==========================================
-- FUNCIÓN: fn_verificar_transferencia_caja_chica_hoy
-- VERSIÓN: 1.4 (2026-05-30) — performance: ventana UTC en lugar de AT TIME ZONE en WHERE
-- ==========================================
-- CAMBIOS v1.4:
--   - Reemplaza (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha por
--     una comparación con ventana UTC. Permite que el índice de operaciones_cajas
--     se use efectivamente; sin esto, con miles de operaciones la query hacía
--     sequential scan completo.
-- CAMBIOS v1.3:
--   - Filtra por negocio_id del JWT
--   - Defensa para "Caja Varios desactivada"
--
-- Verifica si VARIOS ya recibió su transferencia diaria para la fecha indicada.
-- Cubre dos casos:
--   1. Cierre normal anterior del día        → TRANSFERENCIA_ENTRANTE en VARIOS
--   2. Ajuste de apertura (reparar déficit)  → INGRESO categoría DEF-REPONER en VARIOS (categorias_sistema)
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_verificar_transferencia_caja_chica_hoy(DATE);

CREATE OR REPLACE FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(
  p_fecha DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id UUID;
  v_varios_id  UUID;
  v_inicio_utc TIMESTAMPTZ;
  v_fin_utc    TIMESTAMPTZ;
  -- UUID fijo de categorias_sistema para DEF-REPONER
  v_cat_def_reponer CONSTANT UUID := 'a1000001-0000-0000-0000-000000000005';
BEGIN
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);

  -- Si la caja VARIOS no existe (Varios desactivada), no hay transferencia que verificar
  IF v_varios_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Ventana UTC equivalente al día local de Ecuador (UTC-5, sin DST):
  -- p_fecha 00:00 EC = (p_fecha) 05:00 UTC
  v_inicio_utc := (p_fecha::TIMESTAMP        AT TIME ZONE 'America/Guayaquil');
  v_fin_utc    := ((p_fecha + 1)::TIMESTAMP  AT TIME ZONE 'America/Guayaquil');

  RETURN EXISTS (
    SELECT 1
    FROM operaciones_cajas oc
    WHERE oc.negocio_id = v_negocio_id
      AND oc.caja_id    = v_varios_id
      AND oc.fecha     >= v_inicio_utc
      AND oc.fecha     <  v_fin_utc
      AND (
        oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
        OR (oc.tipo_operacion = 'INGRESO' AND oc.categoria_sistema_id = v_cat_def_reponer)
      )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy IS
  'v1.5 — Categoría DEF-REPONER migrada a categorias_sistema (UUID fijo, sin negocio_id). '
  'v1.4: Performance: rango UTC en lugar de AT TIME ZONE en WHERE. '
  'Detecta TRANSFERENCIA_ENTRANTE (cierre normal) o INGRESO DEF-REPONER (ajuste apertura).';
