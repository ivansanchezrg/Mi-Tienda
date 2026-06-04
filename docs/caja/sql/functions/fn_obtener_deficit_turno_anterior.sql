-- ==========================================
-- FUNCIÓN: fn_obtener_deficit_turno_anterior (v1.0 — 2026-06-03)
-- ==========================================
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

  -- ── 2. Último turno cerrado ───────────────────────────────────────────────
  v_fecha_ultimo_cierre := (
    SELECT hora_fecha_cierre
    FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_cierre IS NOT NULL
    ORDER BY hora_fecha_cierre DESC
    LIMIT 1
  );

  IF v_fecha_ultimo_cierre IS NULL THEN
    RETURN json_build_object('deficit_varios', 0);
  END IF;

  -- ── 3. Ventana UTC del día local del último cierre ────────────────────────
  -- Ecuador UTC-5, sin DST. Conversión correcta sin AT TIME ZONE en WHERE
  -- (evita sequential scan; permite uso del índice sobre operaciones_cajas.fecha).
  v_fecha_local := (v_fecha_ultimo_cierre AT TIME ZONE 'America/Guayaquil')::DATE;
  v_inicio_utc  := (v_fecha_local::TIMESTAMP       AT TIME ZONE 'America/Guayaquil');
  v_fin_utc     := ((v_fecha_local + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

  -- ── 4. ¿VARIOS ya cobró ese día? ─────────────────────────────────────────
  -- Cubre dos casos:
  --   a) Cierre normal    → TRANSFERENCIA_ENTRANTE en VARIOS
  --   b) Ajuste apertura  → INGRESO categoría DEF-REPONER (reparación de déficit)
  v_varios_ya_cobro := EXISTS (
    SELECT 1
    FROM operaciones_cajas
    WHERE negocio_id = v_negocio_id
      AND caja_id    = v_varios_id
      AND fecha     >= v_inicio_utc
      AND fecha     <  v_fin_utc
      AND (
        tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
        OR (tipo_operacion = 'INGRESO' AND categoria_sistema_id = v_cat_def_reponer)
      )
    LIMIT 1
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
  'v1.0 — Consolida en 1 RPC los 4 round-trips de obtenerDeficitTurnoAnterior(). '
  'Retorna { deficit_varios: number }. 0 = sin déficit (Varios cobró o módulo desactivado). '
  '>0 = monto que faltó transferir en el último cierre. '
  'STABLE: lectura pura. Sin fn_assert_no_superadmin (el superadmin necesita ver '
  'el estado de apertura del negocio que supervisa). '
  'Ventana UTC para aprovechar índice de operaciones_cajas.fecha (sin AT TIME ZONE en WHERE).';
