-- ==========================================
-- FUNCIÓN: verificar_transferencia_caja_chica_hoy
-- VERSIÓN: 1.0
-- ==========================================
-- Verifica si ya se realizó la transferencia diaria a CAJA_CHICA
-- para la fecha indicada (timezone local Ecuador para evitar desfase UTC).
--
-- Usada en CierreDiarioPage (Paso 2) antes de ejecutar el cierre:
-- si ya existe → muestra aviso, no repite la transferencia.
--
-- Parámetros:
--   p_fecha DATE  — Fecha local (obtenida con getFechaLocal() en TypeScript)
--
-- Retorna:
--   TRUE  → ya existe TRANSFERENCIA_ENTRANTE en CAJA_CHICA para esa fecha
--   FALSE → no existe (cierre aún no realizado)
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
    FROM operaciones_cajas
    WHERE caja_id        = v_caja_chica_id
      AND tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
      AND (fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
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
  'v1.0 - Retorna TRUE si ya existe TRANSFERENCIA_ENTRANTE en CAJA_CHICA para p_fecha. '
  'Usa AT TIME ZONE America/Guayaquil para convertir el TIMESTAMPTZ a fecha local '
  'y evitar desfase UTC en cierres nocturnos. '
  'Llamada desde RecargasService.verificarTransferenciaYaHecha().';
