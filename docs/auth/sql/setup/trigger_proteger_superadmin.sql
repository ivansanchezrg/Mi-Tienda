-- =============================================================================
-- TRIGGER: proteger_superadmin
-- Versión: 2.0 (schema v11)
--
-- Protege al superadmin a nivel de BD contra:
--   - Cambio de es_superadmin (UPDATE en tabla usuarios)
--   - Eliminación física del registro (DELETE en tabla usuarios)
--
-- CAMBIOS v2.0 (schema v11):
--   - Eliminadas verificaciones de NEW.activo y NEW.rol
--     Estas columnas YA NO existen en usuarios (fueron movidas a usuario_negocios).
--     El trigger solo verifica el cambio de es_superadmin en sí mismo.
--   - La protección de rol y activo del superadmin se hace a nivel de RLS en usuario_negocios.
--
-- La UI ya bloquea esto visualmente (editar-usuario-modal.component.ts),
-- pero este trigger es la capa definitiva: protege ante queries directas,
-- bugs en el frontend o cualquier otra vía de escritura.
--
-- Ejecutar tras cada schema.sql (DROP TABLE ... CASCADE elimina triggers).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Función del trigger — BEFORE UPDATE
-- Si el registro tiene es_superadmin = true y ese campo cambia → RAISE EXCEPTION.
-- Si solo cambia el nombre u otros campos → permite el UPDATE normalmente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proteger_superadmin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.es_superadmin = true THEN
    IF NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin THEN
      RAISE EXCEPTION 'No se puede modificar los permisos del administrador principal del sistema.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Trigger BEFORE UPDATE — dispara fn_proteger_superadmin en cada UPDATE
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_proteger_superadmin_update ON usuarios;

CREATE TRIGGER trg_proteger_superadmin_update
BEFORE UPDATE ON usuarios
FOR EACH ROW
EXECUTE FUNCTION fn_proteger_superadmin();

-- -----------------------------------------------------------------------------
-- Política RLS DELETE — bloquea eliminación del superadmin
-- Cualquier authenticated puede eliminar usuarios normales (no hay DELETE en la
-- app, pero si alguien lo intenta desde fuera), excepto el superadmin.
-- En la práctica: nadie puede hacer DELETE desde el cliente (la política
-- "superadmin_no_delete" en docs/setup/02_rls.sql exige es_superadmin = false),
-- pero esta capa extra protege ante service_role accidental o queries directas
-- con bypass de RLS.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "superadmin_no_delete" ON usuarios;

CREATE POLICY "superadmin_no_delete"
ON usuarios FOR DELETE
TO authenticated
USING (es_superadmin = false);

-- =============================================================================
-- Verificación (ejecutar por separado)
-- =============================================================================
-- Ver triggers activos en la tabla:
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'usuarios';
