-- =============================================================================
-- ALTER suscripciones — columnas de purga automatica de negocios vencidos
-- =============================================================================
-- Ver docs/suscripcion/SUSCRIPCION-README.md, sección "Purga automática de negocios vencidos".
--
-- purga_avisada_el    — cuando fn_marcar_negocios_para_purga detecto vencimiento
--                       + gracia cumplida (>= 23 dias) y marco al propietario.
-- purga_programada_el — fecha desde la que "Purgar ahora" queda habilitado en
--                       /admin (purga_avisada_el + 7 dias). fn_purgar_negocio
--                       exige purga_programada_el <= NOW() antes de borrar.
--
-- Ambas se limpian (NULL) si el propietario paga antes de la purga
-- (fn_registrar_pago_propietario) o el superadmin la cancela manualmente
-- (fn_cancelar_purga_negocio).
--
-- Ejecutar una sola vez en el SQL Editor de Supabase. Ya esta reflejado en
-- docs/setup/schema.sql para que un reset completo desde cero las incluya.
-- =============================================================================

ALTER TABLE suscripciones
    ADD COLUMN IF NOT EXISTS purga_avisada_el    TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS purga_programada_el TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_suscripciones_purga_pendiente ON suscripciones (purga_programada_el)
    WHERE purga_programada_el IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verificacion (ejecutar por separado)
-- =============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'suscripciones' AND column_name LIKE 'purga_%';
