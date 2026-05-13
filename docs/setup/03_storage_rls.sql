-- ============================================================
-- RLS Storage — bucket: mi-tienda
-- ============================================================
-- Estructura del path: {negocio_id}/{tipo}/{...}/{uuid}.webp
-- Ejemplos:
--   {negocio_id}/comprobantes/2026/05/operaciones/{uuid}.webp
--   {negocio_id}/productos/bebidas/{uuid}.webp
--
-- El primer segmento del path siempre es el negocio_id.
-- RLS lee negocio_id directamente del JWT (app_metadata) — mismo
-- mecanismo que public.get_negocio_id(). No hace subquery a auth.users.
-- Ejecutar en Supabase SQL Editor después de crear el bucket 'mi-tienda'.
-- ============================================================

-- Borrar políticas anteriores si existen
DROP POLICY IF EXISTS "storage_mi_tienda_insert" ON storage.objects;
DROP POLICY IF EXISTS "storage_mi_tienda_select" ON storage.objects;
DROP POLICY IF EXISTS "storage_mi_tienda_update" ON storage.objects;
DROP POLICY IF EXISTS "storage_mi_tienda_delete" ON storage.objects;

-- INSERT: solo puede subir a su propia carpeta de negocio
CREATE POLICY "storage_mi_tienda_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'mi-tienda'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
);

-- SELECT: solo puede leer su propia carpeta de negocio
CREATE POLICY "storage_mi_tienda_select"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'mi-tienda'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
);

-- UPDATE: solo puede actualizar en su propia carpeta
CREATE POLICY "storage_mi_tienda_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'mi-tienda'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
);

-- DELETE: solo puede eliminar en su propia carpeta
CREATE POLICY "storage_mi_tienda_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'mi-tienda'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
);
