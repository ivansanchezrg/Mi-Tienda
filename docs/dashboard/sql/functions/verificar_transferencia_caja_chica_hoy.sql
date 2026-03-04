-- ==========================================
-- FUNCIÓN: verificar_transferencia_caja_chica_hoy
-- VERSIÓN: 1.1
-- ==========================================
-- CAMBIOS v1.1:
--   - También detecta INGRESO con categoría IN-004 (Reposición Déficit Turno Anterior)
--   - Si hoy se reparó el déficit de ayer al abrir caja, eso cuenta como
--     la transferencia diaria de hoy → no se duplica el envío a Varios
--
-- Verifica si Varios ya recibió su transferencia diaria para la fecha indicada.
-- Cubre dos casos:
--   1. Cierre normal anterior del día     → TRANSFERENCIA_ENTRANTE en CAJA_CHICA
--   2. Ajuste de apertura (reparar déficit) → INGRESO categoría IN-004 en CAJA_CHICA
--
-- Usada en CierreDiarioPage (Paso 2) antes de ejecutar el cierre:
-- si ya existe → muestra "✅ ya recibió hoy", no repite la transferencia.
--
-- Parámetros:
--   p_fecha DATE  — Fecha local (obtenida con getFechaLocal() en TypeScript)
--
-- Retorna:
--   TRUE  → Varios ya recibió su $20 hoy (por cierre anterior o por ajuste apertura)
--   FALSE → no existe ninguna de las dos (cierre aún no realizado)
-- ==========================================

-- Descomentar solo si cambia la firma (parámetros o tipo de retorno):
-- DROP FUNCTION IF EXISTS public.verificar_transferencia_caja_chica_hoy(DATE);

CREATE OR REPLACE FUNCTION public.verificar_transferencia_caja_chica_hoy(
  p_fecha DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_chica_id INTEGER;
  v_existe        BOOLEAN;
BEGIN
  SELECT id INTO v_caja_chica_id FROM cajas WHERE codigo = 'CAJA_CHICA';

  SELECT EXISTS (
    SELECT 1
    FROM operaciones_cajas oc
    WHERE oc.caja_id = v_caja_chica_id
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
            WHERE co.id = oc.categoria_id AND co.codigo = 'IN-004'
          )
        )
      )
  ) INTO v_existe;

  RETURN v_existe;
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.verificar_transferencia_caja_chica_hoy(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_transferencia_caja_chica_hoy(DATE) TO anon;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.verificar_transferencia_caja_chica_hoy IS
  'v1.1 - Retorna TRUE si Varios ya recibió su transferencia diaria hoy: '
  'TRANSFERENCIA_ENTRANTE (cierre normal anterior) o INGRESO categoría IN-004 (ajuste apertura). '
  'El ajuste de apertura cuenta como la transferencia del día para evitar duplicar el envío a Varios. '
  'Usa AT TIME ZONE America/Guayaquil para evitar desfase UTC en cierres nocturnos. '
  'Llamada desde RecargasService.verificarTransferenciaYaHecha().';
