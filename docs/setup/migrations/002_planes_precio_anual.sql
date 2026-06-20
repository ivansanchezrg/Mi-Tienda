-- =============================================================================
-- MIGRACION 002 — Precio dual (mensual + anual) en planes
-- =============================================================================
-- INCREMENTAL e IDEMPOTENTE. Seguro para re-ejecutar (IF NOT EXISTS / OR REPLACE).
--
-- Que hace:
--   1. planes: reemplaza `precio` + `periodo` por `precio_mensual` + `precio_anual`.
--      - precio_anual NULL  => el plan NO ofrece pago anual (solo mensual).
--      - migra los datos existentes: el precio viejo va al campo segun su periodo.
--   2. suscripciones: agrega `periodo_contratado` ('MENSUAL'|'ANUAL') para saber
--      que periodo se cobro en cada fila (el plan ya no lo define — lo elige el cliente).
--   3. Reseed del plan BASICO con ambos precios (ON CONFLICT DO UPDATE).
--
-- DESPUES de este archivo, re-ejecutar las funciones (ver seccion FUNCIONES abajo).
--
-- COMO USARLO: ejecutar completo en el SQL Editor de Supabase.
-- =============================================================================


-- =============================================================================
-- 1. TABLA planes — precio dual
-- =============================================================================

-- Nuevas columnas (nullable de entrada para poder migrar los datos viejos)
ALTER TABLE planes ADD COLUMN IF NOT EXISTS precio_mensual DECIMAL(12,2);
ALTER TABLE planes ADD COLUMN IF NOT EXISTS precio_anual   DECIMAL(12,2);

-- Migrar los datos existentes: el precio viejo se ubica segun su periodo.
-- (Solo corre si la columna vieja `precio` todavia existe.)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'planes' AND column_name = 'precio'
    ) THEN
        -- precio_mensual: el precio viejo si era MENSUAL; si era ANUAL, lo dejamos NULL
        -- (no inventamos un mensual a partir de un anual).
        UPDATE planes
        SET precio_mensual = CASE WHEN periodo = 'MENSUAL' THEN precio ELSE precio_mensual END,
            precio_anual   = CASE WHEN periodo = 'ANUAL'   THEN precio ELSE precio_anual   END
        WHERE precio_mensual IS NULL AND precio_anual IS NULL;
    END IF;
END $$;

-- precio_mensual es obligatorio (todo plan se ofrece al menos mensual).
-- Si quedo NULL tras migrar (plan que solo era ANUAL), ponerlo en 0 para no romper el NOT NULL;
-- el superadmin lo corrige desde /admin.
UPDATE planes SET precio_mensual = 0 WHERE precio_mensual IS NULL;

ALTER TABLE planes ALTER COLUMN precio_mensual SET NOT NULL;
ALTER TABLE planes ALTER COLUMN precio_mensual SET DEFAULT 0;

-- Soltar las columnas viejas (ya migradas).
ALTER TABLE planes DROP COLUMN IF EXISTS precio;
ALTER TABLE planes DROP COLUMN IF EXISTS periodo;


-- =============================================================================
-- 2. TABLA suscripciones — periodo contratado por fila
-- =============================================================================
-- El periodo ya NO vive en el plan: lo elige el cliente al pagar. Cada fila de
-- suscripcion guarda que periodo se cobro, para calcular el vencimiento al renovar.
ALTER TABLE suscripciones
    ADD COLUMN IF NOT EXISTS periodo_contratado VARCHAR(20) NOT NULL DEFAULT 'MENSUAL'
    CHECK (periodo_contratado IN ('MENSUAL', 'ANUAL'));


-- =============================================================================
-- 3. RESEED plan BASICO con ambos precios
-- =============================================================================
-- Ajusta los montos a los reales. precio_anual con descuento sobre 12 meses.
INSERT INTO planes (codigo, nombre, descripcion, precio_mensual, precio_anual, trial_dias, features, orden)
VALUES ('BASICO', 'Plan Basico', 'Acceso completo al sistema de gestion.', 9.99, 99.99, 15,
        '{"pos": true, "inventario": true, "recargas": true, "clientes": true, "reportes": true}', 1)
ON CONFLICT (codigo) DO UPDATE
    SET precio_mensual = EXCLUDED.precio_mensual,
        precio_anual   = EXCLUDED.precio_anual;


NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 4. FUNCIONES — re-ejecutar (usan los campos nuevos)
-- =============================================================================
-- Ejecutar a continuacion el contenido actualizado de:
--   a) docs/suscripcion/sql/functions/fn_estado_suscripcion.sql
--   b) docs/suscripcion/sql/functions/fn_listar_suscripciones_admin.sql
--   c) docs/suscripcion/sql/functions/fn_registrar_pago_suscripcion.sql
-- (Quedan como fuente de verdad en sus archivos.)


-- =============================================================================
-- VERIFICACION (opcional)
-- =============================================================================
-- SELECT codigo, nombre, precio_mensual, precio_anual, trial_dias FROM planes;
-- SELECT periodo_contratado, count(*) FROM suscripciones GROUP BY 1;
-- =============================================================================
