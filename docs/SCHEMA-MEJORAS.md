# Schema — Mejoras y Cambios

Revisión profesional del schema.sql.

- Pendientes: marcar con `[x]` al completar.
- Aplicar en orden de prioridad.

---

## 🔴 Prioridad Alta

### 1. Unificar tipo DECIMAL en columnas monetarias

Inconsistencia: `DECIMAL(10,2)` en dos lugares, el resto usa `DECIMAL(12,2)`.

- [x] `gastos_diarios.monto` → cambiar `DECIMAL(10,2)` a `DECIMAL(12,2)`
- [x] `configuraciones.fondo_fijo_diario` → cambiar `DECIMAL(10,2)` a `DECIMAL(12,2)`

---

### 2. Unificar nombre del campo de notas/observaciones

Tres nombres distintos para el mismo concepto. Estandarizar a `observaciones`.

- [x] `recargas.observacion` (singular) → renombrar a `observaciones`
- [x] `recargas_virtuales.notas` → renombrar a `observaciones`
- [x] Actualizar queries/funciones SQL que referencien `observacion` o `notas`
- [x] Actualizar interfaces TypeScript afectadas (`RecargaVirtual`, etc.)
- [x] Actualizar services y componentes Angular que usen esos campos

---

## 🟡 Prioridad Media

### 3. Eliminar `updated_at` sin trigger (o agregar el trigger)

`cajas.updated_at` y `configuraciones.updated_at` se setean solo en el INSERT y nunca se actualizan. El valor es incorrecto desde el primer UPDATE.

**Opción B aplicada — Columna eliminada:**

- [x] Eliminar `cajas.updated_at` del schema + interface `Caja` + `actualizarSaldoCaja()`
- [x] Eliminar `configuraciones.updated_at` del schema + interface `Configuracion` + `update()`

---

### 4. ~~Agregar `created_at` a `turnos_caja`~~ — N/A

`hora_fecha_apertura` ya cumple ese rol: un turno se crea exactamente cuando se abre.
`created_at` fue eliminado deliberadamente en 2026-02-28 por ser redundante.

- [x] N/A — no aplicar

---

### 5. Agregar CHECK a `tipos_servicio.periodo_comision`

El campo acepta cualquier string. Solo debería aceptar `'MENSUAL'` o `'SEMANAL'`.

- [x] Agregar `CHECK (periodo_comision IN ('MENSUAL', 'SEMANAL'))`

---

### 6. Agregar CHECK a `operaciones_cajas.monto`

`gastos_diarios.monto` tiene `CHECK (monto > 0)` pero `operaciones_cajas.monto` no.
Un movimiento con monto cero o negativo pasaría sin error.

- [x] Agregar `CHECK (monto > 0)` a `operaciones_cajas.monto`

---

### 7. Eliminar `tipos_referencia.activo`

Tabla con 4 filas fijas que nunca cambian. `activo` no tiene ningún uso real
y desactivar una referencia no borra los registros que ya la usan.

- [x] Eliminar columna `activo` de `tipos_referencia`
- [x] Verificar que ningún código TypeScript lea `.activo` de esta tabla — confirmado, no se usa

---

### 8. `categorias_operaciones.tipo` → cambiar de TEXT a VARCHAR

El campo usa `TEXT` con un `CHECK` pero el resto del schema usa `VARCHAR`.

- [x] Cambiar `tipo TEXT` a `tipo VARCHAR(10)` en `categorias_operaciones`

---

## 🟢 Prioridad Baja

### 9. ~~Ampliar `empleados.usuario` a VARCHAR(254)~~ — N/A

Google OAuth limita emails a ~40 chars (Gmail: 30 username + @gmail.com). `VARCHAR(50)` es suficiente para este contexto.

- [x] N/A — no aplicar

---

### 10. Renombrar `turnos_caja.hora_cierre` → `hora_fecha_cierre`

Inconsistencia con `hora_fecha_apertura`. Ambas columnas son TIMESTAMPTZ y deberían seguir el mismo patrón de nombre.

Archivos afectados: `schema.sql`, `turno-caja.model.ts`, `turnos-caja.service.ts`, `recargas.service.ts`, `fn_ejecutar_cierre_diario.sql`, `fn_registrar_compra_saldo_bus.sql`, `3_PROCESO_CIERRE_CAJA.md`, `8_PROCESO_ABRIR_CAJA.md`

- [x] `schema.sql` — renombrar columna
- [x] `turno-caja.model.ts` — interface
- [x] `turnos-caja.service.ts` — queries + update
- [x] `recargas.service.ts` — N/A (no usa el campo)
- [x] `fn_ejecutar_cierre_diario.sql` — validación + UPDATE (también removido `updated_at = NOW()` en UPDATE cajas — columna ya eliminada en Task 3)
- [x] `fn_registrar_compra_saldo_bus.sql` — query (también removido `updated_at = NOW()` en UPDATE cajas)
- [x] `3_PROCESO_CIERRE_CAJA.md` + `8_PROCESO_ABRIR_CAJA.md` — docs

---

### 11. Eliminar `tipos_referencia.codigo` — usar `tabla` como identificador

`codigo` ('RECARGAS') y `tabla` ('recargas') eran el mismo dato en distintos formatos.
`tabla` es más legible: `WHERE tabla = 'recargas_virtuales'` es autoexplicativo.
TypeScript nunca usa esta tabla directamente; solo las funciones SQL la consultaban.

- [x] Confirmar que TypeScript no usa `tipos_referencia` — confirmado, 0 referencias
- [x] Eliminar `codigo` de `tipos_referencia` en `schema.sql` (definición + seed INSERT)
- [x] `fn_ejecutar_cierre_diario.sql` → `WHERE tabla = 'caja_fisica_diaria'` / `'recargas'`
- [x] `fn_registrar_compra_saldo_bus.sql` → `WHERE tabla = 'recargas_virtuales'` / `'recargas'`
- [x] `fn_registrar_pago_proveedor_celular.sql` → `WHERE tabla = 'recargas_virtuales'` (+ fix `updated_at` en UPDATE cajas)
- [x] `insertar_datos_reales_recargas.sql` → `WHERE tabla = 'recargas'`

---

## 📝 Notas

### Redundancias intencionales — NO cambiar

Columnas derivadas guardadas deliberadamente para evitar JOINs frecuentes:

| Tabla                            | Columna                | Por qué se guarda                                              |
| -------------------------------- | ---------------------- | -------------------------------------------------------------- |
| `recargas`                       | `saldo_virtual_actual` | Evita recalcular en cada query                                 |
| `recargas_virtuales`             | `ganancia`             | Evita recalcular `monto_virtual - monto_a_pagar`               |
| `recargas_virtuales`             | `pagado`               | Simplifica queries vs chequear `operacion_pago_id IS NOT NULL` |
| `recargas_virtuales`             | `fecha_pago`           | Evita JOIN a `operaciones_cajas`                               |
| `recargas`, `caja_fisica_diaria` | `empleado_id`          | Evita JOIN a `turnos_caja`                                     |
| `recargas`, `caja_fisica_diaria` | `fecha`                | Evita derivar desde `turnos_caja.hora_fecha_apertura`          |

---

## ✅ Historial de cambios aplicados

### 2026-02-28 — Campo `seleccionable` en `categorias_operaciones`

- ✅ Agregado: `seleccionable BOOLEAN DEFAULT TRUE`
  - `TRUE` → categoría manual, aparece en el dropdown del modal de operaciones
  - `FALSE` → categoría del sistema, creada por funciones SQL (solo aparece en historial)
  - Marcadas con `FALSE`: `EG-010`, `EG-011`, `EG-012`, `IN-004`

| Archivo                                | Cambio                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| `docs/schema.sql`                      | Columna `seleccionable` en tabla + seed data              |
| `services/operaciones-caja.service.ts` | `obtenerCategorias()` filtra `.eq('seleccionable', true)` |

> Migración BD existente: `docs/dashboard/sql/queries/agregar_seleccionable_categorias_operaciones.sql`

---

### 2026-02-28 — Limpieza de campos redundantes / innecesarios

#### `turnos_caja`

- ❌ Eliminado: `fecha DATE NOT NULL` (redundante con `hora_fecha_apertura`)
- ❌ Eliminado: `created_at TIMESTAMPTZ DEFAULT NOW()` (redundante)
- ✏️ Renombrado: `hora_apertura` → `hora_fecha_apertura TIMESTAMPTZ NOT NULL`
- ❌ Eliminado: constraint inline `UNIQUE(fecha, numero_turno)`
- ✅ Agregado: `CREATE UNIQUE INDEX idx_turnos_caja_fecha_turno` con cast a fecha local (America/Guayaquil)

#### `tipos_servicio`

- ❌ Eliminado: `fondo_base DECIMAL(12,2)` (ya no aplica al modelo actual)
- ❌ Eliminado: `frecuencia_recarga VARCHAR(20)` (informativo sin uso real)

#### `recargas`

- ❌ Eliminado: `validado BOOLEAN DEFAULT FALSE` (sin función en el flujo)

#### `operaciones_cajas`

- ❌ Eliminado: `created_at TIMESTAMPTZ DEFAULT NOW()` (duplicaba `fecha`)

| Archivo                                                         | Cambio                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `models/turno-caja.model.ts`                                    | Renombrado `hora_apertura` → `hora_fecha_apertura`, eliminados `fecha` y `created_at` |
| `models/operacion-caja.model.ts`                                | Eliminado `created_at`                                                                |
| `services/turnos-caja.service.ts`                               | Filtros por fecha usando rango en `hora_fecha_apertura`, INSERT actualizado           |
| `docs/dashboard/sql/functions/fn_ejecutar_cierre_diario.sql`       | Actualizado                                                                           |
| `docs/dashboard/sql/queries/insertar_datos_reales_recargas.sql` | Actualizado                                                                           |
