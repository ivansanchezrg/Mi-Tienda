# Deploy — Guía de implementación desde cero

Seguí este orden exacto cada vez que recreés la base de datos en Supabase.
Saltearte un paso o hacerlos en orden incorrecto causa errores silenciosos
(datos vacíos, funciones sin permisos, Realtime muerto).

---

## Paso 1 — Schema base

Crea todas las tablas, tipos enum, índices y datos iniciales (cajas, configuraciones, categorías, etc.).

```
docs/schema.sql
```

> Incluye los INSERT de datos iniciales. Ejecutar completo de una sola vez.

---

## Paso 2 — RLS (Row Level Security)

Supabase activa RLS en todas las tablas por defecto. Sin policies, las queries
devuelven `[]` silenciosamente sin dar error. Hay que ejecutar ambos archivos.

**2a — Todas las tablas del proyecto (excepto usuarios):**
```
docs/dashboard/sql/setup/rls_tablas.sql
```

**2b — Tabla usuarios (tiene reglas propias más estrictas):**
```
docs/auth/sql/setup/rls_usuarios.sql
```

> Siempre ejecutar 2a antes que 2b. Son idempotentes (tienen DROP IF EXISTS).

---

## Paso 3 — Trigger de protección superadmin

Impide que se modifique el rol, estado o permisos del administrador principal
desde cualquier UPDATE (no puede ser sorteado desde el frontend).

```
docs/auth/sql/setup/trigger_proteger_superadmin.sql
```

---

## Paso 4 — Constraints adicionales de inventario

Constraints y validaciones para la tabla `producto_presentaciones`.

```
docs/inventario/sql/setup/presentaciones_constraints.sql
```

---

## Paso 5 — Triggers automáticos

Se disparan solos al insertar ventas. Sin ellos el stock no se descuenta
y CAJA_CHICA no se actualiza al vender.

```
docs/pos/sql/triggers/trg_descontar_stock_venta.sql
docs/pos/sql/triggers/trg_actualizar_caja_por_venta.sql
docs/configuracion/sql/triggers/trg_set_codigo_categoria_operacion.sql
docs/configuracion/sql/triggers/trg_set_codigo_categoria_gasto.sql
```

> El orden entre estos cuatro no importa.

---

## Paso 6 — Funciones SQL

Todas las operaciones multi-tabla del sistema. Sin estas funciones el app
no puede procesar ventas, cierres, recargas ni pagos.

### Dashboard
```
docs/dashboard/sql/functions/fn_abrir_turno.sql
docs/dashboard/sql/functions/fn_reparar_deficit_turno.sql
docs/dashboard/sql/functions/fn_registrar_operacion_manual.sql
docs/dashboard/sql/functions/fn_crear_transferencia.sql
docs/dashboard/sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql
docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql
```

### POS
```
docs/pos/sql/functions/fn_registrar_venta_pos.sql
docs/pos/sql/functions/fn_anular_venta.sql
```

### Inventario
```
docs/inventario/sql/functions/fn_generar_codigo_interno.sql
docs/inventario/sql/functions/fn_generar_codigo_interno_presentacion.sql
docs/inventario/sql/functions/fn_ajustar_stock_inventario.sql
```

### Ventas (reportes)
```
docs/ventas/sql/functions/fn_listar_ventas.sql
docs/ventas/sql/functions/fn_resumir_ventas.sql
docs/ventas/sql/functions/fn_reporte_ventas_periodo.sql
```

### Cuentas por cobrar
```
docs/cuentas-cobrar/sql/functions/fn_registrar_pago_fiado.sql
docs/cuentas-cobrar/sql/functions/fn_listar_cuentas_cobrar.sql
docs/cuentas-cobrar/sql/functions/fn_resumir_cuentas_cobrar.sql
```

### Recargas virtuales
```
docs/recargas-virtuales/sql/functions/fn_registrar_recarga_proveedor_celular.sql
docs/recargas-virtuales/sql/functions/fn_registrar_compra_saldo_bus.sql
docs/recargas-virtuales/sql/functions/fn_registrar_pago_proveedor_celular.sql
docs/recargas-virtuales/sql/functions/fn_liquidar_ganancias_bus.sql
```

### Movimientos empleados
```
docs/movimientos-empleados/sql/functions/fn_registrar_adelanto_sueldo.sql
docs/movimientos-empleados/sql/functions/fn_pagar_nomina_empleado.sql
```

### Notas
```
docs/notas/sql/functions/create_notas_table.sql
docs/notas/sql/functions/fn_eliminar_nota.sql
```

> El orden dentro de cada módulo no importa. Entre módulos tampoco,
> salvo que `fn_ejecutar_cierre_diario_v5.sql` depende de que existan
> las demás funciones de dashboard.

---

## Paso 7 — Realtime

Sin esto los canales WebSocket del app quedan muertos y los cambios en BD
no se propagan en tiempo real (hay que refrescar manualmente para verlos).

```
docs/auth/sql/setup/realtime_usuarios.sql          (si existe)
docs/configuracion/sql/setup/realtime_configuraciones.sql
docs/dashboard/sql/setup/realtime_turnos_caja.sql
```

> Después de ejecutarlos, reiniciar el app para que los servicios
> abran canales nuevos (los anteriores apuntan a tablas que ya no existen).

---

## Paso 8 — Migraciones (solo si aplica)

Solo ejecutar si estás actualizando una BD existente, no en deploy desde cero.

```
docs/configuracion/sql/migrations/eliminar_pos_habilitado.sql
docs/inventario/sql/migrations/migration_v9_grupos_variantes.sql
```

---

## Resumen del orden

```
1. schema.sql
2. rls_tablas.sql → rls_usuarios.sql
3. trigger_proteger_superadmin.sql
4. presentaciones_constraints.sql
5. triggers (x4)
6. funciones SQL (x25, cualquier orden)
7. realtime (x3)
8. migraciones (solo si actualización)
```

---

## Errores comunes y su causa

| Síntoma | Causa | Solución |
|---|---|---|
| Saldos en 0, listas vacías, sin error en consola | RLS activo sin policies | Ejecutar paso 2 |
| `relation "v_variable" does not exist` | `SELECT ... INTO var` en función SQL | Usar `:= (SELECT ...)` — ver CLAUDE.md |
| `relation "tabla" is already member of publication` | Realtime ya registrado | El archivo usa `DO $$ IF NOT EXISTS $$` — es idempotente |
| Realtime deja de funcionar después de recrear schema | `DROP TABLE CASCADE` elimina la publicación | Re-ejecutar paso 7 y reiniciar app |
| `Error al verificar tu cuenta` en login | RLS de usuarios mal configurado o sin ejecutar | Ejecutar paso 2b |
| Funciones sin permisos tras reinicio PostgREST | Falta `GRANT EXECUTE ... TO authenticated` | Cada función tiene su propio GRANT al final |
| Stock no se descuenta al vender | Triggers no ejecutados | Ejecutar paso 5 |
