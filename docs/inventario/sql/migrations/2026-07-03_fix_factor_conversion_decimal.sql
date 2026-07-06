-- ==========================================
-- MIGRACIÓN — Fixes de integridad en el modelo de productos
-- Fecha: 2026-07-03
-- ==========================================
-- Origen: revisión del modelo de datos de productos (simple / presentaciones / variantes).
-- Ejecutar este archivo COMPLETO en Supabase SQL Editor. Es idempotente y seguro de
-- re-ejecutar.
--
-- Contiene 4 fixes independientes:
--   1. fn_actualizar_stock_venta — bug de redondeo (CRÍTICO)
--   2. fn_sync_codigo_barras — integridad silenciosa del backstop de unicidad
--   3. producto_templates — UNIQUE (negocio_id, nombre)
--   4. Índices FK faltantes (ventas_detalles, kardex_inventario, producto_atributos,
--      template_atributo_opciones)
-- ==========================================


-- ══════════════════════════════════════════════════════════════════════════
-- 1. fn_actualizar_stock_venta — v_factor INTEGER truncaba factores fraccionarios
-- ══════════════════════════════════════════════════════════════════════════
-- La migración 2026-06-10_stock_negativo_offline.sql (Fase 6 PLAN-OFFLINE-POS)
-- introdujo v_factor INTEGER — regresión respecto a la v10 original, que ya usaba
-- DECIMAL(12,4). producto_presentaciones.factor_conversion es DECIMAL(12,4) y soporta
-- fracciones (0.5, 1.25...). Con INTEGER, un factor 0.5 se redondeaba a 1 y 1.25 a 1:
-- la venta pasaba, pero el stock descontado y el kardex quedaban mal SIN ningún error
-- visible. Hoy no dolió porque los factores en uso son enteros (packs x6, x10, x20),
-- pero el modelo soporta tipo_venta = 'PESO' y cualquier presentación fraccionaria
-- corrompería stock silenciosamente.
--
-- Este fix reunifica DECIMAL(12,4) + el soporte de venta offline (stock negativo
-- optimista) que sí se necesita mantener.

CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id     UUID;
    v_factor         DECIMAL(12,4);
    v_cantidad_real  DECIMAL(12,2);
    v_stock_actual   DECIMAL(12,2);
    v_permitir_neg   BOOLEAN;
BEGIN
    IF NEW.presentacion_id IS NOT NULL THEN
        v_factor := (SELECT factor_conversion FROM producto_presentaciones WHERE id = NEW.presentacion_id);
        IF v_factor IS NULL THEN
            RAISE EXCEPTION 'Presentacion no valida o no encontrada: %', NEW.presentacion_id;
        END IF;
    ELSE
        v_factor := 1.0;
    END IF;

    v_cantidad_real := NEW.cantidad * v_factor;

    -- Lock de fila: previene race condition en ventas concurrentes del mismo producto
    PERFORM id FROM productos WHERE id = NEW.producto_id FOR UPDATE;

    v_negocio_id   := (SELECT negocio_id   FROM productos WHERE id = NEW.producto_id);
    v_stock_actual := (SELECT stock_actual  FROM productos WHERE id = NEW.producto_id);

    -- Bandera de venta offline (§5/§6 PLAN-OFFLINE-POS): la setea fn_registrar_venta_pos
    -- en la misma transacción cuando la venta viene de la cola offline. Permite stock
    -- negativo porque la venta YA ocurrió físicamente — negarla descuadraría la caja.
    v_permitir_neg := COALESCE(current_setting('app.permitir_stock_negativo', true), 'off') = 'on';

    IF v_stock_actual < v_cantidad_real AND NOT v_permitir_neg THEN
        RAISE EXCEPTION 'Stock insuficiente para producto %. Stock actual: %, requerido: %',
            NEW.producto_id, v_stock_actual, v_cantidad_real;
    END IF;

    UPDATE productos
    SET stock_actual = stock_actual - v_cantidad_real
    WHERE id = NEW.producto_id;

    INSERT INTO kardex_inventario (negocio_id, producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo, referencia_id, presentacion_id, observaciones)
    VALUES (v_negocio_id, NEW.producto_id, 'VENTA', v_cantidad_real,
        v_stock_actual, v_stock_actual - v_cantidad_real,
        NEW.venta_id, NEW.presentacion_id, 'Descuento automatico por Venta POS');

    RETURN NEW;
END;
$$;

-- El trigger trg_descontar_stock_venta ya existe y apunta a esta función — no se recrea.


-- ══════════════════════════════════════════════════════════════════════════
-- 2. fn_sync_codigo_barras — el UPDATE con guardia podía no afectar filas sin avisar
-- ══════════════════════════════════════════════════════════════════════════
-- codigos_barras es la fuente de verdad de unicidad cross-table; productos.codigo_barras
-- y producto_presentaciones.codigo_barras son copias denormalizadas sincronizadas por
-- este trigger. El ON CONFLICT ... DO UPDATE ... WHERE tiene una guardia correcta (evita
-- que un producto le robe el código a otro), pero cuando la guardia excluye la fila, el
-- UPDATE simplemente no hace nada — sin lanzar unique_violation. Resultado: el
-- codigo_barras quedaba escrito en productos/presentaciones mientras la tabla central
-- seguía apuntando al dueño anterior. Las dos fuentes divergían en silencio.

CREATE OR REPLACE FUNCTION fn_sync_codigo_barras()
RETURNS TRIGGER AS $$
DECLARE
    v_negocio_id  UUID;
    v_producto_id UUID;
    v_tipo        TEXT;
    v_pres_id     UUID := NULL;
BEGIN
    IF TG_TABLE_NAME = 'productos' THEN
        v_tipo        := 'PRODUCTO';
        v_negocio_id  := COALESCE(NEW.negocio_id, OLD.negocio_id);
        v_producto_id := COALESCE(NEW.id, OLD.id);
    ELSIF TG_TABLE_NAME = 'producto_presentaciones' THEN
        v_tipo        := 'PRESENTACION';
        v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);
        v_pres_id     := COALESCE(NEW.id, OLD.id);
        v_negocio_id  := (SELECT negocio_id FROM productos WHERE id = v_producto_id);
    END IF;

    -- DELETE: borrar el registro de codigos_barras
    IF TG_OP = 'DELETE' THEN
        IF OLD.codigo_barras IS NOT NULL THEN
            DELETE FROM codigos_barras
            WHERE negocio_id = v_negocio_id AND codigo = OLD.codigo_barras;
        END IF;
        RETURN OLD;
    END IF;

    -- INSERT o UPDATE: borrar codigo anterior si cambio
    IF TG_OP = 'UPDATE' AND OLD.codigo_barras IS NOT NULL
       AND (NEW.codigo_barras IS DISTINCT FROM OLD.codigo_barras) THEN
        DELETE FROM codigos_barras
        WHERE negocio_id = v_negocio_id AND codigo = OLD.codigo_barras;
    END IF;

    -- Insertar nuevo codigo (si existe)
    IF NEW.codigo_barras IS NOT NULL AND TRIM(NEW.codigo_barras) <> '' THEN
        BEGIN
            INSERT INTO codigos_barras (negocio_id, codigo, tipo, producto_id, presentacion_id)
            VALUES (v_negocio_id, NEW.codigo_barras, v_tipo, v_producto_id, v_pres_id)
            ON CONFLICT (negocio_id, codigo) DO UPDATE
            SET tipo            = EXCLUDED.tipo,
                producto_id     = EXCLUDED.producto_id,
                presentacion_id = EXCLUDED.presentacion_id
            -- Guardia: solo actualizar si es el mismo tipo o mismo producto.
            -- Evita que un INSERT concurrente cambie PRODUCTO→PRESENTACION silenciosamente.
            WHERE codigos_barras.tipo = EXCLUDED.tipo
               OR codigos_barras.producto_id = EXCLUDED.producto_id;

            -- Fix 2026-07-03: si la guardia del WHERE excluyó la fila (código ya
            -- pertenece a otro producto/tipo), el UPDATE no afecta ninguna fila y
            -- antes seguía de largo en silencio. Ahora se detecta y se rechaza.
            IF NOT FOUND THEN
                RAISE EXCEPTION 'El codigo de barras % ya existe en este negocio', NEW.codigo_barras;
            END IF;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'El codigo de barras % ya existe en este negocio', NEW.codigo_barras;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Los triggers trg_sync_barcode_productos / trg_sync_barcode_presentaciones ya existen
-- y apuntan a esta función — no se recrean.


-- ══════════════════════════════════════════════════════════════════════════
-- 3. producto_templates — UNIQUE (negocio_id, nombre)
-- ══════════════════════════════════════════════════════════════════════════
-- No había constraint que impidiera dos templates "TAPIOCA" en el mismo negocio.
-- categorias_productos y atributos ya tienen este UNIQUE; producto_templates no lo
-- tenía. Si ya existen duplicados en algún negocio, este ALTER falla con un mensaje
-- claro (a diferencia del bug de arriba, que fallaba en silencio) — en ese caso hay
-- que renombrar/fusionar los templates duplicados antes de re-ejecutar este bloque.

ALTER TABLE producto_templates
    ADD CONSTRAINT producto_templates_negocio_id_nombre_key UNIQUE (negocio_id, nombre);


-- ══════════════════════════════════════════════════════════════════════════
-- 4. Índices FK faltantes
-- ══════════════════════════════════════════════════════════════════════════
-- Sin índice, cada DELETE/UPDATE de una fila referenciada obliga a un seq scan de la
-- tabla hija para verificar la FK. ventas_detalles y kardex_inventario son las tablas
-- de mayor crecimiento del sistema (una fila por línea de venta / movimiento de stock),
-- así que son las que más se benefician a mediano plazo.

CREATE INDEX IF NOT EXISTS idx_ventas_detalles_presentacion
    ON ventas_detalles(presentacion_id) WHERE presentacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kardex_presentacion
    ON kardex_inventario(presentacion_id) WHERE presentacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_template_atrib_opciones_opcion
    ON template_atributo_opciones(atributo_opcion_id);

CREATE INDEX IF NOT EXISTS idx_producto_atributos_opcion
    ON producto_atributos(atributo_opcion_id);


NOTIFY pgrst, 'reload schema';
