-- ==========================================
-- SEED: categorias_sistema
-- ==========================================
-- Catálogo global de categorías del sistema — UUIDs fijos predefinidos.
-- Sin negocio_id: aplica a toda la plataforma por igual.
-- No editable desde la UI; cualquier cambio es un deploy de código.
--
-- Ejecutar UNA SOLA VEZ al inicializar la BD (o en idempotente con ON CONFLICT DO NOTHING).
-- La tabla ya debe existir (creada en schema.sql, sección 7b).
--
-- Implementado: 2026-06-02 (separación categorías de sistema vs. usuario — las de
-- sistema son globales aquí; las de usuario viven en categorias_operaciones por negocio.
-- operaciones_cajas referencia una u otra vía categoria_id XOR categoria_sistema_id,
-- y la vista v_operaciones_cajas las unifica para el frontend).
-- ==========================================

INSERT INTO public.categorias_sistema (id, codigo, tipo, nombre, descripcion)
VALUES
  -- Cierres de turno
  ('a1000001-0000-0000-0000-000000000001', 'CIE-SIN-POS',    'INGRESO', 'Cierre — Ventas del día',            'Depósito de efectivo de ventas al cerrar turno (sin POS activo)'),
  ('a1000001-0000-0000-0000-000000000002', 'CIE-CON-POS',    'INGRESO', 'Cierre — Ventas con POS',            'Depósito de efectivo de ventas al cerrar turno (con POS activo)'),

  -- Ajustes de conteo
  ('a1000001-0000-0000-0000-000000000003', 'AJU-CONTEO-IN',  'INGRESO', 'Ajuste Diferencia Conteo (sobra)',   'Diferencia positiva detectada al contar el efectivo en el cierre'),
  ('a1000001-0000-0000-0000-000000000004', 'AJU-CONTEO-EG',  'EGRESO',  'Ajuste Diferencia Conteo (falta)',   'Diferencia negativa detectada al contar el efectivo en el cierre'),

  -- Déficit de transferencia a VARIOS
  ('a1000001-0000-0000-0000-000000000005', 'DEF-REPONER',    'INGRESO', 'Reposición Déficit Turno Anterior',  'Ingreso en VARIOS para cubrir el monto que faltó transferir en el cierre anterior'),
  ('a1000001-0000-0000-0000-000000000006', 'DEF-RETIRAR',    'EGRESO',  'Ajuste Déficit Turno Anterior',      'Retiro en CAJÓN del monto adeudado a VARIOS del cierre anterior'),

  -- Apertura de turno
  ('a1000001-0000-0000-0000-000000000007', 'FONDO-APERTURA', 'EGRESO',  'Fondo Apertura Turno',               'Retiro de CAJA al abrir turno para cargar el fondo inicial del cajón'),

  -- Nómina
  ('a1000001-0000-0000-0000-000000000008', 'SALARIOS',       'EGRESO',  'Salarios',                           'Pago de nómina mensual de empleados'),
  ('a1000001-0000-0000-0000-000000000009', 'ADELANTO',       'EGRESO',  'Adelanto Sueldo Empleado',           'Adelanto de sueldo descontado de la cuenta corriente del empleado'),

  -- Ventas y anulaciones
  ('a1000001-0000-0000-0000-000000000010', 'ANULACION-VENTA','EGRESO',  'Anulación Venta',                    'Reversión de efectivo al anular una venta POS'),
  ('a1000001-0000-0000-0000-000000000013', 'VENTA-POS',      'INGRESO', 'Venta POS',                          'Ingreso automático en CAJÓN al registrar una venta POS o pago de fiado'),

  -- Recargas virtuales
  ('a1000001-0000-0000-0000-000000000011', 'PAGO-PROV-CEL',  'EGRESO',  'Pago Proveedor Recargas',            'Pago al proveedor de recargas celulares (descuenta CAJA_CELULAR)'),
  ('a1000001-0000-0000-0000-000000000012', 'COMPRA-BUS',     'EGRESO',  'Compra Saldo Virtual Bus',           'Compra de saldo al proveedor de recargas bus (descuenta CAJA_BUS)')

ON CONFLICT (id) DO NOTHING;
