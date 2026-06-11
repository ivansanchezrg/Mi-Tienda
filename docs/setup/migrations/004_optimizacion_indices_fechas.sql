    -- ==========================================
    -- MIGRACIÓN 004 — Optimización de índices + endurecimiento de fechas
    -- Fecha: 2026-06-10 (revisión profesional del modelo de BD)
    -- ==========================================
    -- Idempotente y seguro de re-ejecutar. Ejecutar COMPLETO en Supabase SQL Editor.
    -- No toca datos (salvo el backfill defensivo de fechas NULL, normalmente 0 filas).
    --
    -- Tres bloques:
    --   1. fecha NOT NULL en las 5 tablas financieras — una fila con fecha NULL
    --      desaparece silenciosamente de todos los reportes por rango.
    --   2. DROP de 19 índices simples (negocio_id) redundantes — cada uno tiene un
    --      PK/UNIQUE/índice compuesto que EMPIEZA por negocio_id, y Postgres usa ese
    --      para los filtros de RLS. El simple solo agrega costo de escritura en cada
    --      INSERT/UPDATE (crítico en ledgers: ventas, operaciones_cajas, kardex).
    --   3. Índice nuevo para categoria_sistema_id (lo usa fn_listar_cierres_turno
    --      via usa_pos; existía el de categoria_id pero no el de la columna hermana).
    --
    -- schema.sql queda actualizado con el mismo estado final (fuente de verdad para resets).
    -- ==========================================

    -- ── 1. fecha NOT NULL en tablas financieras ──
    -- Backfill defensivo primero (en una BD sana son 0 filas).

    UPDATE ventas                SET fecha = NOW() WHERE fecha IS NULL;
    UPDATE operaciones_cajas     SET fecha = NOW() WHERE fecha IS NULL;
    UPDATE kardex_inventario     SET fecha = NOW() WHERE fecha IS NULL;
    UPDATE movimientos_empleados SET fecha = NOW() WHERE fecha IS NULL;
    UPDATE cuentas_cobrar        SET fecha = NOW() WHERE fecha IS NULL;

    ALTER TABLE ventas                ALTER COLUMN fecha SET NOT NULL;
    ALTER TABLE operaciones_cajas     ALTER COLUMN fecha SET NOT NULL;
    ALTER TABLE kardex_inventario     ALTER COLUMN fecha SET NOT NULL;
    ALTER TABLE movimientos_empleados ALTER COLUMN fecha SET NOT NULL;
    ALTER TABLE cuentas_cobrar        ALTER COLUMN fecha SET NOT NULL;

    -- ── 2. Índices simples (negocio_id) redundantes ──
    -- Cubiertos por el índice del constraint o compuesto indicado en cada línea.
    -- Los índices de PK/UNIQUE no se tocan — los crea el constraint y permanecen.

    DROP INDEX IF EXISTS idx_cajas_negocio;             -- UNIQUE (negocio_id, codigo)
    DROP INDEX IF EXISTS idx_configuraciones_negocio;   -- PK (negocio_id, clave)
    DROP INDEX IF EXISTS idx_cat_operaciones_negocio;   -- UNIQUE (negocio_id, codigo)
    DROP INDEX IF EXISTS idx_turnos_negocio;            -- idx_turnos_negocio_empleado, idx_turnos_caja_fecha_turno
    DROP INDEX IF EXISTS idx_recargas_negocio;          -- idx_recargas_negocio_fecha / _turno / _tipo_servicio / _empleado
    DROP INDEX IF EXISTS idx_recargas_virt_negocio;     -- idx_recargas_virt_negocio_pagado / _servicio
    DROP INDEX IF EXISTS idx_operaciones_negocio;       -- idx_operaciones_negocio_fecha / _caja / _caja_f / _empl / _categoria
    DROP INDEX IF EXISTS idx_mov_empleados_negocio;     -- idx_mov_empl_negocio_empl_est / _fecha / _turno
    DROP INDEX IF EXISTS idx_categorias_prod_negocio;   -- UNIQUE (negocio_id, nombre)
    DROP INDEX IF EXISTS idx_atributos_negocio;         -- UNIQUE (negocio_id, nombre)
    DROP INDEX IF EXISTS idx_productos_negocio;         -- idx_productos_negocio_activo / _template / _categoria / _nombre / _barcode_nn
    DROP INDEX IF EXISTS idx_presentaciones_negocio;    -- idx_presentaciones_producto_activo (negocio_id, producto_id, activo)
    DROP INDEX IF EXISTS idx_clientes_negocio;          -- UNIQUE (negocio_id, identificacion)
    DROP INDEX IF EXISTS idx_ventas_negocio;            -- idx_ventas_negocio_fecha_desc / _turno / _estado / _metodo / _estado_pago / _cliente
    DROP INDEX IF EXISTS idx_kardex_negocio;            -- idx_kardex_negocio_producto
    DROP INDEX IF EXISTS idx_cuentas_cobrar_negocio;    -- idx_cuentas_cobrar_negocio_fecha
    DROP INDEX IF EXISTS idx_secuencias_negocio;        -- PK (negocio_id, tipo_documento)
    DROP INDEX IF EXISTS idx_notas_negocio;             -- idx_notas_negocio_completada
    DROP INDEX IF EXISTS idx_codigos_barras_negocio;    -- uq_codigo_barras_negocio (negocio_id, codigo) + idx_codigos_barras_lookup

    -- Se CONSERVAN (ningún compuesto/constraint empieza por negocio_id en su tabla):
    --   idx_templates_negocio, idx_atrib_opciones_negocio

    -- ── 3. Índice para categoría de sistema en operaciones ──
    -- Espejo del de categoria_id. Parcial: la mayoría de operaciones manuales no la tienen.

    CREATE INDEX IF NOT EXISTS idx_operaciones_negocio_cat_sist
        ON operaciones_cajas(negocio_id, categoria_sistema_id)
        WHERE categoria_sistema_id IS NOT NULL;

    NOTIFY pgrst, 'reload schema';
