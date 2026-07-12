DROP FUNCTION IF EXISTS public.fn_metricas_inventario();

-- ==========================================
-- fn_metricas_inventario (v1.0)
-- ==========================================
-- Devuelve las 4 métricas de cabecera del inventario en UNA sola pasada sobre
-- `productos` (un solo scan filtrado por negocio + índice idx_productos_negocio_activo).
-- El listado (inventario.page) las muestra como stat-cards clickeables bajo el
-- buscador; se recalcula al entrar y tras cada mutación de stock.
--
-- Métricas (todas sobre el catálogo COMPLETO del negocio, no la página cargada):
--   · total_activos    — productos vendibles (activo = TRUE). Tamaño real del catálogo.
--   · por_reponer      — activos con stock_actual <= stock_minimo (incluye agotados).
--                        Mismo criterio que el filtro "Reponer" de fn_listar_productos.
--   · agotados         — activos con stock_actual = 0. Subconjunto crítico de por_reponer.
--   · valor_inventario — Σ (stock_actual * precio_costo) de los activos. Capital
--                        invertido en mercadería. Métrica clave para el dueño.
--
-- Nota de precisión: por_reponer y agotados cuentan cada SKU individual (incluidas
-- las variantes), coherente con lo que el usuario ve al activar el filtro Reponer.
--
-- SECURITY DEFINER + filtro manual por negocio_id (RLS se bypasea aquí).
-- Ejecutar: una sola vez en Supabase SQL Editor.
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_metricas_inventario()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT json_build_object(
        'total_activos',    COUNT(*),
        'por_reponer',      COUNT(*) FILTER (WHERE p.stock_actual <= p.stock_minimo),
        'agotados',         COUNT(*) FILTER (WHERE p.stock_actual = 0),
        'valor_inventario', COALESCE(SUM(p.stock_actual * p.precio_costo), 0)
    )
    FROM productos p
    WHERE p.negocio_id = public.get_negocio_id()
      AND p.activo = TRUE;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_metricas_inventario() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_metricas_inventario() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_metricas_inventario IS
    'v1.0 — Métricas de cabecera del inventario en 1 scan: total_activos, por_reponer '
    '(stock <= mínimo), agotados (stock = 0) y valor_inventario (Σ stock*costo). '
    'Sobre el catálogo completo del negocio. Consumida por inventario.page (stat-cards).';
