-- ==========================================
-- MIGRATION 002: Datos de identidad del negocio → tabla negocios
-- ==========================================
-- Fecha: 2026-06-03
-- Descripción:
--   Mueve nombre, teléfono y dirección de `configuraciones` a `negocios`.
--   Agrega columnas de identidad y SRI a `negocios`.
--   Elimina las claves migradas de `configuraciones`.
--
-- Esta migración es IDEMPOTENTE — puede ejecutarse varias veces sin efecto adverso.
--
-- Orden de ejecución en Supabase:
--   1. Este script (002_negocios_datos_identidad.sql)
--   2. docs/setup/02_rls.sql (política UPDATE actualizada para ADMIN)
--   3. docs/configuracion/sql/functions/fn_actualizar_datos_negocio.sql
--   4. docs/onboarding/sql/functions/fn_completar_onboarding.sql (actualizado)
-- ==========================================

-- ── Paso 1: Agregar columnas nuevas a negocios (idempotente con IF NOT EXISTS) ──

ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS telefono               VARCHAR(20),
    ADD COLUMN IF NOT EXISTS direccion              VARCHAR(200),
    ADD COLUMN IF NOT EXISTS correo_electronico     VARCHAR(100),
    ADD COLUMN IF NOT EXISTS ruc                    VARCHAR(13),
    ADD COLUMN IF NOT EXISTS razon_social           VARCHAR(300),
    ADD COLUMN IF NOT EXISTS nombre_comercial       VARCHAR(300),
    ADD COLUMN IF NOT EXISTS codigo_establecimiento VARCHAR(3)  DEFAULT '001',
    ADD COLUMN IF NOT EXISTS codigo_punto_emision   VARCHAR(3)  DEFAULT '001',
    ADD COLUMN IF NOT EXISTS ambiente_sri           SMALLINT    DEFAULT 1,
    ADD COLUMN IF NOT EXISTS obligado_contabilidad  BOOLEAN     DEFAULT FALSE;

-- ── Paso 2: Backfill — copiar datos de configuraciones → negocios ──
-- Por cada negocio, leer sus claves en configuraciones y escribirlas en negocios.
-- ON CONFLICT DO NOTHING en las columnas: si ya tienen valor, no sobreescribir.

UPDATE public.negocios n
SET
    nombre    = COALESCE(
                    NULLIF(TRIM((SELECT valor FROM public.configuraciones
                                 WHERE negocio_id = n.id AND clave = 'negocio_nombre')), ''),
                    n.nombre   -- mantener el nombre actual si no hay en configuraciones
                ),
    telefono  = CASE
                    WHEN n.telefono IS NULL THEN
                        NULLIF(TRIM(COALESCE(
                            (SELECT valor FROM public.configuraciones
                             WHERE negocio_id = n.id AND clave = 'negocio_telefono'), ''
                        )), '')
                    ELSE n.telefono
                END,
    direccion = CASE
                    WHEN n.direccion IS NULL THEN
                        NULLIF(TRIM(COALESCE(
                            (SELECT valor FROM public.configuraciones
                             WHERE negocio_id = n.id AND clave = 'negocio_direccion'), ''
                        )), '')
                    ELSE n.direccion
                END;

-- ── Paso 3: Eliminar claves migradas de configuraciones ──
-- Solo eliminar después de confirmar que el backfill fue exitoso.

DELETE FROM public.configuraciones
WHERE clave IN ('negocio_nombre', 'negocio_telefono', 'negocio_direccion');

-- ── Verificación post-migración ──
-- Ejecutar por separado para confirmar el estado:

-- Ver cuántos negocios tienen nombre en la tabla negocios:
-- SELECT id, nombre, telefono, direccion FROM negocios ORDER BY created_at;

-- Confirmar que no quedan claves migradas en configuraciones:
-- SELECT COUNT(*) FROM configuraciones
-- WHERE clave IN ('negocio_nombre', 'negocio_telefono', 'negocio_direccion');
-- → debe ser 0

NOTIFY pgrst, 'reload schema';
