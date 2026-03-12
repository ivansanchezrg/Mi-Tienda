-- ==========================================
-- DROP — firma cambia en v5 (parámetros distintos a v4.9)
-- ==========================================
-- ⚠️  Descomentar y ejecutar PRIMERO si ya existe la función en la BD:
-- DROP FUNCTION IF EXISTS public.ejecutar_cierre_diario(
--   UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
--   DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
-- );

-- ==========================================
-- FUNCIÓN: ejecutar_cierre_diario (v5.0)
-- ==========================================
-- CAMBIOS v5.0 respecto a v4.9:
--   - Eliminado: p_efectivo_recaudado, p_saldo_anterior_caja, p_saldo_anterior_caja_chica
--   - Agregado:  p_efectivo_fisico (conteo físico del empleado en el cajón)
--   - Nueva caja CAJA_CHICA (cajón diario): acumula ventas POS y egresos del día
--   - Nueva caja VARIOS (ex CAJA_CHICA):   recibe transferencia diaria al cierre
--   - Saldos de CAJA y VARIOS se leen de BD (no se pasan como parámetro)
--   - Eliminada dependencia de caja_fisica_diaria (tabla eliminada en v5)
--   - Nuevo paso: ajuste por diferencia de conteo (INGRESO o EGRESO en CAJA_CHICA)
--   - CAJA_CHICA queda en saldo_actual = 0 al finalizar el cierre
--   - Último cierre detectado desde turnos_caja.hora_fecha_cierre (no caja_fisica_diaria)
--   - Referencia documental de operaciones: turnos_caja (no caja_fisica_diaria)
-- HEREDA DE v4.9:
--   - Lógica "todo o nada" para transferencia a VARIOS (ex-Caja Chica)
--   - 1 sola transferencia a VARIOS por día (v_transferencia_ya_hecha)
--   - ON CONFLICT en INSERT BUS (mini cierre registrar_compra_saldo_bus)
--   - Recargas filtradas por created_at > último cierre (no por fecha)
--   - Ventas negativas lanzan excepción con mensaje descriptivo
-- ==========================================

CREATE OR REPLACE FUNCTION public.ejecutar_cierre_diario(  -- v5.1
  p_turno_id               UUID,
  p_fecha                  DATE,
  p_empleado_id            INTEGER,
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
  -- IDs de cajas (por código)
  v_caja_id         INTEGER;  -- CAJA (bóveda/Tienda)
  v_caja_chica_id   INTEGER;  -- CAJA_CHICA (cajón físico diario)
  v_varios_id       INTEGER;  -- VARIOS (fondo emergencia, ex-CAJA_CHICA)
  v_caja_celular_id INTEGER;
  v_caja_bus_id     INTEGER;

  -- IDs de categorías de ajuste
  v_cat_ajuste_ingreso_id INTEGER;  -- IN-005: Ajuste Diferencia Conteo
  v_cat_ajuste_egreso_id  INTEGER;  -- EG-013: Ajuste Diferencia Conteo

  -- IDs de servicios y referencias
  v_tipo_servicio_celular_id INTEGER;
  v_tipo_servicio_bus_id     INTEGER;
  v_tipo_ref_recargas_id     INTEGER;
  v_tipo_ref_turnos_id       INTEGER;

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

  -- IDs generados
  v_recarga_celular_id UUID;
  v_recarga_bus_id     UUID;
  v_turno_cerrado      BOOLEAN := FALSE;
BEGIN
  -- ==========================================
  -- 1. VALIDACIONES DE TURNO
  -- ==========================================

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

  -- ==========================================
  -- 2. OBTENER IDs POR CÓDIGO / TABLA
  -- ==========================================

  SELECT id INTO v_caja_id         FROM cajas WHERE codigo = 'CAJA';
  SELECT id INTO v_caja_chica_id   FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_varios_id       FROM cajas WHERE codigo = 'VARIOS';
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_bus_id     FROM cajas WHERE codigo = 'CAJA_BUS';

  SELECT id INTO v_tipo_servicio_celular_id FROM tipos_servicio   WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_servicio_bus_id     FROM tipos_servicio   WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_recargas_id     FROM tipos_referencia WHERE tabla = 'recargas';
  SELECT id INTO v_tipo_ref_turnos_id       FROM tipos_referencia WHERE tabla = 'turnos_caja';

  SELECT id INTO v_cat_ajuste_ingreso_id FROM categorias_operaciones WHERE codigo = 'IN-005';
  SELECT id INTO v_cat_ajuste_egreso_id  FROM categorias_operaciones WHERE codigo = 'EG-013';

  -- ==========================================
  -- 3. OBTENER CONFIGURACIÓN
  -- ==========================================

  SELECT fondo_fijo_diario, varios_transferencia_diaria
  INTO v_fondo_fijo, v_transferencia_diaria
  FROM configuraciones
  LIMIT 1;

  IF v_fondo_fijo IS NULL OR v_transferencia_diaria IS NULL THEN
    RAISE EXCEPTION 'No se encontró configuración del sistema';
  END IF;

  -- ==========================================
  -- 4. OBTENER TIMESTAMP DEL ÚLTIMO CIERRE
  -- (para filtrar recargas virtuales no incorporadas en cierres previos)
  -- ==========================================

  SELECT MAX(hora_fecha_cierre)
  INTO v_ultimo_cierre_at
  FROM turnos_caja
  WHERE hora_fecha_cierre IS NOT NULL;

  -- ==========================================
  -- 5. RECARGAS VIRTUALES PENDIENTES
  -- IMPORTANTE: Filtra por created_at > último cierre, NO por fecha = hoy.
  -- Esto captura todas las recargas no incorporadas en cierres anteriores,
  -- incluso si tienen fecha anterior (ej: recarga del lunes en un cierre del martes).
  -- ==========================================

  SELECT COALESCE(SUM(monto_virtual), 0)
  INTO v_agregado_celular
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_servicio_celular_id
    AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at);

  SELECT COALESCE(SUM(monto_virtual), 0)
  INTO v_agregado_bus
  FROM recargas_virtuales rv
  WHERE rv.tipo_servicio_id = v_tipo_servicio_bus_id
    AND (v_ultimo_cierre_at IS NULL OR rv.created_at > v_ultimo_cierre_at);

  -- ==========================================
  -- 6. LEER SALDOS ACTUALES DE CAJAS (con lock para consistencia)
  -- ==========================================

  SELECT saldo_actual INTO v_saldo_caja_chica_digital
    FROM cajas WHERE id = v_caja_chica_id FOR UPDATE;

  SELECT saldo_actual INTO v_saldo_caja
    FROM cajas WHERE id = v_caja_id FOR UPDATE;

  SELECT saldo_actual INTO v_saldo_varios
    FROM cajas WHERE id = v_varios_id FOR UPDATE;

  -- ==========================================
  -- 7. AJUSTE POR DIFERENCIA DE CONTEO FÍSICO
  --
  -- efectivo_esperado = saldo_digital + fondo_fijo
  --   (el empleado debe tener exactamente esto en el cajón)
  -- diferencia = p_efectivo_fisico - efectivo_esperado
  --   > 0 → encontró más de lo esperado  → INGRESO de ajuste (faltó registrar algún ingreso)
  --   < 0 → encontró menos de lo esperado → EGRESO de ajuste (faltó registrar algún egreso)
  --   = 0 → conteo exacto, no se necesita ajuste
  -- ==========================================

  v_efectivo_esperado := v_saldo_caja_chica_digital + v_fondo_fijo;
  v_diferencia        := p_efectivo_fisico - v_efectivo_esperado;

  IF v_diferencia > 0 THEN
    -- Más físico del esperado → INGRESO de ajuste a CAJA_CHICA
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
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
      id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
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

    -- Registrar deuda del empleado: el cajón tiene menos de lo esperado.
    -- Causas posibles: dinero tomado sin registrar, error de conteo, billete falso, etc.
    -- El déficit de VARIOS y del fondo NO son deudas del empleado (son costos operacionales).
    -- Esta deuda se salda MANUALMENTE (pago en efectivo o descuento en nómina).
    INSERT INTO deudas_empleados (
      empleado_id, turno_id, fecha, monto_faltante, estado
    ) VALUES (
      p_empleado_id,
      p_turno_id,
      p_fecha,
      ABS(v_diferencia),
      'PENDIENTE'
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
  -- La reposición siempre se hace en montos fijos desde configuraciones.
  -- Regla adicional: solo 1 transferencia a VARIOS por día.
  -- ==========================================

  -- ¿VARIOS ya recibió su transferencia diaria hoy?
  -- Cubre dos casos:
  --   1. Cierre normal anterior del día   → TRANSFERENCIA_ENTRANTE en VARIOS
  --   2. Ajuste de apertura (reparar déficit) → INGRESO categoría IN-004 en VARIOS
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
  ) INTO v_transferencia_ya_hecha;

  IF v_transferencia_ya_hecha THEN
    -- 2do turno del día: VARIOS ya recibió, no hay déficit
    v_transferencia_efectiva    := 0;
    v_deficit_varios            := 0;
    v_fondo_en_cajon            := (p_efectivo_fisico >= v_fondo_fijo);
    -- Fondo queda si alcanza; si no, todo va a CAJA
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
  -- 9. CALCULAR VENTAS VIRTUALES (lógica idéntica a v4.5)
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
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
      v_caja_id,
      p_empleado_id,
      'INGRESO',
      v_dinero_a_depositar,
      v_saldo_caja,
      v_saldo_caja + v_dinero_a_depositar,
      'Depósito del cajón — turno ' || p_fecha,
      v_tipo_ref_turnos_id,
      p_turno_id
    );
  END IF;

  -- ==========================================
  -- 11. TRANSFERENCIA A VARIOS (fondo emergencia)
  -- ==========================================

  IF v_transferencia_efectiva > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
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
  UPDATE cajas SET saldo_actual = v_saldo_caja + v_dinero_a_depositar WHERE id = v_caja_id;

  -- VARIOS (fondo emergencia): recibe la transferencia
  UPDATE cajas SET saldo_actual = v_saldo_varios + v_transferencia_efectiva WHERE id = v_varios_id;

  -- CAJA_CHICA (cajón): queda en $0 digital (el fondo_fijo queda físicamente pero no digitalmente)
  UPDATE cajas SET saldo_actual = 0 WHERE id = v_caja_chica_id;

  -- ==========================================
  -- 13. RECARGAS CELULAR
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, turno_id, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual
  ) VALUES (
    gen_random_uuid(),
    p_fecha,
    p_turno_id,
    p_empleado_id,
    v_tipo_servicio_celular_id,
    v_venta_celular,
    p_saldo_anterior_celular,
    p_saldo_celular_final
  )
  RETURNING id INTO v_recarga_celular_id;

  IF v_venta_celular > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
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
    UPDATE cajas SET saldo_actual = v_saldo_final_caja_celular WHERE id = v_caja_celular_id;
  END IF;

  -- ==========================================
  -- 14. RECARGAS BUS (ON CONFLICT para mini cierre)
  -- ON CONFLICT: si hubo mini cierre durante el día (registrar_compra_saldo_bus v3.0),
  -- ya existe un registro BUS para este turno. Acumula venta_dia y actualiza saldo final.
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, turno_id, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual
  ) VALUES (
    gen_random_uuid(),
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
    saldo_virtual_actual = EXCLUDED.saldo_virtual_actual
  RETURNING id INTO v_recarga_bus_id;

  IF v_venta_bus > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
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
    UPDATE cajas SET saldo_actual = v_saldo_final_caja_bus WHERE id = v_caja_bus_id;
  END IF;

  -- ==========================================
  -- 15. CERRAR TURNO
  -- ==========================================

  UPDATE turnos_caja
     SET hora_fecha_cierre = NOW(),
         fondo_cubierto    = v_fondo_en_cajon
   WHERE id = p_turno_id;
  v_turno_cerrado := TRUE;

  -- ==========================================
  -- 16. RETORNAR RESUMEN
  -- ==========================================

  RETURN json_build_object(
    'success',       true,
    'turno_id',      p_turno_id,
    'fecha',         p_fecha,
    'turno_cerrado', v_turno_cerrado,
    'version',       '5.0',
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
    RAISE EXCEPTION 'Error en cierre diario v5.0: %', SQLERRM;
END;
$function$;

-- ==========================================
-- PERMISOS
-- ==========================================

REVOKE EXECUTE ON FUNCTION public.ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) TO authenticated;

-- Refrescar caché de PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.ejecutar_cierre_diario IS
'Cierre diario v5.2 — Distribución en cascada "todo o nada" por nivel. '
'Inserta en deudas_empleados solo cuando efectivo_fisico < efectivo_esperado (faltante de conteo). '
'El déficit de VARIOS y del fondo son costos operacionales — NO se registran como deuda del empleado. '
'1° VARIOS recibe si efectivo >= transferencia_diaria completa. '
'2° Fondo fijo queda en cajón solo si efectivo >= transferencia_diaria + fondo_fijo. '
'3° CAJA recibe el resto. Si un nivel no alcanza, ese monto va a CAJA. '
'Sin montos parciales → reposición siempre en valores fijos desde configuraciones. '
'CAJA_CHICA.saldo_actual queda en $0 digital al finalizar. '
'Retorna monto_reposicion_apertura para informar al siguiente turno cuánto reponer.';
