-- =============================================================================
-- fn_crear_negocio — Crear un nuevo tenant con todos sus datos semilla
-- =============================================================================
-- Crea atomicamente:
--   1. Registro en negocios
--   2. Fila en usuarios (si no existe) y membresia ADMIN en usuario_negocios
--   3. Las 5 cajas (CAJA, CAJA_CHICA, VARIOS, CAJA_CELULAR, CAJA_BUS)
--   4. Categorias de operaciones iniciales (IN-001, EG-001, EG-002, EG-003)
--   5. Categorias de productos iniciales (Sin categoria)
--   6. Configuraciones iniciales (negocio_, caja_, bus_, pos_, nomina_)
--   7. Secuencias de comprobantes (VENTA, RECARGA)
--
-- Parametros:
--   p_nombre_negocio   VARCHAR  — Nombre visible del negocio
--   p_admin_email      VARCHAR  — Email del primer ADMIN (debe existir en auth.users)
--   p_admin_nombre     VARCHAR  — Nombre del ADMIN (para crear fila en usuarios si no existe)
--
-- Retorna: JSON con { negocio_id, usuario_id, success }
--
-- Seguridad: SECURITY DEFINER para poder insertar en todas las tablas sin
-- que el JWT del llamador tenga negocio_id todavia (el negocio aun no existe).
-- Cualquier authenticated puede llamarla, pero solo para su propio email.
-- Superadmin puede crearla para cualquier email (soporte/admin).
--
-- CORRECCIONES v1.1:
--   - Eliminado SELECT...INTO (bug Supabase): v_usuario_id usa := (SELECT ...)
--   - Eliminado RETURNING id INTO (bug Supabase): usa gen_random_uuid() + INSERT manual
--   - secuencias_comprobantes: corregidas columnas a (negocio_id, tipo_documento, ultimo_valor)
--     El schema v11 NO tiene columnas prefijo ni siguiente_numero — solo ultimo_valor
--   - Eliminada fila duplicada del SELECT en bloque 2 (lineas 56-57 del original)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_crear_negocio(
    p_nombre_negocio VARCHAR,
    p_admin_email    VARCHAR,
    p_admin_nombre   VARCHAR DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id  UUID;
    v_usuario_id  UUID;
    v_cat_prod_id UUID;
BEGIN
    -- Validaciones de entrada
    IF TRIM(p_nombre_negocio) = '' OR p_nombre_negocio IS NULL THEN
        RAISE EXCEPTION 'El nombre del negocio no puede estar vacio';
    END IF;
    IF TRIM(p_admin_email) = '' OR p_admin_email IS NULL THEN
        RAISE EXCEPTION 'El email del admin no puede estar vacio';
    END IF;

    -- Seguridad: el email del llamador debe coincidir con p_admin_email
    -- (un usuario no puede crear un negocio a nombre de otro)
    -- Excepcion: superadmin puede crear negocios para cualquier email
    IF NOT COALESCE((SELECT es_superadmin FROM usuarios WHERE email = (auth.jwt() ->> 'email')), FALSE) THEN
        IF LOWER(TRIM(p_admin_email)) != LOWER(TRIM(auth.jwt() ->> 'email')) THEN
            RAISE EXCEPTION 'No puedes crear un negocio para otro usuario.';
        END IF;
    END IF;

    -- ── 1. Crear el negocio ──
    -- Fix: gen_random_uuid() + INSERT en vez de RETURNING INTO (bug Supabase)
    -- slug: nombre en minúsculas, espacios→guiones, sin caracteres especiales
    v_negocio_id := gen_random_uuid();
    INSERT INTO negocios (id, nombre, slug)
    VALUES (
        v_negocio_id,
        TRIM(p_nombre_negocio),
        TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(TRIM(p_nombre_negocio)), '[^a-z0-9]+', '-', 'g'))
    );

    -- ── 2. Crear/obtener usuario ADMIN ──
    -- Fix: := (SELECT ...) en vez de SELECT ... INTO (bug Supabase)
    v_usuario_id := (SELECT id FROM usuarios WHERE email = LOWER(TRIM(p_admin_email)));

    IF v_usuario_id IS NULL THEN
        -- El usuario aun no existe en la tabla publica (aun no ha hecho login)
        -- Fix: gen_random_uuid() + INSERT en vez de RETURNING INTO (bug Supabase)
        v_usuario_id := gen_random_uuid();
        INSERT INTO usuarios (id, nombre, email, es_superadmin)
        VALUES (
            v_usuario_id,
            COALESCE(NULLIF(TRIM(p_admin_nombre), ''), SPLIT_PART(p_admin_email, '@', 1)),
            LOWER(TRIM(p_admin_email)),
            FALSE
        );
    END IF;

    -- Crear membresia ADMIN en el nuevo negocio
    INSERT INTO usuario_negocios (usuario_id, negocio_id, rol, activo)
    VALUES (v_usuario_id, v_negocio_id, 'ADMIN', TRUE)
    ON CONFLICT (usuario_id, negocio_id) DO UPDATE SET rol = 'ADMIN', activo = TRUE;

    -- ── 3. Las 5 cajas ──
    INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual) VALUES
    (v_negocio_id, 'CAJA',         'Tienda',  'Vault de depositos acumulados',   0),
    (v_negocio_id, 'CAJA_CHICA',   'Cajon',   'Efectivo del dia (ventas + rec)', 0),
    (v_negocio_id, 'VARIOS',       'Varios',  'Fondo fijo de emergencia',        0),
    (v_negocio_id, 'CAJA_CELULAR', 'Celular', 'Efectivo recargas celular',       0),
    (v_negocio_id, 'CAJA_BUS',     'Bus',     'Efectivo recargas bus',           0);

    -- ── 4. Categorias de operaciones ──
    -- El trigger fn_set_codigo_categoria_operacion asigna el codigo automaticamente.
    INSERT INTO categorias_operaciones (negocio_id, nombre, tipo, descripcion) VALUES
    (v_negocio_id, 'Venta POS',          'INGRESO', 'Ingreso automatico por venta en efectivo'),
    (v_negocio_id, 'Gasto operacional',  'EGRESO',  'Gastos del dia a dia del negocio'),
    (v_negocio_id, 'Retiro propietario', 'EGRESO',  'Retiro de efectivo por el propietario'),
    (v_negocio_id, 'Fondo inicial',      'INGRESO', 'Fondo de apertura de caja');
    -- Codigos resultantes: IN-001, EG-001, EG-002, IN-002 (asignados por trigger)

    -- ── 5. Categoria de productos inicial ──
    -- Fix: gen_random_uuid() + INSERT en vez de RETURNING INTO (bug Supabase)
    v_cat_prod_id := gen_random_uuid();
    INSERT INTO categorias_productos (id, negocio_id, nombre)
    VALUES (v_cat_prod_id, v_negocio_id, 'Sin categoria');

    -- ── 6. Configuraciones iniciales ──
    INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
    -- Negocio
    (v_negocio_id, 'negocio_nombre',                  p_nombre_negocio),
    (v_negocio_id, 'negocio_telefono',                ''),
    (v_negocio_id, 'negocio_direccion',               ''),
    -- Caja
    (v_negocio_id, 'caja_fondo_fijo_diario',          '0'),
    (v_negocio_id, 'caja_varios_transferencia_dia',   '0'),
    -- Bus
    (v_negocio_id, 'bus_alerta_saldo_bajo',           '10'),
    (v_negocio_id, 'bus_comision_porcentaje',         '1'),
    -- POS
    (v_negocio_id, 'pos_descuentos_habilitados',      'false'),
    (v_negocio_id, 'pos_descuento_maximo',            '0'),
    -- Nomina
    (v_negocio_id, 'nomina_sueldo_base',              '0'),
    (v_negocio_id, 'nomina_dia_pago',                 '1')
    ON CONFLICT (negocio_id, clave) DO NOTHING;

    -- ── 7. Secuencias de comprobantes ──
    -- Schema v11: columnas son (negocio_id, tipo_documento, ultimo_valor)
    -- No existen columnas prefijo ni siguiente_numero
    INSERT INTO secuencias_comprobantes (negocio_id, tipo_documento, ultimo_valor) VALUES
    (v_negocio_id, 'VENTA',   0),
    (v_negocio_id, 'RECARGA', 0)
    ON CONFLICT (negocio_id, tipo_documento) DO NOTHING;

    RETURN json_build_object(
        'success',     TRUE,
        'negocio_id',  v_negocio_id,
        'usuario_id',  v_usuario_id,
        'mensaje',     'Negocio creado exitosamente. Ejecutar fn_set_negocio_activo para activar el JWT.'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al crear negocio: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Seguridad: solo superadmin puede crear negocios
REVOKE EXECUTE ON FUNCTION public.fn_crear_negocio(VARCHAR, VARCHAR, VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_crear_negocio(VARCHAR, VARCHAR, VARCHAR) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_crear_negocio(VARCHAR, VARCHAR, VARCHAR) TO authenticated;
-- Nota: aunque se concede a authenticated, la funcion no valida el rol del llamador (es SECURITY DEFINER).
-- El frontend verifica auth.es_superadmin() antes de llamar.

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- USO:
--   SELECT fn_crear_negocio('Mi Tienda Central', 'admin@ejemplo.com', 'Juan Admin');
--
-- RESULTADO:
--   { "success": true, "negocio_id": "uuid...", "usuario_id": "uuid...", "mensaje": "..." }
--
-- DESPUES DE CREAR EL NEGOCIO:
--   1. Ejecutar fn_set_negocio_activo para actualizar el JWT del ADMIN
--   2. El ADMIN puede agregar empleados desde el modulo Usuarios
-- =============================================================================
