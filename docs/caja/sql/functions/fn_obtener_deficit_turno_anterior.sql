-- ==========================================
-- FUNCIÓN: fn_obtener_deficit_turno_anterior (v1.1 — 2026-07-18)
-- ==========================================
-- CAMBIOS v1.1 (parte del fix del bug "la reposición cuenta como la transferencia de hoy"):
--   - "¿VARIOS ya cobró el día del último cierre?" ahora considera un DEF-REPONER como
--     válido solo si su referencia_id es EXACTAMENTE el último turno cerrado, no por la
--     fecha del asiento. La reparación se ejecuta al día siguiente del cierre deficitario,
--     así que su fecha caía fuera de la ventana del día que cubría → el criterio por fecha
--     lo perdía y re-detectaba el mismo déficit ya reparado. Fallback por fecha para filas
--     DEF-REPONER viejas sin referencia (previas a fn_reparar_deficit_turno v4.3).
--
-- Determina si el último turno cerrado generó un déficit en la transferencia
-- a VARIOS, y si es así retorna el monto que faltó transferir.
--
-- Reemplaza 4 round-trips secuenciales en TurnosCajaService.obtenerDeficitTurnoAnterior():
--   1. query turnos_caja (último cierre)
--   2. query cajas (id de VARIOS) + configService.get() en paralelo
--   3. 2 queries a operaciones_cajas en paralelo
-- Todo consolidado en 1 RPC con una sola ida al servidor.
--
-- Retorna JSON:
--   { "deficit_varios": 0 }          → sin déficit (VARIOS ya cobró o Varios desactivada)
--   { "deficit_varios": 20.00 }      → hay déficit: monto que faltó transferir
--
-- Lógica:
--   1. Si VARIOS no existe (módulo desactivado) → deficit_varios = 0
--   2. Si no hay ningún turno cerrado → deficit_varios = 0
--   3. Calcula la ventana UTC del día del último cierre (UTC-5 Ecuador, sin DST)
--   4. VARIOS ya cobró si ese día tiene TRANSFERENCIA_ENTRANTE
--      o INGRESO con categoria_sistema_id = DEF-REPONER (a1000001-...-000000000005)
--   5. Si no cobró → deficit_varios = caja_varios_transferencia_dia (de configuraciones)
--
-- Multi-tenant: filtra por public.get_negocio_id() del JWT.
-- Sin fn_assert_no_superadmin: es lectura pura — el superadmin necesita
-- ver el estado de apertura del negocio que supervisa.
--
-- Llamada desde: TurnosCajaService.obtenerDeficitTurnoAnterior()
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_obtener_deficit_turno_anterior();

CREATE OR REPLACE FUNCTION public.fn_obtener_deficit_turno_anterior()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id          UUID;
  v_varios_id           UUID;
  v_turno_ultimo_id     UUID;          -- id del último turno cerrado (para atribuir DEF-REPONER)
  v_fecha_ultimo_cierre TIMESTAMPTZ;
  v_fecha_local         DATE;
  v_inicio_utc          TIMESTAMPTZ;
  v_fin_utc             TIMESTAMPTZ;
  v_transferencia_diaria DECIMAL(12,2);
  v_varios_ya_cobro     BOOLEAN;

  -- UUID fijo de categorias_sistema para DEF-REPONER
  v_cat_def_reponer CONSTANT UUID := 'a1000001-0000-0000-0000-000000000005';
BEGIN
  v_negocio_id := public.get_negocio_id();

  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('deficit_varios', 0);
  END IF;

  -- ── 1. Caja VARIOS ───────────────────────────────────────────────────────
  -- Si no existe (módulo desactivado), no hay déficit posible.
  v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);

  IF v_varios_id IS NULL THEN
    RETURN json_build_object('deficit_varios', 0);
  END IF;

  -- ── 2. Último turno cerrado (id + fecha de cierre en una sola lectura) ────
  FOR v_turno_ultimo_id, v_fecha_ultimo_cierre IN
    SELECT id, hora_fecha_cierre
    FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_cierre IS NOT NULL
    ORDER BY hora_fecha_cierre DESC
    LIMIT 1
  LOOP
    EXIT;  -- single-row iterator
  END LOOP;

  IF v_fecha_ultimo_cierre IS NULL THEN
    RETURN json_build_object('deficit_varios', 0);
  END IF;

  -- ── 2b. ¿VARIOS ya existía cuando cerró el último turno? ─────────────────
  -- Si la caja se creó DESPUÉS del último cierre, fue activada por el superadmin
  -- (o por el onboarding) tras ese cierre — no había obligación de transferir ese día.
  IF (SELECT created_at FROM cajas WHERE id = v_varios_id) > v_fecha_ultimo_cierre THEN
    RETURN json_build_object('deficit_varios', 0);
  END IF;

  -- ── 3. Ventana UTC del día local del último cierre ────────────────────────
  -- Ecuador UTC-5, sin DST. Conversión correcta sin AT TIME ZONE en WHERE
  -- (evita sequential scan; permite uso del índice sobre operaciones_cajas.fecha).
  v_fecha_local := (v_fecha_ultimo_cierre AT TIME ZONE 'America/Guayaquil')::DATE;
  v_inicio_utc  := (v_fecha_local::TIMESTAMP       AT TIME ZONE 'America/Guayaquil');
  v_fin_utc     := ((v_fecha_local + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

  -- ── 4. ¿VARIOS ya cobró la transferencia del día del último cierre? ───────
  -- Cubre dos casos:
  --   a) Cierre normal → TRANSFERENCIA_ENTRANTE en VARIOS fechada ese día.
  --   b) Reparación de un déficit anterior → INGRESO DEF-REPONER cuyo turno referenciado
  --      es EXACTAMENTE el último turno cerrado. Se atribuye por referencia (no por la
  --      fecha del asiento) porque la reparación se ejecuta al día siguiente del cierre
  --      deficitario: su fecha cae fuera de la ventana del día que cubre, así que el
  --      criterio por fecha lo perdía y re-detectaba el mismo déficit (bug v1.0).
  -- Fallback filas viejas sin referencia: criterio histórico por fecha en la ventana.
  v_varios_ya_cobro := EXISTS (
    SELECT 1
    FROM operaciones_cajas
    WHERE negocio_id = v_negocio_id
      AND caja_id    = v_varios_id
      AND fecha     >= v_inicio_utc
      AND fecha     <  v_fin_utc
      AND tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
  )
  OR EXISTS (
    -- DEF-REPONER (v4.3+) que repuso el déficit de este mismo turno.
    SELECT 1
    FROM operaciones_cajas
    WHERE negocio_id     = v_negocio_id
      AND caja_id        = v_varios_id
      AND tipo_operacion = 'INGRESO'
      AND categoria_sistema_id = v_cat_def_reponer
      AND referencia_id  = v_turno_ultimo_id
  )
  OR EXISTS (
    -- Fallback filas DEF-REPONER viejas sin referencia: por fecha del asiento.
    SELECT 1
    FROM operaciones_cajas
    WHERE negocio_id     = v_negocio_id
      AND caja_id        = v_varios_id
      AND tipo_operacion = 'INGRESO'
      AND categoria_sistema_id = v_cat_def_reponer
      AND referencia_id IS NULL
      AND fecha >= v_inicio_utc
      AND fecha <  v_fin_utc
  );

  IF v_varios_ya_cobro THEN
    RETURN json_build_object('deficit_varios', 0);
  END IF;

  -- ── 5. Leer monto de transferencia diaria configurado ────────────────────
  v_transferencia_diaria := (
    SELECT valor::DECIMAL(12,2)
    FROM configuraciones
    WHERE negocio_id = v_negocio_id
      AND clave      = 'caja_varios_transferencia_dia'
  );

  -- Si no hay configuración (negocio sin configurar), no hay déficit
  IF v_transferencia_diaria IS NULL OR v_transferencia_diaria <= 0 THEN
    RETURN json_build_object('deficit_varios', 0);
  END IF;

  RETURN json_build_object('deficit_varios', v_transferencia_diaria);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_obtener_deficit_turno_anterior() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_obtener_deficit_turno_anterior() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_obtener_deficit_turno_anterior IS
  'v1.1 — DEF-REPONER cuenta como "ya cobró" solo si referencia el último turno cerrado '
  '(no por fecha del asiento) — evita re-detectar un déficit ya reparado el día siguiente. '
  'v1.0 — Consolida en 1 RPC los 4 round-trips de obtenerDeficitTurnoAnterior(). '
  'Retorna { deficit_varios: number }. 0 = sin déficit (Varios cobró o módulo desactivado). '
  '>0 = monto que faltó transferir en el último cierre. '
  'STABLE: lectura pura. Sin fn_assert_no_superadmin (el superadmin necesita ver '
  'el estado de apertura del negocio que supervisa). '
  'Ventana UTC para aprovechar índice de operaciones_cajas.fecha (sin AT TIME ZONE en WHERE).';
