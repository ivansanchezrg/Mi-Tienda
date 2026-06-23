-- ============================================================
-- fn_assert_no_superadmin
-- Helper centralizado: lanza excepción si el usuario actual
-- es superadmin. Llamar con PERFORM al inicio de toda función
-- de mutación operativa del negocio.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_assert_no_superadmin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM usuarios
    WHERE email = public.get_email() AND es_superadmin = TRUE
  ) THEN
    RAISE EXCEPTION 'superadmin_blocked: Esta acción no está disponible en modo supervisión';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_assert_no_superadmin() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_assert_no_superadmin() TO authenticated;

NOTIFY pgrst, 'reload schema';
