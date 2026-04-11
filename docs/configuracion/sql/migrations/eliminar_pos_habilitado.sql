-- =============================================================================
-- Migracion: eliminar configuracion pos_habilitado
-- =============================================================================
-- Fecha: 2026-04-10
--
-- Contexto:
--   El toggle manual "POS habilitado" en Configuracion era estado duplicado:
--   la habilitacion del POS depende logicamente de si hay un turno de caja
--   abierto (tabla turnos_caja con hora_fecha_cierre IS NULL). Mantener dos
--   fuentes de verdad era una violacion de Single Source of Truth y abria
--   la puerta a estados inconsistentes (ej: POS habilitado sin caja abierta).
--
--   A partir de esta migracion, el POS se habilita/deshabilita automaticamente
--   segun el estado del turno de caja. Ver:
--   - src/app/features/dashboard/services/turnos-caja.service.ts (turnoActivo$)
--   - docs/dashboard/sql/setup/realtime_turnos_caja.sql
--
-- Efectos:
--   - Elimina la fila pos_habilitado de la tabla configuraciones
--   - El frontend deja de leer/escribir esta clave (ver ConfigService)
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- =============================================================================

DELETE FROM configuraciones
WHERE clave = 'pos_habilitado';

-- Verificacion (opcional)
-- SELECT clave, valor FROM configuraciones WHERE clave LIKE 'pos_%';
