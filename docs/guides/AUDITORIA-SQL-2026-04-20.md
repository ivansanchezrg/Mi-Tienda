# Auditoría SQL — Funciones vs Schema
**Fecha:** 2026-04-20  
**Alcance:** Todos los archivos en `docs/*/sql/functions/`  
**Resultado:** 2 bugs corregidos · 3 items pendientes de decisión tuya

---

## ✅ Corregido en esta sesión

### Fix #1 — `fn_anular_venta` v1.3
**Archivo:** `docs/pos/sql/functions/fn_anular_venta.sql`

**Bug:** La anulación de ventas EFECTIVO siempre revertía de `CAJA` (bóveda), pero el trigger `fn_actualizar_saldo_caja_venta` ingresa el dinero a `CAJA_CHICA`. Si la anulación ocurría antes del cierre del turno, el dinero no había llegado a `CAJA` todavía → desbalance contable.

**Fix:** Verifica si el turno de la venta sigue abierto:
- Turno abierto → revierte de `CAJA_CHICA`
- Turno cerrado → revierte de `CAJA`

**Ejecutar en BD:** Sí, re-ejecutar el archivo completo.

---

### Fix #2 — `fn_registrar_venta_pos` v1.9
**Archivo:** `docs/pos/sql/functions/fn_registrar_venta_pos.sql`

**Bug:** El snapshot de `precio_costo` en `ventas_detalles` siempre leía `productos.precio_costo` (costo unitario base), incluso cuando la venta era por presentación. Esto causaba que `fn_reporte_ventas_periodo` calculara ganancia incorrecta para ventas por presentación.

**Fix:** Si `presentacion_id` está presente, lee `producto_presentaciones.precio_costo` (costo real del paquete). Si es venta directa, lee `productos.precio_costo`.

**Ejecutar en BD:** Sí, re-ejecutar el archivo completo.

---

## ⚠️ Pendiente de decisión tuya

### Pendiente #1 — `fn_ejecutar_cierre_diario` — código muerto `pos_habilitado`
**Archivo:** `docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql` línea 182

**Situación:** La función lee `configuraciones WHERE clave = 'pos_habilitado'`, pero esa clave fue eliminada del schema (el POS se habilita/deshabilita por si hay turno abierto, no por configuración). El `COALESCE(..., TRUE)` lo resuelve silenciosamente → **no falla**, funciona como si siempre fuera `TRUE`.

**Riesgo:** Ninguno en producción hoy. Pero es código que puede confundir en el futuro.

**Opciones:**
- **A) Limpiar (recomendado):** Eliminar la variable `v_pos_habilitado` y la línea que la lee. Cambiar la condición del paso 7 de `IF v_pos_habilitado AND v_hubo_movimientos_caja_chica` a solo `IF v_hubo_movimientos_caja_chica`.
- **B) Dejar como está:** El COALESCE lo neutraliza, no hay urgencia.

---

### Pendiente #2 — `fn_listar_ventas` — campos faltantes en RETURNS TABLE
**Archivo:** `docs/ventas/sql/functions/fn_listar_ventas.sql`

**Situación:** La función no retorna `descuento`, `descuento_pct`, `estado_pago`, `observaciones` de la tabla `ventas`. Estos campos existen en el schema.

**Pregunta:** ¿El frontend de historial de ventas necesita estos campos desde la función, o los obtiene por otra vía (query directa al detalle de venta)?

**Opciones:**
- **A) Agregar a RETURNS TABLE:** Útil si la lista necesita mostrar badge de descuento o estado de pago por fila.
- **B) Dejar como está:** Si el detalle de cada venta los obtiene al abrir el modal, no es necesario en la lista.

---

### Pendiente #3 — `fn_crear_transferencia` — sin `FOR UPDATE`
**Archivo:** `docs/dashboard/sql/functions/fn_crear_transferencia.sql`

**Situación:** Lee los saldos de las cajas sin `FOR UPDATE`. Todas las demás funciones que modifican saldos usan `FOR UPDATE` para evitar race conditions.

**Riesgo:** Bajo en la práctica (app de un solo usuario), pero inconsistente con el patrón del proyecto.

**Opciones:**
- **A) Agregar `FOR UPDATE` (recomendado):** Consistencia con el resto, sin costo.
- **B) Dejar como está:** Sin impacto real dado el uso de la app.

---

## 📁 Organización de archivos

### Archivo mal ubicado
`docs/notas/sql/functions/create_notas_table.sql` no es una función — es DDL de tabla + RLS. Debería moverse a `docs/notas/sql/setup/create_notas_table.sql`.

**Impacto:** Solo organizativo. No afecta la BD.

---

### Función no documentada en schema.sql
`fn_generar_codigo_interno_presentacion` existe en `docs/inventario/sql/functions/` pero no aparece en el listado de funciones al final del `docs/schema.sql` (líneas 711-744).

**Acción:** Agregar al listado:
```
--   • fn_generar_codigo_interno_presentacion → docs/inventario/sql/functions/fn_generar_codigo_interno_presentacion.sql
```

---

## 📋 Orden de ejecución recomendado (si re-ejecutas desde cero)

1. `docs/schema.sql`
2. `docs/inventario/sql/functions/fn_generar_codigo_interno.sql`
3. `docs/inventario/sql/functions/fn_generar_codigo_interno_presentacion.sql`
4. Resto de funciones (sin orden dependiente entre sí)

---

## ✅ Funciones auditadas sin problemas

| Función | Módulo |
|---------|--------|
| `fn_abrir_turno` | Dashboard |
| `fn_registrar_operacion_manual` | Dashboard |
| `fn_reparar_deficit_turno` | Dashboard |
| `fn_verificar_transferencia_caja_chica_hoy` | Dashboard |
| `fn_crear_transferencia` | Dashboard |
| `fn_listar_cuentas_cobrar` | Cuentas por Cobrar |
| `fn_registrar_pago_fiado` | Cuentas por Cobrar |
| `fn_resumir_cuentas_cobrar` | Cuentas por Cobrar |
| `fn_ajustar_stock_inventario` | Inventario |
| `fn_generar_codigo_interno` | Inventario |
| `fn_generar_codigo_interno_presentacion` | Inventario |
| `fn_resumir_ventas` | Ventas |
| `fn_reporte_ventas_periodo` | Ventas |
| `fn_registrar_recarga_proveedor_celular` | Recargas Virtuales |
| `fn_registrar_pago_proveedor_celular` | Recargas Virtuales |
| `fn_registrar_compra_saldo_bus` | Recargas Virtuales |
| `fn_liquidar_ganancias_bus` | Recargas Virtuales |
| `fn_registrar_adelanto_sueldo` | Movimientos Empleados |
| `fn_pagar_nomina_empleado` | Movimientos Empleados |
| `fn_eliminar_nota` | Notas |
