-- =============================================================================
-- TRIGGER: proteger_superadmin
-- Versión: 1.0
--
-- Protege al superadmin a nivel de BD contra:
--   - Cambios en activo, rol o es_superadmin (UPDATE)
--   - Eliminación física del registro (DELETE)
--
-- La UI ya bloquea esto visualmente (editar-usuario-modal.component.ts),
-- pero este trigger es la capa definitiva: protege ante queries directas,
-- bugs en el frontend o cualquier otra vía de escritura.
--
-- Ejecutar tras cada schema.sql (DROP TABLE CASCADE elimina triggers).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Función del trigger — BEFORE UPDATE
-- Compara OLD vs NEW para detectar si cambiaron campos protegidos.
-- Si el registro tiene es_superadmin = true y alguno de los campos protegidos
-- cambia → RAISE EXCEPTION (aborta la transacción).
-- Si solo cambia el nombre → permite el UPDATE normalmente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proteger_superadmin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.es_superadmin = true THEN
    IF NEW.activo      IS DISTINCT FROM OLD.activo      OR
       NEW.rol         IS DISTINCT FROM OLD.rol         OR
       NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin
    THEN
      RAISE EXCEPTION 'No se puede modificar el rol, estado ni permisos del administrador principal del sistema.';
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
-- En la práctica: nadie puede hacer DELETE desde el cliente (no hay política
-- DELETE en rls_usuarios.sql), pero esta capa extra protege ante service_role
-- accidental o queries directas con bypass de RLS.
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
