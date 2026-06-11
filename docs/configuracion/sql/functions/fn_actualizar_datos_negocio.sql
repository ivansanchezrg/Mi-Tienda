-- ==========================================
-- FUNCIÓN: fn_actualizar_datos_negocio (v1.1 — 2026-06-10)
-- ==========================================
-- v1.1: RUC validado como 13 DÍGITOS reales (regex), no solo longitud 13.
-- Actualiza los datos de identidad del negocio activo en la tabla `negocios`.
-- Reemplaza el UPSERT en `configuraciones` para nombre, teléfono y dirección,
-- que ahora viven en `negocios` como fuente de verdad.
--
-- Solo el ADMIN del negocio activo puede llamar esta función.
-- El superadmin está bloqueado (fn_assert_no_superadmin) — si necesita editar
-- datos de un negocio debe entrar a él con cambiarNegocio() primero.
--
-- Parámetros (todos opcionales — solo se actualizan los que vienen NOT NULL):
--   p_nombre               VARCHAR — nombre comercial / display
--   p_telefono             VARCHAR — teléfono de contacto
--   p_direccion            VARCHAR — dirección del establecimiento
--   p_correo_electronico   VARCHAR — correo de contacto / envío de comprobantes
--   p_ruc                  VARCHAR(13) — RUC del negocio
--   p_razon_social         VARCHAR — razón social legal
--   p_nombre_comercial     VARCHAR — nombre comercial (puede ser igual a nombre)
--   p_codigo_establecimiento VARCHAR(3) — código SRI del establecimiento (ej: '001')
--   p_codigo_punto_emision  VARCHAR(3) — código SRI del punto de emisión (ej: '001')
--   p_ambiente_sri         SMALLINT — 1=pruebas, 2=producción
--   p_obligado_contabilidad BOOLEAN — obligado a llevar contabilidad (SRI)
--
-- Retorna: JSON con { success, negocio_id, nombre }
--
-- Multi-tenant: opera sobre get_negocio_id() del JWT — nunca acepta negocio_id externo.
-- SECURITY DEFINER: bypassa RLS de negocios (que bloquea UPDATE directo de authenticated).
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_actualizar_datos_negocio(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    SMALLINT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.fn_actualizar_datos_negocio(
    p_nombre                 VARCHAR  DEFAULT NULL,
    p_telefono               VARCHAR  DEFAULT NULL,
    p_direccion              VARCHAR  DEFAULT NULL,
    p_correo_electronico     VARCHAR  DEFAULT NULL,
    p_ruc                    VARCHAR  DEFAULT NULL,
    p_razon_social           VARCHAR  DEFAULT NULL,
    p_nombre_comercial       VARCHAR  DEFAULT NULL,
    p_codigo_establecimiento VARCHAR  DEFAULT NULL,
    p_codigo_punto_emision   VARCHAR  DEFAULT NULL,
    p_ambiente_sri           SMALLINT DEFAULT NULL,
    p_obligado_contabilidad  BOOLEAN  DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;
    v_rol        TEXT;
    v_nombre     VARCHAR;
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();
    v_rol        := public.get_rol();

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    IF v_rol <> 'ADMIN' THEN
        RAISE EXCEPTION 'Solo el administrador puede actualizar los datos del negocio';
    END IF;

    -- Validaciones de formato
    IF p_nombre IS NOT NULL AND TRIM(p_nombre) = '' THEN
        RAISE EXCEPTION 'El nombre del negocio no puede estar vacío';
    END IF;

    IF p_ruc IS NOT NULL AND TRIM(p_ruc) <> '' AND TRIM(p_ruc) !~ '^\d{13}$' THEN
        RAISE EXCEPTION 'El RUC debe tener exactamente 13 dígitos';
    END IF;

    IF p_ambiente_sri IS NOT NULL AND p_ambiente_sri NOT IN (1, 2) THEN
        RAISE EXCEPTION 'El ambiente SRI debe ser 1 (pruebas) o 2 (producción)';
    END IF;

    -- UPDATE selectivo: solo actualiza los campos que vienen NOT NULL
    UPDATE negocios SET
        nombre                 = COALESCE(NULLIF(TRIM(p_nombre), ''),               nombre),
        telefono               = CASE WHEN p_telefono           IS NOT NULL THEN NULLIF(TRIM(p_telefono), '')           ELSE telefono               END,
        direccion              = CASE WHEN p_direccion          IS NOT NULL THEN NULLIF(TRIM(p_direccion), '')          ELSE direccion              END,
        correo_electronico     = CASE WHEN p_correo_electronico IS NOT NULL THEN NULLIF(TRIM(p_correo_electronico), '') ELSE correo_electronico     END,
        ruc                    = CASE WHEN p_ruc                IS NOT NULL THEN NULLIF(TRIM(p_ruc), '')                ELSE ruc                    END,
        razon_social           = CASE WHEN p_razon_social       IS NOT NULL THEN NULLIF(TRIM(p_razon_social), '')       ELSE razon_social           END,
        nombre_comercial       = CASE WHEN p_nombre_comercial   IS NOT NULL THEN NULLIF(TRIM(p_nombre_comercial), '')   ELSE nombre_comercial       END,
        codigo_establecimiento = COALESCE(NULLIF(TRIM(p_codigo_establecimiento), ''), codigo_establecimiento),
        codigo_punto_emision   = COALESCE(NULLIF(TRIM(p_codigo_punto_emision), ''),   codigo_punto_emision),
        ambiente_sri           = COALESCE(p_ambiente_sri,           ambiente_sri),
        obligado_contabilidad  = COALESCE(p_obligado_contabilidad,  obligado_contabilidad)
    WHERE id = v_negocio_id
    RETURNING nombre INTO v_nombre;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El negocio no existe';
    END IF;

    RETURN json_build_object(
        'success',     TRUE,
        'negocio_id',  v_negocio_id,
        'nombre',      v_nombre
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_actualizar_datos_negocio(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    SMALLINT, BOOLEAN
) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_actualizar_datos_negocio(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    SMALLINT, BOOLEAN
) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_actualizar_datos_negocio IS
    'v1.1 — Actualiza datos de identidad del negocio activo en tabla negocios. '
    'Fuente de verdad: negocios (no configuraciones). '
    'Solo ADMIN del negocio activo puede ejecutar. Superadmin bloqueado. '
    'Campos SRI opcionales — NULL mantiene el valor existente.';
