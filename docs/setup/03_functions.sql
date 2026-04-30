-- =============================================================================
-- 03_functions.sql — Todas las funciones RPC del proyecto
-- =============================================================================
-- Ejecutar DESPUES de 02_triggers.sql.
-- Orden: 01_rls → 02_triggers → 03_functions → 04_realtime → 05_seed_dev
--
-- Incluye (en orden de dependencia):
--   Setup:
--     fn_crear_negocio          (fuente: docs/setup/fn_crear_negocio.sql)
--     fn_set_negocio_activo     (fuente: docs/setup/fn_set_negocio_activo.sql)
--   Dashboard:
--     fn_abrir_turno            (fuente: docs/dashboard/sql/functions/)
--     fn_registrar_operacion_manual
--     fn_crear_transferencia
--     fn_verificar_transferencia_caja_chica_hoy
--     fn_ejecutar_cierre_diario_v5
--     fn_reparar_deficit_turno
--   Inventario:
--     fn_generar_codigo_interno
--     fn_generar_codigo_interno_presentacion
--     fn_crear_producto_simple
--     fn_crear_producto_con_variantes
--     fn_ajustar_stock_inventario
--   POS:
--     fn_registrar_venta_pos
--     fn_anular_venta
--   Recargas:
--     fn_registrar_recarga_proveedor_celular
--     fn_registrar_pago_proveedor_celular
--     fn_registrar_compra_saldo_bus
--     fn_liquidar_ganancias_bus
--   Cuentas por cobrar:
--     fn_listar_cuentas_cobrar
--     fn_resumir_cuentas_cobrar
--     fn_registrar_pago_fiado
--   Ventas:
--     fn_listar_ventas
--     fn_resumir_ventas
--     fn_reporte_ventas_periodo
--   Movimientos empleados:
--     fn_registrar_adelanto_sueldo
--     fn_pagar_nomina_empleado
--   Notas:
--     fn_eliminar_nota
-- =============================================================================

-- =============================================================================
-- fn_crear_negocio — Crear un nuevo tenant con todos sus datos semilla
-- =============================================================================
-- Crea atomicamente:
--   1. Registro en negocios
--   2. Fila en usuarios (si no existe) y membresia ADMIN en usuario_negocios
--   3. Las 5 cajas (CAJA, CAJA_CHICA, VARIOS, CAJA_CELULAR, CAJA_BUS)
--   4. Categorias de operaciones iniciales (IN-001, EG-001, EG-002, EG-003)
--   5. Categorias de productos iniciales (Sin categoria, Bebidas, Snacks...)
--   6. Configuraciones iniciales (negocio_, caja_, bus_, pos_, nomina_)
--   7. Secuencias de comprobantes (TICKET, NOTA_VENTA, FACTURA, RECARGA)
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
    INSERT INTO categorias_operaciones (negocio_id, nombre, tipo, descripcion, seleccionable) VALUES
    -- EGRESOS
    (v_negocio_id, 'Compras/Mercaderia',              'EGRESO',  'Compra de productos para reventa o uso en el negocio',                             TRUE),
    (v_negocio_id, 'Servicios Basicos',               'EGRESO',  'Pago de luz, agua, internet, telefono',                                            TRUE),
    (v_negocio_id, 'Alquiler',                        'EGRESO',  'Pago de alquiler del local',                                                       TRUE),
    (v_negocio_id, 'Mantenimiento',                   'EGRESO',  'Reparaciones y mantenimiento del local o equipo',                                   TRUE),
    (v_negocio_id, 'Transporte/Combustible',          'EGRESO',  'Gastos de transporte y combustible',                                               TRUE),
    (v_negocio_id, 'Papeleria/Suministros',           'EGRESO',  'Papeleria, utiles de oficina y suministros generales',                             TRUE),
    (v_negocio_id, 'Salarios',                        'EGRESO',  'Pago de salarios a empleados (via flujo de nomina)',                               FALSE),
    (v_negocio_id, 'Impuestos/Tasas',                 'EGRESO',  'Pago de impuestos y tasas municipales',                                            TRUE),
    (v_negocio_id, 'Otros Gastos',                    'EGRESO',  'Otros gastos operativos no clasificados',                                          TRUE),
    (v_negocio_id, 'Pago Proveedor Recargas',         'EGRESO',  'Pago al proveedor de recargas celular (saldo prestado a credito)',                 FALSE),
    (v_negocio_id, 'Compra Saldo Virtual Bus',        'EGRESO',  'Compra de saldo virtual bus mediante deposito bancario',                           FALSE),
    (v_negocio_id, 'Ajuste Deficit Turno Anterior',   'EGRESO',  'Retiro de Tienda para reponer deficit del turno anterior',                         FALSE),
    (v_negocio_id, 'Ajuste Diferencia Conteo',        'EGRESO',  'Ajuste al cierre cuando el conteo fisico es menor al saldo digital del cajon',     FALSE),
    (v_negocio_id, 'Adelanto Sueldo Empleado',        'EGRESO',  'Anticipo de sueldo entregado al empleado en efectivo (via flujo de nomina)',        FALSE),
    -- INGRESOS
    (v_negocio_id, 'Ventas',                          'INGRESO', 'Ingresos por ventas del negocio',                                                  TRUE),
    (v_negocio_id, 'Devoluciones de Proveedores',     'INGRESO', 'Devolucion de dinero por parte de proveedores',                                    TRUE),
    (v_negocio_id, 'Otros Ingresos',                  'INGRESO', 'Otros ingresos no clasificados',                                                   TRUE),
    (v_negocio_id, 'Reposicion Deficit Turno Anterior','INGRESO','Ingreso a Varios por reposicion del deficit pendiente del turno anterior',          FALSE),
    (v_negocio_id, 'Ajuste Diferencia Conteo',        'INGRESO', 'Ajuste al cierre cuando el conteo fisico supera al saldo digital del cajon',       FALSE);
    -- Codigos asignados por trigger segun orden de INSERT:
    --   EG-001..EG-014 (egresos), IN-001..IN-005 (ingresos)

    -- ── 5. Categorias de productos iniciales ──
    INSERT INTO categorias_productos (negocio_id, nombre) VALUES
    (v_negocio_id, 'Sin categoria'),
    (v_negocio_id, 'Bebidas'),
    (v_negocio_id, 'Snacks'),
    (v_negocio_id, 'Abarrotes'),
    (v_negocio_id, 'Lacteos'),
    (v_negocio_id, 'Limpieza'),
    (v_negocio_id, 'Aseo Personal'),
    (v_negocio_id, 'Panaderia')
    ON CONFLICT (negocio_id, nombre) DO NOTHING;

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
    (v_negocio_id, 'TICKET',     0),
    (v_negocio_id, 'NOTA_VENTA', 0),
    (v_negocio_id, 'FACTURA',    0),
    (v_negocio_id, 'RECARGA',    0)
    ON CONFLICT (negocio_id, tipo_documento) DO NOTHING;

    -- ── 8. Cliente "Consumidor Final" ──
    -- Requerido por el POS para asignar a ventas sin cliente identificado.
    INSERT INTO clientes (negocio_id, nombre, es_consumidor_final)
    VALUES (v_negocio_id, 'Consumidor Final', TRUE)
    ON CONFLICT DO NOTHING;

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
-- =============================================================================
-- fn_set_negocio_activo — Activar un negocio en el JWT del usuario
-- =============================================================================
-- Establece negocio_id y rol en app_metadata del JWT de auth.users.
-- El frontend llama a esta funcion cuando el usuario selecciona un negocio
-- en la pantalla de seleccion (multi-tenant login flow).
--
-- Tras la llamada, el cliente debe hacer supabase.auth.refreshSession()
-- para que el nuevo JWT con los claims actualizados entre en vigor.
--
-- Parametros:
--   p_negocio_id  UUID  — ID del negocio a activar
--
-- Retorna: JSON con { success, negocio_id, rol, negocio_nombre }
--
-- Seguridad:
--   - SECURITY DEFINER para poder actualizar auth.users.raw_app_meta_data
--   - Valida que el usuario autenticado tenga membresia activa en ese negocio
--   - Un superadmin puede activar cualquier negocio (para soporte/admin)
--
-- CORRECCIONES v1.1:
--   - Fix Supabase: SELECT rol, activo INTO v_rol, v_activo → dos asignaciones := (SELECT ...)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_set_negocio_activo(
    p_negocio_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email         TEXT;
    v_usuario_id    UUID;
    v_rol           TEXT;
    v_es_superadmin BOOLEAN;
    v_negocio_nombre VARCHAR;
    v_activo        BOOLEAN;
BEGIN
    -- Obtener email del usuario autenticado desde el JWT
    v_email := (auth.jwt() ->> 'email');

    IF v_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa. El JWT no contiene email.';
    END IF;

    -- Obtener datos del usuario en la tabla publica
    -- Fix: dos := (SELECT ...) en vez de SELECT ... INTO variable (bug Supabase)
    v_usuario_id    := (SELECT id            FROM usuarios WHERE email = v_email);
    v_es_superadmin := (SELECT es_superadmin FROM usuarios WHERE email = v_email);

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuario % no encontrado en la tabla de usuarios.', v_email;
    END IF;

    -- Verificar que el negocio existe
    v_negocio_nombre := (SELECT nombre FROM negocios WHERE id = p_negocio_id AND activo = TRUE);

    IF v_negocio_nombre IS NULL THEN
        RAISE EXCEPTION 'El negocio % no existe o no esta activo.', p_negocio_id;
    END IF;

    -- Verificar membresia activa (superadmin omite esta validacion)
    IF NOT COALESCE(v_es_superadmin, FALSE) THEN
        -- Fix: dos := (SELECT ...) en vez de SELECT ... INTO v_rol, v_activo (bug Supabase)
        v_rol    := (SELECT rol    FROM usuario_negocios WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id);
        v_activo := (SELECT activo FROM usuario_negocios WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id);

        IF v_rol IS NULL THEN
            RAISE EXCEPTION 'El usuario % no tiene membresia en el negocio %.', v_email, p_negocio_id;
        END IF;

        IF NOT v_activo THEN
            RAISE EXCEPTION 'La membresia del usuario % en el negocio % esta inactiva.', v_email, p_negocio_id;
        END IF;
    ELSE
        -- Superadmin: si tiene membresia la usa, si no tiene se asigna ADMIN virtual
        v_rol := COALESCE(
            (SELECT rol FROM usuario_negocios
             WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id AND activo = TRUE),
            'ADMIN'
        );
    END IF;

    -- Actualizar app_metadata en auth.users
    -- Esto actualiza el JWT en el proximo refresh de sesion
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data
        || jsonb_build_object(
            'negocio_id',    p_negocio_id::TEXT,
            'rol',           v_rol,
            'es_superadmin', COALESCE(v_es_superadmin, FALSE)
        )
    WHERE email = v_email;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo actualizar el JWT del usuario %. El usuario no existe en auth.users.', v_email;
    END IF;

    RETURN json_build_object(
        'success',         TRUE,
        'negocio_id',      p_negocio_id,
        'rol',             v_rol,
        'negocio_nombre',  v_negocio_nombre,
        'mensaje',         'Negocio activado. Llamar a supabase.auth.refreshSession() para aplicar el nuevo JWT.'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al activar negocio: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Cualquier usuario autenticado puede llamar esta funcion para seleccionar SU negocio.
-- La funcion valida internamente que tenga membresia activa.
REVOKE EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- FLUJO DE USO (frontend Angular/TypeScript):
--
-- 1. Login con supabase.auth.signInWithOAuth({ provider: 'google' })
--    → JWT inicial: sin negocio_id (auth.negocio_id() devuelve NULL)
--
-- 2. Obtener negocios del usuario:
--    SELECT un.negocio_id, n.nombre FROM usuario_negocios un
--    INNER JOIN negocios n ON n.id = un.negocio_id
--    WHERE un.usuario_id = <usuario_id> AND un.activo = TRUE
--    → Si solo hay 1, seleccionar automaticamente.
--    → Si hay varios, mostrar pantalla de seleccion.
--
-- 3. Activar negocio:
--    await supabase.rpc('fn_set_negocio_activo', { p_negocio_id: negocioId });
--
-- 4. Refrescar sesion para obtener JWT actualizado:
--    await supabase.auth.refreshSession();
--    → Ahora public.get_negocio_id() devuelve el UUID del negocio seleccionado
--    → RLS filtra automaticamente por ese negocio en todas las queries
--
-- 5. Navegar al home de la app.
-- =============================================================================
-- ==========================================
-- DROP — limpia versiones anteriores con cualquier firma
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_abrir_turno(INTEGER);
DROP FUNCTION IF EXISTS public.fn_abrir_turno(UUID);
DROP FUNCTION IF EXISTS public.fn_abrir_turno();

-- ==========================================
-- FUNCIÓN: fn_abrir_turno (v2.0 — multi-tenant UUID)
-- ==========================================
-- Apertura atómica de turno de caja.
-- Reemplaza la lógica multi-query de TurnosCajaService.abrirTurno().
--
-- CAMBIOS v2.0:
--   - p_empleado_id: INTEGER → UUID (schema v11 migró PKs a UUID)
--   - RLS filtra por negocio_id del JWT automáticamente en todas las queries
--
-- Llamada desde: TurnosCajaService.abrirTurno()
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_abrir_turno(
  p_empleado_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inicio_dia   TIMESTAMPTZ;
  v_numero_turno INTEGER;
  v_turno_id     UUID;
  v_negocio_id   UUID;
BEGIN
  v_negocio_id := public.get_negocio_id();

  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  -- Inicio del día en zona horaria local
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );

  -- Validar que no haya turno abierto hoy en este negocio
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE negocio_id          = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
  END IF;

  -- Número de turno: siguiente al último del día en este negocio
  v_numero_turno := (
    SELECT COUNT(*) + 1
    FROM turnos_caja
    WHERE negocio_id          = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
  );

  v_turno_id := gen_random_uuid();
  INSERT INTO turnos_caja (id, negocio_id, numero_turno, empleado_id, hora_fecha_apertura)
  VALUES (v_turno_id, v_negocio_id, v_numero_turno, p_empleado_id, NOW());

  RETURN json_build_object(
    'success',      true,
    'turno_id',     v_turno_id,
    'numero_turno', v_numero_turno
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_abrir_turno(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_abrir_turno(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_abrir_turno IS
  'v2.0 - Apertura atómica de turno de caja. UUID (multi-tenant v11). '
  'Valida negocio activo en JWT y que no haya turno abierto hoy. '
  'Calcula número de turno secuencial dentro del día por negocio. '
  'Retorna turno_id y numero_turno. Si ya hay turno abierto, retorna success: false.';
-- ==========================================
-- DROP — firma cambia en v3.0 (INTEGER → UUID, multi-tenant)
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_registrar_operacion_manual(INTEGER, INTEGER, TEXT, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_registrar_operacion_manual(UUID, UUID, TEXT, UUID, DECIMAL, TEXT, TEXT);

-- ==========================================
-- FUNCIÓN: fn_registrar_operacion_manual (v3.0 — multi-tenant UUID)
-- ==========================================
-- Registra un INGRESO o EGRESO manual en una caja con bloqueo de concurrencia.
-- Recibe p_tipo_operacion como TEXT (no ENUM) para compatibilidad con PostgREST.
-- Castea internamente TEXT → tipo_operacion_caja_enum.
-- Valida saldo suficiente en EGRESO (saldo_nuevo >= 0).
-- Para CAJA_CHICA: valida que p_empleado_id tenga turno activo hoy
--   (hora_fecha_cierre IS NULL). Solo el empleado que abrió el turno puede operar.
--
-- CAMBIOS v3.0:
--   - p_caja_id, p_empleado_id, p_categoria_id: INTEGER → UUID
--   - Negocio leído del JWT (get_negocio_id()); validaciones filtran por negocio_id
--   - operaciones_cajas INSERT incluye negocio_id
-- ==========================================
-- Llamada desde: OperacionesCajaService.registrarOperacion()
-- Parámetros:
--   p_caja_id         — UUID de la caja
--   p_empleado_id     — UUID del empleado que registra la operación
--   p_tipo_operacion  — 'INGRESO' o 'EGRESO' (TEXT, se castea internamente al ENUM)
--   p_categoria_id    — UUID de categoría contable (categorias_operaciones)
--   p_monto           — Monto de la operación
--   p_descripcion     — Descripción opcional
--   p_comprobante_url — PATH en Storage (no URL firmada), nullable
-- ==========================================
-- NOTA: Para EGRESO de Tienda cuando hay déficit (saldo_actual = 0),
--       usar reparar_deficit_turno que omite la validación de saldo mínimo.
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_registrar_operacion_manual(
  p_caja_id         UUID,
  p_empleado_id     UUID,
  p_tipo_operacion  TEXT,            -- TEXT (no ENUM) para compatibilidad con PostgREST
  p_categoria_id    UUID,
  p_monto           DECIMAL(12,2),
  p_descripcion     TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER                     -- CRÍTICO: ejecuta con permisos del creador
SET search_path = public             -- CRÍTICO: resolución explícita de schema
AS $$
DECLARE
  v_negocio_id     UUID;
  v_saldo_anterior DECIMAL(12,2);
  v_saldo_nuevo    DECIMAL(12,2);
  v_operacion_id   UUID;
  v_tipo           tipo_operacion_caja_enum;
  v_caja_codigo    TEXT;
BEGIN
  -- 0. Obtener negocio del JWT
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- 0.5. Cast TEXT → ENUM con validación
  BEGIN
    v_tipo := p_tipo_operacion::tipo_operacion_caja_enum;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Tipo de operación no válido: %. Use INGRESO o EGRESO', p_tipo_operacion;
  END;

  -- 0.7. Para CAJA_CHICA: validar que el empleado tenga turno activo hoy
  v_caja_codigo := (SELECT codigo FROM cajas WHERE id = p_caja_id AND negocio_id = v_negocio_id);

  IF v_caja_codigo = 'CAJA_CHICA' THEN
    IF NOT EXISTS (
      SELECT 1 FROM turnos_caja
      WHERE empleado_id      = p_empleado_id
        AND negocio_id       = v_negocio_id
        AND hora_fecha_cierre IS NULL
        AND hora_fecha_apertura >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')::date
        AND hora_fecha_apertura <  (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')::date + INTERVAL '1 day'
    ) THEN
      RAISE EXCEPTION 'Solo el empleado con turno activo puede operar sobre Caja Chica';
    END IF;
  END IF;

  -- 1. Obtener saldo actual de la caja (con lock para evitar race conditions)
  PERFORM id FROM cajas WHERE id = p_caja_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_anterior := (SELECT saldo_actual FROM cajas WHERE id = p_caja_id AND negocio_id = v_negocio_id);

  IF v_saldo_anterior IS NULL THEN
    RAISE EXCEPTION 'Caja no encontrada con ID: %', p_caja_id;
  END IF;

  -- 2. Calcular nuevo saldo
  IF v_tipo = 'INGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior + p_monto;
  ELSIF v_tipo = 'EGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior - p_monto;
    IF v_saldo_nuevo < 0 THEN
      RAISE EXCEPTION 'Saldo insuficiente. Saldo actual: %, monto a retirar: %',
        v_saldo_anterior, p_monto;
    END IF;
  END IF;

  -- 3. Actualizar saldo de la caja
  UPDATE cajas
  SET saldo_actual = v_saldo_nuevo
  WHERE id = p_caja_id AND negocio_id = v_negocio_id;

  -- 4. Insertar operación
  v_operacion_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id, monto,
    saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    v_operacion_id, v_negocio_id, p_caja_id, p_empleado_id, v_tipo, p_categoria_id, p_monto,
    v_saldo_anterior, v_saldo_nuevo, p_descripcion, p_comprobante_url
  );

  -- 5. Retornar resultado
  RETURN json_build_object(
    'success',        true,
    'operacion_id',   v_operacion_id,
    'saldo_anterior', v_saldo_anterior,
    'saldo_nuevo',    v_saldo_nuevo
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en operación: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_registrar_operacion_manual(UUID, UUID, TEXT, UUID, DECIMAL, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_operacion_manual(UUID, UUID, TEXT, UUID, DECIMAL, TEXT, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_operacion_manual IS
  'v3.0 (multi-tenant UUID) - Registra un INGRESO o EGRESO manual en una caja. '
  'Bloqueo FOR UPDATE evita race conditions. '
  'Valida saldo suficiente en EGRESO. '
  'Para CAJA_CHICA: solo el empleado con turno activo hoy puede operar. '
  'Para EGRESO con saldo = 0 (déficit), usar reparar_deficit_turno.';
-- =============================================================================
-- DROP — firma cambia en v2.0 (p_empleado_id INTEGER → UUID)
-- =============================================================================
DROP FUNCTION IF EXISTS public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT);

-- =============================================================================
-- FUNCIÓN: fn_crear_transferencia (v2.0 — multi-tenant UUID)
-- =============================================================================
-- Crea una transferencia atómica entre dos cajas usando códigos.
-- Busca las cajas por código, valida saldo suficiente en el origen,
-- registra las dos operaciones y actualiza los saldos en una sola
-- transacción (todo o nada).
--
-- CAMBIOS v2.0:
--   - p_empleado_id: INTEGER → UUID
--   - v_caja_origen_id, v_caja_destino_id: INTEGER → UUID
--   - Negocio leído del JWT (get_negocio_id()); cajas filtran por negocio_id
--   - operaciones_cajas INSERT incluye negocio_id
--
-- Llamada desde: CajasService.crearTransferencia()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_crear_transferencia(
  p_codigo_origen    TEXT,
  p_codigo_destino   TEXT,
  p_monto            NUMERIC,
  p_empleado_id      UUID,
  p_descripcion      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id          UUID;
  v_caja_origen_id      UUID;
  v_caja_destino_id     UUID;
  v_nombre_origen       TEXT;
  v_nombre_destino      TEXT;
  v_saldo_origen        NUMERIC;
  v_saldo_destino       NUMERIC;
  v_nuevo_saldo_origen  NUMERIC;
  v_nuevo_saldo_destino NUMERIC;
BEGIN
  -- Obtener negocio del JWT
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  -- 1. Obtener caja origen por código
  v_caja_origen_id := (SELECT id           FROM cajas WHERE codigo = p_codigo_origen  AND negocio_id = v_negocio_id AND activo = true);
  v_nombre_origen  := (SELECT nombre       FROM cajas WHERE codigo = p_codigo_origen  AND negocio_id = v_negocio_id AND activo = true);
  v_saldo_origen   := (SELECT saldo_actual FROM cajas WHERE codigo = p_codigo_origen  AND negocio_id = v_negocio_id AND activo = true);

  IF v_caja_origen_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Caja origen no encontrada: ' || p_codigo_origen);
  END IF;

  -- 2. Obtener caja destino por código
  v_caja_destino_id := (SELECT id           FROM cajas WHERE codigo = p_codigo_destino AND negocio_id = v_negocio_id AND activo = true);
  v_nombre_destino  := (SELECT nombre       FROM cajas WHERE codigo = p_codigo_destino AND negocio_id = v_negocio_id AND activo = true);
  v_saldo_destino   := (SELECT saldo_actual FROM cajas WHERE codigo = p_codigo_destino AND negocio_id = v_negocio_id AND activo = true);

  IF v_caja_destino_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Caja destino no encontrada: ' || p_codigo_destino);
  END IF;

  -- 3. Validar saldo suficiente en origen
  IF v_saldo_origen < p_monto THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Saldo insuficiente en %s. Disponible: $%s, requerido: $%s',
                      v_nombre_origen,
                      v_saldo_origen::TEXT,
                      p_monto::TEXT)
    );
  END IF;

  -- 4. Calcular nuevos saldos
  v_nuevo_saldo_origen  := v_saldo_origen  - p_monto;
  v_nuevo_saldo_destino := v_saldo_destino + p_monto;

  -- 5. Insertar operación SALIENTE en caja origen
  INSERT INTO operaciones_cajas (
    negocio_id, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_negocio_id, v_caja_origen_id, p_empleado_id, 'TRANSFERENCIA_SALIENTE',
    p_monto, v_saldo_origen, v_nuevo_saldo_origen, p_descripcion
  );

  -- 6. Insertar operación ENTRANTE en caja destino
  INSERT INTO operaciones_cajas (
    negocio_id, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_negocio_id, v_caja_destino_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE',
    p_monto, v_saldo_destino, v_nuevo_saldo_destino,
    p_descripcion || ' desde ' || v_nombre_origen
  );

  -- 7. Actualizar saldo origen
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_origen WHERE id = v_caja_origen_id AND negocio_id = v_negocio_id;

  -- 8. Actualizar saldo destino
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_destino WHERE id = v_caja_destino_id AND negocio_id = v_negocio_id;

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) IS
  'v2.0 (multi-tenant UUID) — Transfiere monto entre dos cajas por código. '
  'Operación atómica con validación de saldo. Negocio leído del JWT.';
  -- ==========================================
  -- FUNCIÓN: fn_verificar_transferencia_caja_chica_hoy
  -- VERSIÓN: 1.2
  -- ==========================================
  -- CAMBIOS v1.2 (Refactor v5):
  --   - Busca por codigo 'VARIOS' (antes 'CAJA_CHICA')
  --   - Razón: en v5, CAJA_CHICA es el cajón físico diario.
  --            VARIOS es el fondo de emergencia que recibe la transferencia diaria.
  -- CAMBIOS v1.1:
  --   - También detecta INGRESO con categoría IN-004 (Reposición Déficit Turno Anterior)
  --   - Si hoy se reparó el déficit de ayer al abrir caja, eso cuenta como
  --     la transferencia diaria de hoy → no se duplica el envío a Varios
  --
  -- Verifica si VARIOS ya recibió su transferencia diaria para la fecha indicada.
  -- Cubre dos casos:
  --   1. Cierre normal anterior del día        → TRANSFERENCIA_ENTRANTE en VARIOS
  --   2. Ajuste de apertura (reparar déficit)  → INGRESO categoría IN-004 en VARIOS
  --
  -- Usada en CierreDiarioPage (Paso 2) antes de ejecutar el cierre:
  -- si ya existe → muestra "✅ Varios ya recibió hoy", no repite la transferencia.
  --
  -- Parámetros:
  --   p_fecha DATE  — Fecha local (obtenida con getFechaLocal() en TypeScript)
  --
  -- Retorna:
  --   TRUE  → VARIOS ya recibió su transferencia hoy (por cierre anterior o por ajuste apertura)
  --   FALSE → no existe ninguna de las dos (cierre aún no realizado)
  -- ==========================================

  -- Descomentar solo si cambia la firma (parámetros o tipo de retorno):
  -- DROP FUNCTION IF EXISTS public.fn_verificar_transferencia_caja_chica_hoy(DATE);

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
    v_varios_id  UUID;  -- v1.2: era v_caja_chica_id con codigo 'CAJA_CHICA'
    v_existe     BOOLEAN;
  BEGIN
    v_negocio_id := public.get_negocio_id();
    v_varios_id  := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);  -- v1.2: era 'CAJA_CHICA'

    v_existe := EXISTS (
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
              WHERE co.id = oc.categoria_id AND co.codigo = 'IN-004'
            )
          )
        )
    );

    RETURN v_existe;
  END;
  $$;

  -- Permisos
  REVOKE EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) FROM anon;
  GRANT EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) TO authenticated;

  -- Refrescar caché PostgREST
  NOTIFY pgrst, 'reload schema';

  COMMENT ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy IS
    'v1.2 - Retorna TRUE si VARIOS ya recibió su transferencia diaria hoy: '
    'TRANSFERENCIA_ENTRANTE (cierre normal anterior) o INGRESO categoría IN-004 (ajuste apertura). '
    'El ajuste de apertura cuenta como la transferencia del día para evitar duplicar el envío a Varios. '
    'Usa AT TIME ZONE America/Guayaquil para evitar desfase UTC en cierres nocturnos. '
    'v1.2: usa codigo VARIOS (antes CAJA_CHICA) — Refactor v5. '
    'Llamada desde RecargasService.verificarTransferenciaYaHecha().';
-- ==========================================
-- DROP — firma cambia en v6.0 (p_empleado_id INTEGER → UUID, multi-tenant)
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
);
DROP FUNCTION IF EXISTS public.fn_ejecutar_cierre_diario(
  UUID, DATE, UUID, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
);

-- ==========================================
-- FUNCIÓN: fn_ejecutar_cierre_diario (v6.0 — multi-tenant UUID)
-- ==========================================
-- CAMBIOS v6.0 respecto a v5.6:
--   - p_empleado_id: INTEGER → UUID (schema v11 migró PKs a UUID)
--   - v_negocio_id UUID: leído de public.get_negocio_id() (JWT)
--   - Todas las queries filtran por negocio_id (SECURITY DEFINER no aplica RLS)
--   - Eliminado: lectura de pos_habilitado desde configuraciones
--     (la clave fue eliminada; el POS se habilita automáticamente por turno abierto)
--   - Variables locales de IDs: INTEGER → UUID
--   - DROP/GRANT usan firma UUID
--
-- HEREDA DE v5.6:
--   - Distribución en cascada "todo o nada" por nivel
--   - Ajuste de conteo físico (solo si hubo movimientos en CAJA_CHICA)
--   - Recargas virtuales por created_at > último cierre
--   - ON CONFLICT en BUS para mini cierre
--   - faltante de conteo → movimientos_empleados (FALTANTE_CAJA)
--   - 1 sola transferencia a VARIOS por día
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_ejecutar_cierre_diario(  -- v6.0
  p_turno_id               UUID,
  p_fecha                  DATE,
  p_empleado_id            UUID,
  p_efectivo_fisico        DECIMAL(12,2),        -- Conteo físico del empleado en el cajón
  p_saldo_celular_final    DECIMAL(12,2),
  p_saldo_bus_final        DECIMAL(12,2),
  p_saldo_anterior_celular     DECIMAL(12,2),
  p_saldo_anterior_bus         DECIMAL(12,2),
  p_saldo_anterior_caja_celular DECIMAL(12,2),
  p_saldo_anterior_caja_bus    DECIMAL(12,2),
  p_observaciones          TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- Tenant
  v_negocio_id UUID;

  -- IDs de cajas (por código)
  v_caja_id         UUID;  -- CAJA (bóveda/Tienda)
  v_caja_chica_id   UUID;  -- CAJA_CHICA (cajón físico diario)
  v_varios_id       UUID;  -- VARIOS (fondo emergencia, ex-CAJA_CHICA)
  v_caja_celular_id UUID;
  v_caja_bus_id     UUID;

  -- IDs de categorías de ajuste
  v_cat_ajuste_ingreso_id UUID;  -- IN-005: Ajuste Diferencia Conteo
  v_cat_ajuste_egreso_id  UUID;  -- EG-013: Ajuste Diferencia Conteo

  -- IDs de servicios y referencias
  v_tipo_servicio_celular_id UUID;
  v_tipo_servicio_bus_id     UUID;
  v_tipo_ref_recargas_id     UUID;
  v_tipo_ref_turnos_id       UUID;

  -- Configuración
  v_fondo_fijo           DECIMAL(12,2);
  v_transferencia_diaria DECIMAL(12,2);

  -- Recargas virtuales pendientes
  v_agregado_celular DECIMAL(12,2);
  v_agregado_bus     DECIMAL(12,2);
  v_ultimo_cierre_at TIMESTAMP;

  -- Saldos actuales de cajas (leídos de BD, no parámetros)
  v_saldo_caja_chica_digital DECIMAL(12,2);  -- CAJA_CHICA antes del ajuste
  v_saldo_caja               DECIMAL(12,2);  -- CAJA (bóveda)
  v_saldo_varios             DECIMAL(12,2);  -- VARIOS (fondo emergencia)

  -- Ajuste por diferencia de conteo físico
  v_efectivo_esperado          DECIMAL(12,2);  -- saldo_digital + fondo_fijo
  v_diferencia                 DECIMAL(12,2);  -- p_efectivo_fisico - efectivo_esperado
  v_saldo_caja_chica_post_ajuste DECIMAL(12,2); -- saldo_digital + diferencia

  -- Distribución de efectivo
  v_transferencia_efectiva    DECIMAL(12,2);   -- Lo que va a VARIOS
  v_deficit_varios            DECIMAL(12,2);   -- Déficit de VARIOS (0 si turno normal)
  v_dinero_a_depositar        DECIMAL(12,2);   -- Lo que va a CAJA (bóveda)
  v_fondo_en_cajon            BOOLEAN;         -- TRUE si el fondo completo queda en cajón
  v_monto_reposicion_apertura DECIMAL(12,2) := 0;  -- Lo que Tienda debe reponer al abrir mañana
  v_transferencia_ya_hecha    BOOLEAN := FALSE;  -- ¿VARIOS ya recibió hoy?

  -- Ventas y saldos finales recargas
  v_venta_celular            DECIMAL(12,2);
  v_venta_bus                DECIMAL(12,2);
  v_saldo_final_caja_celular DECIMAL(12,2);
  v_saldo_final_caja_bus     DECIMAL(12,2);

  -- Sin movimientos manuales en CAJA_CHICA
  v_hubo_movimientos_caja_chica BOOLEAN := FALSE;

  -- IDs generados
  v_recarga_celular_id UUID;
  v_recarga_bus_id     UUID;
  v_turno_cerrado      BOOLEAN := FALSE;
BEGIN
  -- ==========================================
  -- 0. OBTENER NEGOCIO DEL JWT
  -- ==========================================

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- ==========================================
  -- 1. VALIDACIONES DE TURNO
  -- ==========================================

  IF NOT EXISTS (
    SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND negocio_id = v_negocio_id
  ) THEN
    RAISE EXCEPTION 'El turno especificado no existe';
  END IF;

  IF EXISTS (
    SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND negocio_id = v_negocio_id AND hora_fecha_cierre IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND negocio_id = v_negocio_id AND empleado_id = p_empleado_id
  ) THEN
    RAISE EXCEPTION 'Solo el empleado que abrió el turno puede realizar el cierre';
  END IF;

  IF p_efectivo_fisico < 0 THEN
    RAISE EXCEPTION 'El efectivo físico contado no puede ser negativo';
  END IF;

  -- ==========================================
  -- 2. OBTENER IDs POR CÓDIGO / TABLA
  -- ==========================================

  v_caja_id         := (SELECT id FROM cajas WHERE codigo = 'CAJA'         AND negocio_id = v_negocio_id);
  v_caja_chica_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA'   AND negocio_id = v_negocio_id);
  v_varios_id       := (SELECT id FROM cajas WHERE codigo = 'VARIOS'       AND negocio_id = v_negocio_id);
  v_caja_celular_id := (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR' AND negocio_id = v_negocio_id);
  v_caja_bus_id     := (SELECT id FROM cajas WHERE codigo = 'CAJA_BUS'     AND negocio_id = v_negocio_id);

  v_tipo_servicio_celular_id := (SELECT id FROM tipos_servicio   WHERE codigo = 'CELULAR');
  v_tipo_servicio_bus_id     := (SELECT id FROM tipos_servicio   WHERE codigo = 'BUS');
  v_tipo_ref_recargas_id     := (SELECT id FROM tipos_referencia WHERE tabla = 'recargas');
  v_tipo_ref_turnos_id       := (SELECT id FROM tipos_referencia WHERE tabla = 'turnos_caja');

  v_cat_ajuste_ingreso_id := (SELECT id FROM categorias_operaciones WHERE codigo = 'IN-005' AND negocio_id = v_negocio_id);
  v_cat_ajuste_egreso_id  := (SELECT id FROM categorias_operaciones WHERE codigo = 'EG-013' AND negocio_id = v_negocio_id);

  -- ==========================================
  -- 3. OBTENER CONFIGURACIÓN
  -- ==========================================

  v_fondo_fijo           := (SELECT valor::DECIMAL FROM configuraciones WHERE clave = 'caja_fondo_fijo_diario'          AND negocio_id = v_negocio_id);
  v_transferencia_diaria := (SELECT valor::DECIMAL FROM configuraciones WHERE clave = 'caja_varios_transferencia_dia'   AND negocio_id = v_negocio_id);

  IF v_fondo_fijo IS NULL OR v_transferencia_diaria IS NULL THEN
    RAISE EXCEPTION 'No se encontró configuración del sistema';
  END IF;

  -- ==========================================
  -- 4. OBTENER TIMESTAMP DEL ÚLTIMO CIERRE
  -- (para filtrar recargas virtuales no incorporadas en cierres previos)
  -- ==========================================

  v_ultimo_cierre_at := (
    SELECT MAX(hora_fecha_cierre)
    FROM turnos_caja
    WHERE hora_fecha_cierre IS NOT NULL
      AND negocio_id = v_negocio_id
  );

  -- ==========================================
  -- 5. RECARGAS VIRTUALES PENDIENTES
  -- IMPORTANTE: Filtra por created_at > último cierre, NO por fecha = hoy.
  -- Esto captura todas las recargas no incorporadas en cierres anteriores,
  -- incluso si tienen fecha anterior (ej: recarga del lunes en un cierre del martes).
  -- ==========================================

  v_agregado_celular := (
    SELECT COALESCE(SUM(monto_virtual), 0)
    FROM recargas_virtuales rv
    WHERE rv.tipo_servicio_id = v_tipo_servicio_celular_id
      AND rv.negocio_id = v_negocio_id
      AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at)
  );

  v_agregado_bus := (
    SELECT COALESCE(SUM(monto_virtual), 0)
    FROM recargas_virtuales rv
    WHERE rv.tipo_servicio_id = v_tipo_servicio_bus_id
      AND rv.negocio_id = v_negocio_id
      AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at)
  );

  -- ==========================================
  -- 6. LEER SALDOS ACTUALES DE CAJAS (con lock para consistencia)
  -- ==========================================

  -- Lock explícito en las 3 filas + lectura individual por código
  PERFORM id FROM cajas WHERE codigo IN ('CAJA_CHICA', 'CAJA', 'VARIOS') AND negocio_id = v_negocio_id FOR UPDATE;

  v_saldo_caja_chica_digital := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
  v_saldo_caja               := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA'       AND negocio_id = v_negocio_id);
  v_saldo_varios             := (SELECT saldo_actual FROM cajas WHERE codigo = 'VARIOS'     AND negocio_id = v_negocio_id);

  -- ==========================================
  -- 7. AJUSTE POR DIFERENCIA DE CONTEO FÍSICO
  --
  -- Solo aplica si hubo movimientos reales en CAJA_CHICA durante el turno
  -- (ventas POS, ingresos o egresos manuales).
  --
  -- efectivo_esperado = saldo_digital + fondo_fijo
  -- diferencia = p_efectivo_fisico - efectivo_esperado
  --   > 0 → encontró más de lo esperado  → INGRESO de ajuste
  --   < 0 → encontró menos de lo esperado → EGRESO de ajuste + deuda empleado
  --   = 0 → conteo exacto, no se necesita ajuste
  -- ==========================================

  -- Verificar si hubo movimientos reales en CAJA_CHICA durante este turno
  v_hubo_movimientos_caja_chica := EXISTS (
    SELECT 1 FROM operaciones_cajas
    WHERE caja_id = v_caja_chica_id
      AND negocio_id = v_negocio_id
      AND fecha >= (SELECT hora_fecha_apertura FROM turnos_caja WHERE id = p_turno_id AND negocio_id = v_negocio_id)
  );

  IF v_hubo_movimientos_caja_chica THEN
    v_efectivo_esperado := v_saldo_caja_chica_digital + v_fondo_fijo;
    v_diferencia        := p_efectivo_fisico - v_efectivo_esperado;
  ELSE
    -- Sin movimientos: no hay ajuste, el efectivo va directo a distribución
    v_efectivo_esperado := p_efectivo_fisico;
    v_diferencia        := 0;
  END IF;

  IF v_diferencia > 0 THEN
    -- Más físico del esperado → INGRESO de ajuste a CAJA_CHICA
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_chica_id,
      p_empleado_id,
      'INGRESO',
      v_diferencia,
      v_cat_ajuste_ingreso_id,
      v_saldo_caja_chica_digital,
      v_saldo_caja_chica_digital + v_diferencia,
      FORMAT(
        'Ajuste conteo físico: contado $%s, esperado $%s (diferencia: +$%s)',
        TO_CHAR(p_efectivo_fisico, 'FM999990.00'),
        TO_CHAR(v_efectivo_esperado, 'FM999990.00'),
        TO_CHAR(v_diferencia, 'FM999990.00')
      )
    );

  ELSIF v_diferencia < 0 THEN
    -- Menos físico del esperado → EGRESO de ajuste desde CAJA_CHICA
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_chica_id,
      p_empleado_id,
      'EGRESO',
      ABS(v_diferencia),
      v_cat_ajuste_egreso_id,
      v_saldo_caja_chica_digital,
      v_saldo_caja_chica_digital + v_diferencia,  -- negativo: saldo baja
      FORMAT(
        'Ajuste conteo físico: contado $%s, esperado $%s (diferencia: -$%s)',
        TO_CHAR(p_efectivo_fisico, 'FM999990.00'),
        TO_CHAR(v_efectivo_esperado, 'FM999990.00'),
        TO_CHAR(ABS(v_diferencia), 'FM999990.00')
      )
    );

    -- Registrar faltante en cuenta corriente del empleado (movimientos_empleados).
    INSERT INTO movimientos_empleados (
      negocio_id, empleado_id, turno_id, tipo_movimiento, monto, descripcion, creado_por
    ) VALUES (
      v_negocio_id,
      p_empleado_id,
      p_turno_id,
      'FALTANTE_CAJA',
      ABS(v_diferencia),
      format('Faltante de conteo fisico al cierre del %s ($%s)',
             TO_CHAR(p_fecha, 'DD/MM/YYYY'), TO_CHAR(ABS(v_diferencia), 'FM999990.00')),
      p_empleado_id
    );
  END IF;

  v_saldo_caja_chica_post_ajuste := v_saldo_caja_chica_digital + v_diferencia;

  -- ==========================================
  -- 8. DISTRIBUCIÓN EN CASCADA (v5.2)
  --
  -- Regla "todo o nada" en cada nivel — sin montos parciales:
  --   1° VARIOS     → recibe si efectivo >= transferencia_diaria completa
  --   2° Fondo fijo → queda en cajón solo si efectivo >= transferencia_diaria + fondo_fijo
  --   3° CAJA       → recibe el resto (siempre >= 0)
  --
  -- Si el efectivo no alcanza para un nivel, ese monto va a CAJA.
  -- Regla adicional: solo 1 transferencia a VARIOS por día.
  -- ==========================================

  -- ¿VARIOS ya recibió su transferencia diaria hoy?
  v_transferencia_ya_hecha := EXISTS (
    SELECT 1
    FROM operaciones_cajas oc
    WHERE oc.caja_id = v_varios_id
      AND oc.negocio_id = v_negocio_id
      AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
      AND (
        oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
        OR (
          oc.tipo_operacion = 'INGRESO'
          AND EXISTS (
            SELECT 1 FROM categorias_operaciones co
            WHERE co.id = oc.categoria_id AND co.codigo = 'IN-004'
          )
        )
      )
  );

  IF v_transferencia_ya_hecha THEN
    -- 2do turno del día: VARIOS ya recibió, no hay déficit
    v_transferencia_efectiva    := 0;
    v_deficit_varios            := 0;
    v_fondo_en_cajon            := (p_efectivo_fisico >= v_fondo_fijo);
    v_dinero_a_depositar        := p_efectivo_fisico - CASE WHEN v_fondo_en_cajon THEN v_fondo_fijo ELSE 0 END;
    v_monto_reposicion_apertura := 0;

  ELSIF p_efectivo_fisico >= (v_transferencia_diaria + v_fondo_fijo) THEN
    -- CASO NORMAL: VARIOS completo + fondo completo → resto a CAJA
    v_fondo_en_cajon            := TRUE;
    v_transferencia_efectiva    := v_transferencia_diaria;
    v_deficit_varios            := 0;
    v_dinero_a_depositar        := p_efectivo_fisico - v_transferencia_diaria - v_fondo_fijo;
    v_monto_reposicion_apertura := 0;

  ELSIF p_efectivo_fisico >= v_transferencia_diaria THEN
    -- CASO DÉFICIT FONDO: VARIOS completo pero no alcanza para fondo → fondo = $0, resto a CAJA
    v_fondo_en_cajon            := FALSE;
    v_transferencia_efectiva    := v_transferencia_diaria;
    v_deficit_varios            := 0;
    v_dinero_a_depositar        := p_efectivo_fisico - v_transferencia_diaria;
    v_monto_reposicion_apertura := v_fondo_fijo;

  ELSE
    -- CASO DÉFICIT TOTAL: ni VARIOS ni fondo alcanza → todo a CAJA, cajón queda vacío
    v_fondo_en_cajon            := FALSE;
    v_transferencia_efectiva    := 0;
    v_deficit_varios            := v_transferencia_diaria;
    v_dinero_a_depositar        := p_efectivo_fisico;
    v_monto_reposicion_apertura := v_fondo_fijo + v_transferencia_diaria;
  END IF;

  -- ==========================================
  -- 9. CALCULAR VENTAS VIRTUALES
  -- ==========================================

  v_venta_celular := (p_saldo_anterior_celular + v_agregado_celular) - p_saldo_celular_final;
  v_venta_bus     := (p_saldo_anterior_bus     + v_agregado_bus)     - p_saldo_bus_final;

  IF v_venta_celular < 0 THEN
    RAISE EXCEPTION 'Venta celular negativa ($%). Registrá la recarga del proveedor en Recargas Virtuales antes de cerrar.', v_venta_celular;
  END IF;

  IF v_venta_bus < 0 THEN
    RAISE EXCEPTION 'Venta bus negativa ($%). Registrá la compra de saldo virtual en Recargas Virtuales antes de cerrar.', v_venta_bus;
  END IF;

  -- Saldos finales para CAJA_CELULAR y CAJA_BUS
  v_saldo_final_caja_celular := p_saldo_anterior_caja_celular + v_venta_celular;
  v_saldo_final_caja_bus     := p_saldo_anterior_caja_bus     + v_venta_bus;

  -- ==========================================
  -- 10. OPERACIÓN EN CAJA (bóveda) — depósito del cajón físico
  -- ==========================================

  IF v_dinero_a_depositar > 0 THEN
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_id,
      p_empleado_id,
      'CIERRE',
      v_dinero_a_depositar,
      v_saldo_caja,
      v_saldo_caja + v_dinero_a_depositar,
      'Cierre de caja — turno ' || p_fecha,
      v_tipo_ref_turnos_id,
      p_turno_id
    );
  END IF;

  -- ==========================================
  -- 11. TRANSFERENCIA A VARIOS (fondo emergencia)
  -- ==========================================

  IF v_transferencia_efectiva > 0 THEN
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_varios_id,
      p_empleado_id,
      'TRANSFERENCIA_ENTRANTE',
      v_transferencia_efectiva,
      v_saldo_varios,
      v_saldo_varios + v_transferencia_efectiva,
      'Transferencia diaria desde cajón — turno ' || p_fecha,
      v_tipo_ref_turnos_id,
      p_turno_id
    );
  END IF;

  -- ==========================================
  -- 12. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================

  -- CAJA (bóveda): recibe el depósito
  UPDATE cajas SET saldo_actual = v_saldo_caja + v_dinero_a_depositar WHERE id = v_caja_id AND negocio_id = v_negocio_id;

  -- VARIOS (fondo emergencia): recibe la transferencia
  UPDATE cajas SET saldo_actual = v_saldo_varios + v_transferencia_efectiva WHERE id = v_varios_id AND negocio_id = v_negocio_id;

  -- CAJA_CHICA (cajón): queda en $0 digital (el fondo_fijo queda físicamente pero no digitalmente)
  UPDATE cajas SET saldo_actual = 0 WHERE id = v_caja_chica_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 13. RECARGAS CELULAR
  -- Solo se registra si hubo venta real (saldo virtual se movió).
  -- ==========================================

  IF v_venta_celular > 0 THEN
    INSERT INTO recargas (
      id, negocio_id, fecha, turno_id, empleado_id, tipo_servicio_id,
      venta_dia, saldo_virtual_anterior, saldo_virtual_actual
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      p_fecha,
      p_turno_id,
      p_empleado_id,
      v_tipo_servicio_celular_id,
      v_venta_celular,
      p_saldo_anterior_celular,
      p_saldo_celular_final
    );

    v_recarga_celular_id := (SELECT id FROM recargas WHERE turno_id = p_turno_id AND tipo_servicio_id = v_tipo_servicio_celular_id AND negocio_id = v_negocio_id);

    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_celular_id,
      p_empleado_id,
      'INGRESO',
      v_venta_celular,
      p_saldo_anterior_caja_celular,
      v_saldo_final_caja_celular,
      'Venta celular del turno ' || p_fecha,
      v_tipo_ref_recargas_id,
      v_recarga_celular_id
    );
    UPDATE cajas SET saldo_actual = v_saldo_final_caja_celular WHERE id = v_caja_celular_id AND negocio_id = v_negocio_id;
  END IF;

  -- ==========================================
  -- 14. RECARGAS BUS (ON CONFLICT para mini cierre)
  -- ==========================================

  IF v_venta_bus > 0 OR EXISTS (
    SELECT 1 FROM recargas
    WHERE turno_id = p_turno_id
      AND tipo_servicio_id = v_tipo_servicio_bus_id
      AND negocio_id = v_negocio_id
  ) THEN
    INSERT INTO recargas (
      id, negocio_id, fecha, turno_id, empleado_id, tipo_servicio_id,
      venta_dia, saldo_virtual_anterior, saldo_virtual_actual
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      p_fecha,
      p_turno_id,
      p_empleado_id,
      v_tipo_servicio_bus_id,
      v_venta_bus,
      p_saldo_anterior_bus,
      p_saldo_bus_final
    )
    ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE SET
      venta_dia            = recargas.venta_dia + EXCLUDED.venta_dia,
      saldo_virtual_actual = EXCLUDED.saldo_virtual_actual;

    v_recarga_bus_id := (SELECT id FROM recargas WHERE turno_id = p_turno_id AND tipo_servicio_id = v_tipo_servicio_bus_id AND negocio_id = v_negocio_id);

    IF v_venta_bus > 0 THEN
      INSERT INTO operaciones_cajas (
        id, negocio_id, caja_id, empleado_id, tipo_operacion, monto,
        saldo_anterior, saldo_actual, descripcion,
        tipo_referencia_id, referencia_id
      ) VALUES (
        gen_random_uuid(),
        v_negocio_id,
        v_caja_bus_id,
        p_empleado_id,
        'INGRESO',
        v_venta_bus,
        p_saldo_anterior_caja_bus,
        v_saldo_final_caja_bus,
        'Venta bus del turno ' || p_fecha,
        v_tipo_ref_recargas_id,
        v_recarga_bus_id
      );
      UPDATE cajas SET saldo_actual = v_saldo_final_caja_bus WHERE id = v_caja_bus_id AND negocio_id = v_negocio_id;
    END IF;
  END IF;

  -- ==========================================
  -- 15. CERRAR TURNO
  -- ==========================================

  UPDATE turnos_caja
     SET hora_fecha_cierre = NOW(),
         fondo_cubierto    = v_fondo_en_cajon
   WHERE id = p_turno_id
     AND negocio_id = v_negocio_id;
  v_turno_cerrado := TRUE;

  -- ==========================================
  -- 16. RETORNAR RESUMEN
  -- ==========================================

  RETURN json_build_object(
    'success',       true,
    'turno_id',      p_turno_id,
    'fecha',         p_fecha,
    'turno_cerrado', v_turno_cerrado,
    'version',       '6.0',
    'configuracion', json_build_object(
      'fondo_fijo',           v_fondo_fijo,
      'transferencia_diaria', v_transferencia_diaria
    ),
    'conteo_fisico', json_build_object(
      'efectivo_fisico',     p_efectivo_fisico,
      'saldo_digital_antes', v_saldo_caja_chica_digital,
      'efectivo_esperado',   v_efectivo_esperado,
      'diferencia',          v_diferencia,
      'ajuste_aplicado',     (v_diferencia <> 0)
    ),
    'distribucion_efectivo', json_build_object(
      'fondo_en_cajon',            v_fondo_en_cajon,
      'transferencia_varios',      v_transferencia_efectiva,
      'deposito_tienda',           v_dinero_a_depositar,
      'deficit_varios',            v_deficit_varios,
      'turno_con_deficit',         (v_deficit_varios > 0),
      'monto_reposicion_apertura', v_monto_reposicion_apertura
    ),
    'recargas_virtuales_dia', json_build_object(
      'celular', v_agregado_celular,
      'bus',     v_agregado_bus
    ),
    'saldos_finales', json_build_object(
      'caja_chica',   0,
      'caja',         v_saldo_caja + v_dinero_a_depositar,
      'varios',       v_saldo_varios + v_transferencia_efectiva,
      'caja_celular', v_saldo_final_caja_celular,
      'caja_bus',     v_saldo_final_caja_bus
    ),
    'ventas', json_build_object(
      'celular', v_venta_celular,
      'bus',     v_venta_bus
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error en cierre diario v6.0: %', SQLERRM;
END;
$function$;

-- ==========================================
-- PERMISOS
-- ==========================================

REVOKE EXECUTE ON FUNCTION public.fn_ejecutar_cierre_diario(
  UUID, DATE, UUID, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ejecutar_cierre_diario(
  UUID, DATE, UUID, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) TO authenticated;

-- Refrescar caché de PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_ejecutar_cierre_diario IS
'Cierre diario v6.0 (multi-tenant UUID) — Distribución en cascada "todo o nada" por nivel. '
'Ajuste de conteo solo si hubo movimientos reales en CAJA_CHICA durante el turno. '
'Negocio leído del JWT (get_negocio_id()); todas las queries filtran por negocio_id. '
'Inserta en movimientos_empleados (FALTANTE_CAJA) cuando efectivo_fisico < efectivo_esperado. '
'El déficit de VARIOS y del fondo son costos operacionales — NO se registran como faltante del empleado. '
'CAJA_CHICA.saldo_actual queda en $0 digital al finalizar. '
'Retorna monto_reposicion_apertura para informar al siguiente turno cuánto reponer.';
-- ==========================================
-- DROP — firma cambia en v2.0 (INTEGER → UUID, multi-tenant)
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL, UUID, UUID);

-- ==========================================
-- FUNCIÓN: fn_reparar_deficit_turno (v2.0 — multi-tenant UUID)
-- ==========================================
-- CAMBIOS v2.0:
--   - p_empleado_id, p_cat_egreso_id, p_cat_ingreso_id: INTEGER → UUID
--   - v_caja_id, v_varios_id: INTEGER → UUID
--   - Negocio leído del JWT (get_negocio_id()); todas las queries filtran por negocio_id
--   - INSERT en turnos_caja incluye negocio_id
--   - operaciones_cajas INSERT incluye negocio_id
--   - HEREDA DE v1.4:
--     * El déficit es costo operacional — NO toca movimientos_empleados
--     * Apertura de turno en la misma transacción atómica
--
-- Registra el ajuste contable del déficit del turno anterior Y abre el nuevo turno,
-- todo en una sola transacción atómica.
-- EGRESO de Tienda con validación de saldo: si Tienda no tiene suficiente, retorna error.
-- INGRESO a VARIOS solo si p_deficit_varios > 0.
-- ==========================================
-- Llamada desde: TurnosCajaService.repararDeficit()
-- Parámetros:
--   p_empleado_id    — UUID del empleado que abre el turno
--   p_deficit_varios — monto pendiente a VARIOS del turno anterior
--   p_fondo_faltante — fondo que faltó para el día
--   p_cat_egreso_id  — UUID de categoría EG-012 (Ajuste Déficit Turno Anterior)
--   p_cat_ingreso_id — UUID de categoría IN-004 (Reposición Déficit Turno Anterior)
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_reparar_deficit_turno(
  p_empleado_id    UUID,
  p_deficit_varios DECIMAL(12,2),
  p_fondo_faltante DECIMAL(12,2),
  p_cat_egreso_id  UUID,
  p_cat_ingreso_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id      UUID;
  v_total_a_reponer DECIMAL(12,2);
  v_caja_id         UUID;
  v_varios_id       UUID;
  v_saldo_tienda    DECIMAL(12,2);
  v_saldo_varios    DECIMAL(12,2);
  v_op_egreso_id    UUID;
  v_op_ingreso_id   UUID;
  -- Apertura de turno
  v_inicio_dia      TIMESTAMPTZ;
  v_numero_turno    INTEGER;
  v_turno_id        UUID;
BEGIN
  -- Obtener negocio del JWT
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  v_total_a_reponer := p_deficit_varios + p_fondo_faltante;

  -- Validaciones básicas
  IF v_total_a_reponer <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto a reponer debe ser mayor a cero');
  END IF;

  IF p_deficit_varios < 0 OR p_fondo_faltante < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Los montos de déficit no pueden ser negativos');
  END IF;

  -- Obtener IDs de cajas por código
  v_caja_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA'   AND negocio_id = v_negocio_id);
  v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);

  -- Obtener saldo actual de Tienda (con lock)
  PERFORM id FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_tienda := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id);
  IF v_saldo_tienda IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Tienda');
  END IF;

  -- Validar que Tienda tiene saldo suficiente para cubrir el ajuste
  IF v_saldo_tienda < v_total_a_reponer THEN
    RETURN json_build_object(
      'success', false,
      'error', FORMAT(
        'Saldo insuficiente en Tienda ($%s) para cubrir el ajuste de $%s. Registra un ingreso manual en Tienda primero.',
        TO_CHAR(v_saldo_tienda, 'FM999990.00'),
        TO_CHAR(v_total_a_reponer, 'FM999990.00')
      )
    );
  END IF;

  -- ==========================================
  -- 1. EGRESO de Tienda
  -- ==========================================
  v_op_egreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    v_op_egreso_id, v_negocio_id, v_caja_id, p_empleado_id, 'EGRESO', p_cat_egreso_id,
    v_total_a_reponer, v_saldo_tienda, v_saldo_tienda - v_total_a_reponer,
    FORMAT(
      'Ajuste déficit turno anterior — Varios: $%s, Fondo: $%s',
      TO_CHAR(p_deficit_varios, 'FM999990.00'),
      TO_CHAR(p_fondo_faltante, 'FM999990.00')
    ),
    NULL
  );

  UPDATE cajas SET saldo_actual = v_saldo_tienda - v_total_a_reponer WHERE id = v_caja_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 2. INGRESO a VARIOS (solo si hay déficit de la transferencia diaria)
  -- ==========================================
  IF p_deficit_varios > 0 THEN
    PERFORM id FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id FOR UPDATE;
    v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id);
    IF v_saldo_varios IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'No se encontró la caja Varios');
    END IF;

    v_op_ingreso_id := gen_random_uuid();
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
      monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
    ) VALUES (
      v_op_ingreso_id, v_negocio_id, v_varios_id, p_empleado_id, 'INGRESO', p_cat_ingreso_id,
      p_deficit_varios, v_saldo_varios, v_saldo_varios + p_deficit_varios,
      'Reposición déficit turno anterior — pendiente cobrado de Tienda',
      NULL
    );

    UPDATE cajas SET saldo_actual = v_saldo_varios + p_deficit_varios WHERE id = v_varios_id AND negocio_id = v_negocio_id;
  END IF;

  -- ==========================================
  -- 3. ABRIR TURNO (mismo proceso atómico)
  -- ==========================================

  -- Inicio del día en zona horaria local para filtrar turnos de hoy
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );

  -- Validar que no haya turno abierto (no debería, pero doble check)
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
  END IF;

  -- Número de turno: siguiente al último del día
  v_numero_turno := (
    SELECT COUNT(*) + 1
    FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
  );

  v_turno_id := gen_random_uuid();
  INSERT INTO turnos_caja (id, negocio_id, numero_turno, empleado_id, hora_fecha_apertura)
  VALUES (v_turno_id, v_negocio_id, v_numero_turno, p_empleado_id, NOW());

  -- ==========================================
  -- RESULTADO
  -- ==========================================
  RETURN json_build_object(
    'success',            true,
    'turno_id',           v_turno_id,
    'op_egreso_id',       v_op_egreso_id,
    'op_ingreso_id',      v_op_ingreso_id,
    'total_retirado',     v_total_a_reponer,
    'saldo_tienda_nuevo', v_saldo_tienda - v_total_a_reponer
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL, UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL, UUID, UUID) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reparar_deficit_turno IS
  'v2.0 (multi-tenant UUID) - Reparación déficit operacional + apertura de turno en una sola transacción atómica. '
  'EGRESO de Tienda (validando saldo) + INGRESO a VARIOS (si hay déficit de transferencia) + INSERT en turnos_caja. '
  'El déficit de VARIOS y del fondo son costos operacionales — NO son deudas del empleado. '
  'Negocio leído del JWT; todas las queries filtran por negocio_id. '
  'Retorna turno_id del turno abierto. Si algo falla, rollback completo — sin operaciones a medias.';
-- ==========================================
-- FUNCIÓN + TRIGGER: fn_generar_codigo_interno
-- ==========================================
-- Genera un código de barras interno EAN-13 para productos que se insertan
-- o actualizan sin código de barras (ej: granos a granel, productos caseros).
--
-- Formato EAN-13 interno:
--   20 XXXXX YYYYY C
--   ├─ 20       = Prefijo reservado para uso interno de tienda (GS1)
--   ├─ XXXXX    = Secuencia incremental (00001..99999)
--   ├─ YYYYY    = Padding ceros
--   └─ C        = Dígito de control EAN-13 (calculado)
--
-- Usa un SEQUENCE de PostgreSQL para garantizar unicidad sin race conditions.
--
-- Ejecutar: una sola vez en Supabase SQL Editor.
-- ==========================================

-- 1. Crear sequence si no existe
CREATE SEQUENCE IF NOT EXISTS seq_codigo_interno_producto START 1 INCREMENT 1;

-- 2. Función que calcula el dígito de control EAN-13
CREATE OR REPLACE FUNCTION fn_ean13_check_digit(p_12_digits TEXT)
RETURNS TEXT AS $$
DECLARE
    v_sum INTEGER := 0;
    v_digit INTEGER;
    v_weight INTEGER;
    v_check INTEGER;
BEGIN
    IF LENGTH(p_12_digits) <> 12 THEN
        RAISE EXCEPTION 'Se esperan 12 dígitos, se recibieron %', LENGTH(p_12_digits);
    END IF;

    FOR i IN 1..12 LOOP
        v_digit := CAST(SUBSTRING(p_12_digits FROM i FOR 1) AS INTEGER);
        v_weight := CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END;
        v_sum := v_sum + (v_digit * v_weight);
    END LOOP;

    v_check := (10 - (v_sum % 10)) % 10;
    RETURN p_12_digits || v_check::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE
   SECURITY DEFINER
   SET search_path = public;

-- 3. Trigger function: genera código interno si codigo_barras es NULL o vacío
CREATE OR REPLACE FUNCTION fn_generar_codigo_interno()
RETURNS TRIGGER AS $$
DECLARE
    v_seq INTEGER;
    v_base TEXT;
    v_ean13 TEXT;
BEGIN
    IF NEW.codigo_barras IS NULL OR TRIM(NEW.codigo_barras) = '' THEN
        v_seq := nextval('seq_codigo_interno_producto');

        IF v_seq > 9999999999 THEN
            RAISE EXCEPTION 'Secuencia de códigos internos agotada (máx 9999999999)';
        END IF;

        v_base := '20' || LPAD(v_seq::TEXT, 10, '0');
        v_ean13 := fn_ean13_check_digit(v_base);
        NEW.codigo_barras := v_ean13;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- 4. Trigger en INSERT (no en UPDATE para no sobreescribir códigos editados manualmente)
DROP TRIGGER IF EXISTS trg_generar_codigo_interno ON productos;
CREATE TRIGGER trg_generar_codigo_interno
    BEFORE INSERT ON productos
    FOR EACH ROW
    EXECUTE FUNCTION fn_generar_codigo_interno();

-- 5. Permisos
GRANT USAGE, SELECT ON SEQUENCE seq_codigo_interno_producto TO authenticated;
GRANT EXECUTE ON FUNCTION fn_ean13_check_digit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_generar_codigo_interno() TO authenticated;

-- 6. Recargar schema de PostgREST
NOTIFY pgrst, 'reload schema';
-- ==========================================
-- TRIGGER: fn_generar_codigo_interno_presentacion
-- ==========================================
-- Genera un código de barras interno EAN-13 para presentaciones
-- que se insertan sin código de barras.
--
-- Reutiliza:
--   - fn_ean13_check_digit()       → ya existe (fn_generar_codigo_interno.sql)
--   - seq_codigo_interno_producto  → ya existe, comparte secuencia con productos
--
-- Prefijo 21 (distinto al 20 de productos) para evitar colisiones.
-- Ambos prefijos son válidos dentro del rango GS1 reservado para uso interno (20-29).
--
-- Ejecutar: una sola vez en Supabase SQL Editor, después de fn_generar_codigo_interno.sql.
-- ==========================================

CREATE OR REPLACE FUNCTION fn_generar_codigo_interno_presentacion()
RETURNS TRIGGER AS $$
DECLARE
    v_seq   BIGINT;
    v_base  TEXT;
    v_ean13 TEXT;
BEGIN
    IF NEW.codigo_barras IS NULL OR TRIM(NEW.codigo_barras) = '' THEN
        v_seq := nextval('seq_codigo_interno_producto');

        IF v_seq > 9999999999 THEN
            RAISE EXCEPTION 'Secuencia de códigos internos agotada (máx 9999999999)';
        END IF;

        v_base  := '21' || LPAD(v_seq::TEXT, 10, '0');
        v_ean13 := fn_ean13_check_digit(v_base);
        NEW.codigo_barras := v_ean13;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Trigger en INSERT (no en UPDATE para no sobreescribir códigos editados manualmente)
DROP TRIGGER IF EXISTS trg_generar_codigo_interno_presentacion ON producto_presentaciones;
CREATE TRIGGER trg_generar_codigo_interno_presentacion
    BEFORE INSERT ON producto_presentaciones
    FOR EACH ROW
    EXECUTE FUNCTION fn_generar_codigo_interno_presentacion();

-- Permisos
GRANT EXECUTE ON FUNCTION fn_generar_codigo_interno_presentacion() TO authenticated;

-- Recargar schema de PostgREST
NOTIFY pgrst, 'reload schema';
-- ==========================================
-- fn_crear_producto_simple
-- Crea un producto simple (sin variantes) con sus presentaciones opcionales.
-- Toda la operacion es atomica: si algo falla, no se persiste nada.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_crear_producto_simple CASCADE;

CREATE OR REPLACE FUNCTION public.fn_crear_producto_simple(
    p_nombre            TEXT,
    p_categoria_id      UUID,
    p_tiene_iva         BOOLEAN,
    p_tipo_venta        TEXT,
    p_unidad_medida     TEXT,
    p_codigo_barras     TEXT DEFAULT NULL,
    p_imagen_url        TEXT DEFAULT NULL,
    p_precio_costo      NUMERIC DEFAULT 0,
    p_precio_venta      NUMERIC DEFAULT 0,
    p_stock_actual      NUMERIC DEFAULT 0,
    p_stock_minimo      INTEGER DEFAULT 5,
    -- Presentaciones: [{ nombre, factor_conversion, precio_venta, precio_costo, codigo_barras? }]
    p_presentaciones    JSON DEFAULT '[]'::JSON
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id     UUID;
    v_producto_id    UUID;
    v_pres           JSON;
    v_presentaciones JSON;
BEGIN
    -- Obtener negocio del JWT
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;
    -- Normalizar presentaciones: asegurar que sea un JSON array
    -- Supabase puede enviar el parametro como text, como JSON escalar o como array
    BEGIN
        v_presentaciones := p_presentaciones::TEXT::JSON;
        -- Si no es un array, reemplazar por array vacio
        IF json_typeof(v_presentaciones) <> 'array' THEN
            v_presentaciones := '[]'::JSON;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_presentaciones := '[]'::JSON;
    END;

    -- Validaciones
    IF TRIM(COALESCE(p_nombre, '')) = '' THEN
        RAISE EXCEPTION 'El nombre del producto es obligatorio';
    END IF;

    IF p_precio_venta <= 0 THEN
        RAISE EXCEPTION 'El precio de venta debe ser mayor a 0';
    END IF;

    -- Crear producto (gen_random_uuid() evita RETURNING INTO — bug Supabase)
    v_producto_id := gen_random_uuid();
    INSERT INTO productos (
        id, negocio_id, nombre, categoria_id, tiene_iva, tipo_venta, unidad_medida,
        codigo_barras, imagen_url,
        precio_costo, precio_venta, stock_actual, stock_minimo,
        activo
    ) VALUES (
        v_producto_id, v_negocio_id,
        UPPER(TRIM(p_nombre)), p_categoria_id, p_tiene_iva, p_tipo_venta, p_unidad_medida,
        NULLIF(TRIM(COALESCE(p_codigo_barras, '')), ''), p_imagen_url,
        p_precio_costo, p_precio_venta, p_stock_actual, p_stock_minimo,
        TRUE
    );

    -- Presentaciones (opcional)
    IF json_array_length(v_presentaciones) > 0 THEN
        FOR v_pres IN
            SELECT value FROM json_array_elements(v_presentaciones)
        LOOP
            INSERT INTO producto_presentaciones (
                negocio_id, producto_id, nombre, factor_conversion,
                precio_venta, precio_costo, codigo_barras, activo
            ) VALUES (
                v_negocio_id, v_producto_id,
                UPPER(TRIM(v_pres->>'nombre')),
                (v_pres->>'factor_conversion')::INTEGER,
                (v_pres->>'precio_venta')::NUMERIC,
                (v_pres->>'precio_costo')::NUMERIC,
                NULLIF(TRIM(COALESCE(v_pres->>'codigo_barras', '')), ''),
                TRUE
            );
        END LOOP;
    END IF;

    RETURN json_build_object(
        'ok', TRUE,
        'producto_id', v_producto_id
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al crear producto simple: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_crear_producto_simple FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_producto_simple TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- fn_crear_producto_con_variantes
-- Crea un producto con variantes: template + atributos + SKUs + presentaciones por SKU.
-- Toda la operacion es atomica: si algo falla, no se persiste nada.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_crear_producto_con_variantes CASCADE;

CREATE OR REPLACE FUNCTION public.fn_crear_producto_con_variantes(
    -- Datos del template
    p_nombre            TEXT,
    p_categoria_id      UUID,
    p_tiene_iva         BOOLEAN,   -- aplica a los SKUs; el template ya no tiene este campo
    p_tipo_venta        TEXT,
    p_unidad_medida     TEXT,
    p_imagen_url        TEXT DEFAULT NULL,

    -- Definicion de atributos del template:
    -- [{ atributo_nombre, opcion_ids: [uuid] }]
    p_atributos_template JSON DEFAULT '[]'::JSON,

    -- Variantes (SKUs):
    -- [{ nombre, precio_costo, precio_venta, stock_actual, stock_minimo, opcion_ids: [uuid], presentaciones?: [...] }]
    p_variantes         JSON DEFAULT '[]'::JSON
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id        UUID;
    v_template_id       UUID;
    v_producto_id       UUID;
    v_atributo_nombre   TEXT;
    v_atributo_id       UUID;
    v_opcion_id         UUID;
    v_ta_id             UUID;
    v_variante          JSON;
    v_atributo_entry    JSON;
    v_opcion_id_val     TEXT;
    v_pres              JSON;
    v_skus_creados      INTEGER := 0;
    -- Variables JSON casteadas
    v_variantes         JSON;
    v_atributos_tmpl    JSON;
BEGIN
    -- Obtener negocio del JWT
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;
    -- Normalizar JSON: asegurar que sean arrays
    -- Supabase puede enviar los parametros como text, como JSON escalar o como array
    BEGIN
        v_variantes := p_variantes::TEXT::JSON;
        IF json_typeof(v_variantes) <> 'array' THEN
            v_variantes := '[]'::JSON;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_variantes := '[]'::JSON;
    END;

    BEGIN
        v_atributos_tmpl := p_atributos_template::TEXT::JSON;
        IF json_typeof(v_atributos_tmpl) <> 'array' THEN
            v_atributos_tmpl := '[]'::JSON;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_atributos_tmpl := '[]'::JSON;
    END;

    -- Validaciones
    IF TRIM(COALESCE(p_nombre, '')) = '' THEN
        RAISE EXCEPTION 'El nombre del producto es obligatorio';
    END IF;

    IF json_array_length(v_variantes) = 0 THEN
        RAISE EXCEPTION 'Debe incluir al menos una variante. Para producto simple usar fn_crear_producto_simple.';
    END IF;

    IF json_array_length(v_atributos_tmpl) = 0 THEN
        RAISE EXCEPTION 'Debe incluir al menos un tipo de atributo para el template.';
    END IF;

    -- 1. Crear template (gen_random_uuid() evita RETURNING INTO — bug Supabase)
    -- sin tiene_iva — la fuente de verdad es cada SKU en productos
    v_template_id := gen_random_uuid();
    INSERT INTO producto_templates (
        id, negocio_id, nombre, categoria_id, tipo_venta, unidad_medida, imagen_url, activo
    ) VALUES (
        v_template_id, v_negocio_id,
        UPPER(TRIM(p_nombre)), p_categoria_id, p_tipo_venta, p_unidad_medida, p_imagen_url, TRUE
    );

    -- 2. Procesar atributos del template
    FOR v_atributo_entry IN
        SELECT value FROM json_array_elements(v_atributos_tmpl)
    LOOP
        v_atributo_nombre := UPPER(TRIM(v_atributo_entry->>'atributo_nombre'));

        -- Buscar o crear el atributo (por negocio — gen_random_uuid() evita RETURNING INTO)
        v_atributo_id := (SELECT id FROM atributos WHERE nombre = v_atributo_nombre AND negocio_id = v_negocio_id);
        IF v_atributo_id IS NULL THEN
            v_atributo_id := gen_random_uuid();
            INSERT INTO atributos (id, negocio_id, nombre)
            VALUES (v_atributo_id, v_negocio_id, v_atributo_nombre);
        END IF;

        -- Crear template_atributo (gen_random_uuid() evita RETURNING INTO)
        v_ta_id := gen_random_uuid();
        INSERT INTO template_atributos (id, template_id, atributo_id)
        VALUES (v_ta_id, v_template_id, v_atributo_id)
        ON CONFLICT (template_id, atributo_id) DO NOTHING;
        -- Leer el id real (puede ser el generado o el pre-existente)
        v_ta_id := (SELECT id FROM template_atributos WHERE template_id = v_template_id AND atributo_id = v_atributo_id);

        -- Vincular opciones al template_atributo
        FOR v_opcion_id_val IN
            SELECT value::text FROM json_array_elements_text(v_atributo_entry->'opcion_ids')
        LOOP
            v_opcion_id := v_opcion_id_val::UUID;
            INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
            VALUES (v_ta_id, v_opcion_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- 3. Crear SKUs (gen_random_uuid() evita RETURNING INTO — bug Supabase)
    FOR v_variante IN
        SELECT value FROM json_array_elements(v_variantes)
    LOOP
        v_producto_id := gen_random_uuid();
        INSERT INTO productos (
            id, negocio_id, producto_template_id,
            tiene_iva,
            nombre, precio_costo, precio_venta, stock_actual, stock_minimo,
            codigo_barras, activo
        ) VALUES (
            v_producto_id, v_negocio_id, v_template_id,
            p_tiene_iva,
            UPPER(TRIM(v_variante->>'nombre')),
            (v_variante->>'precio_costo')::NUMERIC,
            (v_variante->>'precio_venta')::NUMERIC,
            COALESCE((v_variante->>'stock_actual')::NUMERIC, 0),
            COALESCE((v_variante->>'stock_minimo')::INTEGER, 5),
            NULLIF(TRIM(COALESCE(v_variante->>'codigo_barras', '')), ''),
            TRUE
        );
        -- Nota: categoria_id, tipo_venta, unidad_medida son NULL en variantes
        -- (el trigger fn_limpiar_herencia_template los limpia al INSERT si se pasan)
        -- La fuente de verdad de esos campos es el template.

        -- Vincular atributos al SKU (producto_atributos)
        IF v_variante->'opcion_ids' IS NOT NULL AND json_array_length(v_variante->'opcion_ids') > 0 THEN
            FOR v_opcion_id_val IN
                SELECT value::text FROM json_array_elements_text(v_variante->'opcion_ids')
            LOOP
                v_opcion_id := v_opcion_id_val::UUID;
                INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
                VALUES (v_producto_id, v_opcion_id)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;

        -- Presentaciones del SKU (si las tiene)
        IF v_variante->'presentaciones' IS NOT NULL AND json_array_length(v_variante->'presentaciones') > 0 THEN
            FOR v_pres IN
                SELECT value FROM json_array_elements(v_variante->'presentaciones')
            LOOP
                INSERT INTO producto_presentaciones (
                    negocio_id, producto_id, nombre, factor_conversion,
                    precio_venta, precio_costo, codigo_barras, activo
                ) VALUES (
                    v_negocio_id, v_producto_id,
                    UPPER(TRIM(v_pres->>'nombre')),
                    (v_pres->>'factor_conversion')::INTEGER,
                    (v_pres->>'precio_venta')::NUMERIC,
                    (v_pres->>'precio_costo')::NUMERIC,
                    NULLIF(TRIM(COALESCE(v_pres->>'codigo_barras', '')), ''),
                    TRUE
                );
            END LOOP;
        END IF;

        v_skus_creados := v_skus_creados + 1;
    END LOOP;

    RETURN json_build_object(
        'ok', TRUE,
        'template_id', v_template_id,
        'skus_creados', v_skus_creados
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al crear producto con variantes: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_crear_producto_con_variantes FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_producto_con_variantes TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- FUNCIÓN: fn_ajustar_stock_inventario (v1.0)
-- ==========================================
-- Ajusta el stock de un producto manualmente y registra el movimiento
-- en kardex_inventario (auditoría). Usado desde la página de Kárdex.
--
-- Tipos de movimiento válidos:
--   COMPRA          → (+) Entrada por compra de mercadería
--   AJUSTE_POSITIVO → (+) Corrección manual a favor (inventario físico)
--   AJUSTE_NEGATIVO → (-) Corrección manual en contra (merma, daño, pérdida)
--
-- Llamada desde: InventarioService.ajustarStock()
-- Parámetros:
--   p_producto_id     — UUID del producto a ajustar (debe ser producto base, no empaque)
--   p_tipo_movimiento — 'COMPRA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO'
--   p_cantidad        — Cantidad a sumar o restar (siempre positiva)
--   p_observaciones   — Motivo del ajuste (obligatorio)
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_ajustar_stock_inventario(
    p_producto_id     UUID,
    p_tipo_movimiento TEXT,
    p_cantidad        DECIMAL(12,2),
    p_observaciones   TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id     UUID;
    v_stock_anterior DECIMAL(12,2);
    v_stock_nuevo    DECIMAL(12,2);
    v_delta          DECIMAL(12,2);
BEGIN

    -- 1. Validaciones básicas
    IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
    END IF;

    IF p_observaciones IS NULL OR TRIM(p_observaciones) = '' THEN
        RAISE EXCEPTION 'Las observaciones son obligatorias';
    END IF;

    IF p_tipo_movimiento NOT IN ('COMPRA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO') THEN
        RAISE EXCEPTION 'Tipo de movimiento inválido: %. Use COMPRA, AJUSTE_POSITIVO o AJUSTE_NEGATIVO', p_tipo_movimiento;
    END IF;

    -- 2. Leer stock actual y negocio_id; bloquear la fila (FOR UPDATE evita race conditions)
    -- ⚠️  Supabase no soporta SELECT ... INTO — usar := (SELECT ...)
    PERFORM id FROM productos WHERE id = p_producto_id FOR UPDATE;

    v_negocio_id     := (SELECT negocio_id   FROM productos WHERE id = p_producto_id);
    v_stock_anterior := (SELECT stock_actual FROM productos WHERE id = p_producto_id);

    IF v_stock_anterior IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
    END IF;

    -- 3. Calcular delta según tipo
    IF p_tipo_movimiento = 'AJUSTE_NEGATIVO' THEN
        v_delta = -p_cantidad;
    ELSE
        v_delta = p_cantidad;
    END IF;

    v_stock_nuevo := v_stock_anterior + v_delta;

    IF v_stock_nuevo < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Stock actual: %, ajuste solicitado: -%', v_stock_anterior, p_cantidad;
    END IF;

    -- 4. Actualizar stock
    UPDATE productos
    SET    stock_actual = v_stock_nuevo
    WHERE  id = p_producto_id;

    -- 5. Registrar en kardex
    INSERT INTO kardex_inventario (
        negocio_id,
        producto_id,
        tipo_movimiento,
        cantidad,
        stock_anterior,
        stock_nuevo,
        observaciones
    ) VALUES (
        v_negocio_id,
        p_producto_id,
        p_tipo_movimiento,
        p_cantidad,
        v_stock_anterior,
        v_stock_nuevo,
        TRIM(p_observaciones)
    );

    -- 6. Retornar el stock resultante
    RETURN json_build_object(
        'success',       true,
        'stock_nuevo',   v_stock_nuevo,
        'stock_anterior', v_stock_anterior,
        'delta',         v_delta
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al ajustar stock: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_ajustar_stock_inventario(UUID, TEXT, DECIMAL, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_ajustar_stock_inventario(UUID, TEXT, DECIMAL, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_ajustar_stock_inventario IS
    'v1.0 — Ajuste manual de stock desde el Kárdex. '
    'Tipos: COMPRA (+), AJUSTE_POSITIVO (+), AJUSTE_NEGATIVO (-). '
    'Valida stock suficiente antes de restar. '
    'Registra movimiento en kardex_inventario. '
    'Usa FOR UPDATE para evitar race conditions en concurrencia.';
-- ==========================================
-- DROP — la firma cambia (p_empleado_id INTEGER → UUID, multi-tenant):
-- ejecutar UNA VEZ antes del CREATE
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);

-- ==========================================
-- FUNCIÓN: fn_registrar_venta_pos (v2.0 — multi-tenant UUID)
-- ==========================================
-- Procesa una venta del POS en una transacción atómica.
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- CAMBIOS v2.0 (schema v11 multi-tenant):
--   - p_empleado_id: INTEGER → UUID
--   - v_negocio_id UUID: leído de public.get_negocio_id() (JWT)
--   - secuencias_comprobantes: todas las queries filtran por negocio_id
--   - ventas INSERT incluye negocio_id
--   - DROP/GRANT usan firma UUID
--
-- HEREDA DE v1.9:
--   - Idempotencia (p_idempotency_key)
--   - Snapshot de precio_costo (presentacion o producto base)
--   - Descuentos (monto + porcentaje)
--   - Triggers automáticos: stock (kardex) + CAJA_CHICA (efectivo)
--
-- v1.9 — Fix precio_costo snapshot: si hay presentacion_id lee precio_costo de
--   producto_presentaciones (costo real del paquete); si es venta directa lee de
--   productos (costo unitario base).
--
-- v1.4 — Idempotencia: acepta p_idempotency_key UUID.
--   Si la clave ya existe en ventas, retorna la venta existente
--   en lugar de crear un duplicado (protege contra reintentos por
--   red inestable o doble-tap).
--
-- Flujo interno:
--   1. Si p_idempotency_key ya existe → retorna venta existente (sin efectos secundarios)
--   2. Obtiene el siguiente numero_comprobante de secuencias_comprobantes
--      usando UPDATE ... RETURNING atómico (filtrado por negocio_id)
--   3. Inserta encabezado en `ventas` con negocio_id y todos los campos fiscales
--   4. Inserta ítems en `ventas_detalles`
--   5. El Trigger `trg_descontar_stock_venta` descuenta el stock automáticamente
--   6. El Trigger `trg_actualizar_caja_por_venta` sube el saldo de CAJA_CHICA si es EFECTIVO
--
-- Prerequisito: ejecutar primero secuencias_comprobantes.sql
--
-- Llamada desde: PosService.procesarVenta()
-- Parámetros:
--   p_turno_id          — UUID del turno activo (NOT NULL en ventas)
--   p_empleado_id       — UUID del cajero
--   p_cliente_id        — UUID del cliente (NULL = Consumidor Final)
--   p_tipo_comprobante  — 'TICKET' | 'NOTA_VENTA' | 'FACTURA'
--   p_total             — Monto total cobrado al cliente (incluye IVA si aplica)
--   p_subtotal          — Base neta sin IVA (= total en TICKET/NOTA_VENTA, = base0+base15 en FACTURA)
--   p_descuento         — Monto de descuento aplicado (0 si no aplica o si es FIADO)
--   p_descuento_pct     — Porcentaje de descuento aplicado (0 si no aplica o si es FIADO)
--   p_base_iva_0        — Base gravada 0% (solo FACTURA, sino 0)
--   p_base_iva_15       — Base gravada 15% antes de IVA (solo FACTURA, sino 0)
--   p_iva_valor         — Valor del IVA 15% extraído (solo FACTURA, sino 0)
--   p_metodo_pago       — 'EFECTIVO' | 'DEUNA' | 'TRANSFERENCIA' | 'FIADO'
--   p_items             — JSONB array: [{producto_id, cantidad, precio_unitario, subtotal}]
--   p_idempotency_key   — UUID generado por el cliente antes del RPC (protección contra duplicados)
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_registrar_venta_pos(
  p_turno_id         UUID,
  p_empleado_id      UUID,
  p_cliente_id       UUID             DEFAULT NULL,
  p_tipo_comprobante TEXT             DEFAULT 'TICKET',
  p_total            DECIMAL(12,2)    DEFAULT 0,
  p_subtotal         DECIMAL(12,2)    DEFAULT 0,
  p_descuento        DECIMAL(12,2)    DEFAULT 0,
  p_descuento_pct    SMALLINT         DEFAULT 0,
  p_base_iva_0       DECIMAL(12,2)    DEFAULT 0,
  p_base_iva_15      DECIMAL(12,2)    DEFAULT 0,
  p_iva_valor        DECIMAL(12,2)    DEFAULT 0,
  p_metodo_pago      TEXT             DEFAULT 'EFECTIVO',
  p_items            JSONB            DEFAULT '[]',
  p_idempotency_key  UUID             DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id         UUID;
  v_venta_id           UUID;
  v_item               JSONB;
  v_numero_comprobante INTEGER;
  v_existing_id        UUID;
  v_existing_numero    INTEGER;
  v_precio_costo       DECIMAL(12,2);
BEGIN
  -- Obtener negocio del JWT
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- 0. Idempotencia: si la clave ya existe, retornar la venta previa sin tocar nada.
  --    Esto protege contra reintentos cuando la red falla después de que la BD ya procesó.
  IF p_idempotency_key IS NOT NULL THEN
    v_existing_id     := (SELECT id                 FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);
    v_existing_numero := (SELECT numero_comprobante  FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);

    IF v_existing_id IS NOT NULL THEN
      RETURN json_build_object(
        'success',            true,
        'venta_id',           v_existing_id,
        'numero_comprobante', v_existing_numero,
        'duplicado',          true
      );
    END IF;
  END IF;

  -- 1. Obtener el siguiente número de comprobante de forma atómica.
  --    UPDATE bloquea solo la fila del tipo correspondiente → cero colisiones bajo concurrencia.
  --    Filtra por negocio_id para que cada tenant tenga su propia secuencia.
  UPDATE secuencias_comprobantes
  SET    ultimo_valor = ultimo_valor + 1
  WHERE  tipo_documento = p_tipo_comprobante
    AND  negocio_id = v_negocio_id;

  v_numero_comprobante := (SELECT ultimo_valor FROM secuencias_comprobantes WHERE tipo_documento = p_tipo_comprobante AND negocio_id = v_negocio_id);

  -- Si el tipo no existe en la tabla, abortar con mensaje claro
  IF v_numero_comprobante IS NULL THEN
    RAISE EXCEPTION 'Tipo de comprobante no registrado en secuencias_comprobantes: %', p_tipo_comprobante;
  END IF;

  -- 2. Insertar la Venta maestra con todos los campos fiscales + numero_comprobante
  BEGIN
    v_venta_id := gen_random_uuid();
    INSERT INTO ventas (
      id,
      negocio_id,
      turno_id,
      cliente_id,
      empleado_id,
      tipo_comprobante,
      numero_comprobante,
      subtotal,
      descuento,
      descuento_pct,
      total,
      base_iva_0,
      base_iva_15,
      iva_valor,
      metodo_pago,
      estado,
      estado_pago,
      idempotency_key
    ) VALUES (
      v_venta_id,
      v_negocio_id,
      p_turno_id,
      p_cliente_id,
      p_empleado_id,
      p_tipo_comprobante::tipo_comprobante_enum,
      v_numero_comprobante,
      p_subtotal,
      p_descuento,
      p_descuento_pct,
      p_total,
      p_base_iva_0,
      p_base_iva_15,
      p_iva_valor,
      p_metodo_pago,
      'COMPLETADA',
      CASE WHEN p_metodo_pago = 'FIADO' THEN 'PENDIENTE' ELSE 'NO_APLICA' END,
      p_idempotency_key
    );
  EXCEPTION WHEN unique_violation THEN
    -- Race condition: otro request con la misma idempotency_key ganó entre el SELECT y el INSERT.
    -- Retornar la venta que ya se insertó.
    v_existing_id     := (SELECT id                FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);
    v_existing_numero := (SELECT numero_comprobante FROM ventas WHERE idempotency_key = p_idempotency_key AND negocio_id = v_negocio_id);

    RETURN json_build_object(
      'success',            true,
      'venta_id',           v_existing_id,
      'numero_comprobante', v_existing_numero,
      'duplicado',          true
    );
  END;

  -- 3. Insertar los detalles (líneas de ítems)
  --    El trigger trg_descontar_stock_venta se ejecuta automáticamente
  --    por cada INSERT en ventas_detalles → descuenta stock + graba kardex
  --    precio_costo: si hay presentacion_id → costo de la presentacion (precio_costo del paquete)
  --                  si venta directa        → costo del producto base
  --    Garantiza snapshot histórico inmutable y costo correcto según la forma de venta.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'presentacion_id') IS NOT NULL THEN
      v_precio_costo := (SELECT precio_costo FROM producto_presentaciones WHERE id = (v_item->>'presentacion_id')::UUID);
    ELSE
      v_precio_costo := (SELECT precio_costo FROM productos WHERE id = (v_item->>'producto_id')::UUID);
    END IF;

    INSERT INTO ventas_detalles (
      venta_id,
      producto_id,
      cantidad,
      precio_unitario,
      precio_costo,
      subtotal,
      presentacion_id
    ) VALUES (
      v_venta_id,
      (v_item->>'producto_id')::UUID,
      (v_item->>'cantidad')::DECIMAL,
      (v_item->>'precio_unitario')::DECIMAL,
      COALESCE(v_precio_costo, 0),
      (v_item->>'subtotal')::DECIMAL,
      (v_item->>'presentacion_id')::UUID
    );
  END LOOP;

  -- 4. Retornar resultado exitoso con numero_comprobante para mostrar/imprimir
  RETURN json_build_object(
    'success',            true,
    'venta_id',           v_venta_id,
    'numero_comprobante', v_numero_comprobante
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar venta POS: %', SQLERRM;
END;
$$;

-- Permisos (firma v2.0 — p_empleado_id UUID)
REVOKE EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_venta_pos IS
  'v2.0 (multi-tenant UUID) — Registra venta completa del POS en transacción atómica. '
  'p_empleado_id UUID (era INTEGER en v1.x). Negocio leído del JWT; secuencias y ventas filtran por negocio_id. '
  'v1.9 — Fix precio_costo snapshot: venta por presentacion usa producto_presentaciones.precio_costo '
  '(costo del paquete); venta directa usa productos.precio_costo (costo unitario). '
  'v1.4 — Idempotencia: p_idempotency_key UUID para evitar duplicados por reintento. '
  'Triggers automáticos: descuento de stock (kardex) y actualización de CAJA_CHICA.';
-- ==========================================
-- FUNCIÓN: fn_anular_venta (v1.3)
-- ==========================================
-- Anula una venta completada revirtiendo TODOS sus efectos:
--   1. Repone stock de cada producto vendido (con factor_conversion si fue via presentacion)
--   2. Registra movimiento ANULACION_VENTA en kardex_inventario
--   3. Revierte saldo de caja (solo si fue EFECTIVO):
--      - Turno aún abierto → revierte de CAJA_CHICA (donde el trigger original ingresó)
--      - Turno ya cerrado  → revierte de CAJA (bóveda, donde el cierre depositó el dinero)
--   4. Elimina registros de cuentas_cobrar (solo si fue FIADO)
--   5. Marca la venta como estado='ANULADA'
--
-- v1.3 — Fix: revierte EFECTIVO de la caja correcta según estado del turno.
--   Antes siempre revertía de CAJA (bóveda), pero el trigger fn_actualizar_saldo_caja_venta
--   ingresa a CAJA_CHICA. Si el turno sigue abierto, el dinero aún está en CAJA_CHICA.
--
-- v1.2 — Fix: usa factor_conversion de la presentacion al reponer stock.
--   Antes reponia v_detalle.cantidad (raw) en vez de cantidad * factor.
--   Si vendiste 2 cajetillas x20, el trigger desconto 40 pero la anulacion reponia 2.
--
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- Quién puede anular: ADMIN y EMPLEADO (sin restricción de rol).
-- La validación de rol se hace en el frontend si se necesita en el futuro.
--
-- Llamada desde: VentasService.anularVenta()
-- Parámetros:
--   p_venta_id    — UUID de la venta a anular
--   p_empleado_id — ID del empleado que anula (auditoría)
--   p_motivo      — Razón de la anulación (obligatorio)
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_anular_venta(
    p_venta_id    UUID,
    p_empleado_id UUID,
    p_motivo      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id         UUID;
    v_detalle            RECORD;
    -- campos de ventas
    v_venta_id_check     UUID;
    v_venta_estado       TEXT;
    v_venta_metodo_pago  TEXT;
    v_venta_total        DECIMAL(12,2);
    v_venta_numero       INTEGER;
    v_venta_turno_id     UUID;
    -- resto de variables
    v_stock_actual       DECIMAL(12,2);
    v_cantidad_real      DECIMAL(12,2);
    v_caja_id            UUID;
    v_saldo_actual_caja  DECIMAL(12,2);
    v_categoria_id       UUID;
    v_tipo_referencia_id INTEGER;
    v_turno_abierto      BOOLEAN;
BEGIN
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- ══════════════════════════════════════
    -- 0. Validaciones
    -- ══════════════════════════════════════
    IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo de anulación es obligatorio';
    END IF;

    v_venta_id_check    := (SELECT id                FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);
    v_venta_estado      := (SELECT estado             FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);
    v_venta_metodo_pago := (SELECT metodo_pago        FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);
    v_venta_total       := (SELECT total              FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);
    v_venta_numero      := (SELECT numero_comprobante FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);
    v_venta_turno_id    := (SELECT turno_id           FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);

    IF v_venta_id_check IS NULL THEN
        RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
    END IF;

    IF v_venta_estado = 'ANULADA' THEN
        RAISE EXCEPTION 'La venta #% ya fue anulada', v_venta_numero;
    END IF;

    -- Bloquear si es FIADO con abonos parciales.
    -- Si el cliente ya pagó algo, hay una transacción de dinero real que no se puede
    -- revertir automáticamente. Debe resolverse manualmente fuera del sistema.
    IF v_venta_metodo_pago = 'FIADO' THEN
        IF EXISTS (SELECT 1 FROM cuentas_cobrar WHERE venta_id = p_venta_id LIMIT 1) THEN
            RAISE EXCEPTION 'No se puede anular la venta #%: ya tiene abonos registrados. Resuelve los pagos parciales primero.', v_venta_numero;
        END IF;
    END IF;

    -- ══════════════════════════════════════
    -- 1. Reponer stock + registrar kardex
    --    JOIN a producto_presentaciones para obtener factor_conversion.
    --    Si presentacion_id es NULL (venta directa), factor = 1.
    --    cantidad_real = cantidad_vendida * factor (misma logica que el trigger de venta).
    -- ══════════════════════════════════════
    FOR v_detalle IN
        SELECT vd.producto_id,
               vd.cantidad,
               vd.presentacion_id,
               COALESCE(pp.factor_conversion, 1) AS factor
        FROM   ventas_detalles vd
        LEFT JOIN producto_presentaciones pp ON pp.id = vd.presentacion_id
        WHERE  vd.venta_id = p_venta_id
    LOOP
        v_cantidad_real := v_detalle.cantidad * v_detalle.factor;

        v_stock_actual := (SELECT stock_actual FROM productos WHERE id = v_detalle.producto_id);

        UPDATE productos
        SET    stock_actual = stock_actual + v_cantidad_real
        WHERE  id = v_detalle.producto_id;

        INSERT INTO kardex_inventario (
            producto_id, tipo_movimiento, cantidad,
            stock_anterior, stock_nuevo,
            referencia_id, presentacion_id, observaciones
        ) VALUES (
            v_detalle.producto_id,
            'ANULACION_VENTA',
            v_cantidad_real,
            v_stock_actual,
            v_stock_actual + v_cantidad_real,
            p_venta_id,
            v_detalle.presentacion_id,
            'Anulación Venta POS #' || v_venta_numero || ': ' || TRIM(p_motivo)
        );
    END LOOP;

    -- ══════════════════════════════════════
    -- 2. Revertir saldo de caja (solo EFECTIVO)
    --
    -- El trigger fn_actualizar_saldo_caja_venta ingresa ventas EFECTIVO a CAJA_CHICA.
    -- Al cierre, fn_ejecutar_cierre_diario mueve ese dinero a CAJA (bóveda).
    -- Por eso: si el turno de la venta aún está abierto → revertir de CAJA_CHICA.
    --          si el turno ya cerró                     → revertir de CAJA.
    -- ══════════════════════════════════════
    IF v_venta_metodo_pago = 'EFECTIVO' THEN

        -- ¿El turno de la venta sigue abierto?
        v_turno_abierto := (SELECT hora_fecha_cierre IS NULL FROM turnos_caja WHERE id = v_venta_turno_id);

        IF v_turno_abierto THEN
            v_caja_id           := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
            v_saldo_actual_caja := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
        ELSE
            v_caja_id           := (SELECT id FROM cajas WHERE codigo = 'CAJA' AND negocio_id = v_negocio_id);
            v_saldo_actual_caja := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA' AND negocio_id = v_negocio_id);
        END IF;

        -- Categoría EGRESO genérica para anulaciones (buscar por negocio)
        v_categoria_id := (
            SELECT id FROM categorias_operaciones
            WHERE tipo = 'EGRESO' AND negocio_id = v_negocio_id
            LIMIT 1
        );

        v_tipo_referencia_id := (SELECT id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1);

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            INSERT INTO operaciones_cajas (
                negocio_id, caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id, descripcion
            ) VALUES (
                v_negocio_id,
                v_caja_id,
                p_empleado_id,
                'EGRESO',
                v_venta_total,
                v_saldo_actual_caja,
                v_saldo_actual_caja - v_venta_total,
                v_categoria_id,
                v_tipo_referencia_id,
                p_venta_id,
                'Anulación Venta POS #' || v_venta_numero
            );

            UPDATE cajas
            SET    saldo_actual = saldo_actual - v_venta_total
            WHERE  id = v_caja_id AND negocio_id = v_negocio_id;
        END IF;
    END IF;

    -- ══════════════════════════════════════
    -- 3. Anular cuenta por cobrar (solo FIADO)
    -- ══════════════════════════════════════
    IF v_venta_metodo_pago = 'FIADO' THEN
        DELETE FROM cuentas_cobrar
        WHERE  venta_id = p_venta_id;
    END IF;

    -- ══════════════════════════════════════
    -- 4. Marcar la venta como ANULADA
    -- ══════════════════════════════════════
    UPDATE ventas
    SET    estado      = 'ANULADA',
           estado_pago = 'NO_APLICA',
           observaciones = CASE
               WHEN observaciones IS NOT NULL AND observaciones <> ''
               THEN observaciones || ' | ANULADA: ' || TRIM(p_motivo)
               ELSE 'ANULADA: ' || TRIM(p_motivo)
           END
    WHERE  id = p_venta_id;

    -- ══════════════════════════════════════
    -- 5. Resultado
    -- ══════════════════════════════════════
    RETURN json_build_object(
        'success',            true,
        'venta_id',           p_venta_id,
        'numero_comprobante', v_venta_numero,
        'monto_revertido',    v_venta_total
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al anular venta: %', SQLERRM;
END;
$$;

-- Drop firma antigua (INTEGER → UUID)
DROP FUNCTION IF EXISTS public.fn_anular_venta(UUID, INTEGER, TEXT);

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_anular_venta(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_anular_venta(UUID, UUID, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_anular_venta IS
    'v1.3 — Fix: revierte EFECTIVO de la caja correcta según estado del turno. '
    'Turno abierto → CAJA_CHICA (donde el trigger original ingresó el dinero). '
    'Turno cerrado → CAJA (bóveda, donde el cierre depositó el dinero). '
    'v1.2 — Fix: usa factor_conversion al reponer stock (JOIN a producto_presentaciones). '
    'Antes reponia cantidad raw sin multiplicar por el factor de la presentacion. '
    'v1.1 — Anula una venta completada revirtiendo stock (kardex ANULACION_VENTA), '
    'saldo de caja (EGRESO si fue EFECTIVO), y cuentas por cobrar (DELETE si fue FIADO sin abonos). '
    'Bloquea si es FIADO con abonos parciales. Ambos roles pueden anular. Motivo obligatorio.';
-- ==========================================
-- FUNCIÓN: fn_registrar_recarga_proveedor_celular
-- VERSIÓN: 2.0
-- FECHA: 2026-02-24
-- ==========================================
-- Registra la deuda con el proveedor CELULAR cuando este carga saldo virtual.
-- NO mueve dinero de cajas ni valida saldo — solo crea la deuda (pagado=false).
-- El pago se realiza más adelante con registrar_pago_proveedor_celular.
--
-- Retorna JSON con todos los datos para actualizar la UI sin queries adicionales:
--   - success, recarga_id, monto_virtual, monto_a_pagar, ganancia
--   - saldo_virtual_celular (calculado: último_cierre + SUM post-cierre)
--   - deudas_pendientes: { cantidad, total, lista }
--
-- Parámetros:
--   p_fecha          DATE     Fecha del negocio
--   p_empleado_id    INT      Empleado que registra
--   p_monto_virtual  NUMERIC  Monto virtual cargado por el proveedor (ej: 210.53)
-- ==========================================

-- Drop firma antigua (INTEGER → UUID)
DROP FUNCTION IF EXISTS fn_registrar_recarga_proveedor_celular(DATE, INTEGER, NUMERIC);

CREATE OR REPLACE FUNCTION fn_registrar_recarga_proveedor_celular(
  p_fecha         DATE,
  p_empleado_id   UUID,
  p_monto_virtual NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id                UUID;

  -- IDs de servicios
  v_tipo_celular_id           INTEGER;
  v_comision_pct              NUMERIC;

  -- Cálculos
  v_monto_a_pagar             NUMERIC;
  v_ganancia                  NUMERIC;

  -- ID generado
  v_recarga_id                UUID;

  -- Saldo virtual actualizado
  v_saldo_ultimo_cierre       NUMERIC;
  v_suma_recargas_post_cierre NUMERIC;
  v_saldo_virtual_actual      NUMERIC;
  v_fecha_ultimo_cierre       TIMESTAMP;

  -- Deudas pendientes
  v_deudas_pendientes         JSON;
  v_cantidad_deudas           INTEGER;
  v_total_deudas              NUMERIC;
BEGIN
  -- ==========================================
  -- 1. VALIDACIONES INICIALES
  -- ==========================================

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  v_tipo_celular_id := (SELECT id                FROM tipos_servicio WHERE codigo = 'CELULAR');
  v_comision_pct    := (SELECT porcentaje_comision FROM tipos_servicio WHERE codigo = 'CELULAR');

  IF v_tipo_celular_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio CELULAR no encontrado';
  END IF;

  IF p_monto_virtual <= 0 THEN
    RAISE EXCEPTION 'El monto virtual debe ser mayor a cero';
  END IF;

  -- ==========================================
  -- 2. CÁLCULOS DE MONTOS
  -- ==========================================

  -- monto_a_pagar = monto_virtual * (1 - comision/100)
  -- Ejemplo: 210.53 * 0.95 = 200.00
  v_monto_a_pagar := ROUND(p_monto_virtual * (1 - v_comision_pct / 100.0), 2);
  v_ganancia      := p_monto_virtual - v_monto_a_pagar;

  -- ==========================================
  -- 3. INSERT EN recargas_virtuales (CREAR DEUDA)
  -- ==========================================

  v_recarga_id := gen_random_uuid();

  INSERT INTO recargas_virtuales (
    id, negocio_id, fecha, tipo_servicio_id, empleado_id,
    monto_virtual, monto_a_pagar, ganancia,
    pagado, created_at
  ) VALUES (
    v_recarga_id, v_negocio_id, p_fecha, v_tipo_celular_id, p_empleado_id,
    p_monto_virtual, v_monto_a_pagar, v_ganancia,
    false, NOW()
  );

  -- ==========================================
  -- 4. CALCULAR SALDO VIRTUAL ACTUAL
  -- Fórmula: último_cierre + SUM(recargas_virtuales posteriores)
  -- ==========================================

  v_saldo_ultimo_cierre := (
    SELECT COALESCE(saldo_virtual_actual, 0)
    FROM recargas
    WHERE tipo_servicio_id = v_tipo_celular_id
      AND negocio_id = v_negocio_id
    ORDER BY created_at DESC
    LIMIT 1
  );
  v_fecha_ultimo_cierre := (
    SELECT created_at
    FROM recargas
    WHERE tipo_servicio_id = v_tipo_celular_id
      AND negocio_id = v_negocio_id
    ORDER BY created_at DESC
    LIMIT 1
  );

  IF v_saldo_ultimo_cierre IS NULL THEN
    v_saldo_ultimo_cierre := 0;
    v_fecha_ultimo_cierre := '1900-01-01'::timestamp;
  END IF;

  v_suma_recargas_post_cierre := (
    SELECT COALESCE(SUM(monto_virtual), 0)
    FROM recargas_virtuales rv
    WHERE rv.tipo_servicio_id = v_tipo_celular_id
      AND rv.negocio_id = v_negocio_id
      AND rv.created_at > v_fecha_ultimo_cierre
  );

  v_saldo_virtual_actual := v_saldo_ultimo_cierre + v_suma_recargas_post_cierre;

  -- ==========================================
  -- 5. OBTENER LISTA DE DEUDAS PENDIENTES
  -- ==========================================

  v_deudas_pendientes := (
    SELECT json_agg(
      json_build_object(
        'id', rv.id,
        'fecha', rv.fecha,
        'monto_virtual', rv.monto_virtual,
        'monto_a_pagar', rv.monto_a_pagar,
        'ganancia', rv.ganancia,
        'created_at', rv.created_at
      ) ORDER BY rv.fecha ASC
    )
    FROM recargas_virtuales rv
    WHERE rv.tipo_servicio_id = v_tipo_celular_id
      AND rv.negocio_id = v_negocio_id
      AND rv.pagado = false
  );

  v_cantidad_deudas := (
    SELECT COUNT(*)
    FROM recargas_virtuales
    WHERE tipo_servicio_id = v_tipo_celular_id
      AND negocio_id = v_negocio_id
      AND pagado = false
  );
  v_total_deudas := (
    SELECT COALESCE(SUM(monto_a_pagar), 0)
    FROM recargas_virtuales
    WHERE tipo_servicio_id = v_tipo_celular_id
      AND negocio_id = v_negocio_id
      AND pagado = false
  );

  -- ==========================================
  -- 6. RETORNAR JSON COMPLETO
  -- ==========================================

  RETURN json_build_object(
    'success',              true,
    'recarga_id',           v_recarga_id,
    'monto_virtual',        p_monto_virtual,
    'monto_a_pagar',        v_monto_a_pagar,
    'ganancia',             v_ganancia,
    'message',              'Recarga del proveedor registrada',
    'saldo_virtual_celular', v_saldo_virtual_actual,
    'deudas_pendientes', json_build_object(
      'cantidad', v_cantidad_deudas,
      'total',    v_total_deudas,
      'lista',    COALESCE(v_deudas_pendientes, '[]'::json)
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar recarga proveedor celular: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION fn_registrar_recarga_proveedor_celular IS
'v2.0 - Registra deuda con proveedor CELULAR. Solo crea la deuda (pagado=false).
Sin transferencia de ganancia: la ganancia queda en CAJA_CELULAR como diferencia entre ventas y pago.';

REVOKE EXECUTE ON FUNCTION fn_registrar_recarga_proveedor_celular(DATE, UUID, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION fn_registrar_recarga_proveedor_celular(DATE, UUID, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- FUNCIÓN: fn_registrar_pago_proveedor_celular
-- VERSIÓN: 2.1
-- FECHA: 2026-02-25
-- ==========================================
-- CAMBIOS v2.1:
--   - Eliminado lookup de TR-001 (no existe en categorias_operaciones)
--   - categoria_id = NULL para TRANSFERENCIA_SALIENTE/ENTRANTE
--     (consistente con ejecutar_cierre_diario y el schema actual)
-- Registra el pago al proveedor CELULAR de forma atómica:
--   1. Valida deudas y calcula totales (monto_a_pagar + ganancia)
--   2. Crea EGRESO en operaciones_cajas (CAJA_CELULAR) — pago al proveedor
--   3. Crea TRANSFERENCIA_SALIENTE en CAJA_CELULAR — ganancia sale
--   4. Crea TRANSFERENCIA_ENTRANTE en CAJA_CHICA — ganancia entra
--   5. Marca deudas como pagadas
--   6. Actualiza saldo CAJA_CELULAR (saldo -= monto_a_pagar + ganancia)
--   7. Actualiza saldo CAJA_CHICA (saldo += ganancia)
--
-- La ganancia (v_total_ganancia) se obtiene de recargas_virtuales.ganancia
-- de cada deuda — NO es un valor hardcodeado.
--
-- Parámetros:
--   p_empleado_id   INT      Empleado que registra el pago
--   p_deuda_ids     UUID[]   Array de IDs de recargas_virtuales a pagar
--   p_observaciones         TEXT     Notas opcionales del pago
-- ==========================================

-- Drop firma antigua (INTEGER → UUID)
DROP FUNCTION IF EXISTS fn_registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT);

CREATE OR REPLACE FUNCTION fn_registrar_pago_proveedor_celular(
  p_empleado_id   UUID,
  p_deuda_ids     UUID[],
  p_observaciones TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id             UUID;
  v_caja_celular_id        UUID;
  v_caja_chica_id          UUID;
  v_tipo_ref_id            INTEGER;
  v_categoria_eg010_id     UUID;
  v_total_a_pagar          NUMERIC;
  v_total_ganancia         NUMERIC;
  v_total_egreso           NUMERIC;
  v_saldo_celular_ant      NUMERIC;
  v_saldo_celular_nuevo    NUMERIC;
  v_saldo_chica_ant        NUMERIC;
  v_saldo_chica_nuevo      NUMERIC;
  v_operacion_pago_id      UUID;
  v_operacion_sal_id       UUID;
  v_operacion_ent_id       UUID;
  v_fecha_hoy              DATE;
  v_deudas_count           INTEGER;
BEGIN
  v_fecha_hoy  := CURRENT_DATE;
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- ==========================================
  -- 1. OBTENER IDs NECESARIOS
  -- ==========================================
  v_caja_celular_id    := (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR' AND negocio_id = v_negocio_id);
  v_caja_chica_id      := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA'   AND negocio_id = v_negocio_id);
  v_tipo_ref_id        := (SELECT id FROM tipos_referencia WHERE tabla = 'recargas_virtuales');
  v_categoria_eg010_id := (SELECT id FROM categorias_operaciones WHERE codigo = 'EG-010' AND negocio_id = v_negocio_id);
  -- TRANSFERENCIA_SALIENTE/ENTRANTE no requieren categoria_id (NULL permitido en schema)

  IF v_caja_celular_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_CELULAR no encontrada';
  END IF;

  IF v_caja_chica_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_CHICA no encontrada';
  END IF;

  -- ==========================================
  -- 2. VALIDAR DEUDAS
  -- ==========================================
  v_deudas_count := (
    SELECT COUNT(*)
    FROM recargas_virtuales
    WHERE id = ANY(p_deuda_ids)
      AND pagado = false
      AND tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR')
  );

  IF v_deudas_count != array_length(p_deuda_ids, 1) THEN
    RAISE EXCEPTION 'Algunas deudas no existen, ya están pagadas o no son de tipo CELULAR';
  END IF;

  -- ==========================================
  -- 3. CALCULAR TOTALES DESDE LAS DEUDAS
  -- Los valores vienen de recargas_virtuales — NO son hardcodeados
  -- ==========================================
  v_total_a_pagar  := (SELECT COALESCE(SUM(monto_a_pagar), 0) FROM recargas_virtuales WHERE id = ANY(p_deuda_ids));
  v_total_ganancia := (SELECT COALESCE(SUM(ganancia), 0)      FROM recargas_virtuales WHERE id = ANY(p_deuda_ids));

  IF v_total_a_pagar <= 0 THEN
    RAISE EXCEPTION 'El total a pagar debe ser mayor a cero';
  END IF;

  -- Total que debe salir de CAJA_CELULAR = pago al proveedor + ganancia a transferir
  v_total_egreso := v_total_a_pagar + v_total_ganancia;

  -- ==========================================
  -- 4. VALIDAR SALDO CAJA_CELULAR
  -- ==========================================
  v_saldo_celular_ant := (SELECT saldo_actual FROM cajas WHERE id = v_caja_celular_id);

  IF v_saldo_celular_ant < v_total_egreso THEN
    RAISE EXCEPTION 'Saldo insuficiente en CAJA_CELULAR. Disponible: $%, Requerido: $% (pago: $% + ganancia: $%)',
      v_saldo_celular_ant, v_total_egreso, v_total_a_pagar, v_total_ganancia;
  END IF;

  v_saldo_chica_ant := (SELECT saldo_actual FROM cajas WHERE id = v_caja_chica_id);

  -- ==========================================
  -- 5. CALCULAR SALDOS NUEVOS
  -- ==========================================
  v_saldo_celular_nuevo := v_saldo_celular_ant - v_total_egreso;
  v_saldo_chica_nuevo   := v_saldo_chica_ant + v_total_ganancia;

  v_operacion_pago_id := gen_random_uuid();
  v_operacion_sal_id  := gen_random_uuid();
  v_operacion_ent_id  := gen_random_uuid();

  -- ==========================================
  -- 6. EGRESO: Pago al proveedor (CAJA_CELULAR)
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, negocio_id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id,
    descripcion
  ) VALUES (
    v_operacion_pago_id, v_negocio_id, NOW(), v_caja_celular_id, p_empleado_id,
    'EGRESO', v_total_a_pagar,
    v_saldo_celular_ant, v_saldo_celular_ant - v_total_a_pagar,
    v_categoria_eg010_id, v_tipo_ref_id,
    COALESCE(p_observaciones, 'Pago al proveedor celular — ' || array_length(p_deuda_ids, 1) || ' deuda(s)')
  );

  -- ==========================================
  -- 7. TRANSFERENCIA_SALIENTE: Ganancia sale de CAJA_CELULAR
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, negocio_id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    tipo_referencia_id,
    descripcion
  ) VALUES (
    v_operacion_sal_id, v_negocio_id, NOW(), v_caja_celular_id, p_empleado_id,
    'TRANSFERENCIA_SALIENTE', v_total_ganancia,
    v_saldo_celular_ant - v_total_a_pagar, v_saldo_celular_nuevo,
    v_tipo_ref_id,
    'Ganancia celular → Caja Chica'
  );

  -- ==========================================
  -- 8. TRANSFERENCIA_ENTRANTE: Ganancia entra a CAJA_CHICA
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, negocio_id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    tipo_referencia_id,
    descripcion
  ) VALUES (
    v_operacion_ent_id, v_negocio_id, NOW(), v_caja_chica_id, p_empleado_id,
    'TRANSFERENCIA_ENTRANTE', v_total_ganancia,
    v_saldo_chica_ant, v_saldo_chica_nuevo,
    v_tipo_ref_id,
    'Ganancia celular recibida desde Caja Celular'
  );

  -- ==========================================
  -- 9. MARCAR DEUDAS COMO PAGADAS
  -- ==========================================
  UPDATE recargas_virtuales
  SET pagado            = true,
      fecha_pago        = v_fecha_hoy,
      operacion_pago_id = v_operacion_pago_id
  WHERE id = ANY(p_deuda_ids);

  -- ==========================================
  -- 10. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================
  UPDATE cajas
  SET saldo_actual = v_saldo_celular_nuevo
  WHERE id = v_caja_celular_id;

  UPDATE cajas
  SET saldo_actual = v_saldo_chica_nuevo
  WHERE id = v_caja_chica_id;

  -- ==========================================
  -- 11. RETORNAR RESULTADO
  -- ==========================================
  RETURN json_build_object(
    'success',               true,
    'operacion_pago_id',     v_operacion_pago_id,
    'deudas_pagadas',        array_length(p_deuda_ids, 1),
    'total_pagado',          v_total_a_pagar,
    'total_ganancia',        v_total_ganancia,
    'saldo_celular_anterior', v_saldo_celular_ant,
    'saldo_celular_nuevo',   v_saldo_celular_nuevo,
    'saldo_chica_anterior',  v_saldo_chica_ant,
    'saldo_chica_nuevo',     v_saldo_chica_nuevo,
    'message',               'Pago registrado: $' || v_total_a_pagar || ' — Ganancia $' || v_total_ganancia || ' transferida a Caja Chica'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar pago proveedor celular: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION fn_registrar_pago_proveedor_celular IS
'v2.1 - Registra pago al proveedor CELULAR. Crea EGRESO en CAJA_CELULAR (monto_a_pagar)
y transfiere la ganancia acumulada (de recargas_virtuales.ganancia) a CAJA_CHICA.
Ganancia NO hardcodeada: se lee de cada deuda seleccionada.
Las operaciones TRANSFERENCIA_SALIENTE/ENTRANTE no usan categoria_id (NULL).';

REVOKE EXECUTE ON FUNCTION fn_registrar_pago_proveedor_celular(UUID, UUID[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_registrar_pago_proveedor_celular(UUID, UUID[], TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- FUNCIÓN: fn_registrar_compra_saldo_bus
-- VERSIÓN: 4.0
-- FECHA: 2026-03-03
-- ==========================================
-- CAMBIOS v4.0 — Ganancia BUS como deuda pendiente de cobro:
--   pagado        = false  → ganancia pendiente de cobrar al proveedor
--   pagado        = true   → ganancia ya cobrada (via liquidar_ganancias_bus)
--   monto_a_pagar = p_monto  → monto completo pagado al proveedor (mismo que monto_virtual)
--   ganancia      = 0  → no se guarda por fila; se calcula al liquidar como ROUND(SUM(monto_a_pagar)*comision%, 2)
--   fecha_pago, operacion_pago_id = NULL (se setean cuando se liquida el mes)
--
--   La liquidación mensual (liquidar_ganancias_bus) hace:
--     ROUND(SUM(monto_a_pagar) WHERE tipo=BUS AND pagado=false AND fecha IN mes, 2)
--     + TRANSFERENCIA CAJA_BUS → CAJA_CHICA (atómica con UPDATE pagado=true)
--
-- CAMBIOS v3.1 — Fix timestamp mini cierre:
--   recargas_virtuales usa clock_timestamp() en lugar de NOW() para garantizar
--   que su created_at sea estrictamente posterior al snapshot del mini cierre.
--   NOW() es estable dentro de una transacción (mismo valor), lo que causaba
--   que getSaldoVirtualActual (filtro created_at > snapshot) no contara la compra.
--
-- CAMBIOS v3.0 — Mini cierre integrado:
--   Con p_saldo_virtual_maquina Y ventas > 0:
--     1. Busca turno abierto (requerido para crear snapshot)
--     2. INSERT en `recargas` como mini cierre (snapshot parcial del día)
--        ON CONFLICT acumula si ya hubo un mini cierre previo en el mismo turno
--     3. INGRESO CAJA_BUS por ventas acumuladas desde último cierre/mini-cierre
--     4. EGRESO CAJA_BUS por monto comprado
--     → CAJA_BUS nunca queda negativa
--     → El cierre diario usa el mini cierre como base y solo suma ventas restantes
--   Con p_saldo_virtual_maquina Y ventas = 0:
--     → Comportamiento básico (CAJA_BUS >= monto, solo EGRESO)
--   Sin p_saldo_virtual_maquina (NULL):
--     → Comportamiento básico v2.0 (CAJA_BUS >= monto, solo EGRESO)
--
-- COMPATIBILIDAD: firma idéntica a v3.x, sin cambios en TypeScript
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.fn_registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.fn_registrar_compra_saldo_bus(
  p_fecha                 DATE,
  p_empleado_id           UUID,
  p_monto                 NUMERIC,
  p_observaciones         TEXT    DEFAULT NULL,
  p_saldo_virtual_maquina NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Tenant
  v_negocio_id               UUID;

  -- IDs de tablas de referencia
  v_caja_bus_id              UUID;
  v_tipo_bus_id              INTEGER;
  v_tipo_ref_rv_id           INTEGER;  -- tipos_referencia 'recargas_virtuales'
  v_tipo_ref_recargas_id     INTEGER;  -- tipos_referencia 'recargas'
  v_categoria_eg011_id       UUID;

  -- Saldos
  v_saldo_anterior           NUMERIC;   -- CAJA_BUS antes de cualquier operación
  v_saldo_despues_ingreso    NUMERIC;   -- CAJA_BUS después del INGRESO (antes del EGRESO)
  v_saldo_nuevo              NUMERIC;   -- CAJA_BUS final

  -- UUIDs
  v_turno_id                 UUID;
  v_mini_cierre_id           UUID;
  v_operacion_ingreso_id     UUID;
  v_operacion_egreso_id      UUID;
  v_recarga_id               UUID;

  -- Para cálculo de ventas acumuladas
  v_saldo_ultimo_cierre_bus   NUMERIC;
  v_fecha_ultimo_cierre_bus   TIMESTAMP;
  v_suma_recargas_post_cierre NUMERIC;
  v_saldo_virtual_sistema     NUMERIC;
  v_venta_bus_hoy             NUMERIC;
  v_disponible_total          NUMERIC;
BEGIN

  -- ==========================================
  -- INICIALIZACIÓN — obtener IDs y configuración
  -- ==========================================

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  v_caja_bus_id          := (SELECT id FROM cajas WHERE codigo = 'CAJA_BUS' AND negocio_id = v_negocio_id);
  v_tipo_bus_id          := (SELECT id FROM tipos_servicio WHERE codigo = 'BUS');
  v_tipo_ref_rv_id       := (SELECT id FROM tipos_referencia WHERE tabla = 'recargas_virtuales');
  v_tipo_ref_recargas_id := (SELECT id FROM tipos_referencia WHERE tabla = 'recargas');
  v_categoria_eg011_id   := (SELECT id FROM categorias_operaciones WHERE codigo = 'EG-011' AND negocio_id = v_negocio_id);

  IF v_caja_bus_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_BUS no encontrada';
  END IF;

  IF v_tipo_bus_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio BUS no encontrado';
  END IF;

  IF v_categoria_eg011_id IS NULL THEN
    RAISE EXCEPTION 'Categoría operación EG-011 no encontrada';
  END IF;

  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de compra debe ser mayor a cero';
  END IF;

  v_saldo_anterior := (SELECT saldo_actual FROM cajas WHERE id = v_caja_bus_id);

  -- ==========================================
  -- VALIDACIÓN Y CÁLCULO DE VENTAS
  -- ==========================================

  IF p_saldo_virtual_maquina IS NOT NULL THEN

    -- Calcula saldo virtual del sistema (mismo algoritmo que getSaldoVirtualActual TypeScript)
    -- Usa el último registro de `recargas` como base (puede ser cierre completo o mini cierre)
    v_saldo_ultimo_cierre_bus := (
      SELECT COALESCE(r.saldo_virtual_actual, 0)
      FROM recargas r
      JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
      WHERE ts.codigo = 'BUS'
        AND r.negocio_id = v_negocio_id
      ORDER BY r.created_at DESC
      LIMIT 1
    );

    v_fecha_ultimo_cierre_bus := (
      SELECT r.created_at
      FROM recargas r
      JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
      WHERE ts.codigo = 'BUS'
        AND r.negocio_id = v_negocio_id
      ORDER BY r.created_at DESC
      LIMIT 1
    );

    IF v_saldo_ultimo_cierre_bus IS NULL THEN
      v_saldo_ultimo_cierre_bus  := 0;
      v_fecha_ultimo_cierre_bus  := '1900-01-01'::timestamp;
    END IF;

    v_suma_recargas_post_cierre := (
      SELECT COALESCE(SUM(rv.monto_virtual), 0)
      FROM recargas_virtuales rv
      WHERE rv.tipo_servicio_id = v_tipo_bus_id
        AND rv.negocio_id = v_negocio_id
        AND rv.created_at > v_fecha_ultimo_cierre_bus
    );

    v_saldo_virtual_sistema := v_saldo_ultimo_cierre_bus + v_suma_recargas_post_cierre;
    v_venta_bus_hoy         := GREATEST(v_saldo_virtual_sistema - p_saldo_virtual_maquina, 0);
    v_disponible_total      := v_saldo_anterior + v_venta_bus_hoy;

    IF v_disponible_total < p_monto THEN
      RAISE EXCEPTION 'Efectivo insuficiente. Caja BUS: $% + ventas del día: $% = $%. Requerido: $%',
        v_saldo_anterior, v_venta_bus_hoy, v_disponible_total, p_monto;
    END IF;

  ELSE
    -- Modo básico: solo CAJA_BUS
    v_venta_bus_hoy := 0;
    IF v_saldo_anterior < p_monto THEN
      RAISE EXCEPTION 'Saldo insuficiente en CAJA_BUS. Disponible: $%, Requerido: $%',
        v_saldo_anterior, p_monto;
    END IF;

  END IF;

  -- ==========================================
  -- MINI CIERRE (solo si hay ventas que registrar)
  -- ==========================================

  IF v_venta_bus_hoy > 0 THEN

    -- Requiere turno abierto para crear el snapshot en `recargas`
    v_turno_id := (
      SELECT id
      FROM turnos_caja
      WHERE (hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = p_fecha
        AND hora_fecha_cierre IS NULL
        AND negocio_id = v_negocio_id
      ORDER BY hora_fecha_apertura DESC
      LIMIT 1
    );

    IF v_turno_id IS NULL THEN
      RAISE EXCEPTION
        'No hay turno abierto para la fecha %. Abrí un turno antes de registrar la compra con saldo de máquina.',
        p_fecha;
    END IF;

    v_mini_cierre_id       := gen_random_uuid();
    v_operacion_ingreso_id := gen_random_uuid();

    -- Snapshot parcial en `recargas`
    -- ON CONFLICT: si ya hubo un mini cierre en este turno+BUS, acumula las ventas
    -- El cierre diario (ejecutar_cierre_diario) tiene el mismo ON CONFLICT para cerrar el día
    INSERT INTO recargas (
      id, negocio_id, fecha, turno_id, empleado_id, tipo_servicio_id,
      venta_dia, saldo_virtual_anterior, saldo_virtual_actual
    ) VALUES (
      v_mini_cierre_id, v_negocio_id, p_fecha, v_turno_id, p_empleado_id, v_tipo_bus_id,
      v_venta_bus_hoy, v_saldo_virtual_sistema, p_saldo_virtual_maquina
    )
    ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE SET
      venta_dia            = recargas.venta_dia + EXCLUDED.venta_dia,
      saldo_virtual_actual = EXCLUDED.saldo_virtual_actual;

    v_mini_cierre_id := (SELECT id FROM recargas WHERE turno_id = v_turno_id AND tipo_servicio_id = v_tipo_bus_id AND negocio_id = v_negocio_id);

    -- INGRESO CAJA_BUS por ventas acumuladas
    -- Referencia al snapshot en `recargas` para trazabilidad (igual que el cierre diario)
    v_saldo_despues_ingreso := v_saldo_anterior + v_venta_bus_hoy;

    INSERT INTO operaciones_cajas (
      id, negocio_id, fecha, caja_id, empleado_id,
      tipo_operacion, monto,
      saldo_anterior, saldo_actual,
      tipo_referencia_id, referencia_id,
      descripcion
    ) VALUES (
      v_operacion_ingreso_id, v_negocio_id, NOW(), v_caja_bus_id, p_empleado_id,
      'INGRESO', v_venta_bus_hoy,
      v_saldo_anterior, v_saldo_despues_ingreso,
      v_tipo_ref_recargas_id, v_mini_cierre_id,
      'Ventas Bus pre-compra saldo — ' || p_fecha
    );

  ELSE
    -- Sin ventas: CAJA_BUS no necesita INGRESO previo
    v_saldo_despues_ingreso := v_saldo_anterior;
  END IF;

  -- ==========================================
  -- EGRESO + RECARGA VIRTUAL (siempre)
  -- ==========================================

  v_saldo_nuevo         := v_saldo_despues_ingreso - p_monto;
  v_operacion_egreso_id := gen_random_uuid();
  v_recarga_id          := gen_random_uuid();

  -- EGRESO debe existir ANTES de recargas_virtuales (FK: operacion_pago_id)
  INSERT INTO operaciones_cajas (
    id, negocio_id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id, referencia_id,
    descripcion
  ) VALUES (
    v_operacion_egreso_id, v_negocio_id, NOW(), v_caja_bus_id, p_empleado_id,
    'EGRESO', p_monto,
    v_saldo_despues_ingreso, v_saldo_nuevo,
    v_categoria_eg011_id, v_tipo_ref_rv_id, v_recarga_id,
    COALESCE(p_observaciones, 'Compra saldo virtual Bus — ' || p_fecha)
  );

  INSERT INTO recargas_virtuales (
    id, negocio_id, fecha, tipo_servicio_id, empleado_id,
    monto_virtual, monto_a_pagar, ganancia,
    pagado, observaciones, created_at
    -- fecha_pago, operacion_pago_id: NULL hasta que se liquide el mes
  ) VALUES (
    v_recarga_id, v_negocio_id, p_fecha, v_tipo_bus_id, p_empleado_id,
    p_monto, p_monto, 0,
    false, p_observaciones, clock_timestamp()
    -- clock_timestamp() avanza en tiempo real (NOW() es estable en transacción)
    -- Garantiza created_at > snapshot del mini cierre → getSaldoVirtualActual lo cuenta correctamente
  );

  UPDATE cajas
  SET saldo_actual = v_saldo_nuevo
  WHERE id = v_caja_bus_id;

  -- ==========================================
  -- RETORNAR RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',            true,
    'recarga_id',         v_recarga_id,
    'operacion_id',       v_operacion_egreso_id,
    'monto',              p_monto,
    'saldo_anterior',     v_saldo_anterior,
    'saldo_nuevo',        v_saldo_nuevo,
    'venta_bus_incluida', v_venta_bus_hoy,
    'mini_cierre',        (v_venta_bus_hoy > 0),
    'message',            CASE
      WHEN v_venta_bus_hoy > 0
        THEN 'Compra saldo Bus $' || p_monto || ' — Ventas registradas: $' || v_venta_bus_hoy
      ELSE
        'Compra saldo Bus $' || p_monto
    END
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar compra saldo bus: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.fn_registrar_compra_saldo_bus IS
'v4.0 - Ganancia BUS como deuda pendiente: pagado=false, monto_a_pagar=monto_completo, ganancia=0.
La liquidación (liquidar_ganancias_bus) calcula ROUND(SUM(monto_a_pagar)*comision%, 2) WHERE pagado=false,
transfiere ese total de CAJA_BUS→CAJA_CHICA y marca pagado=true en una transacción atómica.
v3.1 - Fix timestamp: clock_timestamp() garantiza created_at > snapshot del mini cierre.
v3.0 - Mini cierre integrado: con p_saldo_virtual_maquina y ventas > 0 crea snapshot
en recargas (ON CONFLICT acumula) + INGRESO por ventas + EGRESO por compra. CAJA_BUS nunca negativa.';

REVOKE EXECUTE ON FUNCTION public.fn_registrar_compra_saldo_bus(DATE, UUID, NUMERIC, TEXT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_compra_saldo_bus(DATE, UUID, NUMERIC, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- FUNCIÓN: fn_liquidar_ganancias_bus
-- VERSIÓN: 1.0
-- FECHA: 2026-03-03
-- ==========================================
-- Liquida las ganancias BUS pendientes de un mes dado.
-- Opera de forma atómica:
--   1. Calcula ganancia = ROUND(SUM(monto_a_pagar) * comision%, 2) WHERE pagado=false AND fecha IN mes
--      (monto_a_pagar = monto completo de cada compra; la ganancia es el % aplicado sobre el total)
--   2. Transfiere esa ganancia de CAJA_BUS → CAJA_CHICA (via crear_transferencia)
--   3. Marca las filas como pagado=true, fecha_pago=hoy
--
-- Si la transferencia falla (ej: saldo insuficiente en CAJA_BUS), la transacción
-- completa se revierte y las filas NO se marcan como pagadas.
--
-- Parámetros:
--   p_mes          TEXT     Mes a liquidar en formato 'YYYY-MM' (ej: '2026-02')
--   p_empleado_id  INTEGER  Empleado que ejecuta la liquidación
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.fn_liquidar_ganancias_bus(
  p_mes         TEXT,
  p_empleado_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id       UUID;
  v_tipo_bus_id      INTEGER;
  v_comision_pct     NUMERIC;
  v_inicio_mes       DATE;
  v_fin_mes          DATE;
  v_total_compras    NUMERIC;
  v_total_ganancia   NUMERIC;
  v_filas_afectadas  INTEGER;
  v_transfer_result  JSON;
BEGIN

  -- ==========================================
  -- INICIALIZACIÓN
  -- ==========================================

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  v_tipo_bus_id  := (SELECT id                 FROM tipos_servicio WHERE codigo = 'BUS');
  v_comision_pct := (SELECT porcentaje_comision FROM tipos_servicio WHERE codigo = 'BUS');

  IF v_tipo_bus_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio BUS no encontrado';
  END IF;

  -- Calcular rango del mes (inicio inclusivo, fin exclusivo)
  v_inicio_mes := (p_mes || '-01')::date;
  v_fin_mes    := (v_inicio_mes + INTERVAL '1 month')::date;

  -- ==========================================
  -- CALCULAR GANANCIA PENDIENTE DEL MES
  -- ==========================================

  -- monto_a_pagar = monto completo de cada compra (mismo que monto_virtual)
  -- La ganancia es el porcentaje de comisión aplicado sobre el total del mes
  v_total_compras := (
    SELECT COALESCE(SUM(monto_a_pagar), 0)
    FROM recargas_virtuales
    WHERE tipo_servicio_id = v_tipo_bus_id
      AND negocio_id = v_negocio_id
      AND pagado = false
      AND fecha >= v_inicio_mes
      AND fecha < v_fin_mes
  );

  IF v_total_compras <= 0 THEN
    RAISE EXCEPTION 'No hay compras BUS pendientes de liquidar para el mes %', p_mes;
  END IF;

  v_total_ganancia := ROUND(v_total_compras * (v_comision_pct / 100.0), 2);

  -- ==========================================
  -- TRANSFERENCIA CAJA_BUS → CAJA_CHICA
  -- ==========================================

  v_transfer_result := public.fn_crear_transferencia(
    'CAJA_BUS',
    'CAJA_CHICA',
    v_total_ganancia,
    p_empleado_id,
    'Ganancia ' || v_comision_pct || '% BUS ' || p_mes
  );

  IF NOT (v_transfer_result->>'success')::boolean THEN
    RAISE EXCEPTION '%', v_transfer_result->>'error';
  END IF;

  -- ==========================================
  -- MARCAR FILAS COMO PAGADAS
  -- ==========================================

  UPDATE recargas_virtuales
  SET
    pagado     = true,
    fecha_pago = CURRENT_DATE
  WHERE tipo_servicio_id = v_tipo_bus_id
    AND negocio_id = v_negocio_id
    AND pagado = false
    AND fecha >= v_inicio_mes
    AND fecha < v_fin_mes;

  GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

  -- ==========================================
  -- RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',          true,
    'mes',              p_mes,
    'total_ganancia',   v_total_ganancia,
    'filas_afectadas',  v_filas_afectadas,
    'message',          'Ganancia $' || v_total_ganancia || ' transferida a Varios (' || v_filas_afectadas || ' compras del mes ' || p_mes || ')'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al liquidar ganancias BUS: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.fn_liquidar_ganancias_bus IS
'v1.0 - Liquida ganancias BUS de un mes: calcula ROUND(SUM(monto_a_pagar) * comision%, 2) WHERE pagado=false,
transfiere de CAJA_BUS a CAJA_CHICA y marca las filas como pagado=true. Operación atómica:
si la transferencia falla (saldo insuficiente) toda la operación se revierte.
monto_a_pagar = monto completo de cada compra; la ganancia = ese total * porcentaje_comision.';

REVOKE EXECUTE ON FUNCTION public.fn_liquidar_ganancias_bus(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_liquidar_ganancias_bus(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- fn_listar_cuentas_cobrar
-- ==========================================
-- Lista clientes con ventas fiadas pendientes (total o parcialmente).
-- Agrupa por cliente, suma la deuda total y ordena por mayor deuda primero.
-- Soporta búsqueda por nombre / identificación del cliente.
-- Paginada: p_page 0-indexed, p_page_size filas por página.
--
-- Retorna: SETOF JSON con campos de CuentaCliente
-- ==========================================

CREATE OR REPLACE FUNCTION fn_listar_cuentas_cobrar(
    p_busqueda  TEXT    DEFAULT NULL,
    p_page      INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 20
)
RETURNS TABLE (
    cliente_id             UUID,
    cliente_nombre         VARCHAR,
    cliente_identificacion VARCHAR,
    cliente_telefono       VARCHAR,
    total_deuda            DECIMAL,
    cantidad_ventas        BIGINT,
    ultima_venta_fecha     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        c.id                                                         AS cliente_id,
        c.nombre                                                     AS cliente_nombre,
        c.identificacion                                             AS cliente_identificacion,
        c.telefono                                                   AS cliente_telefono,
        SUM(v.total - COALESCE(pagos.total_pagado, 0))::DECIMAL      AS total_deuda,
        COUNT(v.id)                                                  AS cantidad_ventas,
        MAX(v.fecha)                                                 AS ultima_venta_fecha
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN (
        SELECT venta_id, SUM(monto) AS total_pagado
        FROM cuentas_cobrar
        GROUP BY venta_id
    ) pagos ON pagos.venta_id = v.id
    WHERE
        v.negocio_id = public.get_negocio_id()
        AND v.metodo_pago = 'FIADO'
        AND v.estado       = 'COMPLETADA'
        AND v.estado_pago  IN ('PENDIENTE', 'PAGADO_PARCIAL')
        AND (
            p_busqueda IS NULL
            OR p_busqueda = ''
            OR c.nombre         ILIKE '%' || p_busqueda || '%'
            OR c.identificacion ILIKE '%' || p_busqueda || '%'
        )
    GROUP BY c.id, c.nombre, c.identificacion, c.telefono
    HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ORDER BY total_deuda DESC
    LIMIT  p_page_size
    OFFSET p_page * p_page_size;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION fn_listar_cuentas_cobrar(TEXT, INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_listar_cuentas_cobrar(TEXT, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- fn_resumir_cuentas_cobrar
-- ==========================================
-- Devuelve el resumen global de cuentas por cobrar:
--   • total_clientes  — cuántos clientes distintos tienen deuda
--   • total_deuda     — suma total adeudada ($)
--
-- Soporta el mismo filtro de búsqueda que fn_listar_cuentas_cobrar
-- para que el footer coincida exactamente con la lista filtrada.
--
-- SIEMPRE devuelve exactamente 1 fila (con 0s si no hay deudas).
--
-- ¿Por qué función y no query directa?
--   • Llamado via supabase.rpc() — requiere función PostgreSQL.
--   • La lógica de filtrado aplicado a un agregado multi-tabla es compleja
--     para el query builder de Supabase.
--
-- LANGUAGE sql STABLE: lectura pura, más eficiente que plpgsql para SELECTs.
-- ==========================================

CREATE OR REPLACE FUNCTION fn_resumir_cuentas_cobrar(
    p_busqueda TEXT DEFAULT NULL
)
RETURNS TABLE (
    total_clientes BIGINT,
    total_deuda    DECIMAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Subquery para calcular por cliente; luego agregar en fila única.
    -- COALESCE(..., 0) garantiza que siempre se retorna 1 fila aun sin datos.
    SELECT
        COALESCE(COUNT(DISTINCT base.cliente_id), 0)::BIGINT  AS total_clientes,
        COALESCE(SUM(base.saldo_pendiente), 0)::DECIMAL        AS total_deuda
    FROM (
        SELECT
            c.id                                                      AS cliente_id,
            SUM(v.total - COALESCE(pagos.total_pagado, 0))::DECIMAL   AS saldo_pendiente
        FROM ventas v
        JOIN clientes c ON c.id = v.cliente_id
        LEFT JOIN (
            SELECT venta_id, SUM(monto) AS total_pagado
            FROM cuentas_cobrar
            GROUP BY venta_id
        ) pagos ON pagos.venta_id = v.id
        WHERE
            v.negocio_id = public.get_negocio_id()
            AND v.metodo_pago = 'FIADO'
            AND v.estado      = 'COMPLETADA'
            AND v.estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')
            AND (
                p_busqueda IS NULL
                OR p_busqueda = ''
                OR c.nombre         ILIKE '%' || p_busqueda || '%'
                OR c.identificacion ILIKE '%' || p_busqueda || '%'
            )
        GROUP BY c.id
        HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ) base;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION fn_resumir_cuentas_cobrar(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_resumir_cuentas_cobrar(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- fn_registrar_pago_fiado
-- ==========================================
-- Registra un pago (total o parcial) contra una venta fiada.
--
-- Flujo:
--   1. Valida que la venta sea FIADO y tenga saldo pendiente
--   2. Inserta registro en cuentas_cobrar
--   3. Actualiza estado_pago de la venta (PAGADO_PARCIAL o PAGADO)
--   4. Si metodo_pago = EFECTIVO → ingresa a CAJA_CHICA
--
-- Retorna JSON: { success: true }
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT);

CREATE OR REPLACE FUNCTION fn_registrar_pago_fiado(
    p_venta_id       UUID,
    p_monto          DECIMAL(12,2),
    p_metodo_pago    VARCHAR(20),
    p_observaciones  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id         UUID;
    v_venta_total        DECIMAL(12,2);
    v_venta_metodo_pago  VARCHAR(20);
    v_venta_estado_pago  VARCHAR(20);
    v_total_pagado       DECIMAL(12,2);
    v_saldo_pendiente    DECIMAL(12,2);
    v_nuevo_estado       VARCHAR(20);
    v_empleado_id        UUID;
    v_caja_id            UUID;
    v_categoria_id       UUID;
    v_tipo_referencia_id INTEGER;
    v_saldo_caja         DECIMAL(12,2);
BEGIN
    -- 0. Obtener negocio y empleado autenticado
    v_negocio_id  := public.get_negocio_id();
    v_empleado_id := (SELECT id FROM usuarios WHERE email = auth.jwt() ->> 'email');

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    IF v_empleado_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    -- 1. Validar venta — PERFORM para lock + := para leer campos
    PERFORM id FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venta no encontrada';
    END IF;

    v_venta_total       := (SELECT total        FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);
    v_venta_metodo_pago := (SELECT metodo_pago  FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);
    v_venta_estado_pago := (SELECT estado_pago  FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id);

    IF v_venta_metodo_pago != 'FIADO' THEN
        RAISE EXCEPTION 'La venta no es de tipo FIADO';
    END IF;

    IF v_venta_estado_pago = 'PAGADO' THEN
        RAISE EXCEPTION 'Esta venta ya esta completamente pagada';
    END IF;

    -- 2. Calcular saldo pendiente
    v_total_pagado := (
      SELECT COALESCE(SUM(monto), 0)
      FROM cuentas_cobrar
      WHERE venta_id = p_venta_id
    );

    v_saldo_pendiente := v_venta_total - v_total_pagado;

    IF p_monto <= 0 THEN
        RAISE EXCEPTION 'El monto debe ser mayor a 0';
    END IF;

    IF p_monto > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto ($%) supera el saldo pendiente ($%)', p_monto, v_saldo_pendiente;
    END IF;

    -- 3. Insertar pago
    INSERT INTO cuentas_cobrar (venta_id, empleado_id, monto, metodo_pago, observaciones)
    VALUES (p_venta_id, v_empleado_id, p_monto, p_metodo_pago, p_observaciones);

    -- 4. Actualizar estado_pago de la venta
    v_nuevo_estado := CASE
        WHEN (v_total_pagado + p_monto) >= v_venta_total THEN 'PAGADO'
        ELSE 'PAGADO_PARCIAL'
    END;

    UPDATE ventas
    SET estado_pago = v_nuevo_estado
    WHERE id = p_venta_id AND negocio_id = v_negocio_id;

    -- 5. Si es EFECTIVO → ingresar a CAJA_CHICA
    IF p_metodo_pago = 'EFECTIVO' THEN
        v_caja_id            := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
        v_categoria_id       := (SELECT id FROM categorias_operaciones WHERE tipo = 'INGRESO' AND negocio_id = v_negocio_id AND nombre ILIKE '%Ventas%' LIMIT 1);
        v_tipo_referencia_id := (SELECT id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1);

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL AND v_tipo_referencia_id IS NOT NULL THEN
            v_saldo_caja := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id);

            INSERT INTO operaciones_cajas (
                negocio_id, caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id,
                descripcion
            ) VALUES (
                v_negocio_id, v_caja_id, v_empleado_id, 'INGRESO', p_monto,
                v_saldo_caja, v_saldo_caja + p_monto,
                v_categoria_id, v_tipo_referencia_id, p_venta_id,
                'Pago fiado - ' || COALESCE(p_observaciones, 'Sin observaciones')
            );

            UPDATE cajas
            SET saldo_actual = saldo_actual + p_monto
            WHERE id = v_caja_id AND negocio_id = v_negocio_id;
        END IF;
    END IF;

    RETURN json_build_object('success', true);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT);
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID, INTEGER);

-- ==========================================
-- FUNCIÓN: fn_listar_ventas (v1.4)
-- ==========================================
-- Lista paginada de ventas con soporte de filtro por período, búsqueda libre,
-- estado y turno. Todos los roles ven todas las ventas.
-- El filtro por turno es solo visible para ADMIN (client-side).
--
-- v1.4 — Simplificado: todos los roles ven todas las ventas. Filtro de turno
--         solo disponible para ADMIN en el frontend.
-- v1.3 — Agrega: p_turno_id para filtrar ventas de un turno específico.
--
-- Llamada desde: VentasService.obtenerVentas()
-- Parámetros:
--   p_filtro     — 'hoy' | 'semana' | 'mes' | 'todo' | 'YYYY-MM-DD'
--   p_busqueda   — término libre (nombre, cédula o nro. comprobante). NULL = sin filtro
--   p_page       — página 0-based
--   p_page_size  — registros por página (default 10)
--   p_estado     — 'COMPLETADA' | 'ANULADA' | NULL (NULL = solo COMPLETADA, default operativo)
--   p_turno_id   — UUID del turno. NULL = todos los turnos del período
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_listar_ventas(
    p_filtro    TEXT    DEFAULT 'hoy',
    p_busqueda  TEXT    DEFAULT NULL,
    p_page      INT     DEFAULT 0,
    p_page_size INT     DEFAULT 10,
    p_estado    TEXT    DEFAULT NULL,
    p_turno_id  UUID    DEFAULT NULL
)
RETURNS TABLE (
    id                    UUID,
    turno_id              UUID,
    empleado_id           UUID,
    cliente_id            UUID,
    tipo_comprobante      TEXT,
    numero_comprobante    INTEGER,
    subtotal              NUMERIC,
    total                 NUMERIC,
    base_iva_0            NUMERIC,
    base_iva_15           NUMERIC,
    iva_valor             NUMERIC,
    metodo_pago           TEXT,
    estado                TEXT,
    fecha                 TIMESTAMPTZ,
    cliente_nombre        TEXT,
    cliente_identificacion TEXT,
    empleado_nombre       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id    UUID;
    v_fecha_local   DATE;
    v_inicio        TIMESTAMPTZ;
    v_fin           TIMESTAMPTZ;
    v_term          TEXT;
    v_term_regex    TEXT;
BEGIN
    -- ── Tenant ──────────────────────────────────────────────────────────────
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- ── Fecha actual en Ecuador ─────────────────────────────────────────────
    v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;

    -- ── Rango de fechas según filtro ────────────────────────────────────────
    IF p_filtro = 'hoy' THEN
        v_inicio := (v_fecha_local::TIMESTAMP         AT TIME ZONE 'America/Guayaquil');
        v_fin    := ((v_fecha_local + 1)::TIMESTAMP   AT TIME ZONE 'America/Guayaquil');

    ELSIF p_filtro = 'semana' THEN
        -- Lunes de la semana actual en Ecuador (ISODOW: 1=Lun … 7=Dom)
        v_inicio := ((v_fecha_local - (EXTRACT(ISODOW FROM v_fecha_local)::INT - 1) * INTERVAL '1 day')::TIMESTAMP
                     AT TIME ZONE 'America/Guayaquil');
        v_fin    := NULL;  -- sin límite superior

    ELSIF p_filtro = 'mes' THEN
        -- Primer día del mes actual en Ecuador
        v_inicio := (DATE_TRUNC('month', v_fecha_local)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin    := NULL;

    ELSIF p_filtro = 'todo' THEN
        v_inicio := NULL;
        v_fin    := NULL;

    ELSE
        -- Se asume 'YYYY-MM-DD' — fecha específica
        v_inicio := (p_filtro::DATE::TIMESTAMP         AT TIME ZONE 'America/Guayaquil');
        v_fin    := ((p_filtro::DATE + 1)::TIMESTAMP   AT TIME ZONE 'America/Guayaquil');
    END IF;

    -- ── Término de búsqueda: trim + versión escapada para regex ────────────
    v_term       := NULLIF(TRIM(p_busqueda), '');
    v_term_regex := regexp_replace(v_term, '([.+*?^${}()|[\]\\])', '\\\1', 'g');

    -- ── Query principal ─────────────────────────────────────────────────────
    RETURN QUERY
    SELECT
        v.id,
        v.turno_id,
        v.empleado_id,
        v.cliente_id,
        v.tipo_comprobante::TEXT,
        v.numero_comprobante,
        v.subtotal,
        v.total,
        v.base_iva_0,
        v.base_iva_15,
        v.iva_valor,
        v.metodo_pago::TEXT,
        v.estado::TEXT,
        v.fecha,
        c.nombre::TEXT          AS cliente_nombre,
        c.identificacion::TEXT  AS cliente_identificacion,
        e.nombre::TEXT          AS empleado_nombre
    FROM ventas v
    LEFT JOIN clientes  c ON v.cliente_id  = c.id
    LEFT JOIN usuarios  e ON v.empleado_id = e.id
    WHERE v.negocio_id = v_negocio_id
      AND v.estado = COALESCE(p_estado, 'COMPLETADA')
      -- Filtro de turno (solo ADMIN lo usa desde el frontend)
      AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
      -- Filtro de fecha
      AND (v_inicio IS NULL OR v.fecha >= v_inicio)
      AND (v_fin    IS NULL OR v.fecha <  v_fin)
      -- Búsqueda libre: tipo+número, solo número, nombre o cédula
      AND (
          v_term IS NULL
          OR v.numero_comprobante::TEXT ILIKE '%' || v_term || '%'
          -- "factura 10", "nota venta 5", "ticket 3"
          -- Usa regex con límites de palabra (\m inicio, \M fin) para evitar que
          -- "ticket 1" coincida con "ticket 10" o "ticket 11"
          OR (REPLACE(v.tipo_comprobante::TEXT, '_', ' ') || ' ' || COALESCE(v.numero_comprobante::TEXT, ''))
                 ~* ('\m' || v_term_regex || '\M')
          OR c.nombre         ILIKE '%' || v_term || '%'
          OR c.identificacion ILIKE '%' || v_term || '%'
      )
    ORDER BY v.fecha DESC
    OFFSET p_page * p_page_size
    LIMIT  p_page_size;
END;
$$;

-- ==========================================
-- PERMISOS
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID, INTEGER);

-- ==========================================
-- FUNCIÓN: fn_resumir_ventas (v1.3)
-- ==========================================
-- Devuelve el total de registros y el monto acumulado de ventas
-- para un filtro de período + búsqueda + estado + turno, SIN paginación.
-- Todos los roles ven todas las ventas. El filtro de turno es solo para ADMIN.
--
-- v1.3 — Simplificado: todos los roles ven todas las ventas. Se elimina p_empleado_id.
-- v1.2 — Agrega: p_turno_id para filtrar ventas de un turno específico.
--
-- Llamada desde: VentasService.resumirVentas()
-- Parámetros:
--   p_filtro    — 'hoy' | 'semana' | 'mes' | 'todo' | 'YYYY-MM-DD'
--   p_busqueda  — término libre (nombre, cédula o nro. comprobante). NULL = sin filtro
--   p_estado    — 'COMPLETADA' | 'ANULADA' | NULL (NULL = solo COMPLETADA)
--   p_turno_id  — UUID del turno. NULL = todos los turnos del período
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_resumir_ventas(
    p_filtro    TEXT    DEFAULT 'hoy',
    p_busqueda  TEXT    DEFAULT NULL,
    p_estado    TEXT    DEFAULT NULL,
    p_turno_id  UUID    DEFAULT NULL
)
RETURNS TABLE (
    total_registros BIGINT,
    total_monto     NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id    UUID;
    v_fecha_local   DATE;
    v_inicio        TIMESTAMPTZ;
    v_fin           TIMESTAMPTZ;
    v_term          TEXT;
    v_term_regex    TEXT;
BEGIN
    -- ── Tenant ──────────────────────────────────────────────────────────────
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- ── Fecha actual en Ecuador ─────────────────────────────────────────────
    v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;

    -- ── Rango de fechas según filtro ────────────────────────────────────────
    IF p_filtro = 'hoy' THEN
        v_inicio := (v_fecha_local::TIMESTAMP         AT TIME ZONE 'America/Guayaquil');
        v_fin    := ((v_fecha_local + 1)::TIMESTAMP   AT TIME ZONE 'America/Guayaquil');

    ELSIF p_filtro = 'semana' THEN
        v_inicio := ((v_fecha_local - (EXTRACT(ISODOW FROM v_fecha_local)::INT - 1) * INTERVAL '1 day')::TIMESTAMP
                     AT TIME ZONE 'America/Guayaquil');
        v_fin    := NULL;

    ELSIF p_filtro = 'mes' THEN
        v_inicio := (DATE_TRUNC('month', v_fecha_local)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin    := NULL;

    ELSIF p_filtro = 'todo' THEN
        v_inicio := NULL;
        v_fin    := NULL;

    ELSE
        -- Se asume 'YYYY-MM-DD' — fecha específica
        v_inicio := (p_filtro::DATE::TIMESTAMP         AT TIME ZONE 'America/Guayaquil');
        v_fin    := ((p_filtro::DATE + 1)::TIMESTAMP   AT TIME ZONE 'America/Guayaquil');
    END IF;

    -- ── Término de búsqueda: trim + versión escapada para regex ────────────
    v_term       := NULLIF(TRIM(p_busqueda), '');
    v_term_regex := regexp_replace(v_term, '([.+*?^${}()|[\]\\])', '\\\1', 'g');

    -- ── Query de agregación ─────────────────────────────────────────────────
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT    AS total_registros,
        COALESCE(SUM(v.total), 0) AS total_monto
    FROM ventas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    WHERE v.negocio_id = v_negocio_id
      AND v.estado = COALESCE(p_estado, 'COMPLETADA')
      -- Filtro de turno (solo ADMIN lo usa desde el frontend)
      AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
      AND (v_inicio IS NULL OR v.fecha >= v_inicio)
      AND (v_fin    IS NULL OR v.fecha <  v_fin)
      AND (
          v_term IS NULL
          OR v.numero_comprobante::TEXT ILIKE '%' || v_term || '%'
          OR (REPLACE(v.tipo_comprobante::TEXT, '_', ' ') || ' ' || COALESCE(v.numero_comprobante::TEXT, ''))
                 ~* ('\m' || v_term_regex || '\M')
          OR c.nombre         ILIKE '%' || v_term || '%'
          OR c.identificacion ILIKE '%' || v_term || '%'
      );
END;
$$;

-- ==========================================
-- PERMISOS
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID, INTEGER);

-- ==========================================
-- FUNCIÓN: fn_reporte_ventas_periodo (v1.4)
-- ==========================================
-- Genera un resumen de ventas para un rango de fechas.
-- Incluye totales generales, desglose por método de pago,
-- por tipo de comprobante, top 5 productos más vendidos
-- y ganancia bruta del período (precio_venta - precio_costo).
-- Las ventas anuladas se reportan aparte (total_anuladas, monto_anulado).
-- Todos los roles ven todas las ventas. El filtro de turno es solo para ADMIN.
--
-- v1.4 — Usa vd.precio_costo (snapshot histórico en ventas_detalles) en lugar de
--   p.precio_costo (precio actual del producto). Los reportes históricos ya no
--   cambian si se modifica el costo de un producto.
-- v1.3 — Simplificado: todos los roles ven todas las ventas. Se elimina p_empleado_id.
-- v1.2 — Agrega: p_turno_id para filtrar ventas de un turno específico.
-- v1.1 — Agrega: costo_total, ganancia_bruta, margen_pct
--
-- Todas las fechas se calculan en zona horaria Ecuador (America/Guayaquil).
-- Usa rango exclusivo [inicio, fin) — patrón obligatorio del proyecto.
--
-- Llamada desde: VentasService.obtenerReportePeriodo(filtro, turnoId?)
-- Parámetros:
--   p_fecha_inicio — Fecha inicio en formato 'YYYY-MM-DD'
--   p_fecha_fin    — Fecha fin en formato 'YYYY-MM-DD' (exclusivo: se suma 1 día internamente)
--   p_turno_id     — UUID del turno. NULL = todos los turnos del período
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_reporte_ventas_periodo(
    p_fecha_inicio TEXT,
    p_fecha_fin    TEXT,
    p_turno_id     UUID    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id      UUID;
    v_inicio          TIMESTAMPTZ;
    v_fin             TIMESTAMPTZ;
    v_total_ventas    BIGINT;
    v_total_monto     NUMERIC(12,2);
    v_total_anuladas  BIGINT;
    v_monto_anulado   NUMERIC(12,2);
    v_costo_total     NUMERIC(12,2);
    v_ganancia_bruta  NUMERIC(12,2);
    v_margen_pct      NUMERIC(5,2);
    v_por_metodo      JSON;
    v_por_comprobante JSON;
    v_top_productos   JSON;
BEGIN
    -- ── Tenant ──────────────────────────────────────────────────────────────
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- ── Rango en zona Ecuador (exclusivo al final) ──
    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- ── Totales de ventas completadas ──
    v_total_ventas := (
        SELECT COALESCE(COUNT(*), 0)
        FROM   ventas
        WHERE  negocio_id = v_negocio_id
          AND  estado = 'COMPLETADA'
          AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND  fecha >= v_inicio
          AND  fecha <  v_fin
    );
    v_total_monto := (
        SELECT COALESCE(SUM(total), 0)
        FROM   ventas
        WHERE  negocio_id = v_negocio_id
          AND  estado = 'COMPLETADA'
          AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND  fecha >= v_inicio
          AND  fecha <  v_fin
    );

    -- ── Totales de ventas anuladas ──
    v_total_anuladas := (
        SELECT COALESCE(COUNT(*), 0)
        FROM   ventas
        WHERE  negocio_id = v_negocio_id
          AND  estado = 'ANULADA'
          AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND  fecha >= v_inicio
          AND  fecha <  v_fin
    );
    v_monto_anulado := (
        SELECT COALESCE(SUM(total), 0)
        FROM   ventas
        WHERE  negocio_id = v_negocio_id
          AND  estado = 'ANULADA'
          AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND  fecha >= v_inicio
          AND  fecha <  v_fin
    );

    -- ── Ganancia bruta: (precio_venta - precio_costo) * unidades ──
    -- precio_costo es el snapshot guardado al momento de la venta → históricamente exacto
    v_costo_total := (
        SELECT COALESCE(SUM(vd.precio_costo * vd.cantidad), 0)
        FROM   ventas_detalles vd
        JOIN   ventas v ON v.id = vd.venta_id
        WHERE  v.negocio_id = v_negocio_id
          AND  v.estado = 'COMPLETADA'
          AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
          AND  v.fecha  >= v_inicio
          AND  v.fecha  <  v_fin
    );
    v_ganancia_bruta := (
        SELECT COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)
        FROM   ventas_detalles vd
        JOIN   ventas v ON v.id = vd.venta_id
        WHERE  v.negocio_id = v_negocio_id
          AND  v.estado = 'COMPLETADA'
          AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
          AND  v.fecha  >= v_inicio
          AND  v.fecha  <  v_fin
    );

    -- ── Margen % (0 si no hay ventas) ──
    v_margen_pct := CASE
        WHEN v_total_monto > 0
        THEN ROUND((v_ganancia_bruta / v_total_monto) * 100, 2)
        ELSE 0
    END;

    -- ── Desglose por método de pago (solo completadas) ──
    v_por_metodo := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT metodo_pago AS metodo,
                   COUNT(*)    AS cantidad,
                   SUM(total)  AS monto
            FROM   ventas
            WHERE  negocio_id = v_negocio_id
              AND  estado = 'COMPLETADA'
              AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
              AND  fecha >= v_inicio
              AND  fecha <  v_fin
            GROUP BY metodo_pago
            ORDER BY SUM(total) DESC
        ) t
    );

    -- ── Desglose por tipo de comprobante (solo completadas) ──
    v_por_comprobante := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT tipo_comprobante::TEXT AS tipo,
                   COUNT(*)              AS cantidad,
                   SUM(total)            AS monto
            FROM   ventas
            WHERE  negocio_id = v_negocio_id
              AND  estado = 'COMPLETADA'
              AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
              AND  fecha >= v_inicio
              AND  fecha <  v_fin
            GROUP BY tipo_comprobante
            ORDER BY SUM(total) DESC
        ) t
    );

    -- ── Top 5 productos más vendidos (solo ventas completadas) ──
    v_top_productos := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT p.id               AS producto_id,
                   p.nombre           AS nombre,
                   SUM(vd.cantidad)   AS total_unidades,
                   SUM(vd.subtotal)   AS total_monto,
                   COUNT(DISTINCT v.id) AS total_ventas
            FROM   ventas_detalles vd
            JOIN   ventas   v ON v.id = vd.venta_id
            JOIN   productos p ON p.id = vd.producto_id
            WHERE  v.negocio_id = v_negocio_id
              AND  v.estado = 'COMPLETADA'
              AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
              AND  v.fecha  >= v_inicio
              AND  v.fecha  <  v_fin
            GROUP BY p.id, p.nombre
            ORDER BY SUM(vd.cantidad) DESC
            LIMIT 5
        ) t
    );

    -- ── Resultado ──
    RETURN json_build_object(
        'fecha_inicio',         p_fecha_inicio,
        'fecha_fin',            p_fecha_fin,
        'total_ventas',         v_total_ventas,
        'total_monto',          v_total_monto,
        'total_anuladas',       v_total_anuladas,
        'monto_anulado',        v_monto_anulado,
        'costo_total',          v_costo_total,
        'ganancia_bruta',       v_ganancia_bruta,
        'margen_pct',           v_margen_pct,
        'por_metodo_pago',      v_por_metodo,
        'por_tipo_comprobante', v_por_comprobante,
        'top_productos',        v_top_productos
    );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reporte_ventas_periodo IS
    'v1.4 — Usa vd.precio_costo (snapshot histórico) para cálculo de ganancia bruta. '
    'v1.3 — Resumen de ventas de un período: totales, ganancia bruta, margen %, '
    'desglose por método de pago, tipo de comprobante y top 5 productos más vendidos '
    '(solo COMPLETADAS). Filtro opcional por turno (solo ADMIN lo usa desde el frontend). '
    'Todos los roles ven todas las ventas. Fechas en zona Ecuador (America/Guayaquil).';
-- ==========================================
-- FUNCION: fn_registrar_adelanto_sueldo (v2.0 — multi-tenant UUID)
-- ==========================================
-- Registra un adelanto de sueldo como transaccion atomica.
-- El sistema elige automaticamente de que caja sacar: VARIOS primero, luego CAJA (Tienda).
-- CAJA_CHICA no se usa porque se resetea diariamente en el cierre.
--
-- CAMBIOS v2.0:
--   - p_empleado_id, p_beneficiario_id: INTEGER → UUID
--   - v_varios_id, v_caja_id, v_cat_adelanto_id, v_tipo_ref_id: INTEGER → UUID
--   - Negocio leído del JWT (get_negocio_id()); todas las queries filtran por negocio_id
--   - operaciones_cajas y movimientos_empleados INSERT incluyen negocio_id
--   - Validacion de beneficiario activo: usa usuario_negocios (antes buscaba activo en usuarios)
--
-- HEREDA DE v1.1:
--   - No requiere turno abierto (el admin puede dar un adelanto en cualquier momento)
--   - Distribuye automaticamente: VARIOS primero, luego CAJA (Tienda). CAJA_CHICA excluida.
--
-- Flujo:
--   1. Validar monto, beneficiario y fondos disponibles
--   2. Distribuir monto entre cajas (VARIOS → CAJA)
--   3. Registrar EGRESO(s) en operaciones_cajas con categoria EG-014
--   4. Registrar ADELANTO_SUELDO en movimientos_empleados
--   5. Retornar JSON con instrucciones fisicas
--
-- Llamada desde: MovimientosEmpleadosService.registrarAdelanto()
-- ==========================================

-- DROP previo necesario porque cambia la firma
DROP FUNCTION IF EXISTS public.fn_registrar_adelanto_sueldo(UUID, INTEGER, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_registrar_adelanto_sueldo(INTEGER, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_registrar_adelanto_sueldo(UUID, UUID, DECIMAL, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_registrar_adelanto_sueldo(
  p_empleado_id     UUID,        -- quien opera (admin que autoriza)
  p_beneficiario_id UUID,        -- a quien se le da el adelanto
  p_monto           DECIMAL(12,2),
  p_descripcion     TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id         UUID;
  v_varios_id          UUID;
  v_caja_id            UUID;
  v_saldo_varios       DECIMAL(12,2);
  v_saldo_caja         DECIMAL(12,2);
  v_monto_de_varios    DECIMAL(12,2);
  v_monto_de_caja      DECIMAL(12,2);
  v_cat_adelanto_id    UUID;
  v_tipo_ref_id        INTEGER;
  v_op_varios_id       UUID;
  v_op_caja_id         UUID;
  v_mov_id             UUID;
  v_beneficiario_nombre VARCHAR(255);
  v_instrucciones      JSON;
BEGIN
  -- ==========================================
  -- OBTENER NEGOCIO DEL JWT
  -- ==========================================

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  -- ==========================================
  -- VALIDACIONES
  -- ==========================================

  IF p_monto <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto debe ser mayor a cero');
  END IF;

  -- Validar beneficiario activo en este negocio (activo vive en usuario_negocios, no en usuarios)
  v_beneficiario_nombre := (
    SELECT u.nombre
    FROM usuarios u
    INNER JOIN usuario_negocios un ON un.usuario_id = u.id
    WHERE u.id = p_beneficiario_id
      AND un.negocio_id = v_negocio_id
      AND un.activo = TRUE
  );
  IF v_beneficiario_nombre IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no existe o no esta activo en este negocio');
  END IF;

  v_cat_adelanto_id := (SELECT id FROM categorias_operaciones WHERE tipo = 'EGRESO' AND nombre = 'Adelanto Sueldo Empleado' AND negocio_id = v_negocio_id LIMIT 1);

  IF v_cat_adelanto_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Categoria EG-014 no encontrada');
  END IF;

  v_tipo_ref_id := (SELECT id FROM tipos_referencia WHERE tabla = 'movimientos_empleados');
  IF v_tipo_ref_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Tipo de referencia movimientos_empleados no encontrado en tipos_referencia');
  END IF;

  -- ==========================================
  -- DISTRIBUCION ENTRE CAJAS (VARIOS → CAJA)
  -- ==========================================

  v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);
  v_caja_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA'   AND negocio_id = v_negocio_id);

  PERFORM id FROM cajas WHERE id IN (v_varios_id, v_caja_id) AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id);
  v_saldo_caja   := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id   AND negocio_id = v_negocio_id);

  v_monto_de_varios := LEAST(p_monto, v_saldo_varios);
  v_monto_de_caja   := p_monto - v_monto_de_varios;

  IF v_monto_de_caja > v_saldo_caja THEN
    RETURN json_build_object(
      'success', false,
      'error', format(
        'Fondos insuficientes. Varios: $%s, Tienda: $%s, Total disponible: $%s, Monto solicitado: $%s',
        TO_CHAR(v_saldo_varios, 'FM999990.00'),
        TO_CHAR(v_saldo_caja, 'FM999990.00'),
        TO_CHAR(v_saldo_varios + v_saldo_caja, 'FM999990.00'),
        TO_CHAR(p_monto, 'FM999990.00')
      )
    );
  END IF;

  -- ==========================================
  -- MOVIMIENTO DEL EMPLEADO (primero para obtener el ID)
  -- ==========================================

  v_mov_id := gen_random_uuid();

  INSERT INTO movimientos_empleados (
    id, negocio_id, empleado_id, tipo_movimiento, monto,
    descripcion, creado_por
  ) VALUES (
    v_mov_id, v_negocio_id, p_beneficiario_id,
    'ADELANTO_SUELDO',
    p_monto,
    COALESCE(p_descripcion, 'Adelanto de sueldo'),
    p_empleado_id
  );

  -- ==========================================
  -- EGRESOS DE CAJAS
  -- ==========================================

  IF v_monto_de_varios > 0 THEN
    v_op_varios_id := gen_random_uuid();

    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      v_op_varios_id, v_negocio_id, v_varios_id, p_empleado_id, 'EGRESO', v_cat_adelanto_id,
      v_tipo_ref_id, v_mov_id,
      v_monto_de_varios, v_saldo_varios, v_saldo_varios - v_monto_de_varios,
      format('Adelanto de sueldo a %s', v_beneficiario_nombre),
      p_comprobante_url
    );

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_varios WHERE id = v_varios_id AND negocio_id = v_negocio_id;
  END IF;

  IF v_monto_de_caja > 0 THEN
    v_op_caja_id := gen_random_uuid();

    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      v_op_caja_id, v_negocio_id, v_caja_id, p_empleado_id, 'EGRESO', v_cat_adelanto_id,
      v_tipo_ref_id, v_mov_id,
      v_monto_de_caja, v_saldo_caja, v_saldo_caja - v_monto_de_caja,
      format('Adelanto de sueldo a %s', v_beneficiario_nombre),
      p_comprobante_url
    );

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_caja WHERE id = v_caja_id AND negocio_id = v_negocio_id;
  END IF;

  -- ==========================================
  -- INSTRUCCIONES FISICAS
  -- ==========================================

  v_instrucciones := (
    SELECT json_agg(x)
    FROM (
      SELECT * FROM (VALUES
        ('Varios', 'VARIOS', v_monto_de_varios),
        ('Tienda', 'CAJA',   v_monto_de_caja)
      ) AS t(caja, codigo, monto)
      WHERE monto > 0
    ) x
  );

  -- ==========================================
  -- RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',                true,
    'movimiento_id',          v_mov_id,
    'monto',                  p_monto,
    'beneficiario',           v_beneficiario_nombre,
    'instrucciones_fisicas',  COALESCE(v_instrucciones, '[]'::JSON),
    'operaciones_ids',        json_build_array(v_op_varios_id, v_op_caja_id)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_registrar_adelanto_sueldo(UUID, UUID, DECIMAL, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_adelanto_sueldo(UUID, UUID, DECIMAL, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_adelanto_sueldo IS
  'v2.0 (multi-tenant UUID) - Registra adelanto de sueldo como transaccion atomica. No requiere turno abierto. '
  'El admin puede dar un adelanto en cualquier momento desde cualquier dispositivo. '
  'Distribuye automaticamente: VARIOS primero, luego CAJA (Tienda). CAJA_CHICA excluida. '
  'Valida beneficiario activo en usuario_negocios (no en usuarios.activo — columna eliminada en v11). '
  'Registra EGRESO(s) en operaciones_cajas (EG-014) + ADELANTO_SUELDO en movimientos_empleados. '
  'Retorna instrucciones fisicas para que el admin sepa de que sobres sacar el efectivo.';
-- ==========================================
-- FUNCION: fn_pagar_nomina_empleado (v2.0 — multi-tenant UUID)
-- ==========================================
-- Liquida la cuenta corriente de un empleado como transaccion atomica.
-- El sistema elige automaticamente de que cajas sacar: VARIOS primero, luego CAJA (Tienda).
-- CAJA_CHICA no se usa — solo VARIOS y CAJA (cajas permanentes, no requieren turno).
--
-- CAMBIOS v2.0:
--   - p_empleado_id, p_beneficiario_id: INTEGER → UUID
--   - v_varios_id, v_caja_id, v_cat_salarios_id: INTEGER → UUID
--   - v_tipo_ref_id: INTEGER → INTEGER (tipos_referencia.id sigue siendo INTEGER en schema)
--   - Negocio leído del JWT (get_negocio_id()); todas las queries filtran por negocio_id
--   - operaciones_cajas y movimientos_empleados INSERT incluyen negocio_id
--   - Validacion de beneficiario activo: usa usuario_negocios (antes buscaba activo en usuarios)
--   - Fix Supabase: RETURNING id INTO → pattern gen_random_uuid() + := (SELECT ...)
--
-- HEREDA DE v1.1:
--   - No requiere turno abierto
--   - Inserta SUELDO_BASE, calcula descuentos pendientes, distribuye entre VARIOS→CAJA,
--     inserta PAGO_NOMINA, marca pendientes como LIQUIDADO
--
-- Llamada desde: MovimientosEmpleadosService.pagarNomina()
-- ==========================================

-- DROP previo necesario porque cambia la firma
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(UUID, INTEGER, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(INTEGER, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_pagar_nomina_empleado(
  p_empleado_id     UUID,        -- quien opera (admin que autoriza)
  p_beneficiario_id UUID,        -- a quien se le paga
  p_sueldo_base     DECIMAL(12,2),  -- sueldo bruto del periodo
  p_descripcion     TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id          UUID;
  v_varios_id           UUID;
  v_caja_id             UUID;
  v_saldo_varios        DECIMAL(12,2);
  v_saldo_caja          DECIMAL(12,2);
  v_cat_salarios_id     UUID;
  v_beneficiario_nombre VARCHAR(255);

  v_total_descuentos  DECIMAL(12,2) := 0;
  v_liquido           DECIMAL(12,2);
  v_monto_de_varios   DECIMAL(12,2);
  v_monto_de_caja     DECIMAL(12,2);

  v_tipo_ref_id       INTEGER;
  v_op_varios_id      UUID;
  v_op_caja_id        UUID;
  v_mov_sueldo_id     UUID;
  v_mov_pago_id       UUID;

  v_detalle_descuentos JSON;
  v_instrucciones      JSON;
BEGIN
  -- ==========================================
  -- OBTENER NEGOCIO DEL JWT
  -- ==========================================

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  -- ==========================================
  -- VALIDACIONES
  -- ==========================================

  IF p_sueldo_base <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El sueldo base debe ser mayor a cero');
  END IF;

  -- Validar beneficiario activo en este negocio (activo vive en usuario_negocios, no en usuarios)
  v_beneficiario_nombre := (
    SELECT u.nombre
    FROM usuarios u
    INNER JOIN usuario_negocios un ON un.usuario_id = u.id
    WHERE u.id = p_beneficiario_id
      AND un.negocio_id = v_negocio_id
      AND un.activo = TRUE
  );
  IF v_beneficiario_nombre IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no existe o no esta activo en este negocio');
  END IF;

  v_cat_salarios_id := (SELECT id FROM categorias_operaciones WHERE tipo = 'EGRESO' AND nombre = 'Salarios' AND negocio_id = v_negocio_id LIMIT 1);

  IF v_cat_salarios_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Categoria EG-007 (Salarios) no encontrada');
  END IF;

  v_tipo_ref_id := (SELECT id FROM tipos_referencia WHERE tabla = 'movimientos_empleados');
  IF v_tipo_ref_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Tipo de referencia movimientos_empleados no encontrado en tipos_referencia');
  END IF;

  -- ==========================================
  -- 1. INSERTAR SUELDO_BASE
  -- ==========================================

  v_mov_sueldo_id := gen_random_uuid();

  INSERT INTO movimientos_empleados (
    id, negocio_id, empleado_id, tipo_movimiento, monto, descripcion, creado_por
  ) VALUES (
    v_mov_sueldo_id, v_negocio_id, p_beneficiario_id,
    'SUELDO_BASE',
    p_sueldo_base,
    COALESCE(p_descripcion, 'Sueldo del periodo'),
    p_empleado_id
  );

  -- ==========================================
  -- 2. CALCULAR DESCUENTOS PENDIENTES
  -- ==========================================

  v_total_descuentos := (
    SELECT COALESCE(SUM(monto), 0)
    FROM movimientos_empleados
    WHERE empleado_id = p_beneficiario_id
      AND negocio_id = v_negocio_id
      AND estado_liquidacion = 'PENDIENTE'
      AND tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'AJUSTE_CARGO')
      AND id != v_mov_sueldo_id
  );

  v_detalle_descuentos := (
    SELECT COALESCE(json_agg(json_build_object(
      'tipo', tipo_movimiento::TEXT,
      'monto', monto,
      'fecha', TO_CHAR(fecha, 'YYYY-MM-DD'),
      'descripcion', COALESCE(descripcion, '')
    ) ORDER BY fecha), '[]'::JSON)
    FROM movimientos_empleados
    WHERE empleado_id = p_beneficiario_id
      AND negocio_id = v_negocio_id
      AND estado_liquidacion = 'PENDIENTE'
      AND tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'AJUSTE_CARGO')
      AND id != v_mov_sueldo_id
  );

  -- ==========================================
  -- 3. CALCULAR LIQUIDO
  -- ==========================================

  v_liquido := p_sueldo_base - v_total_descuentos;

  -- ==========================================
  -- 4. SI LIQUIDO <= 0: DESCUENTOS ABSORBEN TODO
  -- ==========================================

  IF v_liquido <= 0 THEN
    v_mov_pago_id := gen_random_uuid();

    INSERT INTO movimientos_empleados (
      id, negocio_id, empleado_id, tipo_movimiento, monto, descripcion, creado_por
    ) VALUES (
      v_mov_pago_id, v_negocio_id, p_beneficiario_id,
      'PAGO_NOMINA',
      p_sueldo_base,
      'Sueldo absorbido por descuentos pendientes — no sale efectivo de caja',
      p_empleado_id
    );

    UPDATE movimientos_empleados
    SET estado_liquidacion = 'LIQUIDADO',
        liquidado_en = v_mov_pago_id
    WHERE empleado_id = p_beneficiario_id
      AND negocio_id = v_negocio_id
      AND estado_liquidacion = 'PENDIENTE';

    RETURN json_build_object(
      'success',               true,
      'sueldo_bruto',          p_sueldo_base,
      'total_descuentos',      v_total_descuentos,
      'detalle_descuentos',    v_detalle_descuentos,
      'liquido_pagado',        0,
      'instrucciones_fisicas', '[]'::JSON,
      'operaciones_ids',       '[]'::JSON,
      'mensaje',               'El sueldo fue absorbido por los descuentos pendientes. No sale efectivo de caja.'
    );
  END IF;

  -- ==========================================
  -- 5. LIQUIDO > 0: DISTRIBUIR ENTRE CAJAS
  -- ==========================================

  v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);
  v_caja_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA'   AND negocio_id = v_negocio_id);

  PERFORM id FROM cajas WHERE id IN (v_varios_id, v_caja_id) AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id);
  v_saldo_caja   := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id   AND negocio_id = v_negocio_id);

  v_monto_de_varios := LEAST(v_liquido, v_saldo_varios);
  v_monto_de_caja   := v_liquido - v_monto_de_varios;

  IF v_monto_de_caja > v_saldo_caja THEN
    RAISE EXCEPTION 'Fondos insuficientes. Varios: $%, Tienda: $%, Total: $%, Necesario: $%',
      TO_CHAR(v_saldo_varios, 'FM999990.00'),
      TO_CHAR(v_saldo_caja, 'FM999990.00'),
      TO_CHAR(v_saldo_varios + v_saldo_caja, 'FM999990.00'),
      TO_CHAR(v_liquido, 'FM999990.00');
  END IF;

  -- ==========================================
  -- 6. PAGO_NOMINA (gen_random_uuid() para evitar RETURNING INTO — bug Supabase)
  -- ==========================================

  v_mov_pago_id := gen_random_uuid();

  INSERT INTO movimientos_empleados (
    id, negocio_id, empleado_id, tipo_movimiento, monto,
    descripcion, creado_por
  ) VALUES (
    v_mov_pago_id, v_negocio_id, p_beneficiario_id,
    'PAGO_NOMINA',
    v_liquido,
    COALESCE(p_descripcion, format('Pago nomina — bruto $%s, descuentos $%s, liquido $%s',
      TO_CHAR(p_sueldo_base, 'FM999990.00'),
      TO_CHAR(v_total_descuentos, 'FM999990.00'),
      TO_CHAR(v_liquido, 'FM999990.00')
    )),
    p_empleado_id
  );

  -- Egreso de VARIOS
  IF v_monto_de_varios > 0 THEN
    v_op_varios_id := gen_random_uuid();
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      v_op_varios_id, v_negocio_id, v_varios_id, p_empleado_id, 'EGRESO', v_cat_salarios_id,
      v_tipo_ref_id, v_mov_pago_id,
      v_monto_de_varios, v_saldo_varios, v_saldo_varios - v_monto_de_varios,
      format('Pago nomina a %s', v_beneficiario_nombre),
      p_comprobante_url
    );

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_varios WHERE id = v_varios_id AND negocio_id = v_negocio_id;
  END IF;

  -- Egreso de CAJA/Tienda
  IF v_monto_de_caja > 0 THEN
    v_op_caja_id := gen_random_uuid();
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      v_op_caja_id, v_negocio_id, v_caja_id, p_empleado_id, 'EGRESO', v_cat_salarios_id,
      v_tipo_ref_id, v_mov_pago_id,
      v_monto_de_caja, v_saldo_caja, v_saldo_caja - v_monto_de_caja,
      format('Pago nomina a %s', v_beneficiario_nombre),
      p_comprobante_url
    );

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_caja WHERE id = v_caja_id AND negocio_id = v_negocio_id;
  END IF;

  UPDATE movimientos_empleados
  SET estado_liquidacion = 'LIQUIDADO',
      liquidado_en = v_mov_pago_id
  WHERE empleado_id = p_beneficiario_id
    AND negocio_id = v_negocio_id
    AND estado_liquidacion = 'PENDIENTE';

  -- ==========================================
  -- 7. INSTRUCCIONES FISICAS
  -- ==========================================

  v_instrucciones := (
    SELECT json_agg(x)
    FROM (
      SELECT * FROM (VALUES
        ('Varios', 'VARIOS', v_monto_de_varios),
        ('Tienda', 'CAJA',   v_monto_de_caja)
      ) AS t(caja, codigo, monto)
      WHERE monto > 0
    ) x
  );

  -- ==========================================
  -- RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',                true,
    'sueldo_bruto',           p_sueldo_base,
    'total_descuentos',       v_total_descuentos,
    'detalle_descuentos',     v_detalle_descuentos,
    'liquido_pagado',         v_liquido,
    'beneficiario',           v_beneficiario_nombre,
    'instrucciones_fisicas',  COALESCE(v_instrucciones, '[]'::JSON),
    'operaciones_ids',        json_build_array(v_op_varios_id, v_op_caja_id)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_pagar_nomina_empleado(UUID, UUID, DECIMAL, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_pagar_nomina_empleado IS
  'v2.0 (multi-tenant UUID) - Liquida la cuenta corriente de un empleado como transaccion atomica. No requiere turno abierto. '
  'Solo requieren turno las operaciones sobre CAJA_CHICA (cajon diario). VARIOS y CAJA son cajas permanentes. '
  'Valida beneficiario activo en usuario_negocios (no en usuarios.activo — columna eliminada en v11). '
  'Inserta SUELDO_BASE, calcula descuentos pendientes (faltantes + adelantos + ajustes cargo), '
  'distribuye el liquido entre VARIOS y CAJA automaticamente, registra EGRESO(s), '
  'inserta PAGO_NOMINA y marca todos los movimientos PENDIENTE como LIQUIDADO. '
  'Retorna desglose completo con instrucciones fisicas para el admin.';
-- ============================================================
-- fn_eliminar_nota
-- Elimina una nota solo si el usuario autenticado tiene rol ADMIN.
-- El rol se lee del JWT claim 'rol' (sincronizado por trigger fn_sync_rol_to_jwt).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_eliminar_nota(
    p_nota_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;
    v_rol        TEXT;
BEGIN
    -- Obtener negocio y rol desde el JWT
    v_negocio_id := public.get_negocio_id();
    v_rol        := auth.jwt() ->> 'rol';

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    IF v_rol IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Solo ADMIN puede eliminar notas
    IF v_rol <> 'ADMIN' THEN
        RAISE EXCEPTION 'Sin permisos para eliminar notas';
    END IF;

    -- Eliminar la nota (solo del negocio activo)
    DELETE FROM notas WHERE id = p_nota_id AND negocio_id = v_negocio_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota no encontrada';
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_eliminar_nota(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_eliminar_nota(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- fn_registrar_usuario_negocio
-- =============================================================================
-- Registra un usuario en el negocio activo del llamador (rol ADMIN requerido).
-- SECURITY DEFINER: bypasea RLS para poder insertar en `usuarios` cuando el
-- nuevo usuario aún no comparte negocio con el admin (la política UPDATE de
-- usuarios requiere comparten_negocio, que aún no existe antes del INSERT).
--
-- Flujo:
--   1. Valida que el llamador sea ADMIN del negocio activo
--   2. Busca si el email ya existe en `usuarios` (usuario de otro negocio)
--   3. Si no existe → INSERT en `usuarios`
--   4. INSERT en `usuario_negocios` (membresía en el negocio activo)
--
-- Retorna JSON: { usuario_id, membresia_id, nombre, email, es_superadmin, created_at }
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_registrar_usuario_negocio(
    p_nombre TEXT,
    p_email  TEXT,
    p_rol    TEXT  -- 'ADMIN' | 'EMPLEADO'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id   UUID;
    v_rol_caller   TEXT;
    v_usuario_id   UUID;
    v_membresia_id UUID;
    v_nombre       TEXT;
    v_email        TEXT;
    v_es_superadmin BOOLEAN;
    v_created_at   TIMESTAMPTZ;
BEGIN
    v_negocio_id := public.get_negocio_id();
    v_rol_caller := auth.jwt() -> 'app_metadata' ->> 'rol';

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    IF v_rol_caller <> 'ADMIN' THEN
        RAISE EXCEPTION 'Solo los administradores pueden registrar usuarios';
    END IF;

    IF p_rol NOT IN ('ADMIN', 'EMPLEADO') THEN
        RAISE EXCEPTION 'Rol inválido: %. Use ADMIN o EMPLEADO', p_rol;
    END IF;

    v_email  := LOWER(TRIM(p_email));
    v_nombre := TRIM(p_nombre);

    IF v_email = '' THEN
        RAISE EXCEPTION 'El email es obligatorio';
    END IF;

    -- Buscar si el usuario ya existe
    v_usuario_id    := (SELECT id            FROM usuarios WHERE email = v_email);
    v_nombre        := COALESCE((SELECT nombre       FROM usuarios WHERE email = v_email), v_nombre);
    v_es_superadmin := COALESCE((SELECT es_superadmin FROM usuarios WHERE email = v_email), FALSE);
    v_created_at    := (SELECT created_at    FROM usuarios WHERE email = v_email);

    IF v_usuario_id IS NULL THEN
        -- Usuario nuevo → nombre es obligatorio
        IF v_nombre = '' THEN
            RAISE EXCEPTION 'El usuario con email % no existe en el sistema. Registralo primero con nombre.', v_email;
        END IF;
        v_usuario_id := gen_random_uuid();
        INSERT INTO usuarios (id, nombre, email, es_superadmin)
        VALUES (v_usuario_id, v_nombre, v_email, FALSE);
        v_es_superadmin := FALSE;
        v_created_at    := NOW();
    END IF;

    -- Crear membresía (falla si ya existe en este negocio)
    v_membresia_id := gen_random_uuid();
    INSERT INTO usuario_negocios (id, usuario_id, negocio_id, rol, activo)
    VALUES (v_membresia_id, v_usuario_id, v_negocio_id, p_rol::rol_usuario_enum, TRUE);

    RETURN json_build_object(
        'usuario_id',    v_usuario_id,
        'membresia_id',  v_membresia_id,
        'nombre',        v_nombre,
        'email',         v_email,
        'es_superadmin', v_es_superadmin,
        'created_at',    v_created_at
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Este usuario ya pertenece al negocio';
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error al registrar usuario: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_usuario_negocio(TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_usuario_negocio(TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_transferir_empleado
-- Transfiere un empleado de su negocio actual a otro negocio destino.
-- Desactiva la membresía origen y crea/reactiva la membresía destino.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_transferir_empleado(
    p_membresia_id       UUID,
    p_negocio_destino_id UUID,
    p_rol                TEXT DEFAULT 'EMPLEADO'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id   UUID;
    v_negocio_orig UUID;
BEGIN
    -- Solo ADMIN o superadmin puede transferir
    IF public.get_rol() <> 'ADMIN' AND NOT public.get_es_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    -- Obtener datos de la membresía origen
    v_usuario_id   := (SELECT usuario_id FROM usuario_negocios WHERE id = p_membresia_id);
    v_negocio_orig := (SELECT negocio_id FROM usuario_negocios WHERE id = p_membresia_id);

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Membresía no encontrada';
    END IF;

    -- Solo se puede transferir si la membresía está activa en el negocio origen
    IF NOT (SELECT activo FROM usuario_negocios WHERE id = p_membresia_id) THEN
        RAISE EXCEPTION 'El empleado ya está inactivo en este negocio y no puede ser transferido';
    END IF;

    -- No transferir al mismo negocio
    IF v_negocio_orig = p_negocio_destino_id THEN
        RAISE EXCEPTION 'El negocio destino es el mismo que el origen';
    END IF;

    -- Desactivar membresía origen
    UPDATE usuario_negocios
    SET activo = FALSE
    WHERE id = p_membresia_id;

    -- Crear o reactivar membresía destino
    INSERT INTO usuario_negocios (usuario_id, negocio_id, rol, activo)
    VALUES (v_usuario_id, p_negocio_destino_id, p_rol::rol_usuario_enum, TRUE)
    ON CONFLICT (usuario_id, negocio_id)
    DO UPDATE SET activo = TRUE, rol = EXCLUDED.rol;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_transferir_empleado(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_transferir_empleado(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

NOTIFY pgrst, 'reload schema';
