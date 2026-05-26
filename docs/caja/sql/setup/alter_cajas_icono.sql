-- Agrega columna icono a cajas para cajas personalizadas.
-- Las cajas base existentes toman el default 'cash-outline'.
ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS icono VARCHAR(50) NOT NULL DEFAULT 'cash-outline';

NOTIFY pgrst, 'reload schema';
