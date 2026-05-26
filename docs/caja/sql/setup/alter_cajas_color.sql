-- Agrega columna color a cajas para cajas personalizadas.
-- Las cajas base existentes toman el default '#6c757d' (gris neutro).
ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS color VARCHAR(20) NOT NULL DEFAULT '#6c757d';

NOTIFY pgrst, 'reload schema';
