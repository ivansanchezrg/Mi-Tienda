-- =============================================================================
-- fn_completar_onboarding — Crear negocio + configuración inicial en una sola transacción
-- =============================================================================
-- Reemplaza el flujo multi-paso del onboarding frontend que guardaba por partes.
-- Todo o nada: si falla cualquier paso, rollback completo.
--
-- Parámetros:
--   p_nombre_negocio        VARCHAR  — Nombre del negocio (requerido)
--   p_admin_email           VARCHAR  — Email del admin (debe existir en auth.users)
--   p_admin_nombre          VARCHAR  — Nombre del admin (para crear fila en usuarios si no existe)
--   p_negocio_telefono      VARCHAR  — Teléfono del negocio (opcional, puede ser '')
--   p_negocio_direccion     VARCHAR  — Dirección del negocio (opcional, puede ser '')
--   p_caja_fondo_fijo       DECIMAL  — Fondo fijo del cajón al inicio de cada turno (>= 0)
--   p_varios_activa         BOOLEAN  — Si true, activa la caja Varios y la transferencia diaria
--   p_caja_varios_monto     DECIMAL  — Monto diario a transferir a Varios al cierre (> 0 si varios_activa)
--   p_nomina_sueldo_base    DECIMAL  — Sueldo base mensual de empleados (>= 0)
--   p_propietario_email     VARCHAR  — (opcional) Email del propietario/dueño del negocio.
--                                       Si NULL → propietario = admin (caso onboarding inicial / admin comun creando sucursal).
--                                       Si difiere de p_admin_email → solo el superadmin puede invocarlo.
--
-- Retorna: JSON con { negocio_id, usuario_id, propietario_id, success }
--
-- Seguridad: SECURITY DEFINER — el JWT del llamador aún no tiene negocio_id.
-- Restricciones (validadas internamente):
--   - Admin comun: solo puede crear negocios con su propio email como admin Y como propietario
--   - Superadmin: puede crear con cualquier admin/propietario
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_completar_onboarding(
    p_nombre_negocio     VARCHAR,
    p_admin_email        VARCHAR,
    p_admin_nombre       VARCHAR  DEFAULT NULL,
    p_negocio_telefono   VARCHAR  DEFAULT '',
    p_negocio_direccion  VARCHAR  DEFAULT '',
    p_caja_fondo_fijo    DECIMAL  DEFAULT 0,
    p_varios_activa      BOOLEAN  DEFAULT FALSE,
    p_caja_varios_monto  DECIMAL  DEFAULT 0,
    p_nomina_sueldo_base DECIMAL  DEFAULT 0,
    -- Email del propietario (dueño) del nuevo negocio.
    -- Si no se especifica, el propietario es el mismo admin (caso onboarding inicial o admin comun creando sucursal).
    -- Si difiere de p_admin_email, solo el superadmin puede invocarlo (caso sucursal creada por superadmin para un dueño existente).
    p_propietario_email  VARCHAR  DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id          UUID;
    v_usuario_id          UUID;          -- usuario admin del nuevo negocio
    v_propietario_id      UUID;          -- usuario dueño/propietario del nuevo negocio
    v_propietario_email   VARCHAR;       -- email normalizado del propietario
    v_caller_es_superadmin BOOLEAN;
BEGIN
    -- ── Validaciones ──
    IF TRIM(p_nombre_negocio) = '' OR p_nombre_negocio IS NULL THEN
        RAISE EXCEPTION 'El nombre del negocio no puede estar vacío';
    END IF;
    IF TRIM(p_admin_email) = '' OR p_admin_email IS NULL THEN
        RAISE EXCEPTION 'El email del admin no puede estar vacío';
    END IF;
    IF p_caja_fondo_fijo < 0 THEN
        RAISE EXCEPTION 'El fondo fijo del cajón no puede ser negativo';
    END IF;
    IF p_varios_activa AND (p_caja_varios_monto IS NULL OR p_caja_varios_monto <= 0) THEN
        RAISE EXCEPTION 'Si activás Caja Varios, el monto diario debe ser mayor a cero';
    END IF;
    IF p_nomina_sueldo_base < 0 THEN
        RAISE EXCEPTION 'El sueldo base no puede ser negativo';
    END IF;

    -- Resolver propietario: si no se pasa, es el mismo admin
    v_propietario_email := LOWER(TRIM(COALESCE(NULLIF(TRIM(p_propietario_email), ''), p_admin_email)));

    v_caller_es_superadmin := COALESCE((SELECT es_superadmin FROM usuarios WHERE email = (auth.jwt() ->> 'email')), FALSE);

    -- Seguridad: solo el propio usuario puede crear su negocio
    -- Excepción: superadmin puede crear para cualquier email
    IF NOT v_caller_es_superadmin THEN
        IF LOWER(TRIM(p_admin_email)) != LOWER(TRIM(auth.jwt() ->> 'email')) THEN
            RAISE EXCEPTION 'No puedes crear un negocio para otro usuario';
        END IF;
        -- Un admin comun no puede declarar a otra persona como propietario
        IF v_propietario_email != LOWER(TRIM(auth.jwt() ->> 'email')) THEN
            RAISE EXCEPTION 'No puedes asignar a otro usuario como propietario del negocio';
        END IF;
    END IF;

    -- ── 1. Crear/obtener usuario admin ──
    v_usuario_id := (SELECT id FROM usuarios WHERE email = LOWER(TRIM(p_admin_email)));

    IF v_usuario_id IS NULL THEN
        v_usuario_id := gen_random_uuid();
        INSERT INTO usuarios (id, nombre, email, es_superadmin)
        VALUES (
            v_usuario_id,
            COALESCE(NULLIF(TRIM(p_admin_nombre), ''), SPLIT_PART(p_admin_email, '@', 1)),
            LOWER(TRIM(p_admin_email)),
            FALSE
        );
    END IF;

    -- ── 2. Resolver/obtener usuario propietario ──
    -- Si el propietario coincide con el admin, reusamos el mismo registro.
    IF v_propietario_email = LOWER(TRIM(p_admin_email)) THEN
        v_propietario_id := v_usuario_id;
    ELSE
        v_propietario_id := (SELECT id FROM usuarios WHERE email = v_propietario_email);
        IF v_propietario_id IS NULL THEN
            -- El superadmin esta creando una sucursal para un email que no existe aun
            -- (caso raro pero valido). Creamos el registro de usuario base.
            v_propietario_id := gen_random_uuid();
            INSERT INTO usuarios (id, nombre, email, es_superadmin)
            VALUES (
                v_propietario_id,
                SPLIT_PART(v_propietario_email, '@', 1),
                v_propietario_email,
                FALSE
            );
        END IF;
    END IF;

    -- ── 3. Negocio ──
    v_negocio_id := gen_random_uuid();
    INSERT INTO negocios (id, nombre, slug, propietario_usuario_id)
    VALUES (
        v_negocio_id,
        TRIM(p_nombre_negocio),
        TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(TRIM(p_nombre_negocio)), '[^a-z0-9]+', '-', 'g')),
        v_propietario_id
    );

    -- ── 4. Membresia ADMIN del admin en el nuevo negocio ──
    INSERT INTO usuario_negocios (usuario_id, negocio_id, rol, activo)
    VALUES (v_usuario_id, v_negocio_id, 'ADMIN', TRUE)
    ON CONFLICT (usuario_id, negocio_id) DO UPDATE SET rol = 'ADMIN', activo = TRUE;

    -- ── 4b. Si el propietario es distinto del admin, tambien le damos membresia ADMIN ──
    -- Asi el dueño puede entrar a su sucursal aunque no se haya autoasignado como admin operativo.
    IF v_propietario_id != v_usuario_id THEN
        INSERT INTO usuario_negocios (usuario_id, negocio_id, rol, activo)
        VALUES (v_propietario_id, v_negocio_id, 'ADMIN', TRUE)
        ON CONFLICT (usuario_id, negocio_id) DO UPDATE SET rol = 'ADMIN', activo = TRUE;
    END IF;

    -- ── 5. Las 3 cajas base ──
    INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual) VALUES
    (v_negocio_id, 'CAJA',       'Tienda', 'Vault de depositos acumulados',   0),
    (v_negocio_id, 'CAJA_CHICA', 'Cajon',  'Efectivo del dia (ventas + rec)', 0),
    (v_negocio_id, 'VARIOS',     'Varios', 'Fondo fijo de emergencia',        0);
    -- CAJA_CELULAR y CAJA_BUS se crean solo si el superadmin habilita el módulo de recargas (fn_configurar_modulos)

    -- ── 6. Categorías de operaciones ──
    INSERT INTO categorias_operaciones (negocio_id, nombre, tipo, descripcion, seleccionable) VALUES
    (v_negocio_id, 'Compras/Mercaderia',               'EGRESO',  'Compra de productos para reventa o uso en el negocio',                            TRUE),
    (v_negocio_id, 'Servicios Basicos',                'EGRESO',  'Pago de luz, agua, internet, telefono',                                           TRUE),
    (v_negocio_id, 'Alquiler',                         'EGRESO',  'Pago de alquiler del local',                                                      TRUE),
    (v_negocio_id, 'Mantenimiento',                    'EGRESO',  'Reparaciones y mantenimiento del local o equipo',                                  TRUE),
    (v_negocio_id, 'Transporte/Combustible',           'EGRESO',  'Gastos de transporte y combustible',                                              TRUE),
    (v_negocio_id, 'Papeleria/Suministros',            'EGRESO',  'Papeleria, utiles de oficina y suministros generales',                            TRUE),
    (v_negocio_id, 'Salarios',                         'EGRESO',  'Pago de salarios a empleados (via flujo de nomina)',                              FALSE),
    (v_negocio_id, 'Impuestos/Tasas',                  'EGRESO',  'Pago de impuestos y tasas municipales',                                           TRUE),
    (v_negocio_id, 'Otros Gastos',                     'EGRESO',  'Otros gastos operativos no clasificados',                                         TRUE),
    (v_negocio_id, 'Pago Proveedor Recargas',           'EGRESO',  'Pago al proveedor de recargas celular (saldo prestado a credito)',               FALSE),
    (v_negocio_id, 'Compra Saldo Virtual Bus',          'EGRESO',  'Compra de saldo virtual bus mediante deposito bancario',                           FALSE),
    (v_negocio_id, 'Ajuste Deficit Turno Anterior',    'EGRESO',  'Retiro de Tienda para reponer deficit del turno anterior',                        FALSE),
    (v_negocio_id, 'Ajuste Diferencia Conteo',         'EGRESO',  'Ajuste al cierre cuando el conteo fisico es menor al saldo digital del cajon',    FALSE),
    (v_negocio_id, 'Adelanto Sueldo Empleado',         'EGRESO',  'Anticipo de sueldo entregado al empleado en efectivo (via flujo de nomina)',       FALSE),
    (v_negocio_id, 'Anulacion Venta',                  'EGRESO',  'Reversa de efectivo al anular una venta POS completada',                          FALSE),
    (v_negocio_id, 'Ventas',                           'INGRESO', 'Ingresos por ventas del negocio',                                                 TRUE),
    (v_negocio_id, 'Devoluciones de Proveedores',      'INGRESO', 'Devolucion de dinero por parte de proveedores',                                   TRUE),
    (v_negocio_id, 'Otros Ingresos',                   'INGRESO', 'Otros ingresos no clasificados',                                                  TRUE),
    (v_negocio_id, 'Reposicion Deficit Turno Anterior','INGRESO', 'Ingreso a Varios por reposicion del deficit pendiente del turno anterior',         FALSE),
    (v_negocio_id, 'Ajuste Diferencia Conteo',         'INGRESO', 'Ajuste al cierre cuando el conteo fisico supera al saldo digital del cajon',      FALSE);

    -- ── 7. Categorías de productos ──
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

    -- ── 8. Configuraciones (defaults + valores del onboarding) ──
    INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
    -- Negocio
    (v_negocio_id, 'negocio_nombre',                TRIM(p_nombre_negocio)),
    (v_negocio_id, 'negocio_telefono',              COALESCE(TRIM(p_negocio_telefono), '')),
    (v_negocio_id, 'negocio_direccion',             COALESCE(TRIM(p_negocio_direccion), '')),
    -- Caja
    (v_negocio_id, 'caja_fondo_fijo_diario',        p_caja_fondo_fijo::TEXT),
    (v_negocio_id, 'caja_varios_activa',            p_varios_activa::TEXT),
    (v_negocio_id, 'caja_varios_transferencia_dia', CASE WHEN p_varios_activa THEN p_caja_varios_monto::TEXT ELSE '0' END),
    -- Módulos opcionales (desactivados por defecto, el superadmin los habilita por negocio)
    (v_negocio_id, 'recargas_celular_habilitada',    'false'),
    (v_negocio_id, 'recargas_bus_habilitada',        'false'),
    -- POS (defaults fijos — configurables luego en Parámetros)
    (v_negocio_id, 'pos_descuentos_habilitados',    'false'),
    (v_negocio_id, 'pos_descuento_maximo_pct',      '0'),
    (v_negocio_id, 'pos_umbral_monto_descuento',    '0'),
    (v_negocio_id, 'pos_iva_porcentaje',            '15'),
    -- Nómina
    (v_negocio_id, 'nomina_sueldo_base',            p_nomina_sueldo_base::TEXT),
    (v_negocio_id, 'nomina_dia_pago',               '1')
    ON CONFLICT (negocio_id, clave) DO NOTHING;

    -- ── 9. Secuencias de comprobantes ──
    INSERT INTO secuencias_comprobantes (negocio_id, tipo_documento, ultimo_valor) VALUES
    (v_negocio_id, 'TICKET',     0),
    (v_negocio_id, 'NOTA_VENTA', 0),
    (v_negocio_id, 'FACTURA',    0),
    (v_negocio_id, 'RECARGA',    0)
    ON CONFLICT (negocio_id, tipo_documento) DO NOTHING;

    -- ── 10. Cliente "Consumidor Final" ──
    INSERT INTO clientes (negocio_id, nombre, es_consumidor_final)
    VALUES (v_negocio_id, 'Consumidor Final', TRUE)
    ON CONFLICT DO NOTHING;

    RETURN json_build_object(
        'success',        TRUE,
        'negocio_id',     v_negocio_id,
        'usuario_id',     v_usuario_id,
        'propietario_id', v_propietario_id
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al completar onboarding: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Cleanup de firmas viejas (por si se ejecuta despues de versiones anteriores)
DROP FUNCTION IF EXISTS public.fn_completar_onboarding(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DECIMAL, BOOLEAN, DECIMAL, DECIMAL);

REVOKE EXECUTE ON FUNCTION public.fn_completar_onboarding(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_completar_onboarding(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, VARCHAR) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_completar_onboarding(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DECIMAL, BOOLEAN, DECIMAL, DECIMAL, VARCHAR) TO authenticated;

NOTIFY pgrst, 'reload schema';
