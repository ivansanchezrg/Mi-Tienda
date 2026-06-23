-- ==========================================
-- MIGRATION 003: Eliminar caja VARIOS creada sin estar activa
-- ==========================================
-- Fecha: 2026-06-04
-- Descripción:
--   Hasta ahora fn_completar_onboarding creaba la caja VARIOS siempre,
--   aunque el usuario no la hubiera activado en el onboarding.
--   A partir de este cambio, VARIOS solo se crea si p_varios_activa = true
--   (o cuando el superadmin la habilita desde fn_configurar_modulos).
--   Este script limpia las cajas VARIOS huérfanas: existen en BD pero
--   el negocio tiene caja_varios_activa = 'false' en configuraciones.
--
-- Condición segura para eliminar:
--   1. codigo = 'VARIOS'
--   2. saldo_actual = 0  (nunca recibió dinero)
--   3. El negocio tiene caja_varios_activa = 'false' en configuraciones
--   4. No tiene ninguna operación registrada en operaciones_cajas
--
-- La condición 4 es el guardián final: si por algún motivo hay una operación
-- en esa caja, no la tocamos aunque el flag diga false.
--
-- Esta migración es IDEMPOTENTE — puede ejecutarse varias veces sin efecto adverso.
-- ==========================================

DELETE FROM cajas
WHERE codigo = 'VARIOS'
  AND saldo_actual = 0
  AND negocio_id IN (
      SELECT negocio_id FROM configuraciones
      WHERE clave = 'caja_varios_activa' AND valor = 'false'
  )
  AND id NOT IN (
      SELECT DISTINCT caja_id FROM operaciones_cajas WHERE caja_id IS NOT NULL
  );
