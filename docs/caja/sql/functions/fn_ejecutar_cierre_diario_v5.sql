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
-- FUNCIÓN: fn_ejecutar_cierre_diario (v6.3 — todo el efectivo a CAJA/VARIOS)
-- ==========================================
-- CAMBIOS v6.3 respecto a v6.2:
--   - Distribución simplificada: el fondo declarado al abrir (v_fondo_fijo) ya no se
--     retiene en el cajón al cerrar. Todo el efectivo contado se deposita completo.
--     VARIOS recibe su transferencia si alcanza; el resto va íntegro a CAJA.
--   - El fondo del próximo turno lo declara el empleado al abrir — no proviene del cierre.
--   - v_fondo_fijo sigue leyéndose de turnos_caja.fondo_apertura (útil para efectivo_esperado).
--   - Cascada reducida de 4 casos a 3 (eliminado "CASO DÉFICIT FONDO").
--
-- CAMBIOS v6.1 respecto a v6.0:
--   - Fix cutoff de recargas virtuales: usa MAX(recargas.created_at) por servicio
--     en lugar de MAX(turnos_caja.hora_fecha_cierre).
--
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
--   - ON CONFLICT en BUS para mini cierre
--   - faltante de conteo → movimientos_empleados (FALTANTE_CAJA)
--   - 1 sola transferencia a VARIOS por día
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_ejecutar_cierre_diario(  -- v6.3
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

  -- IDs de categorías de sistema (UUIDs fijos de categorias_sistema)
  v_cat_ajuste_ingreso_id UUID;  -- AJU-CONTEO-IN: Ajuste Diferencia Conteo (sobra)
  v_cat_ajuste_egreso_id  UUID;  -- AJU-CONTEO-EG: Ajuste Diferencia Conteo (falta)
  v_cat_cierre_sin_pos_id UUID;  -- CIE-SIN-POS: Cierre — Ventas del día
  v_cat_cierre_con_pos_id UUID;  -- CIE-CON-POS: Cierre — Ventas con POS
  v_cat_cierre_id         UUID;  -- categoría activa según modo

  -- IDs de servicios y referencias (tipos_servicio y tipos_referencia usan SERIAL → INTEGER)
  v_tipo_servicio_celular_id INTEGER;
  v_tipo_servicio_bus_id     INTEGER;
  v_tipo_ref_recargas_id     INTEGER;
  v_tipo_ref_turnos_id       INTEGER;

  -- Fondo declarado al abrir (leído de turnos_caja.fondo_apertura, no de configuraciones)
  v_fondo_fijo           DECIMAL(12,2);
  v_transferencia_diaria DECIMAL(12,2);
  v_varios_activa        BOOLEAN;

  -- Recargas virtuales pendientes
  v_agregado_celular        DECIMAL(12,2);
  v_agregado_bus            DECIMAL(12,2);
  v_ultimo_snapshot_celular TIMESTAMP;  -- último recargas.created_at para CELULAR
  v_ultimo_snapshot_bus     TIMESTAMP;  -- último recargas.created_at para BUS

  -- Saldos actuales de cajas (leídos de BD, no parámetros)
  v_saldo_caja_chica_digital DECIMAL(12,2);  -- CAJA_CHICA antes del ajuste
  v_saldo_caja               DECIMAL(12,2);  -- CAJA (bóveda)
  v_saldo_varios             DECIMAL(12,2);  -- VARIOS (fondo emergencia)

  -- Ajuste por diferencia de conteo físico
  v_efectivo_esperado          DECIMAL(12,2);  -- saldo_digital + fondo_apertura
  v_diferencia                 DECIMAL(12,2);  -- p_efectivo_fisico - efectivo_esperado

  -- Distribución de efectivo
  v_transferencia_efectiva    DECIMAL(12,2);   -- Lo que va a VARIOS
  v_deficit_varios            DECIMAL(12,2);   -- Déficit de VARIOS (0 si turno normal)
  v_dinero_a_depositar        DECIMAL(12,2);   -- Lo que va a CAJA (bóveda)
  v_monto_reposicion_apertura DECIMAL(12,2) := 0;  -- Informativo: lo que va a Tienda
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

  PERFORM public.fn_assert_no_superadmin();

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

  -- Categorías de sistema: UUIDs fijos, no dependen del negocio
  v_cat_ajuste_ingreso_id := 'a1000001-0000-0000-0000-000000000003';  -- AJU-CONTEO-IN
  v_cat_ajuste_egreso_id  := 'a1000001-0000-0000-0000-000000000004';  -- AJU-CONTEO-EG
  v_cat_cierre_sin_pos_id := 'a1000001-0000-0000-0000-000000000001';  -- CIE-SIN-POS
  v_cat_cierre_con_pos_id := 'a1000001-0000-0000-0000-000000000002';  -- CIE-CON-POS

  -- ==========================================
  -- 3. OBTENER CONFIGURACIÓN Y FONDO DE APERTURA
  -- El fondo ya no es un parámetro global — es el monto que el empleado
  -- declaró al abrir su turno (turnos_caja.fondo_apertura).
  -- ==========================================

  v_fondo_fijo           := (SELECT fondo_apertura FROM turnos_caja WHERE id = p_turno_id AND negocio_id = v_negocio_id);
  v_varios_activa        := (SELECT valor = 'true'  FROM configuraciones WHERE clave = 'caja_varios_activa'             AND negocio_id = v_negocio_id);
  v_transferencia_diaria := CASE
    WHEN v_varios_activa THEN (SELECT valor::DECIMAL FROM configuraciones WHERE clave = 'caja_varios_transferencia_dia' AND negocio_id = v_negocio_id)
    ELSE 0
  END;

  IF v_fondo_fijo IS NULL THEN
    RAISE EXCEPTION 'No se pudo leer el fondo de apertura del turno';
  END IF;

  -- ==========================================
  -- 4. OBTENER TIMESTAMPS DE ÚLTIMOS SNAPSHOTS POR SERVICIO
  -- Usa el último created_at de la tabla `recargas` para cada servicio.
  -- Este cutoff es idéntico al que usa getAgregadoVirtualHoy() en el frontend
  -- y garantiza consistencia entre lo que el frontend muestra y lo que el SQL calcula.
  --
  -- Por qué NO usar MAX(turnos_caja.hora_fecha_cierre):
  --   El mini cierre de BUS (fn_registrar_compra_saldo_bus) inserta un snapshot
  --   en `recargas` con created_at = NOW() y el registro en `recargas_virtuales`
  --   con created_at = clock_timestamp() (ligeramente posterior).
  --   Si entre el mini cierre y el cierre final hubo un turno completo cerrado,
  --   MAX(hora_fecha_cierre) puede quedar entre esos dos timestamps, excluyendo
  --   el registro de la compra de BUS → v_agregado_bus = 0 → venta negativa.
  -- ==========================================

  v_ultimo_snapshot_celular := (
    SELECT r.created_at
    FROM recargas r
    JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
    WHERE ts.codigo = 'CELULAR'
      AND r.negocio_id = v_negocio_id
    ORDER BY r.created_at DESC
    LIMIT 1
  );

  v_ultimo_snapshot_bus := (
    SELECT r.created_at
    FROM recargas r
    JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
    WHERE ts.codigo = 'BUS'
      AND r.negocio_id = v_negocio_id
    ORDER BY r.created_at DESC
    LIMIT 1
  );

  -- ==========================================
  -- 5. RECARGAS VIRTUALES PENDIENTES
  -- Filtra por created_at > último snapshot de cada servicio (misma lógica que frontend).
  -- Captura todo lo no incorporado en cierres previos, incluso de fechas anteriores.
  -- ==========================================

  v_agregado_celular := (
    SELECT COALESCE(SUM(monto_virtual), 0)
    FROM recargas_virtuales rv
    WHERE rv.tipo_servicio_id = v_tipo_servicio_celular_id
      AND rv.negocio_id = v_negocio_id
      AND (v_ultimo_snapshot_celular IS NULL OR rv.created_at > v_ultimo_snapshot_celular)
  );

  v_agregado_bus := (
    SELECT COALESCE(SUM(monto_virtual), 0)
    FROM recargas_virtuales rv
    WHERE rv.tipo_servicio_id = v_tipo_servicio_bus_id
      AND rv.negocio_id = v_negocio_id
      AND (v_ultimo_snapshot_bus IS NULL OR rv.created_at > v_ultimo_snapshot_bus)
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
  -- efectivo_esperado = saldo_digital + fondo_apertura (declarado al abrir)
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
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto, categoria_sistema_id,
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
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto, categoria_sistema_id,
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

  -- ==========================================
  -- 8. DISTRIBUCIÓN (v6.3 — todo el efectivo se deposita al cerrar)
  --
  --   1° VARIOS → recibe la transferencia diaria si efectivo >= transferencia_diaria
  --   2° CAJA   → recibe el resto completo (sin retención de fondo en cajón)
  --
  -- v_fondo_fijo (= fondo_apertura del turno) solo intervino arriba para
  -- calcular efectivo_esperado. No retiene nada en el cajón al cerrar.
  -- El fondo del próximo turno lo declara el empleado al abrir.
  -- Regla adicional: solo 1 transferencia a VARIOS por día.
  -- ==========================================

  -- ¿VARIOS ya recibió su transferencia diaria hoy?
  v_transferencia_ya_hecha := EXISTS (
    SELECT 1
    FROM operaciones_cajas oc
    WHERE oc.caja_id    = v_varios_id
      AND oc.negocio_id = v_negocio_id
      AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = p_fecha
      AND (
        oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
        OR (
          oc.tipo_operacion = 'INGRESO'
          AND oc.categoria_sistema_id = 'a1000001-0000-0000-0000-000000000005'  -- DEF-REPONER
        )
      )
  );

  -- Distribución simplificada (v6.3 — fondo libre, sin retención en cajón):
  -- El fondo declarado al abrir (v_fondo_fijo) solo sirve para calcular efectivo_esperado.
  -- Al cierre, TODO el efectivo se deposita: VARIOS primero, resto completo a CAJA.
  -- El fondo del próximo turno lo declara el empleado al abrir — no proviene del cierre.

  IF v_transferencia_ya_hecha THEN
    -- 2do turno del día: VARIOS ya recibió, todo va a CAJA
    v_transferencia_efectiva    := 0;
    v_deficit_varios            := 0;
    v_dinero_a_depositar        := p_efectivo_fisico;
    v_monto_reposicion_apertura := 0;

  ELSIF p_efectivo_fisico >= v_transferencia_diaria THEN
    -- CASO NORMAL: VARIOS recibe su transferencia, resto a CAJA
    v_transferencia_efectiva    := v_transferencia_diaria;
    v_deficit_varios            := 0;
    v_dinero_a_depositar        := p_efectivo_fisico - v_transferencia_diaria;
    v_monto_reposicion_apertura := 0;

  ELSE
    -- CASO DÉFICIT VARIOS: no alcanza para la transferencia → todo a CAJA
    v_transferencia_efectiva    := 0;
    v_deficit_varios            := v_transferencia_diaria;
    v_dinero_a_depositar        := p_efectivo_fisico;
    v_monto_reposicion_apertura := v_transferencia_diaria;
  END IF;

  -- Determinar categoría del depósito a Tienda según modo de operación:
  -- Se consulta directamente si hubo ventas POS en efectivo durante el turno.
  -- No se usa v_saldo_caja_chica_digital porque puede ser $0 aunque hubo ventas
  -- (ej: egresos manuales que vaciaron el cajón antes del cierre).
  v_cat_cierre_id := CASE
    WHEN EXISTS (
      SELECT 1 FROM ventas
      WHERE turno_id   = p_turno_id
        AND negocio_id = v_negocio_id
        AND metodo_pago = 'EFECTIVO'
        AND estado      = 'COMPLETADA'
    ) THEN v_cat_cierre_con_pos_id
    ELSE v_cat_cierre_sin_pos_id
  END;

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
      id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_sistema_id, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_id,
      p_empleado_id,
      'CIERRE',
      v_cat_cierre_id,
      v_dinero_a_depositar,
      v_saldo_caja,
      v_saldo_caja + v_dinero_a_depositar,
      COALESCE(p_observaciones, 'Sin novedad'),
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
      'desde Cajón · Fondo de emergencia',
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

  -- CAJA_CHICA (cajón): queda en $0 digital — todo el efectivo fue depositado en CAJA/VARIOS
  UPDATE cajas SET saldo_actual = 0 WHERE id = v_caja_chica_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 13. RECARGAS CELULAR
  -- Solo se registra si hubo venta real (saldo virtual se movió).
  -- ==========================================

  IF v_venta_celular > 0 THEN
    INSERT INTO recargas (
      id, negocio_id, fecha, turno_id, empleado_id, tipo_servicio_id,
      venta_dia, saldo_virtual_anterior, saldo_virtual_actual, saldo_caja
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      p_fecha,
      p_turno_id,
      p_empleado_id,
      v_tipo_servicio_celular_id,
      v_venta_celular,
      p_saldo_anterior_celular,
      p_saldo_celular_final,
      v_saldo_final_caja_celular
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
      venta_dia, saldo_virtual_anterior, saldo_virtual_actual, saldo_caja
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      p_fecha,
      p_turno_id,
      p_empleado_id,
      v_tipo_servicio_bus_id,
      v_venta_bus,
      p_saldo_anterior_bus,
      p_saldo_bus_final,
      v_saldo_final_caja_bus
    )
    ON CONFLICT (turno_id, tipo_servicio_id) DO UPDATE SET
      venta_dia            = recargas.venta_dia + EXCLUDED.venta_dia,
      saldo_virtual_actual = EXCLUDED.saldo_virtual_actual,
      saldo_caja           = EXCLUDED.saldo_caja,
      created_at           = NOW();

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
     SET hora_fecha_cierre = NOW()
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
    'version',       '6.3',
    'configuracion', json_build_object(
      'fondo_apertura',       v_fondo_fijo,
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
'Cierre diario v6.4 — categorías migradas a categorias_sistema (UUIDs fijos). '
'v6.3: todo el efectivo se deposita al cerrar (sin retención en cajón). '
'v_fondo_fijo leído de turnos_caja.fondo_apertura solo para calcular efectivo_esperado. '
'Distribución: VARIOS recibe su transferencia si hay suficiente efectivo; resto íntegro a CAJA. '
'El fondo del próximo turno lo declara el empleado al abrir, no viene del cierre. '
'Ajuste de conteo solo si hubo movimientos reales en CAJA_CHICA durante el turno. '
'Negocio leído del JWT (get_negocio_id()); todas las queries filtran por negocio_id. '
'Inserta en movimientos_empleados (FALTANTE_CAJA) cuando efectivo_fisico < efectivo_esperado. '
'CAJA_CHICA.saldo_actual queda en $0 digital al finalizar.';
