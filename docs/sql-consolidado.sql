-- ============================================================
-- SQL CONSOLIDADO — Mi Tienda
-- Todas las funciones y triggers para ejecutar en Supabase
-- Generado: 2026-03-28
-- ============================================================
-- ORDEN DE EJECUCIÓN:
--   1. Triggers (funciones de trigger + CREATE TRIGGER)
--   2. Funciones base (sin dependencias)
--   3. Funciones que dependen de otras (fn_liquidar_ganancias_bus → fn_crear_transferencia)
-- ============================================================


-- ████████████████████████████████████████████████████████████
-- TRIGGERS
-- ████████████████████████████████████████████████████████████


-- ── trg_set_codigo_categoria_operacion ──────────────────────
CREATE OR REPLACE FUNCTION fn_set_codigo_categoria_operacion()
RETURNS TRIGGER AS $$
DECLARE
  v_prefijo VARCHAR(2);
  v_numero  INTEGER;
BEGIN
  v_prefijo := CASE NEW.tipo
    WHEN 'EGRESO'  THEN 'EG'
    WHEN 'INGRESO' THEN 'IN'
    ELSE UPPER(SUBSTRING(NEW.tipo FROM 1 FOR 2))
  END;
  SELECT COALESCE(
    MAX(
      CASE WHEN codigo ~ ('^' || v_prefijo || '-\d+$')
        THEN CAST(SUBSTRING(codigo FROM 4) AS INTEGER)
        ELSE 0
      END
    ), 0
  ) + 1
  INTO v_numero
  FROM categorias_operaciones
  WHERE codigo LIKE v_prefijo || '-%';
  NEW.codigo := v_prefijo || '-' || LPAD(v_numero::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_set_codigo_categoria_operacion ON categorias_operaciones;
CREATE TRIGGER trg_set_codigo_categoria_operacion
  BEFORE INSERT ON categorias_operaciones
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_codigo_categoria_operacion();


-- ── trg_descontar_stock_venta ───────────────────────────────
CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_stock_actual DECIMAL(12,2);
BEGIN
    SELECT stock_actual INTO v_stock_actual FROM productos WHERE id = NEW.producto_id;
    UPDATE productos
    SET stock_actual = stock_actual - NEW.cantidad
    WHERE id = NEW.producto_id;
    INSERT INTO kardex_inventario (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, referencia_id, observaciones)
    VALUES (NEW.producto_id, 'VENTA', NEW.cantidad, v_stock_actual, v_stock_actual - NEW.cantidad, NEW.venta_id, 'Descuento automático por Venta POS');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_descontar_stock_venta ON ventas_detalles;
CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_stock_venta();


-- ── trg_actualizar_caja_por_venta ───────────────────────────
CREATE OR REPLACE FUNCTION fn_actualizar_saldo_caja_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_caja_id            INTEGER;
    v_categoria_id       INTEGER;
    v_tipo_referencia_id INTEGER;
    v_saldo_actual_caja  DECIMAL(12,2);
BEGIN
    IF NEW.metodo_pago = 'EFECTIVO' AND NEW.estado = 'COMPLETADA' THEN
        SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA_CHICA';
        SELECT id INTO v_categoria_id FROM categorias_operaciones WHERE tipo = 'INGRESO' AND nombre ILIKE '%Ventas%' LIMIT 1;
        SELECT id INTO v_tipo_referencia_id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1;
        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            SELECT saldo_actual INTO v_saldo_actual_caja FROM cajas WHERE id = v_caja_id;
            INSERT INTO operaciones_cajas (
                caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id, descripcion
            ) VALUES (
                v_caja_id, NEW.empleado_id, 'INGRESO', NEW.total,
                v_saldo_actual_caja, v_saldo_actual_caja + NEW.total,
                v_categoria_id, v_tipo_referencia_id, NEW.id, 'Venta POS Efectivo'
            );
            UPDATE cajas SET saldo_actual = saldo_actual + NEW.total WHERE id = v_caja_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_caja_por_venta ON ventas;
CREATE TRIGGER trg_actualizar_caja_por_venta
    AFTER INSERT ON ventas
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_saldo_caja_venta();


-- ── trg_generar_codigo_interno (EAN-13) ─────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_codigo_interno_producto START 1 INCREMENT 1;

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
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_generar_codigo_interno ON productos;
CREATE TRIGGER trg_generar_codigo_interno
    BEFORE INSERT ON productos
    FOR EACH ROW
    EXECUTE FUNCTION fn_generar_codigo_interno();

GRANT USAGE, SELECT ON SEQUENCE seq_codigo_interno_producto TO authenticated;
GRANT EXECUTE ON FUNCTION fn_ean13_check_digit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_generar_codigo_interno() TO authenticated;


-- ████████████████████████████████████████████████████████████
-- FUNCIONES — DASHBOARD
-- ████████████████████████████████████████████████████████████


-- ── fn_abrir_turno ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_abrir_turno(
  p_empleado_id INTEGER
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
BEGIN
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
  END IF;
  SELECT COUNT(*) + 1 INTO v_numero_turno
  FROM turnos_caja
  WHERE hora_fecha_apertura >= v_inicio_dia
    AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day';
  INSERT INTO turnos_caja (numero_turno, empleado_id, hora_fecha_apertura)
  VALUES (v_numero_turno, p_empleado_id, NOW())
  RETURNING id INTO v_turno_id;
  RETURN json_build_object('success', true, 'turno_id', v_turno_id, 'numero_turno', v_numero_turno);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_abrir_turno(INTEGER) TO authenticated;


-- ── fn_reparar_deficit_turno ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reparar_deficit_turno(
  p_empleado_id        INTEGER,
  p_deficit_varios DECIMAL(12,2),
  p_fondo_faltante     DECIMAL(12,2),
  p_cat_egreso_id      INTEGER,
  p_cat_ingreso_id     INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_a_reponer DECIMAL(12,2);
  v_caja_id         INTEGER;
  v_varios_id       INTEGER;
  v_saldo_tienda    DECIMAL(12,2);
  v_saldo_varios    DECIMAL(12,2);
  v_op_egreso_id    UUID;
  v_op_ingreso_id   UUID;
  v_inicio_dia      TIMESTAMPTZ;
  v_numero_turno    INTEGER;
  v_turno_id        UUID;
BEGIN
  v_total_a_reponer := p_deficit_varios + p_fondo_faltante;
  IF v_total_a_reponer <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto a reponer debe ser mayor a cero');
  END IF;
  IF p_deficit_varios < 0 OR p_fondo_faltante < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Los montos de déficit no pueden ser negativos');
  END IF;
  SELECT id INTO v_caja_id   FROM cajas WHERE codigo = 'CAJA';
  SELECT id INTO v_varios_id FROM cajas WHERE codigo = 'VARIOS';
  SELECT saldo_actual INTO v_saldo_tienda FROM cajas WHERE id = v_caja_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Tienda');
  END IF;
  IF v_saldo_tienda < v_total_a_reponer THEN
    RETURN json_build_object('success', false, 'error', FORMAT(
      'Saldo insuficiente en Tienda ($%s) para cubrir el ajuste de $%s. Registra un ingreso manual en Tienda primero.',
      TO_CHAR(v_saldo_tienda, 'FM999990.00'), TO_CHAR(v_total_a_reponer, 'FM999990.00')
    ));
  END IF;
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, categoria_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    gen_random_uuid(), v_caja_id, p_empleado_id, 'EGRESO', p_cat_egreso_id,
    v_total_a_reponer, v_saldo_tienda, v_saldo_tienda - v_total_a_reponer,
    FORMAT('Ajuste déficit turno anterior — Varios: $%s, Fondo: $%s',
      TO_CHAR(p_deficit_varios, 'FM999990.00'), TO_CHAR(p_fondo_faltante, 'FM999990.00')), NULL
  ) RETURNING id INTO v_op_egreso_id;
  UPDATE cajas SET saldo_actual = v_saldo_tienda - v_total_a_reponer WHERE id = v_caja_id;
  IF p_deficit_varios > 0 THEN
    SELECT saldo_actual INTO v_saldo_varios FROM cajas WHERE id = v_varios_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'No se encontró la caja Varios');
    END IF;
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, categoria_id,
      monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
    ) VALUES (
      gen_random_uuid(), v_varios_id, p_empleado_id, 'INGRESO', p_cat_ingreso_id,
      p_deficit_varios, v_saldo_varios, v_saldo_varios + p_deficit_varios,
      'Reposición déficit turno anterior — pendiente cobrado de Tienda', NULL
    ) RETURNING id INTO v_op_ingreso_id;
    UPDATE cajas SET saldo_actual = v_saldo_varios + p_deficit_varios WHERE id = v_varios_id;
  END IF;
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
  END IF;
  SELECT COUNT(*) + 1 INTO v_numero_turno
  FROM turnos_caja
  WHERE hora_fecha_apertura >= v_inicio_dia
    AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day';
  INSERT INTO turnos_caja (numero_turno, empleado_id, hora_fecha_apertura)
  VALUES (v_numero_turno, p_empleado_id, NOW())
  RETURNING id INTO v_turno_id;
  RETURN json_build_object(
    'success', true, 'turno_id', v_turno_id,
    'op_egreso_id', v_op_egreso_id, 'op_ingreso_id', v_op_ingreso_id,
    'total_retirado', v_total_a_reponer, 'saldo_tienda_nuevo', v_saldo_tienda - v_total_a_reponer
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER) TO authenticated;


-- ── fn_verificar_transferencia_caja_chica_hoy ───────────────
CREATE OR REPLACE FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(
  p_fecha DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_varios_id INTEGER;
  v_existe    BOOLEAN;
BEGIN
  SELECT id INTO v_varios_id FROM cajas WHERE codigo = 'VARIOS';
  SELECT EXISTS (
    SELECT 1
    FROM operaciones_cajas oc
    WHERE oc.caja_id = v_varios_id
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
  ) INTO v_existe;
  RETURN v_existe;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_verificar_transferencia_caja_chica_hoy(DATE) TO authenticated;


-- ── fn_registrar_operacion_manual ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_registrar_operacion_manual(
  p_caja_id         INTEGER,
  p_empleado_id     INTEGER,
  p_tipo_operacion  TEXT,
  p_categoria_id    INTEGER,
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
  v_saldo_anterior DECIMAL(12,2);
  v_saldo_nuevo    DECIMAL(12,2);
  v_operacion_id   UUID;
  v_tipo           tipo_operacion_caja_enum;
BEGIN
  BEGIN
    v_tipo := p_tipo_operacion::tipo_operacion_caja_enum;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Tipo de operación no válido: %. Use INGRESO o EGRESO', p_tipo_operacion;
  END;
  SELECT saldo_actual INTO v_saldo_anterior FROM cajas WHERE id = p_caja_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada con ID: %', p_caja_id;
  END IF;
  IF v_tipo = 'INGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior + p_monto;
  ELSIF v_tipo = 'EGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior - p_monto;
    IF v_saldo_nuevo < 0 THEN
      RAISE EXCEPTION 'Saldo insuficiente. Saldo actual: %, monto a retirar: %', v_saldo_anterior, p_monto;
    END IF;
  END IF;
  UPDATE cajas SET saldo_actual = v_saldo_nuevo WHERE id = p_caja_id;
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, categoria_id, monto,
    saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    gen_random_uuid(), p_caja_id, p_empleado_id, v_tipo, p_categoria_id, p_monto,
    v_saldo_anterior, v_saldo_nuevo, p_descripcion, p_comprobante_url
  ) RETURNING id INTO v_operacion_id;
  RETURN json_build_object(
    'success', true, 'operacion_id', v_operacion_id,
    'saldo_anterior', v_saldo_anterior, 'saldo_nuevo', v_saldo_nuevo
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en operación: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_operacion_manual(INTEGER, INTEGER, TEXT, INTEGER, DECIMAL, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_operacion_manual(INTEGER, INTEGER, TEXT, INTEGER, DECIMAL, TEXT, TEXT) TO authenticated;


-- ── fn_crear_transferencia ──────────────────────────────────
CREATE OR REPLACE FUNCTION fn_crear_transferencia(
  p_codigo_origen    TEXT,
  p_codigo_destino   TEXT,
  p_monto            NUMERIC,
  p_empleado_id      INTEGER,
  p_descripcion      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_origen_id   INTEGER;
  v_caja_destino_id  INTEGER;
  v_nombre_origen    TEXT;
  v_nombre_destino   TEXT;
  v_saldo_origen     NUMERIC;
  v_saldo_destino    NUMERIC;
  v_nuevo_saldo_origen  NUMERIC;
  v_nuevo_saldo_destino NUMERIC;
BEGIN
  SELECT id, nombre, saldo_actual INTO v_caja_origen_id, v_nombre_origen, v_saldo_origen
    FROM cajas WHERE codigo = p_codigo_origen AND activo = true;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Caja origen no encontrada: ' || p_codigo_origen);
  END IF;
  SELECT id, nombre, saldo_actual INTO v_caja_destino_id, v_nombre_destino, v_saldo_destino
    FROM cajas WHERE codigo = p_codigo_destino AND activo = true;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Caja destino no encontrada: ' || p_codigo_destino);
  END IF;
  IF v_saldo_origen < p_monto THEN
    RETURN json_build_object('success', false, 'error', format(
      'Saldo insuficiente en %s. Disponible: $%s, requerido: $%s',
      v_nombre_origen, v_saldo_origen::TEXT, p_monto::TEXT));
  END IF;
  v_nuevo_saldo_origen  := v_saldo_origen  - p_monto;
  v_nuevo_saldo_destino := v_saldo_destino + p_monto;
  INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, descripcion)
  VALUES (v_caja_origen_id, p_empleado_id, 'TRANSFERENCIA_SALIENTE', p_monto, v_saldo_origen, v_nuevo_saldo_origen, p_descripcion);
  INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, descripcion)
  VALUES (v_caja_destino_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE', p_monto, v_saldo_destino, v_nuevo_saldo_destino, p_descripcion || ' desde ' || v_nombre_origen);
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_origen WHERE id = v_caja_origen_id;
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_destino WHERE id = v_caja_destino_id;
  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_crear_transferencia(TEXT, TEXT, NUMERIC, INTEGER, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_crear_transferencia(TEXT, TEXT, NUMERIC, INTEGER, TEXT) TO authenticated;


-- ── fn_ejecutar_cierre_diario (v5) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ejecutar_cierre_diario(
  p_turno_id               UUID,
  p_fecha                  DATE,
  p_empleado_id            INTEGER,
  p_efectivo_fisico        DECIMAL(12,2),
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
  v_caja_id INTEGER; v_caja_chica_id INTEGER; v_varios_id INTEGER;
  v_caja_celular_id INTEGER; v_caja_bus_id INTEGER;
  v_cat_ajuste_ingreso_id INTEGER; v_cat_ajuste_egreso_id INTEGER;
  v_tipo_servicio_celular_id INTEGER; v_tipo_servicio_bus_id INTEGER;
  v_tipo_ref_recargas_id INTEGER; v_tipo_ref_turnos_id INTEGER;
  v_fondo_fijo DECIMAL(12,2); v_transferencia_diaria DECIMAL(12,2);
  v_agregado_celular DECIMAL(12,2); v_agregado_bus DECIMAL(12,2);
  v_ultimo_cierre_at TIMESTAMP;
  v_saldo_caja_chica_digital DECIMAL(12,2); v_saldo_caja DECIMAL(12,2); v_saldo_varios DECIMAL(12,2);
  v_efectivo_esperado DECIMAL(12,2); v_diferencia DECIMAL(12,2);
  v_saldo_caja_chica_post_ajuste DECIMAL(12,2);
  v_transferencia_efectiva DECIMAL(12,2); v_deficit_varios DECIMAL(12,2);
  v_dinero_a_depositar DECIMAL(12,2); v_fondo_en_cajon BOOLEAN;
  v_monto_reposicion_apertura DECIMAL(12,2) := 0;
  v_transferencia_ya_hecha BOOLEAN := FALSE;
  v_venta_celular DECIMAL(12,2); v_venta_bus DECIMAL(12,2);
  v_saldo_final_caja_celular DECIMAL(12,2); v_saldo_final_caja_bus DECIMAL(12,2);
  v_recarga_celular_id UUID; v_recarga_bus_id UUID;
  v_turno_cerrado BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id) THEN
    RAISE EXCEPTION 'El turno especificado no existe';
  END IF;
  IF EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND hora_fecha_cierre IS NOT NULL) THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND empleado_id = p_empleado_id) THEN
    RAISE EXCEPTION 'Solo el empleado que abrió el turno puede realizar el cierre';
  END IF;
  IF p_efectivo_fisico < 0 THEN
    RAISE EXCEPTION 'El efectivo físico contado no puede ser negativo';
  END IF;

  SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA';
  SELECT id INTO v_caja_chica_id FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_varios_id FROM cajas WHERE codigo = 'VARIOS';
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS';
  SELECT id INTO v_tipo_servicio_celular_id FROM tipos_servicio WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_servicio_bus_id FROM tipos_servicio WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_recargas_id FROM tipos_referencia WHERE tabla = 'recargas';
  SELECT id INTO v_tipo_ref_turnos_id FROM tipos_referencia WHERE tabla = 'turnos_caja';
  SELECT id INTO v_cat_ajuste_ingreso_id FROM categorias_operaciones WHERE codigo = 'IN-005';
  SELECT id INTO v_cat_ajuste_egreso_id FROM categorias_operaciones WHERE codigo = 'EG-013';

  SELECT (SELECT valor::DECIMAL FROM configuraciones WHERE clave = 'caja_fondo_fijo_diario'),
         (SELECT valor::DECIMAL FROM configuraciones WHERE clave = 'caja_varios_transferencia_dia')
  INTO v_fondo_fijo, v_transferencia_diaria;
  IF v_fondo_fijo IS NULL OR v_transferencia_diaria IS NULL THEN
    RAISE EXCEPTION 'No se encontró configuración del sistema';
  END IF;

  SELECT MAX(hora_fecha_cierre) INTO v_ultimo_cierre_at FROM turnos_caja WHERE hora_fecha_cierre IS NOT NULL;

  SELECT COALESCE(SUM(monto_virtual), 0) INTO v_agregado_celular
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_servicio_celular_id
    AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at);

  SELECT COALESCE(SUM(monto_virtual), 0) INTO v_agregado_bus
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_servicio_bus_id
    AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at);

  SELECT saldo_actual INTO v_saldo_caja_chica_digital FROM cajas WHERE id = v_caja_chica_id FOR UPDATE;
  SELECT saldo_actual INTO v_saldo_caja FROM cajas WHERE id = v_caja_id FOR UPDATE;
  SELECT saldo_actual INTO v_saldo_varios FROM cajas WHERE id = v_varios_id FOR UPDATE;

  v_efectivo_esperado := v_saldo_caja_chica_digital + v_fondo_fijo;
  v_diferencia := p_efectivo_fisico - v_efectivo_esperado;

  IF v_diferencia > 0 THEN
    INSERT INTO operaciones_cajas (id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion)
    VALUES (gen_random_uuid(), v_caja_chica_id, p_empleado_id, 'INGRESO', v_diferencia, v_cat_ajuste_ingreso_id,
      v_saldo_caja_chica_digital, v_saldo_caja_chica_digital + v_diferencia,
      FORMAT('Ajuste conteo físico: contado $%s, esperado $%s (diferencia: +$%s)',
        TO_CHAR(p_efectivo_fisico, 'FM999990.00'), TO_CHAR(v_efectivo_esperado, 'FM999990.00'), TO_CHAR(v_diferencia, 'FM999990.00')));
  ELSIF v_diferencia < 0 THEN
    INSERT INTO operaciones_cajas (id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion)
    VALUES (gen_random_uuid(), v_caja_chica_id, p_empleado_id, 'EGRESO', ABS(v_diferencia), v_cat_ajuste_egreso_id,
      v_saldo_caja_chica_digital, v_saldo_caja_chica_digital + v_diferencia,
      FORMAT('Ajuste conteo físico: contado $%s, esperado $%s (diferencia: -$%s)',
        TO_CHAR(p_efectivo_fisico, 'FM999990.00'), TO_CHAR(v_efectivo_esperado, 'FM999990.00'), TO_CHAR(ABS(v_diferencia), 'FM999990.00')));
    INSERT INTO deudas_empleados (empleado_id, turno_id, fecha, monto_faltante, estado)
    VALUES (p_empleado_id, p_turno_id, p_fecha, ABS(v_diferencia), 'PENDIENTE');
  END IF;

  v_saldo_caja_chica_post_ajuste := v_saldo_caja_chica_digital + v_diferencia;

  SELECT EXISTS (
    SELECT 1 FROM operaciones_cajas oc
    WHERE oc.caja_id = v_varios_id
      AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
      AND (oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
        OR (oc.tipo_operacion = 'INGRESO' AND EXISTS (
          SELECT 1 FROM categorias_operaciones co WHERE co.id = oc.categoria_id AND co.codigo = 'IN-004')))
  ) INTO v_transferencia_ya_hecha;

  IF v_transferencia_ya_hecha THEN
    v_transferencia_efectiva := 0; v_deficit_varios := 0;
    v_fondo_en_cajon := (p_efectivo_fisico >= v_fondo_fijo);
    v_dinero_a_depositar := p_efectivo_fisico - CASE WHEN v_fondo_en_cajon THEN v_fondo_fijo ELSE 0 END;
    v_monto_reposicion_apertura := 0;
  ELSIF p_efectivo_fisico >= (v_transferencia_diaria + v_fondo_fijo) THEN
    v_fondo_en_cajon := TRUE; v_transferencia_efectiva := v_transferencia_diaria;
    v_deficit_varios := 0; v_dinero_a_depositar := p_efectivo_fisico - v_transferencia_diaria - v_fondo_fijo;
    v_monto_reposicion_apertura := 0;
  ELSIF p_efectivo_fisico >= v_transferencia_diaria THEN
    v_fondo_en_cajon := FALSE; v_transferencia_efectiva := v_transferencia_diaria;
    v_deficit_varios := 0; v_dinero_a_depositar := p_efectivo_fisico - v_transferencia_diaria;
    v_monto_reposicion_apertura := v_fondo_fijo;
  ELSE
    v_fondo_en_cajon := FALSE; v_transferencia_efectiva := 0;
    v_deficit_varios := v_transferencia_diaria; v_dinero_a_depositar := p_efectivo_fisico;
    v_monto_reposicion_apertura := v_fondo_fijo + v_transferencia_diaria;
  END IF;

  v_venta_celular := (p_saldo_anterior_celular + v_agregado_celular) - p_saldo_celular_final;
  v_venta_bus := (p_saldo_anterior_bus + v_agregado_bus) - p_saldo_bus_final;
  IF v_venta_celular < 0 THEN
    RAISE EXCEPTION 'Venta celular negativa ($%). Registrá la recarga del proveedor en Recargas Virtuales antes de cerrar.', v_venta_celular;
  END IF;
  IF v_venta_bus < 0 THEN
    RAISE EXCEPTION 'Venta bus negativa ($%). Registrá la compra de saldo virtual en Recargas Virtuales antes de cerrar.', v_venta_bus;
  END IF;
  v_saldo_final_caja_celular := p_saldo_anterior_caja_celular + v_venta_celular;
  v_saldo_final_caja_bus := p_saldo_anterior_caja_bus + v_venta_bus;

  IF v_dinero_a_depositar > 0 THEN
    INSERT INTO operaciones_cajas (id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion, tipo_referencia_id, referencia_id)
    VALUES (gen_random_uuid(), v_caja_id, p_empleado_id, 'CIERRE', v_dinero_a_depositar,
      v_saldo_caja, v_saldo_caja + v_dinero_a_depositar, 'Cierre de caja — turno ' || p_fecha,
      v_tipo_ref_turnos_id, p_turno_id);
  END IF;

  IF v_transferencia_efectiva > 0 THEN
    INSERT INTO operaciones_cajas (id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion, tipo_referencia_id, referencia_id)
    VALUES (gen_random_uuid(), v_varios_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE', v_transferencia_efectiva,
      v_saldo_varios, v_saldo_varios + v_transferencia_efectiva,
      'Transferencia diaria desde cajón — turno ' || p_fecha, v_tipo_ref_turnos_id, p_turno_id);
  END IF;

  UPDATE cajas SET saldo_actual = v_saldo_caja + v_dinero_a_depositar WHERE id = v_caja_id;
  UPDATE cajas SET saldo_actual = v_saldo_varios + v_transferencia_efectiva WHERE id = v_varios_id;
  UPDATE cajas SET saldo_actual = 0 WHERE id = v_caja_chica_id;

  INSERT INTO recargas (id, fecha, turno_id, empleado_id, tipo_servicio_id, venta_dia, saldo_virtual_anterior, saldo_virtual_actual)
  VALUES (gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id, v_tipo_servicio_celular_id,
    v_venta_celular, p_saldo_anterior_celular, p_saldo_celular_final)
  RETURNING id INTO v_recarga_celular_id;

  IF v_venta_celular > 0 THEN
    INSERT INTO operaciones_cajas (id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion, tipo_referencia_id, referencia_id)
    VALUES (gen_random_uuid(), v_caja_celular_id, p_empleado_id, 'INGRESO', v_venta_celular,
      p_saldo_anterior_caja_celular, v_saldo_final_caja_celular,
      'Venta celular del turno ' || p_fecha, v_tipo_ref_recargas_id, v_recarga_celular_id);
    UPDATE cajas SET saldo_actual = v_saldo_final_caja_celular WHERE id = v_caja_celular_id;
  END IF;

  INSERT INTO recargas (id, fecha, turno_id, empleado_id, tipo_servicio_id, venta_dia, saldo_virtual_anterior, saldo_virtual_actual)
  VALUES (gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id, v_tipo_servicio_bus_id,
    v_venta_bus, p_saldo_anterior_bus, p_saldo_bus_final)
  ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE SET
    venta_dia = recargas.venta_dia + EXCLUDED.venta_dia,
    saldo_virtual_actual = EXCLUDED.saldo_virtual_actual
  RETURNING id INTO v_recarga_bus_id;

  IF v_venta_bus > 0 THEN
    INSERT INTO operaciones_cajas (id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion, tipo_referencia_id, referencia_id)
    VALUES (gen_random_uuid(), v_caja_bus_id, p_empleado_id, 'INGRESO', v_venta_bus,
      p_saldo_anterior_caja_bus, v_saldo_final_caja_bus,
      'Venta bus del turno ' || p_fecha, v_tipo_ref_recargas_id, v_recarga_bus_id);
    UPDATE cajas SET saldo_actual = v_saldo_final_caja_bus WHERE id = v_caja_bus_id;
  END IF;

  UPDATE turnos_caja SET hora_fecha_cierre = NOW(), fondo_cubierto = v_fondo_en_cajon WHERE id = p_turno_id;
  v_turno_cerrado := TRUE;

  RETURN json_build_object(
    'success', true, 'turno_id', p_turno_id, 'fecha', p_fecha, 'turno_cerrado', v_turno_cerrado, 'version', '5.0',
    'configuracion', json_build_object('fondo_fijo', v_fondo_fijo, 'transferencia_diaria', v_transferencia_diaria),
    'conteo_fisico', json_build_object('efectivo_fisico', p_efectivo_fisico, 'saldo_digital_antes', v_saldo_caja_chica_digital,
      'efectivo_esperado', v_efectivo_esperado, 'diferencia', v_diferencia, 'ajuste_aplicado', (v_diferencia <> 0)),
    'distribucion_efectivo', json_build_object('fondo_en_cajon', v_fondo_en_cajon, 'transferencia_varios', v_transferencia_efectiva,
      'deposito_tienda', v_dinero_a_depositar, 'deficit_varios', v_deficit_varios, 'turno_con_deficit', (v_deficit_varios > 0),
      'monto_reposicion_apertura', v_monto_reposicion_apertura),
    'recargas_virtuales_dia', json_build_object('celular', v_agregado_celular, 'bus', v_agregado_bus),
    'saldos_finales', json_build_object('caja_chica', 0, 'caja', v_saldo_caja + v_dinero_a_depositar,
      'varios', v_saldo_varios + v_transferencia_efectiva, 'caja_celular', v_saldo_final_caja_celular, 'caja_bus', v_saldo_final_caja_bus),
    'ventas', json_build_object('celular', v_venta_celular, 'bus', v_venta_bus)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error en cierre diario v5.0: %', SQLERRM;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) TO authenticated;


-- ████████████████████████████████████████████████████████████
-- FUNCIONES — RECARGAS VIRTUALES
-- ████████████████████████████████████████████████████████████


-- ── fn_registrar_recarga_proveedor_celular ───────────────────
CREATE OR REPLACE FUNCTION fn_registrar_recarga_proveedor_celular(
  p_fecha         DATE,
  p_empleado_id   INTEGER,
  p_monto_virtual NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo_celular_id INTEGER; v_comision_pct NUMERIC;
  v_monto_a_pagar NUMERIC; v_ganancia NUMERIC; v_recarga_id UUID;
  v_saldo_ultimo_cierre NUMERIC; v_suma_recargas_post_cierre NUMERIC;
  v_saldo_virtual_actual NUMERIC; v_fecha_ultimo_cierre TIMESTAMP;
  v_deudas_pendientes JSON; v_cantidad_deudas INTEGER; v_total_deudas NUMERIC;
BEGIN
  SELECT id, porcentaje_comision INTO v_tipo_celular_id, v_comision_pct
  FROM tipos_servicio WHERE codigo = 'CELULAR';
  IF v_tipo_celular_id IS NULL THEN RAISE EXCEPTION 'Tipo de servicio CELULAR no encontrado'; END IF;
  IF p_monto_virtual <= 0 THEN RAISE EXCEPTION 'El monto virtual debe ser mayor a cero'; END IF;

  v_monto_a_pagar := ROUND(p_monto_virtual * (1 - v_comision_pct / 100.0), 2);
  v_ganancia := p_monto_virtual - v_monto_a_pagar;

  INSERT INTO recargas_virtuales (id, fecha, tipo_servicio_id, empleado_id, monto_virtual, monto_a_pagar, ganancia, pagado, created_at)
  VALUES (gen_random_uuid(), p_fecha, v_tipo_celular_id, p_empleado_id, p_monto_virtual, v_monto_a_pagar, v_ganancia, false, NOW())
  RETURNING id INTO v_recarga_id;

  SELECT COALESCE(saldo_virtual_actual, 0), created_at INTO v_saldo_ultimo_cierre, v_fecha_ultimo_cierre
  FROM recargas WHERE tipo_servicio_id = v_tipo_celular_id ORDER BY created_at DESC LIMIT 1;
  IF v_saldo_ultimo_cierre IS NULL THEN v_saldo_ultimo_cierre := 0; v_fecha_ultimo_cierre := '1900-01-01'::timestamp; END IF;

  SELECT COALESCE(SUM(monto_virtual), 0) INTO v_suma_recargas_post_cierre
  FROM recargas_virtuales rv WHERE rv.tipo_servicio_id = v_tipo_celular_id AND rv.created_at > v_fecha_ultimo_cierre;
  v_saldo_virtual_actual := v_saldo_ultimo_cierre + v_suma_recargas_post_cierre;

  SELECT json_agg(json_build_object('id', rv.id, 'fecha', rv.fecha, 'monto_virtual', rv.monto_virtual,
    'monto_a_pagar', rv.monto_a_pagar, 'ganancia', rv.ganancia, 'created_at', rv.created_at) ORDER BY rv.fecha ASC)
  INTO v_deudas_pendientes FROM recargas_virtuales rv WHERE rv.tipo_servicio_id = v_tipo_celular_id AND rv.pagado = false;

  SELECT COUNT(*), COALESCE(SUM(monto_a_pagar), 0) INTO v_cantidad_deudas, v_total_deudas
  FROM recargas_virtuales WHERE tipo_servicio_id = v_tipo_celular_id AND pagado = false;

  RETURN json_build_object('success', true, 'recarga_id', v_recarga_id,
    'monto_virtual', p_monto_virtual, 'monto_a_pagar', v_monto_a_pagar, 'ganancia', v_ganancia,
    'message', 'Recarga del proveedor registrada', 'saldo_virtual_celular', v_saldo_virtual_actual,
    'deudas_pendientes', json_build_object('cantidad', v_cantidad_deudas, 'total', v_total_deudas, 'lista', COALESCE(v_deudas_pendientes, '[]'::json)));
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar recarga proveedor celular: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_registrar_recarga_proveedor_celular(DATE, INTEGER, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION fn_registrar_recarga_proveedor_celular(DATE, INTEGER, NUMERIC) TO authenticated;


-- ── fn_registrar_pago_proveedor_celular ─────────────────────
CREATE OR REPLACE FUNCTION fn_registrar_pago_proveedor_celular(
  p_empleado_id  INTEGER,
  p_deuda_ids    UUID[],
  p_observaciones        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_celular_id INTEGER; v_caja_chica_id INTEGER; v_tipo_ref_id INTEGER;
  v_categoria_eg010_id INTEGER; v_total_a_pagar NUMERIC; v_total_ganancia NUMERIC;
  v_total_egreso NUMERIC; v_saldo_celular_ant NUMERIC; v_saldo_celular_nuevo NUMERIC;
  v_saldo_chica_ant NUMERIC; v_saldo_chica_nuevo NUMERIC;
  v_operacion_pago_id UUID; v_operacion_sal_id UUID; v_operacion_ent_id UUID;
  v_fecha_hoy DATE; v_deudas_count INTEGER;
BEGIN
  v_fecha_hoy := CURRENT_DATE;
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_chica_id FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_tipo_ref_id FROM tipos_referencia WHERE tabla = 'recargas_virtuales';
  SELECT id INTO v_categoria_eg010_id FROM categorias_operaciones WHERE codigo = 'EG-010';
  IF v_caja_celular_id IS NULL THEN RAISE EXCEPTION 'Caja CAJA_CELULAR no encontrada'; END IF;
  IF v_caja_chica_id IS NULL THEN RAISE EXCEPTION 'Caja CAJA_CHICA no encontrada'; END IF;

  SELECT COUNT(*) INTO v_deudas_count FROM recargas_virtuales
  WHERE id = ANY(p_deuda_ids) AND pagado = false AND tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR');
  IF v_deudas_count != array_length(p_deuda_ids, 1) THEN
    RAISE EXCEPTION 'Algunas deudas no existen, ya están pagadas o no son de tipo CELULAR';
  END IF;

  SELECT COALESCE(SUM(monto_a_pagar), 0), COALESCE(SUM(ganancia), 0)
  INTO v_total_a_pagar, v_total_ganancia FROM recargas_virtuales WHERE id = ANY(p_deuda_ids);
  IF v_total_a_pagar <= 0 THEN RAISE EXCEPTION 'El total a pagar debe ser mayor a cero'; END IF;
  v_total_egreso := v_total_a_pagar + v_total_ganancia;

  SELECT saldo_actual INTO v_saldo_celular_ant FROM cajas WHERE id = v_caja_celular_id;
  IF v_saldo_celular_ant < v_total_egreso THEN
    RAISE EXCEPTION 'Saldo insuficiente en CAJA_CELULAR. Disponible: $%, Requerido: $% (pago: $% + ganancia: $%)',
      v_saldo_celular_ant, v_total_egreso, v_total_a_pagar, v_total_ganancia;
  END IF;
  SELECT saldo_actual INTO v_saldo_chica_ant FROM cajas WHERE id = v_caja_chica_id;

  v_saldo_celular_nuevo := v_saldo_celular_ant - v_total_egreso;
  v_saldo_chica_nuevo := v_saldo_chica_ant + v_total_ganancia;
  v_operacion_pago_id := gen_random_uuid(); v_operacion_sal_id := gen_random_uuid(); v_operacion_ent_id := gen_random_uuid();

  INSERT INTO operaciones_cajas (id, fecha, caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, categoria_id, tipo_referencia_id, descripcion)
  VALUES (v_operacion_pago_id, NOW(), v_caja_celular_id, p_empleado_id, 'EGRESO', v_total_a_pagar,
    v_saldo_celular_ant, v_saldo_celular_ant - v_total_a_pagar, v_categoria_eg010_id, v_tipo_ref_id,
    COALESCE(p_observaciones, 'Pago al proveedor celular — ' || array_length(p_deuda_ids, 1) || ' deuda(s)'));

  INSERT INTO operaciones_cajas (id, fecha, caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, tipo_referencia_id, descripcion)
  VALUES (v_operacion_sal_id, NOW(), v_caja_celular_id, p_empleado_id, 'TRANSFERENCIA_SALIENTE', v_total_ganancia,
    v_saldo_celular_ant - v_total_a_pagar, v_saldo_celular_nuevo, v_tipo_ref_id, 'Ganancia celular → Caja Chica');

  INSERT INTO operaciones_cajas (id, fecha, caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, tipo_referencia_id, descripcion)
  VALUES (v_operacion_ent_id, NOW(), v_caja_chica_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE', v_total_ganancia,
    v_saldo_chica_ant, v_saldo_chica_nuevo, v_tipo_ref_id, 'Ganancia celular recibida desde Caja Celular');

  UPDATE recargas_virtuales SET pagado = true, fecha_pago = v_fecha_hoy, operacion_pago_id = v_operacion_pago_id WHERE id = ANY(p_deuda_ids);
  UPDATE cajas SET saldo_actual = v_saldo_celular_nuevo WHERE id = v_caja_celular_id;
  UPDATE cajas SET saldo_actual = v_saldo_chica_nuevo WHERE id = v_caja_chica_id;

  RETURN json_build_object('success', true, 'operacion_pago_id', v_operacion_pago_id,
    'deudas_pagadas', array_length(p_deuda_ids, 1), 'total_pagado', v_total_a_pagar,
    'total_ganancia', v_total_ganancia, 'saldo_celular_anterior', v_saldo_celular_ant,
    'saldo_celular_nuevo', v_saldo_celular_nuevo, 'saldo_chica_anterior', v_saldo_chica_ant,
    'saldo_chica_nuevo', v_saldo_chica_nuevo,
    'message', 'Pago registrado: $' || v_total_a_pagar || ' — Ganancia $' || v_total_ganancia || ' transferida a Caja Chica');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar pago proveedor celular: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT) TO authenticated;


-- ── fn_registrar_compra_saldo_bus ───────────────────────────
DROP FUNCTION IF EXISTS public.fn_registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.fn_registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.fn_registrar_compra_saldo_bus(
  p_fecha                 DATE,
  p_empleado_id           INTEGER,
  p_monto                 NUMERIC,
  p_observaciones                 TEXT    DEFAULT NULL,
  p_saldo_virtual_maquina NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_bus_id INTEGER; v_tipo_bus_id INTEGER; v_tipo_ref_rv_id INTEGER;
  v_tipo_ref_recargas_id INTEGER; v_categoria_eg011_id INTEGER;
  v_saldo_anterior NUMERIC; v_saldo_despues_ingreso NUMERIC; v_saldo_nuevo NUMERIC;
  v_turno_id UUID; v_mini_cierre_id UUID; v_operacion_ingreso_id UUID;
  v_operacion_egreso_id UUID; v_recarga_id UUID;
  v_saldo_ultimo_cierre_bus NUMERIC; v_fecha_ultimo_cierre_bus TIMESTAMP;
  v_suma_recargas_post_cierre NUMERIC; v_saldo_virtual_sistema NUMERIC;
  v_venta_bus_hoy NUMERIC; v_disponible_total NUMERIC;
BEGIN
  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS';
  SELECT id INTO v_tipo_bus_id FROM tipos_servicio WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_rv_id FROM tipos_referencia WHERE tabla = 'recargas_virtuales';
  SELECT id INTO v_tipo_ref_recargas_id FROM tipos_referencia WHERE tabla = 'recargas';
  SELECT id INTO v_categoria_eg011_id FROM categorias_operaciones WHERE codigo = 'EG-011';
  IF v_caja_bus_id IS NULL THEN RAISE EXCEPTION 'Caja CAJA_BUS no encontrada'; END IF;
  IF v_tipo_bus_id IS NULL THEN RAISE EXCEPTION 'Tipo de servicio BUS no encontrado'; END IF;
  IF v_categoria_eg011_id IS NULL THEN RAISE EXCEPTION 'Categoría operación EG-011 no encontrada'; END IF;
  IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto de compra debe ser mayor a cero'; END IF;

  SELECT saldo_actual INTO v_saldo_anterior FROM cajas WHERE id = v_caja_bus_id;

  IF p_saldo_virtual_maquina IS NOT NULL THEN
    SELECT COALESCE(r.saldo_virtual_actual, 0), r.created_at INTO v_saldo_ultimo_cierre_bus, v_fecha_ultimo_cierre_bus
    FROM recargas r JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
    WHERE ts.codigo = 'BUS' ORDER BY r.created_at DESC LIMIT 1;
    IF v_saldo_ultimo_cierre_bus IS NULL THEN v_saldo_ultimo_cierre_bus := 0; v_fecha_ultimo_cierre_bus := '1900-01-01'::timestamp; END IF;

    SELECT COALESCE(SUM(rv.monto_virtual), 0) INTO v_suma_recargas_post_cierre
    FROM recargas_virtuales rv WHERE rv.tipo_servicio_id = v_tipo_bus_id AND rv.created_at > v_fecha_ultimo_cierre_bus;

    v_saldo_virtual_sistema := v_saldo_ultimo_cierre_bus + v_suma_recargas_post_cierre;
    v_venta_bus_hoy := GREATEST(v_saldo_virtual_sistema - p_saldo_virtual_maquina, 0);
    v_disponible_total := v_saldo_anterior + v_venta_bus_hoy;
    IF v_disponible_total < p_monto THEN
      RAISE EXCEPTION 'Efectivo insuficiente. Caja BUS: $% + ventas del día: $% = $%. Requerido: $%',
        v_saldo_anterior, v_venta_bus_hoy, v_disponible_total, p_monto;
    END IF;
  ELSE
    v_venta_bus_hoy := 0;
    IF v_saldo_anterior < p_monto THEN
      RAISE EXCEPTION 'Saldo insuficiente en CAJA_BUS. Disponible: $%, Requerido: $%', v_saldo_anterior, p_monto;
    END IF;
  END IF;

  IF v_venta_bus_hoy > 0 THEN
    SELECT id INTO v_turno_id FROM turnos_caja
    WHERE (hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = p_fecha AND hora_fecha_cierre IS NULL
    ORDER BY hora_fecha_apertura DESC LIMIT 1;
    IF v_turno_id IS NULL THEN
      RAISE EXCEPTION 'No hay turno abierto para la fecha %. Abrí un turno antes de registrar la compra con saldo de máquina.', p_fecha;
    END IF;
    v_mini_cierre_id := gen_random_uuid(); v_operacion_ingreso_id := gen_random_uuid();
    INSERT INTO recargas (id, fecha, turno_id, empleado_id, tipo_servicio_id, venta_dia, saldo_virtual_anterior, saldo_virtual_actual)
    VALUES (v_mini_cierre_id, p_fecha, v_turno_id, p_empleado_id, v_tipo_bus_id, v_venta_bus_hoy, v_saldo_virtual_sistema, p_saldo_virtual_maquina)
    ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE SET
      venta_dia = recargas.venta_dia + EXCLUDED.venta_dia, saldo_virtual_actual = EXCLUDED.saldo_virtual_actual
    RETURNING id INTO v_mini_cierre_id;
    v_saldo_despues_ingreso := v_saldo_anterior + v_venta_bus_hoy;
    INSERT INTO operaciones_cajas (id, fecha, caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, tipo_referencia_id, referencia_id, descripcion)
    VALUES (v_operacion_ingreso_id, NOW(), v_caja_bus_id, p_empleado_id, 'INGRESO', v_venta_bus_hoy,
      v_saldo_anterior, v_saldo_despues_ingreso, v_tipo_ref_recargas_id, v_mini_cierre_id, 'Ventas Bus pre-compra saldo — ' || p_fecha);
  ELSE
    v_saldo_despues_ingreso := v_saldo_anterior;
  END IF;

  v_saldo_nuevo := v_saldo_despues_ingreso - p_monto;
  v_operacion_egreso_id := gen_random_uuid(); v_recarga_id := gen_random_uuid();

  INSERT INTO operaciones_cajas (id, fecha, caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, categoria_id, tipo_referencia_id, referencia_id, descripcion)
  VALUES (v_operacion_egreso_id, NOW(), v_caja_bus_id, p_empleado_id, 'EGRESO', p_monto,
    v_saldo_despues_ingreso, v_saldo_nuevo, v_categoria_eg011_id, v_tipo_ref_rv_id, v_recarga_id,
    COALESCE(p_observaciones, 'Compra saldo virtual Bus — ' || p_fecha));

  INSERT INTO recargas_virtuales (id, fecha, tipo_servicio_id, empleado_id, monto_virtual, monto_a_pagar, ganancia, pagado, observaciones, created_at)
  VALUES (v_recarga_id, p_fecha, v_tipo_bus_id, p_empleado_id, p_monto, p_monto, 0, false, p_observaciones, clock_timestamp());

  UPDATE cajas SET saldo_actual = v_saldo_nuevo WHERE id = v_caja_bus_id;

  RETURN json_build_object('success', true, 'recarga_id', v_recarga_id, 'operacion_id', v_operacion_egreso_id,
    'monto', p_monto, 'saldo_anterior', v_saldo_anterior, 'saldo_nuevo', v_saldo_nuevo,
    'venta_bus_incluida', v_venta_bus_hoy, 'mini_cierre', (v_venta_bus_hoy > 0),
    'message', CASE WHEN v_venta_bus_hoy > 0 THEN 'Compra saldo Bus $' || p_monto || ' — Ventas registradas: $' || v_venta_bus_hoy
      ELSE 'Compra saldo Bus $' || p_monto END);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar compra saldo bus: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_compra_saldo_bus(DATE, INTEGER, NUMERIC, TEXT, NUMERIC) TO authenticated;


-- ── fn_liquidar_ganancias_bus (depende de fn_crear_transferencia) ──
CREATE OR REPLACE FUNCTION public.fn_liquidar_ganancias_bus(
  p_mes         TEXT,
  p_empleado_id INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo_bus_id INTEGER; v_comision_pct NUMERIC;
  v_inicio_mes DATE; v_fin_mes DATE;
  v_total_compras NUMERIC; v_total_ganancia NUMERIC;
  v_filas_afectadas INTEGER; v_transfer_result JSON;
BEGIN
  SELECT id, porcentaje_comision INTO v_tipo_bus_id, v_comision_pct FROM tipos_servicio WHERE codigo = 'BUS';
  IF v_tipo_bus_id IS NULL THEN RAISE EXCEPTION 'Tipo de servicio BUS no encontrado'; END IF;
  v_inicio_mes := (p_mes || '-01')::date;
  v_fin_mes := (v_inicio_mes + INTERVAL '1 month')::date;

  SELECT COALESCE(SUM(monto_a_pagar), 0) INTO v_total_compras
  FROM recargas_virtuales WHERE tipo_servicio_id = v_tipo_bus_id AND pagado = false AND fecha >= v_inicio_mes AND fecha < v_fin_mes;
  IF v_total_compras <= 0 THEN RAISE EXCEPTION 'No hay compras BUS pendientes de liquidar para el mes %', p_mes; END IF;
  v_total_ganancia := ROUND(v_total_compras * (v_comision_pct / 100.0), 2);

  SELECT public.fn_crear_transferencia('CAJA_BUS', 'CAJA_CHICA', v_total_ganancia, p_empleado_id,
    'Ganancia ' || v_comision_pct || '% BUS ' || p_mes) INTO v_transfer_result;
  IF NOT (v_transfer_result->>'success')::boolean THEN RAISE EXCEPTION '%', v_transfer_result->>'error'; END IF;

  UPDATE recargas_virtuales SET pagado = true, fecha_pago = CURRENT_DATE
  WHERE tipo_servicio_id = v_tipo_bus_id AND pagado = false AND fecha >= v_inicio_mes AND fecha < v_fin_mes;
  GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

  RETURN json_build_object('success', true, 'mes', p_mes, 'total_ganancia', v_total_ganancia,
    'filas_afectadas', v_filas_afectadas,
    'message', 'Ganancia $' || v_total_ganancia || ' transferida a Varios (' || v_filas_afectadas || ' compras del mes ' || p_mes || ')');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al liquidar ganancias BUS: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_liquidar_ganancias_bus(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_liquidar_ganancias_bus(TEXT, INTEGER) TO authenticated;


-- ████████████████████████████████████████████████████████████
-- FUNCIONES — POS
-- ████████████████████████████████████████████████████████████


-- ── fn_registrar_venta_pos ──────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_registrar_venta_pos(
  UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID
);

CREATE OR REPLACE FUNCTION public.fn_registrar_venta_pos(
  p_turno_id         UUID,
  p_empleado_id      INTEGER,
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
  v_venta_id UUID; v_item JSONB; v_numero_comprobante INTEGER;
  v_existing_id UUID; v_existing_numero INTEGER;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, numero_comprobante INTO v_existing_id, v_existing_numero FROM ventas WHERE idempotency_key = p_idempotency_key;
    IF v_existing_id IS NOT NULL THEN
      RETURN json_build_object('success', true, 'venta_id', v_existing_id, 'numero_comprobante', v_existing_numero, 'duplicado', true);
    END IF;
  END IF;

  UPDATE secuencias_comprobantes SET ultimo_valor = ultimo_valor + 1 WHERE tipo_documento = p_tipo_comprobante
  RETURNING ultimo_valor INTO v_numero_comprobante;
  IF v_numero_comprobante IS NULL THEN
    RAISE EXCEPTION 'Tipo de comprobante no registrado en secuencias_comprobantes: %', p_tipo_comprobante;
  END IF;

  BEGIN
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, tipo_comprobante, numero_comprobante,
      subtotal, descuento, descuento_pct, total, base_iva_0, base_iva_15, iva_valor,
      metodo_pago, estado, estado_pago, idempotency_key)
    VALUES (p_turno_id, p_cliente_id, p_empleado_id, p_tipo_comprobante::tipo_comprobante_enum, v_numero_comprobante,
      p_subtotal, p_descuento, p_descuento_pct, p_total, p_base_iva_0, p_base_iva_15, p_iva_valor,
      p_metodo_pago, 'COMPLETADA', CASE WHEN p_metodo_pago = 'FIADO' THEN 'PENDIENTE' ELSE 'NO_APLICA' END, p_idempotency_key)
    RETURNING id INTO v_venta_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, numero_comprobante INTO v_existing_id, v_existing_numero FROM ventas WHERE idempotency_key = p_idempotency_key;
    RETURN json_build_object('success', true, 'venta_id', v_existing_id, 'numero_comprobante', v_existing_numero, 'duplicado', true);
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal)
    VALUES (v_venta_id, (v_item->>'producto_id')::UUID, (v_item->>'cantidad')::DECIMAL,
      (v_item->>'precio_unitario')::DECIMAL, (v_item->>'subtotal')::DECIMAL);
  END LOOP;

  RETURN json_build_object('success', true, 'venta_id', v_venta_id, 'numero_comprobante', v_numero_comprobante);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar venta POS: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_venta_pos(UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, SMALLINT, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB, UUID) TO authenticated;


-- ── fn_anular_venta ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_anular_venta(
    p_venta_id    UUID,
    p_empleado_id INTEGER,
    p_motivo      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_venta RECORD; v_detalle RECORD; v_stock_actual DECIMAL(12,2);
    v_caja_id INTEGER; v_saldo_actual_caja DECIMAL(12,2);
    v_categoria_id INTEGER; v_tipo_referencia_id INTEGER;
BEGIN
    IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN RAISE EXCEPTION 'El motivo de anulación es obligatorio'; END IF;
    SELECT id, estado, metodo_pago, total, numero_comprobante, estado_pago INTO v_venta FROM ventas WHERE id = p_venta_id;
    IF v_venta.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id; END IF;
    IF v_venta.estado = 'ANULADA' THEN RAISE EXCEPTION 'La venta #% ya fue anulada', v_venta.numero_comprobante; END IF;
    IF v_venta.metodo_pago = 'FIADO' THEN
        IF EXISTS (SELECT 1 FROM cuentas_cobrar WHERE venta_id = p_venta_id LIMIT 1) THEN
            RAISE EXCEPTION 'No se puede anular la venta #%: ya tiene abonos registrados. Resuelve los pagos parciales primero.', v_venta.numero_comprobante;
        END IF;
    END IF;

    FOR v_detalle IN SELECT producto_id, cantidad FROM ventas_detalles WHERE venta_id = p_venta_id LOOP
        SELECT stock_actual INTO v_stock_actual FROM productos WHERE id = v_detalle.producto_id;
        UPDATE productos SET stock_actual = stock_actual + v_detalle.cantidad WHERE id = v_detalle.producto_id;
        INSERT INTO kardex_inventario (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, referencia_id, observaciones)
        VALUES (v_detalle.producto_id, 'ANULACION_VENTA', v_detalle.cantidad, v_stock_actual, v_stock_actual + v_detalle.cantidad,
          p_venta_id, 'Anulación Venta POS #' || v_venta.numero_comprobante || ': ' || TRIM(p_motivo));
    END LOOP;

    IF v_venta.metodo_pago = 'EFECTIVO' THEN
        SELECT id, saldo_actual INTO v_caja_id, v_saldo_actual_caja FROM cajas WHERE codigo = 'CAJA';
        SELECT id INTO v_categoria_id FROM categorias_operaciones WHERE tipo = 'EGRESO' AND nombre ILIKE '%Otros Gastos%' LIMIT 1;
        SELECT id INTO v_tipo_referencia_id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1;
        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual,
              categoria_id, tipo_referencia_id, referencia_id, descripcion)
            VALUES (v_caja_id, p_empleado_id, 'EGRESO', v_venta.total, v_saldo_actual_caja, v_saldo_actual_caja - v_venta.total,
              v_categoria_id, v_tipo_referencia_id, p_venta_id, 'Anulación Venta POS #' || v_venta.numero_comprobante);
            UPDATE cajas SET saldo_actual = saldo_actual - v_venta.total WHERE id = v_caja_id;
        END IF;
    END IF;

    IF v_venta.metodo_pago = 'FIADO' THEN DELETE FROM cuentas_cobrar WHERE venta_id = p_venta_id; END IF;

    UPDATE ventas SET estado = 'ANULADA', estado_pago = 'NO_APLICA',
      observaciones = CASE WHEN observaciones IS NOT NULL AND observaciones <> '' THEN observaciones || ' | ANULADA: ' || TRIM(p_motivo) ELSE 'ANULADA: ' || TRIM(p_motivo) END
    WHERE id = p_venta_id;

    RETURN json_build_object('success', true, 'venta_id', p_venta_id, 'numero_comprobante', v_venta.numero_comprobante, 'monto_revertido', v_venta.total);
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al anular venta: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_anular_venta(UUID, INTEGER, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_anular_venta(UUID, INTEGER, TEXT) TO authenticated;


-- ████████████████████████████████████████████████████████████
-- FUNCIONES — INVENTARIO
-- ████████████████████████████████████████████████████████████


-- ── fn_ajustar_stock_inventario ─────────────────────────────
CREATE OR REPLACE FUNCTION fn_ajustar_stock_inventario(
    p_producto_id UUID,
    p_tipo_movimiento TEXT,
    p_cantidad DECIMAL(12,2),
    p_observaciones TEXT
)
RETURNS JSON AS $$
DECLARE
    v_stock_actual DECIMAL(12,2); v_stock_nuevo DECIMAL(12,2); v_kardex_id UUID;
BEGIN
    IF p_cantidad <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
    IF p_tipo_movimiento NOT IN ('COMPRA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO') THEN
        RAISE EXCEPTION 'Tipo de movimiento no válido: %. Use COMPRA, AJUSTE_POSITIVO o AJUSTE_NEGATIVO', p_tipo_movimiento;
    END IF;
    IF COALESCE(TRIM(p_observaciones), '') = '' THEN RAISE EXCEPTION 'Las observaciones son obligatorias para ajustes de stock'; END IF;
    SELECT stock_actual INTO v_stock_actual FROM productos WHERE id = p_producto_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF p_tipo_movimiento IN ('COMPRA', 'AJUSTE_POSITIVO') THEN v_stock_nuevo := v_stock_actual + p_cantidad;
    ELSE v_stock_nuevo := v_stock_actual - p_cantidad; END IF;
    IF v_stock_nuevo < 0 THEN RAISE EXCEPTION 'Stock insuficiente. Stock actual: %, cantidad a restar: %', v_stock_actual, p_cantidad; END IF;
    UPDATE productos SET stock_actual = v_stock_nuevo WHERE id = p_producto_id;
    INSERT INTO kardex_inventario (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, observaciones)
    VALUES (p_producto_id, p_tipo_movimiento, p_cantidad, v_stock_actual, v_stock_nuevo, p_observaciones) RETURNING id INTO v_kardex_id;
    RETURN json_build_object('success', TRUE, 'kardex_id', v_kardex_id, 'stock_anterior', v_stock_actual,
      'stock_nuevo', v_stock_nuevo, 'tipo_movimiento', p_tipo_movimiento, 'cantidad', p_cantidad);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION fn_ajustar_stock_inventario(UUID, TEXT, DECIMAL, TEXT) TO authenticated;


-- ████████████████████████████████████████████████████████████
-- FUNCIONES — CUENTAS POR COBRAR
-- ████████████████████████████████████████████████████████████


-- ── fn_registrar_pago_fiado ─────────────────────────────────
CREATE OR REPLACE FUNCTION fn_registrar_pago_fiado(
    p_venta_id UUID, p_monto DECIMAL(12,2), p_metodo_pago VARCHAR(20), p_observaciones TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_venta RECORD; v_total_pagado DECIMAL(12,2); v_saldo_pendiente DECIMAL(12,2);
    v_nuevo_estado VARCHAR(20); v_empleado_id INTEGER;
    v_caja_id INTEGER; v_categoria_id INTEGER; v_tipo_referencia_id INTEGER; v_saldo_caja DECIMAL(12,2);
BEGIN
    SELECT id INTO v_empleado_id FROM usuarios WHERE usuario = auth.jwt() ->> 'email';
    IF v_empleado_id IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
    SELECT id, total, metodo_pago, estado, estado_pago INTO v_venta FROM ventas WHERE id = p_venta_id FOR UPDATE;
    IF v_venta IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
    IF v_venta.metodo_pago != 'FIADO' THEN RAISE EXCEPTION 'La venta no es de tipo FIADO'; END IF;
    IF v_venta.estado_pago = 'PAGADO' THEN RAISE EXCEPTION 'Esta venta ya esta completamente pagada'; END IF;
    SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado FROM cuentas_cobrar WHERE venta_id = p_venta_id;
    v_saldo_pendiente := v_venta.total - v_total_pagado;
    IF p_monto > v_saldo_pendiente THEN RAISE EXCEPTION 'El monto ($%) supera el saldo pendiente ($%)', p_monto, v_saldo_pendiente; END IF;
    IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;

    INSERT INTO cuentas_cobrar (venta_id, empleado_id, monto, metodo_pago, observaciones)
    VALUES (p_venta_id, v_empleado_id, p_monto, p_metodo_pago, p_observaciones);
    v_nuevo_estado := CASE WHEN (v_total_pagado + p_monto) >= v_venta.total THEN 'PAGADO' ELSE 'PAGADO_PARCIAL' END;
    UPDATE ventas SET estado_pago = v_nuevo_estado WHERE id = p_venta_id;

    IF p_metodo_pago = 'EFECTIVO' THEN
        SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA_CHICA';
        SELECT id INTO v_categoria_id FROM categorias_operaciones WHERE tipo = 'INGRESO' AND nombre ILIKE '%Ventas%' LIMIT 1;
        SELECT id INTO v_tipo_referencia_id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1;
        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            SELECT saldo_actual INTO v_saldo_caja FROM cajas WHERE id = v_caja_id;
            INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual,
              categoria_id, tipo_referencia_id, referencia_id, descripcion)
            VALUES (v_caja_id, v_empleado_id, 'INGRESO', p_monto, v_saldo_caja, v_saldo_caja + p_monto,
              v_categoria_id, v_tipo_referencia_id, p_venta_id, 'Pago fiado - ' || COALESCE(p_observaciones, 'Sin observaciones'));
            UPDATE cajas SET saldo_actual = saldo_actual + p_monto WHERE id = v_caja_id;
        END IF;
    END IF;
    RETURN json_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) TO authenticated;


-- ── fn_listar_cuentas_cobrar ────────────────────────────────
CREATE OR REPLACE FUNCTION fn_listar_cuentas_cobrar(
    p_busqueda TEXT DEFAULT NULL, p_page INTEGER DEFAULT 0, p_page_size INTEGER DEFAULT 20
)
RETURNS TABLE (
    cliente_id UUID, cliente_nombre VARCHAR, cliente_identificacion VARCHAR,
    cliente_telefono VARCHAR, total_deuda DECIMAL, cantidad_ventas BIGINT, ultima_venta_fecha TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT c.id, c.nombre, c.identificacion, c.telefono,
        SUM(v.total - COALESCE(pagos.total_pagado, 0))::DECIMAL, COUNT(v.id), MAX(v.fecha)
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN (SELECT venta_id, SUM(monto) AS total_pagado FROM cuentas_cobrar GROUP BY venta_id) pagos ON pagos.venta_id = v.id
    WHERE v.metodo_pago = 'FIADO' AND v.estado = 'COMPLETADA' AND v.estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')
      AND (p_busqueda IS NULL OR p_busqueda = '' OR c.nombre ILIKE '%' || p_busqueda || '%' OR c.identificacion ILIKE '%' || p_busqueda || '%')
    GROUP BY c.id, c.nombre, c.identificacion, c.telefono
    HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ORDER BY 5 DESC LIMIT p_page_size OFFSET p_page * p_page_size;
$$;

REVOKE EXECUTE ON FUNCTION fn_listar_cuentas_cobrar(TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION fn_listar_cuentas_cobrar(TEXT, INTEGER, INTEGER) TO authenticated;


-- ── fn_resumir_cuentas_cobrar ───────────────────────────────
CREATE OR REPLACE FUNCTION fn_resumir_cuentas_cobrar(p_busqueda TEXT DEFAULT NULL)
RETURNS TABLE (total_clientes BIGINT, total_deuda DECIMAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(COUNT(DISTINCT base.cliente_id), 0)::BIGINT, COALESCE(SUM(base.saldo_pendiente), 0)::DECIMAL
    FROM (
        SELECT c.id AS cliente_id, SUM(v.total - COALESCE(pagos.total_pagado, 0))::DECIMAL AS saldo_pendiente
        FROM ventas v JOIN clientes c ON c.id = v.cliente_id
        LEFT JOIN (SELECT venta_id, SUM(monto) AS total_pagado FROM cuentas_cobrar GROUP BY venta_id) pagos ON pagos.venta_id = v.id
        WHERE v.metodo_pago = 'FIADO' AND v.estado = 'COMPLETADA' AND v.estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')
          AND (p_busqueda IS NULL OR p_busqueda = '' OR c.nombre ILIKE '%' || p_busqueda || '%' OR c.identificacion ILIKE '%' || p_busqueda || '%')
        GROUP BY c.id HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ) base;
$$;

REVOKE EXECUTE ON FUNCTION fn_resumir_cuentas_cobrar(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_resumir_cuentas_cobrar(TEXT) TO authenticated;


-- ████████████████████████████████████████████████████████████
-- FUNCIONES — VENTAS (historial)
-- ████████████████████████████████████████████████████████████


-- ── fn_listar_ventas ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT);
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.fn_listar_ventas(
    p_filtro TEXT DEFAULT 'hoy', p_busqueda TEXT DEFAULT NULL, p_page INT DEFAULT 0,
    p_page_size INT DEFAULT 10, p_estado TEXT DEFAULT NULL, p_turno_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID, turno_id UUID, empleado_id INTEGER, cliente_id UUID, tipo_comprobante TEXT,
    numero_comprobante INTEGER, subtotal NUMERIC, total NUMERIC, base_iva_0 NUMERIC,
    base_iva_15 NUMERIC, iva_valor NUMERIC, metodo_pago TEXT, estado TEXT, fecha TIMESTAMPTZ,
    cliente_nombre TEXT, cliente_identificacion TEXT, empleado_nombre TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_fecha_local DATE; v_inicio TIMESTAMPTZ; v_fin TIMESTAMPTZ; v_term TEXT; v_term_regex TEXT;
BEGIN
    v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;
    IF p_filtro = 'hoy' THEN
        v_inicio := (v_fecha_local::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := ((v_fecha_local + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    ELSIF p_filtro = 'semana' THEN
        v_inicio := ((v_fecha_local - (EXTRACT(ISODOW FROM v_fecha_local)::INT - 1) * INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := NULL;
    ELSIF p_filtro = 'mes' THEN
        v_inicio := (DATE_TRUNC('month', v_fecha_local)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := NULL;
    ELSIF p_filtro = 'todo' THEN v_inicio := NULL; v_fin := NULL;
    ELSE
        v_inicio := (p_filtro::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := ((p_filtro::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    END IF;
    v_term := NULLIF(TRIM(p_busqueda), '');
    v_term_regex := regexp_replace(v_term, '([.+*?^${}()|[\]\\])', '\\\1', 'g');
    RETURN QUERY
    SELECT v.id, v.turno_id, v.empleado_id, v.cliente_id, v.tipo_comprobante::TEXT, v.numero_comprobante,
        v.subtotal, v.total, v.base_iva_0, v.base_iva_15, v.iva_valor, v.metodo_pago::TEXT, v.estado::TEXT, v.fecha,
        c.nombre::TEXT, c.identificacion::TEXT, e.nombre::TEXT
    FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id LEFT JOIN usuarios e ON v.empleado_id = e.id
    WHERE v.estado = COALESCE(p_estado, 'COMPLETADA')
      AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
      AND (v_inicio IS NULL OR v.fecha >= v_inicio) AND (v_fin IS NULL OR v.fecha < v_fin)
      AND (v_term IS NULL OR v.numero_comprobante::TEXT ILIKE '%' || v_term || '%'
        OR (REPLACE(v.tipo_comprobante::TEXT, '_', ' ') || ' ' || COALESCE(v.numero_comprobante::TEXT, '')) ~* ('\m' || v_term_regex || '\M')
        OR c.nombre ILIKE '%' || v_term || '%' OR c.identificacion ILIKE '%' || v_term || '%')
    ORDER BY v.fecha DESC OFFSET p_page * p_page_size LIMIT p_page_size;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID) TO authenticated;


-- ── fn_resumir_ventas ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.fn_resumir_ventas(
    p_filtro TEXT DEFAULT 'hoy', p_busqueda TEXT DEFAULT NULL,
    p_estado TEXT DEFAULT NULL, p_turno_id UUID DEFAULT NULL
)
RETURNS TABLE (total_registros BIGINT, total_monto NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_fecha_local DATE; v_inicio TIMESTAMPTZ; v_fin TIMESTAMPTZ; v_term TEXT; v_term_regex TEXT;
BEGIN
    v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;
    IF p_filtro = 'hoy' THEN
        v_inicio := (v_fecha_local::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := ((v_fecha_local + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    ELSIF p_filtro = 'semana' THEN
        v_inicio := ((v_fecha_local - (EXTRACT(ISODOW FROM v_fecha_local)::INT - 1) * INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := NULL;
    ELSIF p_filtro = 'mes' THEN
        v_inicio := (DATE_TRUNC('month', v_fecha_local)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := NULL;
    ELSIF p_filtro = 'todo' THEN v_inicio := NULL; v_fin := NULL;
    ELSE
        v_inicio := (p_filtro::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin := ((p_filtro::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    END IF;
    v_term := NULLIF(TRIM(p_busqueda), '');
    v_term_regex := regexp_replace(v_term, '([.+*?^${}()|[\]\\])', '\\\1', 'g');
    RETURN QUERY
    SELECT COUNT(*)::BIGINT, COALESCE(SUM(v.total), 0)
    FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id
    WHERE v.estado = COALESCE(p_estado, 'COMPLETADA')
      AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
      AND (v_inicio IS NULL OR v.fecha >= v_inicio) AND (v_fin IS NULL OR v.fecha < v_fin)
      AND (v_term IS NULL OR v.numero_comprobante::TEXT ILIKE '%' || v_term || '%'
        OR (REPLACE(v.tipo_comprobante::TEXT, '_', ' ') || ' ' || COALESCE(v.numero_comprobante::TEXT, '')) ~* ('\m' || v_term_regex || '\M')
        OR c.nombre ILIKE '%' || v_term || '%' OR c.identificacion ILIKE '%' || v_term || '%');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID) TO authenticated;


-- ── fn_reporte_ventas_periodo ───────────────────────────────
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.fn_reporte_ventas_periodo(
    p_fecha_inicio TEXT, p_fecha_fin TEXT, p_turno_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_inicio TIMESTAMPTZ; v_fin TIMESTAMPTZ;
    v_total_ventas BIGINT; v_total_monto NUMERIC(12,2);
    v_total_anuladas BIGINT; v_monto_anulado NUMERIC(12,2);
    v_costo_total NUMERIC(12,2); v_ganancia_bruta NUMERIC(12,2); v_margen_pct NUMERIC(5,2);
    v_por_metodo JSON; v_por_comprobante JSON; v_top_productos JSON;
BEGIN
    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(total), 0) INTO v_total_ventas, v_total_monto
    FROM ventas WHERE estado = 'COMPLETADA' AND (p_turno_id IS NULL OR turno_id = p_turno_id) AND fecha >= v_inicio AND fecha < v_fin;

    SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(total), 0) INTO v_total_anuladas, v_monto_anulado
    FROM ventas WHERE estado = 'ANULADA' AND (p_turno_id IS NULL OR turno_id = p_turno_id) AND fecha >= v_inicio AND fecha < v_fin;

    SELECT COALESCE(SUM(p.precio_costo * vd.cantidad), 0), COALESCE(SUM((vd.precio_unitario - p.precio_costo) * vd.cantidad), 0)
    INTO v_costo_total, v_ganancia_bruta
    FROM ventas_detalles vd JOIN ventas v ON v.id = vd.venta_id JOIN productos p ON p.id = vd.producto_id
    WHERE v.estado = 'COMPLETADA' AND (p_turno_id IS NULL OR v.turno_id = p_turno_id) AND v.fecha >= v_inicio AND v.fecha < v_fin;

    v_margen_pct := CASE WHEN v_total_monto > 0 THEN ROUND((v_ganancia_bruta / v_total_monto) * 100, 2) ELSE 0 END;

    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON) INTO v_por_metodo FROM (
        SELECT metodo_pago AS metodo, COUNT(*) AS cantidad, SUM(total) AS monto FROM ventas
        WHERE estado = 'COMPLETADA' AND (p_turno_id IS NULL OR turno_id = p_turno_id) AND fecha >= v_inicio AND fecha < v_fin
        GROUP BY metodo_pago ORDER BY SUM(total) DESC) t;

    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON) INTO v_por_comprobante FROM (
        SELECT tipo_comprobante::TEXT AS tipo, COUNT(*) AS cantidad, SUM(total) AS monto FROM ventas
        WHERE estado = 'COMPLETADA' AND (p_turno_id IS NULL OR turno_id = p_turno_id) AND fecha >= v_inicio AND fecha < v_fin
        GROUP BY tipo_comprobante ORDER BY SUM(total) DESC) t;

    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON) INTO v_top_productos FROM (
        SELECT p.id AS producto_id, p.nombre, SUM(vd.cantidad) AS total_unidades, SUM(vd.subtotal) AS total_monto, COUNT(DISTINCT v.id) AS total_ventas
        FROM ventas_detalles vd JOIN ventas v ON v.id = vd.venta_id JOIN productos p ON p.id = vd.producto_id
        WHERE v.estado = 'COMPLETADA' AND (p_turno_id IS NULL OR v.turno_id = p_turno_id) AND v.fecha >= v_inicio AND v.fecha < v_fin
        GROUP BY p.id, p.nombre ORDER BY SUM(vd.cantidad) DESC LIMIT 5) t;

    RETURN json_build_object('fecha_inicio', p_fecha_inicio, 'fecha_fin', p_fecha_fin,
        'total_ventas', v_total_ventas, 'total_monto', v_total_monto,
        'total_anuladas', v_total_anuladas, 'monto_anulado', v_monto_anulado,
        'costo_total', v_costo_total, 'ganancia_bruta', v_ganancia_bruta, 'margen_pct', v_margen_pct,
        'por_metodo_pago', v_por_metodo, 'por_tipo_comprobante', v_por_comprobante, 'top_productos', v_top_productos);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) TO authenticated;


-- ████████████████████████████████████████████████████████████
-- FINALIZAR
-- ████████████████████████████████████████████████████████████
NOTIFY pgrst, 'reload schema';
