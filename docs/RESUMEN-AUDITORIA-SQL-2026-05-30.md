# Resumen Auditoría SQL — 2026-05-30

Auditoría completa de las 35 funciones SQL del proyecto.
Para detalle completo ver:
- `docs/AUDITORIA-FUNCIONES-SQL-2026-05-30.md`
- `docs/CORRECCIONES-SQL-2026-05-30.md`

---

## ✅ Funciones modificadas (20)

### Seguridad multi-tenant (8)

| Función | Cambio |
|---|---|
| `fn_resumir_cuentas_cobrar` | Filtros `negocio_id = get_negocio_id()` en JOINs (ventas, clientes, cuentas_cobrar) |
| `fn_ajustar_stock_inventario` | Filtro `negocio_id` en lectura, lock y UPDATE de `productos` |
| `fn_actualizar_membresia` | Valida que la membresía pertenezca al negocio del JWT (superadmin exento) |
| `fn_transferir_empleado` | Valida que negocio origen sea el del JWT + valida destino existe |
| `fn_abrir_turno` | Valida que `p_empleado_id` tenga membresía activa en el negocio |
| `fn_registrar_venta_pos` | Valida turno/cliente/empleado/productos pertenecen al negocio + INSERT batch elimina N+1 |
| `fn_crear_producto_simple` | Valida que `p_categoria_id` pertenezca al negocio |
| `fn_crear_producto_con_variantes` | Valida categoría + cada `atributo_opcion_id` del array |

### Correctitud (race conditions y locks) (2)

| Función | Cambio |
|---|---|
| `fn_crear_transferencia` | `FOR UPDATE` en ambas cajas con `FOR..LOOP` atómico, 6 queries consolidadas en 2 |
| `fn_anular_venta` | `FOR UPDATE` en venta con `RECORD`, eliminadas 7 subqueries idénticas |

### Performance (1)

| Función | Cambio |
|---|---|
| `fn_verificar_transferencia_caja_chica_hoy` | Reemplaza `(fecha AT TIME ZONE ...)::date = p_fecha` por ventana UTC (usa el índice). Categoría IN-004 resuelta antes del WHERE para evitar subquery anidada |

### Limpieza — `EXCEPTION WHEN OTHERS` enmascarador removido (21)

Estas funciones tenían `EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Error...'` al final que ocultaba el `SQLSTATE` original (perdían info para debugging). Removido en:

- `fn_configurar_modulos_admin`
- `fn_consultar_usuario_por_email`
- `fn_suspender_usuario`
- `fn_abrir_turno`
- `fn_crear_transferencia` (reescrita)
- `fn_registrar_operacion_manual`
- `fn_reparar_deficit_turno`
- `fn_ajustar_stock_inventario`
- `fn_crear_producto_simple`
- `fn_crear_producto_con_variantes`
- `fn_pagar_nomina_empleado`
- `fn_registrar_adelanto_sueldo`
- `fn_completar_onboarding`
- `fn_configurar_modulos`
- `fn_registrar_venta_pos` (reescrita)
- `fn_anular_venta`
- `fn_ejecutar_cierre_diario_v5` ⚠️ (detectado tarde — patrón `EXCEPTION` + salto + `WHEN OTHERS`)
- `fn_pagar_proveedor_celular` ⚠️
- `fn_liquidar_ganancias` ⚠️
- `fn_registrar_compra_saldo_bus` ⚠️
- `fn_registrar_recarga_proveedor_celular` ⚠️

> Nota: en `fn_crear_producto_*` quedaron `EXCEPTION WHEN OTHERS` internos dentro de bloques pequeños que castean JSON — son legítimos (defensa contra entrada malformada), no enmascaradores globales.
>
> Nota 2: las 5 funciones marcadas con ⚠️ se me escaparon en la primera pasada porque usaban el patrón `EXCEPTION` en una línea y `WHEN OTHERS` en la siguiente. Detectadas y corregidas en pasada de revisión.

### Otros (1)

| Función | Cambio |
|---|---|
| `fn_completar_onboarding` | `DROP FUNCTION IF EXISTS` movido al inicio del archivo (estaba al final, lo que dejaba dos versiones convivendo si la firma cambiaba) |

---

## ⚠️ Funciones NO modificadas (pendientes documentados)

Bugs/mejoras conocidos que NO se aplicaron — abordar en sesión dedicada con pruebas E2E:

| Función | Pendiente | Riesgo |
|---|---|---|
| `fn_reporte_ventas_periodo` | 15 queries duplicadas sobre `ventas` — consolidar en 1 con `FILTER` | Performance crítica con miles de ventas |
| `fn_listar_productos` | Subqueries N+1 en SELECT — usar `LEFT JOIN LATERAL` | Performance en pantalla más usada |
| `fn_liquidar_ganancias` | Calcula `SUM` sin lock antes de transferir | Race condition (bajo: solo admin la dispara) |
| `fn_pagar_nomina_empleado` / `fn_registrar_adelanto_sueldo` | Caché de saldos tras `FOR UPDATE` — usar `RETURNING` | Robustez teórica |
| `fn_registrar_compra_saldo_bus` / `fn_registrar_recarga_proveedor_celular` | 2-3 SELECT secuenciales — consolidar en CTE | Performance puntual |
| `fn_registrar_operacion_manual` / `fn_reparar_deficit_turno` | No valida `p_categoria_id` por negocio | Bajo (FK garantiza existencia) |
| `fn_registrar_pago_fiado` | Lee `cajas.saldo_actual` sin `FOR UPDATE` antes de UPDATE | Race condition leve |
| `fn_listar_clientes_con_saldo` | Llama `get_negocio_id()` 3 veces (redundante) + falta `DROP FUNCTION IF EXISTS` | Cosmético |

---

## ✅ Funciones OK (sin cambios)

| Función | Estado |
|---|---|
| `fn_assert_no_superadmin` | ✅ |
| `fn_set_negocio_activo` (schema.sql) | ✅ |
| `fn_validar_sesion` | ✅ |
| `fn_listar_cierres_turno` | ✅ (recién creada y optimizada) |
| `fn_listar_ventas` | ✅ |
| `fn_generar_codigo_interno` | ✅ |
| `fn_generar_codigo_interno_presentacion` | ✅ |

## 🆕 Funciones nuevas creadas en post-auditoría

| Función | Propósito |
|---|---|
| `fn_reporte_ventas_periodo` v1.9 | Performance: 11 queries duplicadas → 4 (consolidación con FILTER + RECORDs) |
| `fn_listar_productos` v2.0 | Performance: 3 subqueries por fila → JOINs explícitos (LEFT JOIN LATERAL para presentaciones) |
| `fn_buscar_productos_pos` v1.0 | Buscador del POS por texto (reemplaza query directa de InventarioService) |
| `fn_catalogo_productos_pos` v1.0 | Catálogo POS con filtro por categoría heredada del template (**fix bug variantes**) |
| `fn_home_dashboard` v1.0 | Consolida 9 queries del home en 1 RPC (estado caja + saldos virtuales + movimientos) — ver `docs/guides/PERFORMANCE-STARTUP.md` |

---

## 📋 Estadísticas

| Categoría | Cantidad |
|---|---|
| Total auditadas | 35 |
| Sin cambios (OK) | 4 |
| Modificadas | 27 (25 originales + 2 post-auditoría: fn_reporte_ventas_periodo v1.9, fn_listar_productos v2.0) |
| Nuevas funciones creadas | 3 (fn_buscar_productos_pos, fn_catalogo_productos_pos, fn_home_dashboard) |
| 🔴 Bugs críticos corregidos | 12 (8 multi-tenant + 2 race conditions + 1 performance + 1 fix bug variantes POS) |
| 🧹 Limpieza aplicada | 21 (EXCEPTION enmascarador) |
| ⚡ Optimizaciones post-auditoría | 3 (fn_reporte_ventas_periodo: 11→4 queries, fn_listar_productos: subqueries→JOINs, fn_home_dashboard: 9→1 query) |

---

## 📂 Archivos a re-ejecutar en Supabase (orden)

```
 1. docs/clientes/sql/functions/fn_resumir_cuentas_cobrar.sql
 2. docs/inventario/sql/functions/fn_ajustar_stock_inventario.sql
 3. docs/inventario/sql/functions/fn_crear_producto_simple.sql
 4. docs/inventario/sql/functions/fn_crear_producto_con_variantes.sql
 5. docs/usuarios/sql/functions/fn_actualizar_membresia.sql
 6. docs/usuarios/sql/functions/fn_transferir_empleado.sql
 7. docs/caja/sql/functions/fn_abrir_turno.sql
 8. docs/caja/sql/functions/fn_crear_transferencia.sql
 9. docs/caja/sql/functions/fn_registrar_operacion_manual.sql
10. docs/caja/sql/functions/fn_reparar_deficit_turno.sql
11. docs/caja/sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql
12. docs/caja/sql/functions/fn_ejecutar_cierre_diario_v5.sql
13. docs/pos/sql/functions/fn_registrar_venta_pos.sql
14. docs/ventas/sql/functions/fn_anular_venta.sql
15. docs/admin/sql/functions/fn_configurar_modulos_admin.sql
16. docs/admin/sql/functions/fn_consultar_usuario_por_email.sql
17. docs/admin/sql/functions/fn_suspender_usuario.sql
18. docs/movimientos-empleados/sql/functions/fn_pagar_nomina_empleado.sql
19. docs/movimientos-empleados/sql/functions/fn_registrar_adelanto_sueldo.sql
20. docs/onboarding/sql/functions/fn_completar_onboarding.sql
21. docs/onboarding/sql/functions/fn_configurar_modulos.sql
22. docs/recargas-virtuales/sql/functions/fn_pagar_proveedor_celular.sql
23. docs/recargas-virtuales/sql/functions/fn_liquidar_ganancias.sql
24. docs/recargas-virtuales/sql/functions/fn_registrar_compra_saldo_bus.sql
25. docs/recargas-virtuales/sql/functions/fn_registrar_recarga_proveedor_celular.sql
26. docs/ventas/sql/functions/fn_reporte_ventas_periodo.sql           (v1.9 — performance)
27. docs/inventario/sql/functions/fn_listar_productos.sql             (v2.0 — performance)
28. docs/pos/sql/functions/fn_buscar_productos_pos.sql                (v1.0 — nueva)
29. docs/pos/sql/functions/fn_catalogo_productos_pos.sql              (v1.0 — nueva, fix bug variantes)
30. docs/caja/sql/functions/fn_home_dashboard.sql                     (v1.0 — nueva, performance del home)
```

**Total: 30 archivos.** Todos idempotentes (DROP + CREATE OR REPLACE). Se pueden re-ejecutar sin temor.

### Fix del bug variantes en catálogo POS (2026-05-30)

**Bug:** Al filtrar el catálogo del POS por categoría, las variantes no aparecían.

**Causa:** La query directa filtraba `productos.categoria_id = X`, pero en variantes ese campo es NULL (la categoría vive en `producto_templates.categoria_id`). El trigger `fn_limpiar_herencia_template` fuerza ese NULL.

**Fix:** `fn_catalogo_productos_pos` usa `COALESCE(t.categoria_id, p.categoria_id) = p_categoria_id` que cubre ambos casos.
