-- ==========================================
-- TABLA: secuencias_comprobantes
-- ==========================================
-- Genera números correlativos por tipo de comprobante
-- usando UPDATE ... RETURNING para garantizar atomicidad
-- sin DDL dentro de triggers (patrón seguro para baja concurrencia).
--
-- Uso: fn_registrar_venta_pos incrementa el contador del tipo
--      correspondiente y usa el valor obtenido como numero_comprobante.
--
-- Tipos inicializados:
--   TICKET     → uso inmediato (app actual)
--   NOTA_VENTA → reservado para fase SRI
--   FACTURA    → reservado para fase SRI
-- ==========================================

CREATE TABLE IF NOT EXISTS secuencias_comprobantes (
    tipo_documento VARCHAR(20) PRIMARY KEY,
    ultimo_valor   INTEGER     NOT NULL DEFAULT 0
);

-- Inicializar los tres tipos (idempotente con ON CONFLICT DO NOTHING)
INSERT INTO secuencias_comprobantes (tipo_documento, ultimo_valor)
VALUES
    ('TICKET',     0),
    ('NOTA_VENTA', 0),
    ('FACTURA',    0)
ON CONFLICT (tipo_documento) DO NOTHING;
