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
--
-- SELECT y DELETE tienen rama adicional para superadmin (EXISTS contra la
-- tabla `usuarios`, mismo patron que la RLS de `negocios` — nunca
-- get_es_superadmin() porque el JWT del superadmin en /admin puede no
-- tener ese claim actualizado). Necesario para que
-- StorageService.deleteNegocioFolder (docs/suscripcion/SUSCRIPCION-README.md,
-- sección "Purga automática de negocios vencidos") pueda listar y borrar la
-- carpeta de un negocio que el superadmin
-- purga desde /admin sin haberlo activado antes en su JWT — sin esta rama,
-- list()/remove() son filtrados en silencio por RLS (0 filas, sin error) y
-- los archivos del negocio quedan huerfanos en el bucket para siempre.
-- INSERT y UPDATE no la necesitan: el flujo de purga solo lee y borra.
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

-- SELECT: su propia carpeta de negocio, o cualquier carpeta si es superadmin
-- (necesario para listar la carpeta de un negocio ajeno durante la purga).
CREATE POLICY "storage_mi_tienda_select"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'mi-tienda'
    AND (
        (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
        OR EXISTS (
            SELECT 1 FROM usuarios
            WHERE email = public.get_email() AND es_superadmin = true
        )
    )
);

-- UPDATE: solo puede actualizar en su propia carpeta
CREATE POLICY "storage_mi_tienda_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'mi-tienda'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
);

-- DELETE: su propia carpeta de negocio, o cualquier carpeta si es superadmin
-- (necesario para purgar la carpeta de un negocio ajeno, ver SELECT arriba).
CREATE POLICY "storage_mi_tienda_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'mi-tienda'
    AND (
        (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
        OR EXISTS (
            SELECT 1 FROM usuarios
            WHERE email = public.get_email() AND es_superadmin = true
        )
    )
);
