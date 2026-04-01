-- ============================================================
-- Tabla: notas
-- Tablón de notas compartido visible por todos los empleados
-- ============================================================

CREATE TABLE public.notas (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  texto          TEXT        NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 500),
  completada     BOOLEAN     NOT NULL DEFAULT false,
  creada_por     INTEGER     REFERENCES public.usuarios(id) ON DELETE SET NULL,
  completada_por INTEGER     REFERENCES public.usuarios(id) ON DELETE SET NULL,
  completada_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para ordenar activas primero, luego por fecha desc
CREATE INDEX idx_notas_completada ON public.notas (completada, created_at DESC);

-- RLS
ALTER TABLE public.notas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notas_authenticated_all"
  ON public.notas
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Revoke anon
REVOKE ALL ON public.notas FROM anon;

NOTIFY pgrst, 'reload schema';
