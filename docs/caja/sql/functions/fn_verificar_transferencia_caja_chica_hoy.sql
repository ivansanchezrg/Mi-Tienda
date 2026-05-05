-- ==========================================
-- FUNCIÓN: fn_verificar_transferencia_caja_chica_hoy
-- VERSIÓN: 1.3
-- ==========================================
-- CAMBIOS v1.3:
--   - Filtra por negocio_id del JWT (bug multi-tenant pre-existente: antes podía
--     dar falsos positivos si otro negocio tenía una operación VARIOS hoy)
--   - Defensa para "Caja Varios desactivada": si la caja VARIOS no existe en el
--     negocio, retorna FALSE sin hacer la query.
-- CAMBIOS v1.2:
--   - Busca por codigo 'VARIOS' (antes 'CAJA_CHICA')
-- CAMBIOS v1.1:
--   - También detecta INGRESO con categoría IN-004 (Reposición Déficit Turno Anterior)
--
-- Verifica si VARIOS ya recibió su transferencia diaria para la fecha indicada.
-- Cubre dos casos:
--   1. Cierre normal anterior del día        → TRANSFERENCIA_ENTRANTE en VARIOS
--   2. Ajuste de apertura (reparar déficit)  → INGRESO categoría IN-004 en VARIOS
--
-- Parámetros:
--   p_fecha DATE  — Fecha local (obtenida con getFechaLocal() en TypeScript)
--
-- Retorna:
--   TRUE  → VARIOS ya recibió su transferencia hoy
--   FALSE → no recibió, o la caja VARIOS no existe en el negocio
-- ==========================================

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
BEGIN
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);

  -- Si la caja VARIOS no existe (negocio sin Varios activada), no hay transferencia que verificar
  IF v_varios_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM operaciones_cajas oc
    WHERE oc.caja_id = v_varios_id
      AND oc.negocio_id = v_negocio_id
      AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
      AND (
        -- Caso 1: cierre normal anterior del día
        oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
        OR
        -- Caso 2: ajuste de apertura por déficit del turno anterior (IN-004)
        (
          oc.tipo_operacion = 'INGRESO'
          AND EXISTS (
            SELECT 1 FROM categorias_operaciones co
            WHERE co.id = oc.categoria_id
              AND co.codigo = 'IN-004'
              AND co.negocio_id = v_negocio_id
          )
        )
      )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy IS
  'v1.3 - Retorna TRUE si VARIOS ya recibió su transferencia diaria hoy en el negocio activo. '
  'Detecta: TRANSFERENCIA_ENTRANTE (cierre normal) o INGRESO categoría IN-004 (ajuste apertura). '
  'Filtra por negocio_id del JWT (multi-tenant). Retorna FALSE si VARIOS no existe en el negocio. '
  'Usa AT TIME ZONE America/Guayaquil para evitar desfase UTC en cierres nocturnos.';
