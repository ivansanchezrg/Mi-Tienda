INSERT INTO storage.buckets (id, name, public)
VALUES ('productos', 'productos', true);

-- Lectura pública (bucket público)
CREATE POLICY "Lectura pública productos" ON storage.objects
  FOR SELECT USING (bucket_id = 'productos');

-- Upload para usuarios autenticados
CREATE POLICY "Upload productos autenticados" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'productos' AND auth.role() = 'authenticated');

-- Delete para usuarios autenticados
CREATE POLICY "Delete productos autenticados" ON storage.objects
  FOR DELETE USING (bucket_id = 'productos' AND auth.role() = 'authenticated');