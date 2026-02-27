-- ==========================================
-- DROP — descomentar SOLO si cambia la firma (parámetros o tipo de retorno)
-- ==========================================
-- DROP FUNCTION IF EXISTS public.ejecutar_cierre_diario(
--   UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
--   DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
-- );

-- ==========================================
-- FUNCIÓN: ejecutar_cierre_diario (v4.7)
-- ==========================================
-- CAMBIOS v4.7:
--   - 1 sola transferencia a Varios por día (sin importar cuántos turnos)
--   - Si ya existe TRANSFERENCIA_ENTRANTE en CAJA_CHICA para p_fecha → skip
--   - En ese caso: v_transferencia_efectiva = 0, v_deficit_caja_chica = 0
--   - El efectivo disponible va todo a Tienda en el segundo turno
-- CAMBIOS v4.6:
--   - Distribución inteligente de efectivo (ya no lanza excepción por déficit)
--   - Lógica "todo o nada" para Caja Chica:
--       Si efectivo - fondo >= transferencia → transfiere completo
--       Si no                               → transfiere $0 (registra déficit)
--   - El sobrante SIEMPRE va a Caja Principal (nunca negativo)
--   - deficit_caja_chica guardado en caja_fisica_diaria para trazabilidad
--   - 3 casos manejados: normal / déficit parcial / déficit total
-- CAMBIOS v4.5:
--   - Fórmula corregida para venta_celular y venta_bus:
--       venta = (saldo_anterior + agregado_dia) - saldo_final
--   - Soporta recargas del proveedor CELULAR y compras de saldo BUS
--   - CRÍTICO: Filtro de recargas_virtuales por created_at > último_cierre_at
--       (NO por fecha = p_fecha) — captura recargas no aplicadas en cierres previos
-- ==========================================

CREATE OR REPLACE FUNCTION public.ejecutar_cierre_diario(  -- v4.8
  p_turno_id                    UUID,
  p_fecha                       DATE,
  p_empleado_id                 INTEGER,
  p_efectivo_recaudado          DECIMAL(12,2),
  p_saldo_celular_final         DECIMAL(12,2),
  p_saldo_bus_final             DECIMAL(12,2),
  p_saldo_anterior_celular      DECIMAL(12,2),
  p_saldo_anterior_bus          DECIMAL(12,2),
  p_saldo_anterior_caja         DECIMAL(12,2),
  p_saldo_anterior_caja_chica   DECIMAL(12,2),
  p_saldo_anterior_caja_celular DECIMAL(12,2),
  p_saldo_anterior_caja_bus     DECIMAL(12,2),
  p_observaciones               TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- IDs de cajas (por código para evitar hardcodeo)
  v_caja_id          INTEGER;
  v_caja_chica_id    INTEGER;
  v_caja_celular_id  INTEGER;
  v_caja_bus_id      INTEGER;

  -- IDs de servicios y referencias
  v_tipo_servicio_celular_id  INTEGER;
  v_tipo_servicio_bus_id      INTEGER;
  v_tipo_ref_caja_fisica_id   INTEGER;
  v_tipo_ref_recargas_id      INTEGER;

  -- Configuración
  v_fondo_fijo           DECIMAL(12,2);
  v_transferencia_diaria DECIMAL(12,2);

  -- Recargas virtuales pendientes (v4.5)
  v_agregado_celular  DECIMAL(12,2);
  v_agregado_bus      DECIMAL(12,2);
  v_ultimo_cierre_at  TIMESTAMP; -- Timestamp del último cierre (para filtrar recargas no aplicadas)

  -- Distribución inteligente de efectivo (v4.6)
  v_efectivo_disponible        DECIMAL(12,2); -- Efectivo tras apartar el fondo
  v_transferencia_efectiva     DECIMAL(12,2); -- Lo que realmente va a Caja Chica (puede ser 0)
  v_deficit_caja_chica         DECIMAL(12,2); -- Lo que faltó para Caja Chica (0 si turno normal)
  v_dinero_a_depositar         DECIMAL(12,2); -- Lo que va a Caja Principal (>= 0 siempre)
  v_transferencia_ya_hecha     BOOLEAN := FALSE; -- (v4.7) ¿Ya se transfirió a Varios hoy?

  -- Saldos finales
  v_saldo_final_caja           DECIMAL(12,2);
  v_saldo_final_caja_chica     DECIMAL(12,2);
  v_venta_celular              DECIMAL(12,2);
  v_venta_bus                  DECIMAL(12,2);
  v_saldo_final_caja_celular   DECIMAL(12,2);
  v_saldo_final_caja_bus       DECIMAL(12,2);

  -- IDs generados
  v_cierre_id          UUID;
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

  IF EXISTS (SELECT 1 FROM caja_fisica_diaria WHERE turno_id = p_turno_id) THEN
    RAISE EXCEPTION 'El turno ya tiene un cierre registrado';
  END IF;

  IF EXISTS (SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND hora_cierre IS NOT NULL) THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;

  -- ==========================================
  -- 2. OBTENER IDs POR CÓDIGO
  -- ==========================================

  SELECT id INTO v_caja_id          FROM cajas WHERE codigo = 'CAJA';
  SELECT id INTO v_caja_chica_id    FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_caja_celular_id  FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_bus_id      FROM cajas WHERE codigo = 'CAJA_BUS';

  SELECT id INTO v_tipo_servicio_celular_id FROM tipos_servicio   WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_servicio_bus_id     FROM tipos_servicio   WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_caja_fisica_id  FROM tipos_referencia WHERE codigo = 'CAJA_FISICA_DIARIA';
  SELECT id INTO v_tipo_ref_recargas_id     FROM tipos_referencia WHERE codigo = 'RECARGAS';

  -- ==========================================
  -- 3. OBTENER CONFIGURACIÓN
  -- ==========================================

  SELECT fondo_fijo_diario, caja_chica_transferencia_diaria
  INTO v_fondo_fijo, v_transferencia_diaria
  FROM configuraciones
  LIMIT 1;

  IF v_fondo_fijo IS NULL OR v_transferencia_diaria IS NULL THEN
    RAISE EXCEPTION 'No se encontró configuración del sistema';
  END IF;

  -- ==========================================
  -- 4. OBTENER TIMESTAMP DEL ÚLTIMO CIERRE
  -- ==========================================
  -- Busca el cierre más reciente (cualquier turno) para saber hasta dónde
  -- ya se incorporaron las recargas virtuales

  SELECT MAX(created_at)
  INTO v_ultimo_cierre_at
  FROM caja_fisica_diaria;

  -- ==========================================
  -- 5. RECARGAS VIRTUALES PENDIENTES (v4.5 CORREGIDO)
  -- ==========================================
  -- IMPORTANTE: Filtra por created_at > último cierre, NO por fecha = hoy
  -- Esto captura todas las recargas no incorporadas en cierres previos,
  -- incluso si tienen fecha anterior (ej: recarga del 21 cerrada el 23)

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
  -- 6. DISTRIBUCIÓN INTELIGENTE DE EFECTIVO (v4.7)
  --
  -- Regla de negocio: solo 1 transferencia a Varios por día.
  -- Si ya se transfirió en un turno anterior del mismo día → skip.
  --
  -- Prioridades (cuando no se ha transferido aún):
  --   1° Fondo fijo (para dar vueltos mañana)
  --   2° Caja Chica: todo o nada (si no alcanza el monto completo → $0)
  --   3° Caja Principal: lo que sobre (siempre >= 0)
  --
  -- Casos:
  --   YA TRANSFERIDO HOY: chica = $0, deficit = $0, principal = efectivo - fondo
  --   NORMAL:          efectivo >= fondo + transferencia
  --                    → chica = transferencia (completo), principal = efectivo - fondo - transferencia
  --   DÉFICIT PARCIAL: fondo <= efectivo < fondo + transferencia
  --                    → chica = $0 (todo o nada), principal = efectivo - fondo, deficit = transferencia
  --   DÉFICIT TOTAL:   efectivo < fondo
  --                    → chica = $0, principal = $0, deficit = transferencia
  --                    → fondo queda incompleto (el efectivo disponible es lo que hay)
  -- ==========================================

  v_efectivo_disponible := p_efectivo_recaudado - v_fondo_fijo;

  -- (v4.7) Verificar si ya se hizo la transferencia a Varios hoy
  -- Usar columna `fecha` (TIMESTAMP WITH TIME ZONE) con timezone local
  -- para evitar desfase UTC en cierres nocturnos
  SELECT EXISTS (
    SELECT 1 FROM operaciones_cajas
    WHERE caja_id        = v_caja_chica_id
      AND tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
      AND (fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
  ) INTO v_transferencia_ya_hecha;

  IF v_transferencia_ya_hecha THEN
    -- Ya se transfirió hoy en otro turno: Varios no recibe nada, sin déficit
    v_transferencia_efectiva := 0;
    v_deficit_caja_chica     := 0;
    v_dinero_a_depositar     := GREATEST(0, v_efectivo_disponible);

  ELSIF v_efectivo_disponible >= v_transferencia_diaria THEN
    -- CASO NORMAL
    v_transferencia_efectiva := v_transferencia_diaria;
    v_deficit_caja_chica     := 0;
    v_dinero_a_depositar     := v_efectivo_disponible - v_transferencia_diaria;

  ELSIF v_efectivo_disponible > 0 THEN
    -- CASO DÉFICIT PARCIAL: política todo o nada → Caja Chica = $0
    v_transferencia_efectiva := 0;
    v_deficit_caja_chica     := v_transferencia_diaria;
    v_dinero_a_depositar     := v_efectivo_disponible;

  ELSE
    -- CASO DÉFICIT TOTAL
    v_transferencia_efectiva := 0;
    v_deficit_caja_chica     := v_transferencia_diaria;
    v_dinero_a_depositar     := 0;
  END IF;

  -- ==========================================
  -- 7. CALCULAR VENTAS VIRTUALES (v4.5)
  -- ==========================================

  v_venta_celular := (p_saldo_anterior_celular + v_agregado_celular) - p_saldo_celular_final;
  v_venta_bus     := (p_saldo_anterior_bus     + v_agregado_bus)     - p_saldo_bus_final;

  -- Ventas negativas indican falta de registro en recargas_virtuales
  IF v_venta_celular < 0 THEN
    RAISE EXCEPTION 'Venta celular negativa ($%). Registrá la recarga del proveedor en Recargas Virtuales antes de cerrar.', v_venta_celular;
  END IF;

  IF v_venta_bus < 0 THEN
    RAISE EXCEPTION 'Venta bus negativa ($%). Registrá la compra de saldo virtual en Recargas Virtuales antes de cerrar.', v_venta_bus;
  END IF;

  -- ==========================================
  -- 8. CALCULAR SALDOS FINALES
  -- ==========================================

  v_saldo_final_caja           := p_saldo_anterior_caja         + v_dinero_a_depositar;
  v_saldo_final_caja_chica     := p_saldo_anterior_caja_chica   + v_transferencia_efectiva;
  v_saldo_final_caja_celular   := p_saldo_anterior_caja_celular + v_venta_celular;
  v_saldo_final_caja_bus       := p_saldo_anterior_caja_bus     + v_venta_bus;

  -- ==========================================
  -- 9. INSERTAR caja_fisica_diaria
  -- ==========================================

  INSERT INTO caja_fisica_diaria (
    id, fecha, turno_id, empleado_id,
    efectivo_recaudado, deficit_caja_chica, observaciones, created_at
  ) VALUES (
    gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id,
    p_efectivo_recaudado, v_deficit_caja_chica, p_observaciones, NOW()
  )
  RETURNING id INTO v_cierre_id;

  -- ==========================================
  -- 10. OPERACIÓN EN CAJA PRINCIPAL
  -- ==========================================

  IF v_dinero_a_depositar > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_id, p_empleado_id, 'INGRESO', v_dinero_a_depositar,
      p_saldo_anterior_caja, v_saldo_final_caja,
      'Depósito del turno ' || p_fecha,
      v_tipo_ref_caja_fisica_id, v_cierre_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 11. TRANSFERENCIA A CAJA_CHICA
  -- ==========================================

  IF v_transferencia_efectiva > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_chica_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE', v_transferencia_efectiva,
      p_saldo_anterior_caja_chica, v_saldo_final_caja_chica,
      'Transferencia diaria desde caja física - turno ' || p_fecha,
      v_tipo_ref_caja_fisica_id, v_cierre_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 12. RECARGAS CELULAR
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, turno_id, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id, v_tipo_servicio_celular_id,
    v_venta_celular, p_saldo_anterior_celular, p_saldo_celular_final,
    (v_venta_celular + p_saldo_celular_final) = (p_saldo_anterior_celular + v_agregado_celular),
    NOW()
  )
  RETURNING id INTO v_recarga_celular_id;

  IF v_venta_celular > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_celular_id, p_empleado_id, 'INGRESO', v_venta_celular,
      p_saldo_anterior_caja_celular, v_saldo_final_caja_celular,
      'Venta celular del turno ' || p_fecha,
      v_tipo_ref_recargas_id, v_recarga_celular_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 13. RECARGAS BUS (v4.8)
  -- ON CONFLICT: si hubo mini cierre durante el día (registrar_compra_saldo_bus v3.0),
  -- ya existe un registro BUS para este turno en `recargas`.
  -- En ese caso: acumula venta_dia (mañana + tarde) y actualiza saldo_virtual_actual final.
  -- Sin mini cierre: comportamiento idéntico a v4.7 (INSERT normal).
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, turno_id, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    gen_random_uuid(), p_fecha, p_turno_id, p_empleado_id, v_tipo_servicio_bus_id,
    v_venta_bus, p_saldo_anterior_bus, p_saldo_bus_final,
    (v_venta_bus + p_saldo_bus_final) = (p_saldo_anterior_bus + v_agregado_bus),
    NOW()
  )
  ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE SET
    venta_dia            = recargas.venta_dia + EXCLUDED.venta_dia,
    saldo_virtual_actual = EXCLUDED.saldo_virtual_actual,
    validado             = EXCLUDED.validado,
    created_at           = NOW()
  RETURNING id INTO v_recarga_bus_id;

  IF v_venta_bus > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_bus_id, p_empleado_id, 'INGRESO', v_venta_bus,
      p_saldo_anterior_caja_bus, v_saldo_final_caja_bus,
      'Venta bus del turno ' || p_fecha,
      v_tipo_ref_recargas_id, v_recarga_bus_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 14. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================

  UPDATE cajas SET saldo_actual = v_saldo_final_caja,         updated_at = NOW() WHERE id = v_caja_id;
  UPDATE cajas SET saldo_actual = v_saldo_final_caja_chica,   updated_at = NOW() WHERE id = v_caja_chica_id;
  UPDATE cajas SET saldo_actual = v_saldo_final_caja_celular, updated_at = NOW() WHERE id = v_caja_celular_id;
  UPDATE cajas SET saldo_actual = v_saldo_final_caja_bus,     updated_at = NOW() WHERE id = v_caja_bus_id;

  -- ==========================================
  -- 15. CERRAR TURNO
  -- ==========================================

  UPDATE turnos_caja SET hora_cierre = NOW() WHERE id = p_turno_id;
  v_turno_cerrado := TRUE;

  -- ==========================================
  -- 16. RETORNAR RESUMEN
  -- ==========================================

  RETURN json_build_object(
    'success',       true,
    'cierre_id',     v_cierre_id,
    'turno_id',      p_turno_id,
    'fecha',         p_fecha,
    'turno_cerrado', v_turno_cerrado,
    'version',       '4.8',
    'configuracion', json_build_object(
      'fondo_fijo',           v_fondo_fijo,
      'transferencia_diaria', v_transferencia_diaria
    ),
    'distribucion_efectivo', json_build_object(
      'efectivo_recaudado',       p_efectivo_recaudado,
      'fondo_fisico',             GREATEST(p_efectivo_recaudado, v_fondo_fijo) - GREATEST(p_efectivo_recaudado - v_fondo_fijo, 0),
      'transferencia_caja_chica', v_transferencia_efectiva,
      'deposito_caja_principal',  v_dinero_a_depositar,
      'deficit_caja_chica',       v_deficit_caja_chica,
      'turno_con_deficit',        (v_deficit_caja_chica > 0)
    ),
    'recargas_virtuales_dia', json_build_object(
      'celular', v_agregado_celular,
      'bus',     v_agregado_bus
    ),
    'saldos_finales', json_build_object(
      'caja',         v_saldo_final_caja,
      'caja_chica',   v_saldo_final_caja_chica,
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
    RAISE EXCEPTION 'Error en cierre diario v4.8: %', SQLERRM;
END;
$function$;

-- ==========================================
-- PERMISOS
-- ==========================================

GRANT EXECUTE ON FUNCTION public.ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.ejecutar_cierre_diario(
  UUID, DATE, INTEGER, DECIMAL, DECIMAL, DECIMAL,
  DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT
) TO anon;

-- Refrescar caché de PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.ejecutar_cierre_diario IS
'Cierre diario v4.8 — ON CONFLICT en INSERT BUS de recargas: compatible con mini cierre de registrar_compra_saldo_bus v3.0. Acumula venta_dia (mañana + tarde) si ya existe snapshot del turno.';
