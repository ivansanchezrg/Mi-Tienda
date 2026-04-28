-- ==========================================
-- FUNCIÓN: fn_cierre_emergencia_turno
-- ==========================================
-- Permite al ADMIN cerrar un turno abierto por otro empleado (empleado ausente).
-- Útil cuando el empleado se va en emergencia sin cerrar su turno y el admin
-- queda bloqueado por las validaciones de fn_ejecutar_cierre_diario.
--
-- Diferencias con fn_ejecutar_cierre_diario (v6.0):
--   - Valida que el caller sea ADMIN (no el empleado del turno)
--   - Valida que el turno NO pertenezca al admin (si es suyo, usa flujo normal)
--   - NO procesa recargas virtuales (celular/bus) — el admin las gestiona manualmente
--   - Registra FALTANTE_CAJA en movimientos_empleados del empleado ausente si hay diferencia
--   - Cierra el turno con observaciones de "CIERRE DE EMERGENCIA" + nombre del admin + motivo
--
-- Parámetros:
--   p_admin_id       UUID del admin que autoriza el cierre
--   p_turno_id       UUID del turno a cerrar (abierto por el empleado ausente)
--   p_efectivo_fisico DECIMAL(12,2) — efectivo físico encontrado en el cajón
--   p_motivo         TEXT — motivo del cierre de emergencia (opcional)
--
-- Retorna JSON:
--   success, turno_id, empleado_ausente, admin_autorizador, resumen_cierre
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_cierre_emergencia_turno(UUID, UUID, DECIMAL, TEXT);

CREATE OR REPLACE FUNCTION public.fn_cierre_emergencia_turno(
  p_admin_id        UUID,
  p_turno_id        UUID,
  p_efectivo_fisico DECIMAL(12,2),
  p_motivo          TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- Tenant
  v_negocio_id UUID;

  -- Admin
  v_admin_nombre VARCHAR;

  -- Empleado ausente
  v_empleado_ausente_id   UUID;
  v_empleado_ausente_nombre VARCHAR;
  v_hora_apertura         TIMESTAMP WITH TIME ZONE;
  v_fecha                 DATE;

  -- IDs de cajas
  v_caja_id         UUID;
  v_caja_chica_id   UUID;
  v_varios_id       UUID;

  -- IDs de categorías de ajuste
  v_cat_ajuste_ingreso_id UUID;  -- IN-005: Ajuste Diferencia Conteo
  v_cat_ajuste_egreso_id  UUID;  -- EG-013: Ajuste Diferencia Conteo

  -- IDs de referencias
  v_tipo_ref_turnos_id INTEGER;

  -- Configuración
  v_fondo_fijo           DECIMAL(12,2);
  v_transferencia_diaria DECIMAL(12,2);

  -- Saldos actuales
  v_saldo_caja_chica_digital    DECIMAL(12,2);
  v_saldo_caja                  DECIMAL(12,2);
  v_saldo_varios                DECIMAL(12,2);

  -- Ajuste de conteo físico
  v_efectivo_esperado            DECIMAL(12,2);
  v_diferencia                   DECIMAL(12,2);
  v_saldo_caja_chica_post_ajuste DECIMAL(12,2);
  v_hubo_movimientos_caja_chica  BOOLEAN := FALSE;

  -- Distribución de efectivo
  v_transferencia_efectiva    DECIMAL(12,2);
  v_deficit_varios            DECIMAL(12,2);
  v_dinero_a_depositar        DECIMAL(12,2);
  v_fondo_en_cajon            BOOLEAN;
  v_monto_reposicion_apertura DECIMAL(12,2) := 0;
  v_transferencia_ya_hecha    BOOLEAN := FALSE;

  -- Control
  v_observaciones_cierre TEXT;
BEGIN
  -- ==========================================
  -- 0. OBTENER NEGOCIO DEL JWT
  -- ==========================================

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  -- ==========================================
  -- 1. VALIDAR ROL ADMIN
  -- ==========================================

  IF NOT EXISTS (
    SELECT 1 FROM usuario_negocios
    WHERE usuario_id = p_admin_id
      AND negocio_id = v_negocio_id
      AND rol = 'ADMIN'
      AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'Solo un administrador puede ejecutar el cierre de emergencia';
  END IF;

  v_admin_nombre := (SELECT nombre FROM usuarios WHERE id = p_admin_id);

  -- ==========================================
  -- 2. VALIDAR TURNO
  -- ==========================================

  IF NOT EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE id = p_turno_id AND negocio_id = v_negocio_id
  ) THEN
    RAISE EXCEPTION 'El turno especificado no existe o no pertenece a este negocio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE id = p_turno_id AND negocio_id = v_negocio_id AND hora_fecha_cierre IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'El turno ya está cerrado';
  END IF;

  -- Obtener datos del turno
  v_empleado_ausente_id := (
    SELECT empleado_id FROM turnos_caja
    WHERE id = p_turno_id AND negocio_id = v_negocio_id
  );
  v_hora_apertura := (
    SELECT hora_fecha_apertura FROM turnos_caja
    WHERE id = p_turno_id AND negocio_id = v_negocio_id
  );
  v_fecha := (v_hora_apertura AT TIME ZONE 'America/Guayaquil')::date;

  -- El admin no puede usar este flujo para cerrar su propio turno
  IF v_empleado_ausente_id = p_admin_id THEN
    RAISE EXCEPTION 'Para cerrar tu propio turno usa el flujo normal de cierre diario';
  END IF;

  v_empleado_ausente_nombre := (SELECT nombre FROM usuarios WHERE id = v_empleado_ausente_id);

  -- ==========================================
  -- 3. VALIDAR EFECTIVO
  -- ==========================================

  IF p_efectivo_fisico < 0 THEN
    RAISE EXCEPTION 'El efectivo físico contado no puede ser negativo';
  END IF;

  -- ==========================================
  -- 4. OBTENER IDs POR CÓDIGO / TABLA
  -- ==========================================

  v_caja_id       := (SELECT id FROM cajas WHERE codigo = 'CAJA'       AND negocio_id = v_negocio_id);
  v_caja_chica_id := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
  v_varios_id     := (SELECT id FROM cajas WHERE codigo = 'VARIOS'     AND negocio_id = v_negocio_id);

  v_tipo_ref_turnos_id := (SELECT id FROM tipos_referencia WHERE tabla = 'turnos_caja');

  v_cat_ajuste_ingreso_id := (SELECT id FROM categorias_operaciones WHERE codigo = 'IN-005' AND negocio_id = v_negocio_id);
  v_cat_ajuste_egreso_id  := (SELECT id FROM categorias_operaciones WHERE codigo = 'EG-013' AND negocio_id = v_negocio_id);

  -- ==========================================
  -- 5. OBTENER CONFIGURACIÓN
  -- ==========================================

  v_fondo_fijo           := (SELECT valor::DECIMAL FROM configuraciones WHERE clave = 'caja_fondo_fijo_diario'        AND negocio_id = v_negocio_id);
  v_transferencia_diaria := (SELECT valor::DECIMAL FROM configuraciones WHERE clave = 'caja_varios_transferencia_dia' AND negocio_id = v_negocio_id);

  IF v_fondo_fijo IS NULL OR v_transferencia_diaria IS NULL THEN
    RAISE EXCEPTION 'No se encontró configuración del sistema (fondo_fijo o transferencia_diaria)';
  END IF;

  -- ==========================================
  -- 6. LEER SALDOS ACTUALES CON LOCK
  -- ==========================================

  PERFORM id FROM cajas WHERE codigo IN ('CAJA_CHICA', 'CAJA', 'VARIOS') AND negocio_id = v_negocio_id FOR UPDATE;

  v_saldo_caja_chica_digital := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
  v_saldo_caja               := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA'       AND negocio_id = v_negocio_id);
  v_saldo_varios             := (SELECT saldo_actual FROM cajas WHERE codigo = 'VARIOS'     AND negocio_id = v_negocio_id);

  -- ==========================================
  -- 7. AJUSTE POR DIFERENCIA DE CONTEO FÍSICO
  --
  -- Misma lógica que fn_ejecutar_cierre_diario v6.0:
  -- Solo aplica si hubo movimientos reales en CAJA_CHICA durante el turno.
  -- Si hay diferencia negativa (faltante), se registra en movimientos_empleados
  -- del empleado ausente — él abrió el turno y es responsable del cajón.
  -- ==========================================

  v_hubo_movimientos_caja_chica := EXISTS (
    SELECT 1 FROM operaciones_cajas
    WHERE caja_id = v_caja_chica_id
      AND negocio_id = v_negocio_id
      AND fecha >= v_hora_apertura
  );

  IF v_hubo_movimientos_caja_chica THEN
    v_efectivo_esperado := v_saldo_caja_chica_digital + v_fondo_fijo;
    v_diferencia        := p_efectivo_fisico - v_efectivo_esperado;
  ELSE
    v_efectivo_esperado := p_efectivo_fisico;
    v_diferencia        := 0;
  END IF;

  IF v_diferencia > 0 THEN
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_chica_id,
      p_admin_id,
      'INGRESO',
      v_diferencia,
      v_cat_ajuste_ingreso_id,
      v_saldo_caja_chica_digital,
      v_saldo_caja_chica_digital + v_diferencia,
      FORMAT(
        'Ajuste conteo fisico (cierre emergencia): contado $%s, esperado $%s (diferencia: +$%s)',
        TO_CHAR(p_efectivo_fisico, 'FM999990.00'),
        TO_CHAR(v_efectivo_esperado, 'FM999990.00'),
        TO_CHAR(v_diferencia, 'FM999990.00')
      )
    );

  ELSIF v_diferencia < 0 THEN
    INSERT INTO operaciones_cajas (
      id, negocio_id, caja_id, empleado_id, tipo_operacion, monto, categoria_id,
      saldo_anterior, saldo_actual, descripcion
    ) VALUES (
      gen_random_uuid(),
      v_negocio_id,
      v_caja_chica_id,
      p_admin_id,
      'EGRESO',
      ABS(v_diferencia),
      v_cat_ajuste_egreso_id,
      v_saldo_caja_chica_digital,
      v_saldo_caja_chica_digital + v_diferencia,
      FORMAT(
        'Ajuste conteo fisico (cierre emergencia): contado $%s, esperado $%s (diferencia: -$%s)',
        TO_CHAR(p_efectivo_fisico, 'FM999990.00'),
        TO_CHAR(v_efectivo_esperado, 'FM999990.00'),
        TO_CHAR(ABS(v_diferencia), 'FM999990.00')
      )
    );

    -- Registrar faltante en cuenta corriente del empleado ausente.
    -- El empleado abrió el turno y es responsable del cajón durante su turno.
    INSERT INTO movimientos_empleados (
      negocio_id, empleado_id, turno_id, tipo_movimiento, monto, descripcion, creado_por
    ) VALUES (
      v_negocio_id,
      v_empleado_ausente_id,
      p_turno_id,
      'FALTANTE_CAJA',
      ABS(v_diferencia),
      format('Faltante de conteo fisico — cierre de emergencia del %s ($%s). Admin: %s',
             TO_CHAR(v_fecha, 'DD/MM/YYYY'),
             TO_CHAR(ABS(v_diferencia), 'FM999990.00'),
             COALESCE(v_admin_nombre, 'Administrador')),
      p_admin_id
    );
  END IF;

  v_saldo_caja_chica_post_ajuste := v_saldo_caja_chica_digital + v_diferencia;

  -- ==========================================
  -- 8. DISTRIBUCIÓN EN CASCADA (misma lógica que v6.0)
  --
  -- Regla "todo o nada" en cada nivel:
  --   1° VARIOS     → recibe si efectivo >= transferencia_diaria completa
  --   2° Fondo fijo → queda en cajón solo si efectivo >= transferencia_diaria + fondo_fijo
  --   3° CAJA       → recibe el resto
  -- Regla: solo 1 transferencia a VARIOS por día.
  -- ==========================================

  v_transferencia_ya_hecha := EXISTS (
    SELECT 1
    FROM operaciones_cajas oc
    WHERE oc.caja_id = v_varios_id
      AND oc.negocio_id = v_negocio_id
      AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = v_fecha
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
    v_transferencia_efectiva    := 0;
    v_deficit_varios            := 0;
    v_fondo_en_cajon            := (p_efectivo_fisico >= v_fondo_fijo);
    v_dinero_a_depositar        := p_efectivo_fisico - CASE WHEN v_fondo_en_cajon THEN v_fondo_fijo ELSE 0 END;
    v_monto_reposicion_apertura := 0;

  ELSIF p_efectivo_fisico >= (v_transferencia_diaria + v_fondo_fijo) THEN
    v_fondo_en_cajon            := TRUE;
    v_transferencia_efectiva    := v_transferencia_diaria;
    v_deficit_varios            := 0;
    v_dinero_a_depositar        := p_efectivo_fisico - v_transferencia_diaria - v_fondo_fijo;
    v_monto_reposicion_apertura := 0;

  ELSIF p_efectivo_fisico >= v_transferencia_diaria THEN
    v_fondo_en_cajon            := FALSE;
    v_transferencia_efectiva    := v_transferencia_diaria;
    v_deficit_varios            := 0;
    v_dinero_a_depositar        := p_efectivo_fisico - v_transferencia_diaria;
    v_monto_reposicion_apertura := v_fondo_fijo;

  ELSE
    v_fondo_en_cajon            := FALSE;
    v_transferencia_efectiva    := 0;
    v_deficit_varios            := v_transferencia_diaria;
    v_dinero_a_depositar        := p_efectivo_fisico;
    v_monto_reposicion_apertura := v_fondo_fijo + v_transferencia_diaria;
  END IF;

  -- ==========================================
  -- 9. OPERACIÓN EN CAJA (bóveda) — depósito del cajón físico
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
      p_admin_id,
      'CIERRE',
      v_dinero_a_depositar,
      v_saldo_caja,
      v_saldo_caja + v_dinero_a_depositar,
      format('Cierre de emergencia — turno %s (empleado: %s)',
             v_fecha, COALESCE(v_empleado_ausente_nombre, 'desconocido')),
      v_tipo_ref_turnos_id,
      p_turno_id
    );
  END IF;

  -- ==========================================
  -- 10. TRANSFERENCIA A VARIOS (fondo emergencia)
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
      p_admin_id,
      'TRANSFERENCIA_ENTRANTE',
      v_transferencia_efectiva,
      v_saldo_varios,
      v_saldo_varios + v_transferencia_efectiva,
      format('Transferencia diaria — cierre emergencia turno %s', v_fecha),
      v_tipo_ref_turnos_id,
      p_turno_id
    );
  END IF;

  -- ==========================================
  -- 11. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================

  UPDATE cajas SET saldo_actual = v_saldo_caja + v_dinero_a_depositar
  WHERE id = v_caja_id AND negocio_id = v_negocio_id;

  UPDATE cajas SET saldo_actual = v_saldo_varios + v_transferencia_efectiva
  WHERE id = v_varios_id AND negocio_id = v_negocio_id;

  -- CAJA_CHICA queda en $0 digital (fondo físico queda en cajón)
  UPDATE cajas SET saldo_actual = 0
  WHERE id = v_caja_chica_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 12. CERRAR TURNO CON OBSERVACIONES DE EMERGENCIA
  -- ==========================================

  v_observaciones_cierre := format(
    'CIERRE DE EMERGENCIA — Admin: %s. Motivo: %s',
    COALESCE(v_admin_nombre, 'Administrador'),
    COALESCE(p_motivo, 'No especificado')
  );

  UPDATE turnos_caja
     SET hora_fecha_cierre = NOW(),
         fondo_cubierto    = v_fondo_en_cajon,
         observaciones     = v_observaciones_cierre
   WHERE id = p_turno_id
     AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 13. RETORNAR RESUMEN
  -- ==========================================

  RETURN json_build_object(
    'success',           true,
    'turno_id',          p_turno_id,
    'fecha',             v_fecha,
    'empleado_ausente',  json_build_object(
      'id',     v_empleado_ausente_id,
      'nombre', v_empleado_ausente_nombre
    ),
    'admin_autorizador', json_build_object(
      'id',     p_admin_id,
      'nombre', v_admin_nombre
    ),
    'motivo',            COALESCE(p_motivo, 'No especificado'),
    'conteo_fisico',     json_build_object(
      'efectivo_fisico',     p_efectivo_fisico,
      'saldo_digital_antes', v_saldo_caja_chica_digital,
      'efectivo_esperado',   v_efectivo_esperado,
      'diferencia',          v_diferencia,
      'ajuste_aplicado',     (v_diferencia <> 0),
      'hubo_movimientos',    v_hubo_movimientos_caja_chica
    ),
    'distribucion_efectivo', json_build_object(
      'fondo_en_cajon',            v_fondo_en_cajon,
      'transferencia_varios',      v_transferencia_efectiva,
      'deposito_tienda',           v_dinero_a_depositar,
      'deficit_varios',            v_deficit_varios,
      'monto_reposicion_apertura', v_monto_reposicion_apertura
    ),
    'saldos_finales',    json_build_object(
      'caja_chica', 0,
      'caja',       v_saldo_caja + v_dinero_a_depositar,
      'varios',     v_saldo_varios + v_transferencia_efectiva
    ),
    'nota', 'Las recargas virtuales (celular/bus) no se procesaron — gestionarlas manualmente si es necesario'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error en cierre de emergencia: %', SQLERRM;
END;
$function$;

-- ==========================================
-- PERMISOS
-- ==========================================

REVOKE EXECUTE ON FUNCTION public.fn_cierre_emergencia_turno(UUID, UUID, DECIMAL, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cierre_emergencia_turno(UUID, UUID, DECIMAL, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_cierre_emergencia_turno IS
'Cierre de emergencia de turno — permite al ADMIN cerrar un turno abierto por otro empleado ausente. '
'Reutiliza la lógica de distribución en cascada de fn_ejecutar_cierre_diario v6.0 (VARIOS → fondo → CAJA). '
'Registra FALTANTE_CAJA en movimientos_empleados del empleado ausente si hay diferencia de conteo negativa. '
'NO procesa recargas virtuales (celular/bus) — el admin las gestiona manualmente si es necesario. '
'El turno se cierra con observaciones que incluyen "CIERRE DE EMERGENCIA", nombre del admin y motivo. '
'Requiere JWT con negocio_id activo (get_negocio_id()) y rol ADMIN del caller en usuario_negocios.';
