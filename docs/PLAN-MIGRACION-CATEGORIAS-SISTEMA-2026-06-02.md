# Plan de migración — Separación de categorías de sistema vs. usuario

> Fecha: 2026-06-02
> Estado: **IMPLEMENTADO — 2026-06-02**
> Contexto: 1 solo negocio en BD (entorno de pruebas). Momento ideal para migrar sin riesgo de pérdida de datos masiva.

---

## 1. Problema actual

La tabla `categorias_operaciones` mezcla **dos cosas distintas** en una sola estructura:

| Concepto                  | Ejemplos                                                                                  | ¿Las ve el usuario?          | ¿Varían por negocio?                 | Cantidad     |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ | ------------ |
| **Categorías de sistema** | `Cierre — Ventas del dia`, `Ajuste Diferencia Conteo`, `Salarios`, `Fondo Apertura Turno` | No (`seleccionable = FALSE`) | No — idénticas en todos los negocios | ~14          |
| **Categorías de usuario** | `Compras/Mercaderia`, `Otros Gastos`, `Devoluciones de Proveedores`                       | Sí (`seleccionable = TRUE`)  | Sí — el usuario crea las suyas       | ~9 (semilla) |

### Consecuencias de la mezcla

1. **Duplicidad multi-tenant**: las ~14 categorías de sistema se replican **idénticas** en cada negocio nuevo. Con 1.000 negocios → 14.000 filas que son la misma información conceptual repetida.

2. **Códigos inestables entre negocios**: el trigger `fn_set_codigo_categoria_operacion()` asigna `IN-005`, `EG-013`, etc. **por orden de inserción**. El mismo concepto (`Ajuste Diferencia Conteo`) puede ser `EG-013` en un negocio y `EG-014` en otro si el orden cambia. Las funciones que buscan `WHERE codigo = 'EG-013'` son frágiles.

3. **Búsquedas por nombre frágiles**: 6 funciones SQL buscan categorías de sistema por `WHERE nombre = '...'`. Ya hay un **bug activo en producción**: `fn_ejecutar_cierre_diario` busca `'Cierre Turno — Ventas del dia'` pero `fn_completar_onboarding` la crea como `'Cierre — Ventas del dia'` → la búsqueda retorna `NULL` y el depósito a CAJA se guarda **sin categoría**.

4. **El flag `seleccionable` es un parche**: existe solo para que el frontend filtre las de sistema. Una vez separadas en tablas distintas, **deja de tener sentido** (confirmado: ya no hay mezcla que filtrar).

---

## 2. Arquitectura objetivo

### Decisión de diseño clave: ¿dos FK separadas o columna polimórfica?

Se evaluaron dos opciones para `operaciones_cajas`:

| Opción                                        | Descripción                                                                                                                               | Veredicto                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — Dos FK**                                | `categoria_id` (usuario) + `categoria_sistema_id` (sistema)                                                                               | ❌ Obliga a **dos JOINs embebidos** en cada listado del historial y combinar en frontend. El consumo actual es un único `op.categoria?.nombre` en 3 listados. |
| **B — Columna polimórfica resuelta en vista** | Una sola `categoria_id` + `categoria_origen` (`'USUARIO'` \| `'SISTEMA'`), resuelta vía **vista SQL** que hace `COALESCE` de ambas tablas | ✅ El frontend sigue leyendo un único campo `categoria`. Sin cambios en los 3 templates.                                                                      |

**Se elige la Opción B**, pero refinada para evitar FK polimórfica (que PostgreSQL no soporta nativamente). Ver detalle abajo.

### Estructura final

```
┌─────────────────────────────────┐
│ categorias_sistema  (NUEVA)     │   Global — SIN negocio_id
│ ─────────────────────────────── │   Catálogo fijo, 1 fila por concepto
│ id        UUID PK (FIJO)        │   en TODA la plataforma
│ codigo    VARCHAR UNIQUE        │   Ej: 'CIE-SIN-POS', 'CIE-CON-POS'
│ tipo      VARCHAR(10)           │
│ nombre    VARCHAR(100)          │
│ descripcion TEXT                │
└─────────────────────────────────┘
                 ▲
                 │ FK (categoria_sistema_id)
                 │
┌─────────────────────────────────┐      ┌─────────────────────────────────┐
│ operaciones_cajas               │      │ categorias_operaciones          │
│ ─────────────────────────────── │      │ (SOLO categorías de usuario)    │
│ categoria_id        FK ─────────┼─────▶│ ─────────────────────────────── │
│ categoria_sistema_id FK ────────┐      │ id, negocio_id, tipo, nombre,   │
│                                 │      │ codigo, descripcion, activo     │
│ (exactamente una de las dos)    │      │ ── seleccionable: ELIMINADA ──  │
└─────────────────────────────────┘      └─────────────────────────────────┘
```

**Reglas:**

- `operaciones_cajas` tiene **dos columnas FK** físicas, pero con un **CHECK** que garantiza que solo una está poblada (XOR). Una operación es de usuario *o* de sistema, nunca ambas.
- Una **vista** `v_operaciones_cajas` resuelve la categoría con `COALESCE`, exponiendo un único objeto `categoria` al frontend → **cero cambios en los 3 templates**.
- `categorias_sistema` tiene **UUIDs fijos predefinidos** (constantes en el código), no generados. Las funciones SQL referencian por `codigo` estable o por el UUID constante.
- `categorias_operaciones` pierde la columna `seleccionable` (ya no hay nada que filtrar — toda fila es de usuario).

### Por qué `categorias_sistema` NO tiene `negocio_id`

Es un **catálogo global de la plataforma**. El concepto "Ajuste Diferencia Conteo" es idéntico para todos los negocios. RLS no aplica (es solo-lectura para todos los `authenticated`). Esto elimina por completo la duplicidad.

---

## 3. Catálogo de categorías de sistema (propuesto)

Códigos **semánticos y estables** (no `EG-XXX` autogenerado). UUIDs fijos para referencia directa desde funciones.

| Código nuevo     | Tipo    | Nombre                            | Reemplaza búsqueda actual por     | Usado en                                                            |
| ---------------- | ------- | --------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `CIE-SIN-POS`    | INGRESO | Cierre — Ventas del día           | `nombre = 'Cierre...'` (roto)     | `fn_ejecutar_cierre_diario`                                         |
| `CIE-CON-POS`    | INGRESO | Cierre — Ventas con POS           | `nombre = 'Cierre...'` (roto)     | `fn_ejecutar_cierre_diario`, `fn_listar_cierres_turno`              |
| `AJU-CONTEO-IN`  | INGRESO | Ajuste Diferencia Conteo (sobra)  | `codigo = 'IN-005'`               | `fn_ejecutar_cierre_diario`                                         |
| `AJU-CONTEO-EG`  | EGRESO  | Ajuste Diferencia Conteo (falta)  | `codigo = 'EG-013'`               | `fn_ejecutar_cierre_diario`                                         |
| `DEF-REPONER`    | INGRESO | Reposición Déficit Turno Anterior | `codigo = 'IN-004'`               | `fn_reparar_deficit_turno`, `fn_verificar_transferencia...`         |
| `DEF-RETIRAR`    | EGRESO  | Ajuste Déficit Turno Anterior     | `codigo = 'EG-012'`               | `fn_reparar_deficit_turno`                                          |
| `FONDO-APERTURA` | EGRESO  | Fondo Apertura Turno              | `nombre = 'Fondo Apertura Turno'` | `fn_abrir_turno`                                                    |
| `SALARIOS`       | EGRESO  | Salarios                          | `nombre = 'Salarios'`             | `fn_pagar_nomina_empleado`                                          |
| `ADELANTO`       | EGRESO  | Adelanto Sueldo Empleado          | `nombre = 'Adelanto Sueldo...'`   | `fn_registrar_adelanto_sueldo`                                      |
| `ANULACION`      | EGRESO  | Anulación Venta                   | (verificar uso)                   | `fn_anular_venta`                                                   |
| `PAGO-PROV-CEL`  | EGRESO  | Pago Proveedor Recargas           | `nombre = 'Pago Proveedor...'`    | `fn_pagar_proveedor_celular`                                        |
| `COMPRA-BUS`     | EGRESO  | Compra Saldo Virtual Bus          | `nombre = 'Compra Saldo...'`      | `fn_registrar_compra_saldo_bus`                                     |
| `VENTA-POS`      | INGRESO | Venta POS                         | `codigo = 'IN-001'`               | trigger `fn_actualizar_saldo_caja_venta`, `fn_registrar_pago_fiado` |

> ✅ **`VENTA-POS` — RESUELTO**: La categoría `Ventas` (`IN-001`, `seleccionable=TRUE`) se **elimina** de `categorias_operaciones`. El trigger y `fn_registrar_pago_fiado` usarán `VENTA-POS` de `categorias_sistema`. No tiene sentido exponer al usuario una categoría "Ventas" manual cuando las ventas reales las captura el POS automáticamente — para ingresos manuales el usuario usa "Otros Ingresos" o crea la suya.

---

## 4. Cambios por archivo

### 4.1 Schema (`docs/setup/schema.sql`)

1. **Crear tabla `categorias_sistema`** (sin `negocio_id`, sin trigger de código, con seed de UUIDs fijos).
2. **Seed del catálogo** (las ~13 filas de la sección 3) — se ejecuta una sola vez, global.
3. **Alterar `operaciones_cajas`**:
   - Agregar `categoria_sistema_id UUID REFERENCES categorias_sistema(id)`.
   - Agregar CHECK XOR: `(categoria_id IS NULL) <> (categoria_sistema_id IS NULL)` permitiendo ambas NULL para operaciones sin categoría (APERTURA, transferencias). Forma final: `NOT (categoria_id IS NOT NULL AND categoria_sistema_id IS NOT NULL)`.
   - Índice en `categoria_sistema_id`.
4. **Alterar `categorias_operaciones`**: eliminar columna `seleccionable`.
5. **Crear vista `v_operaciones_cajas`** que resuelve la categoría con COALESCE de ambas tablas (expone objeto `categoria` unificado).
6. **RLS**: `categorias_sistema` → política SELECT para todos los `authenticated` (solo lectura), bloqueo de escritura. NO necesita `superadmin_no_write` (nadie escribe desde el cliente).

### 4.2 Onboarding (`fn_completar_onboarding.sql`)

- **Eliminar** del INSERT las ~14 categorías con `seleccionable = FALSE`.
- **Mantener** solo las de usuario, ahora sin la columna `seleccionable`.

### 4.3 Configuración de módulos (`fn_configurar_modulos.sql`, `fn_configurar_modulos_admin.sql`)

- **Eliminar** la creación de `Pago Proveedor Recargas` y `Compra Saldo Virtual Bus` como categorías por negocio (ahora viven en `categorias_sistema`, ya existen globalmente). El módulo solo crea la **caja**, no la categoría.

### 4.4 Funciones de caja/nómina/recargas

Reemplazar en cada una la búsqueda actual por referencia a `categorias_sistema` (por código semántico estable):

| Función                                                    | Cambio                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `fn_ejecutar_cierre_diario_v5.sql`                         | `v_cat_* := (SELECT id FROM categorias_sistema WHERE codigo = 'CIE-SIN-POS')` etc. + insertar en `categoria_sistema_id` |
| `fn_abrir_turno.sql`                                       | `FONDO-APERTURA` → `categoria_sistema_id`                                                                               |
| `fn_reparar_deficit_turno.sql`                             | `DEF-REPONER` / `DEF-RETIRAR`                                                                                           |
| `fn_verificar_transferencia_caja_chica_hoy.sql`            | `DEF-REPONER`                                                                                                           |
| `fn_listar_cierres_turno.sql`                              | `CIE-CON-POS` / `CIE-SIN-POS`                                                                                           |
| `fn_pagar_nomina_empleado.sql`                             | `SALARIOS`                                                                                                              |
| `fn_registrar_adelanto_sueldo.sql`                         | `ADELANTO`                                                                                                              |
| `fn_pagar_proveedor_celular.sql`                           | `PAGO-PROV-CEL`                                                                                                         |
| `fn_registrar_compra_saldo_bus.sql`                        | `COMPRA-BUS`                                                                                                            |
| `fn_anular_venta.sql`                                      | `ANULACION`                                                                                                             |
| `fn_registrar_pago_fiado.sql`                              | `VENTA-POS` (según decisión punto abierto)                                                                              |
| trigger `fn_actualizar_saldo_caja_venta` (en `schema.sql`) | `VENTA-POS` (según decisión punto abierto)                                                                              |
| `fn_registrar_operacion_manual.sql`                        | **Sin cambio** — recibe `p_categoria_id` del usuario → sigue insertando en `categoria_id`                               |

### 4.5 Frontend

| Archivo                                    | Cambio                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operaciones-caja.service.ts`              | Las 3 queries (`select` con `categoria:categorias_operaciones(...)`) apuntan a la **vista** `v_operaciones_cajas` o usan el JOIN unificado. Eliminar `.eq('seleccionable', true)` de `obtenerCategorias()` (ya no existe la columna; la tabla solo tiene categorías de usuario). |
| `categorias-operaciones.service.ts`        | `getCategorias()` ya no trae las de sistema (no están en la tabla). `crear()` elimina `seleccionable: true`.                                                                                                                                                                     |
| `categoria-operacion.model.ts`             | Eliminar `seleccionable` de la interfaz y del DTO.                                                                                                                                                                                                                               |
| `operacion-caja.model.ts`                  | Sin cambio (la vista expone el mismo objeto `categoria`).                                                                                                                                                                                                                        |
| `categorias-operaciones.page.ts` / `.html` | Eliminar la lógica `if (!categoria.seleccionable) return` y el badge "solo lectura del sistema" — ya no hay categorías de sistema en esta pantalla. **La pantalla pasa a gestionar exclusivamente categorías de usuario.**                                                       |
| `operacion-modal.component.*`              | Sin cambio (ya consumía solo categorías de usuario).                                                                                                                                                                                                                             |

---

## 5. Estrategia de migración de datos (preservar lo existente)

Como hay **1 solo negocio de pruebas**, la migración de datos es trivial pero se documenta el procedimiento correcto:

### Orden de ejecución (transaccional)

```
1. Crear tabla categorias_sistema + seed global (UUIDs fijos)
2. Alterar operaciones_cajas: agregar categoria_sistema_id (nullable, sin CHECK aún)
3. BACKFILL: por cada operación cuya categoria_id apunte a una categoría de sistema
   (las que hoy tienen seleccionable=FALSE), mapear al UUID nuevo de categorias_sistema
   y mover el valor de categoria_id → categoria_sistema_id, dejando categoria_id NULL.
      - Mapeo por nombre/código viejo → codigo nuevo (tabla de equivalencia en la sección 3)
4. Eliminar de categorias_operaciones las filas con seleccionable=FALSE (ya migradas)
5. Eliminar columna seleccionable de categorias_operaciones
6. Agregar el CHECK XOR a operaciones_cajas
7. Crear vista v_operaciones_cajas
8. Reemplazar todas las funciones SQL afectadas
9. NOTIFY pgrst, 'reload schema'
```

> El backfill (paso 3) es lo que **preserva el histórico**: las operaciones de cierre ya registradas siguen apuntando a la categoría correcta, ahora vía `categoria_sistema_id`. Ninguna operación pierde su clasificación.

### Script de verificación post-migración

```sql
-- Ninguna operación debe tener ambas FK pobladas
SELECT count(*) FROM operaciones_cajas
WHERE categoria_id IS NOT NULL AND categoria_sistema_id IS NOT NULL;  -- debe ser 0

-- Ninguna operación de cierre debe quedar sin categoría (corrige el bug actual)
SELECT count(*) FROM operaciones_cajas
WHERE tipo_operacion = 'CIERRE' AND categoria_sistema_id IS NULL;  -- debe ser 0
```

---

## 6. Orden de implementación recomendado

1. **Fase BD** (un solo script `docs/setup/migrations/XXX_categorias_sistema.sql` idempotente):
   schema → seed → backfill → constraints → vista.
2. **Fase funciones SQL**: actualizar las ~12 funciones afectadas (una por archivo, fuente de verdad).
3. **Fase frontend**: modelos → servicios → páginas. Compila el usuario.
4. **Verificación**: scripts de la sección 5 + prueba manual de un cierre completo (con y sin POS).
5. **Documentación**: actualizar `CLAUDE.md` (sección categorías), `docs/caja/3_PROCESO_CIERRE_CAJA.md`, y los README afectados.

---

## 7. Puntos abiertos para tu aprobación

1. ~~**`Ventas` / `IN-001`**~~ — ✅ **RESUELTO**: `VENTA-POS` va a `categorias_sistema`; la categoría `Ventas` se elimina de `categorias_operaciones`.

2. ~~**`Anulacion Venta`**~~ — ✅ **RESUELTO**: confirmado en `fn_anular_venta` línea 195, búsqueda por nombre. Va a `categorias_sistema` con código `ANULACION-VENTA`. El usuario nunca la ve ni la usa manualmente.

3. ~~**Códigos semánticos vs. mantener prefijo**~~ — ✅ **RESUELTO**: códigos semánticos confirmados (`CIE-SIN-POS`, `ANULACION-VENTA`, etc.).

4. ~~**Vista vs. dos JOINs**~~ — ✅ **RESUELTO**: vista `v_operaciones_cajas` confirmada. Los 3 templates del frontend no cambian.

5. ~~**¿Tabla `categorias_sistema` editable por superadmin?**~~ — ✅ **RESUELTO**: catálogo fijo en código, no editable desde UI. Cualquier adición futura es un cambio de código con su migration, no de datos.

---

## 8. Lo que NO cambia

- `fn_registrar_operacion_manual` y todo el flujo de operaciones manuales del usuario (sigue usando `categoria_id`).
- El modelo `OperacionCaja` del frontend (la vista mantiene la forma del objeto `categoria`).
- El pipe `OperacionLabelPipe` y los 3 templates del historial.
- La lógica de negocio del cierre (distribución de efectivo, ajustes, etc.) — solo cambia **de dónde sale el UUID de la categoría**.

---

## 9. Índice de archivos modificados — ejecutar en Supabase

> Todos los archivos SQL deben re-ejecutarse en Supabase SQL Editor en el orden indicado.
> Los archivos de frontend requieren compilación Angular normal.

### Orden de ejecución en Supabase

| # | Archivo | Tipo | Qué cambió |
|---|---------|------|------------|
| 1 | [`docs/setup/migrations/001_categorias_sistema.sql`](docs/setup/migrations/001_categorias_sistema.sql) | **Migration** ⚡ | Script principal: crea tabla `categorias_sistema`, seed con 13 UUIDs fijos, backfill de operaciones existentes, elimina `seleccionable` de `categorias_operaciones`, agrega `categoria_sistema_id` a `operaciones_cajas`, CHECK XOR, RLS, vista `v_operaciones_cajas` |
| 2 | [`docs/onboarding/sql/functions/fn_completar_onboarding.sql`](docs/onboarding/sql/functions/fn_completar_onboarding.sql) | Función | Elimina ~14 categorías de sistema del INSERT; solo inserta categorías de usuario |
| 3 | [`docs/onboarding/sql/functions/fn_configurar_modulos.sql`](docs/onboarding/sql/functions/fn_configurar_modulos.sql) | Función | Elimina creación de `Pago Proveedor Recargas` y `Compra Saldo Virtual Bus` por negocio |
| 4 | [`docs/admin/sql/functions/fn_configurar_modulos_admin.sql`](docs/admin/sql/functions/fn_configurar_modulos_admin.sql) | Función | Ídem anterior (versión superadmin) |
| 5 | [`docs/caja/sql/functions/fn_ejecutar_cierre_diario_v5.sql`](docs/caja/sql/functions/fn_ejecutar_cierre_diario_v5.sql) | Función | Categorías migradas a UUIDs fijos de `categorias_sistema`; INSERTs usan `categoria_sistema_id`; corrige bug de nombre inconsistente |
| 6 | [`docs/caja/sql/functions/fn_abrir_turno.sql`](docs/caja/sql/functions/fn_abrir_turno.sql) | Función | `FONDO-APERTURA` referenciado como UUID constante; INSERT usa `categoria_sistema_id` |
| 7 | [`docs/caja/sql/functions/fn_reparar_deficit_turno.sql`](docs/caja/sql/functions/fn_reparar_deficit_turno.sql) | Función | **Firma cambia**: elimina `p_cat_egreso_id` y `p_cat_ingreso_id` (ahora son constantes internas); INSERTs usan `categoria_sistema_id` |
| 8 | [`docs/caja/sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql`](docs/caja/sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql) | Función | Reemplaza lookup `IN-004` por UUID fijo `DEF-REPONER`; usa `categoria_sistema_id` |
| 9 | [`docs/caja/sql/functions/fn_listar_cierres_turno.sql`](docs/caja/sql/functions/fn_listar_cierres_turno.sql) | Función | UUIDs de ajuste y cierre como CONSTANT; `usa_pos` compara `categoria_sistema_id` |
| 10 | [`docs/movimientos-empleados/sql/functions/fn_pagar_nomina_empleado.sql`](docs/movimientos-empleados/sql/functions/fn_pagar_nomina_empleado.sql) | Función | `SALARIOS` como UUID constante; INSERTs usan `categoria_sistema_id` |
| 11 | [`docs/movimientos-empleados/sql/functions/fn_registrar_adelanto_sueldo.sql`](docs/movimientos-empleados/sql/functions/fn_registrar_adelanto_sueldo.sql) | Función | `ADELANTO` como UUID constante; INSERTs usan `categoria_sistema_id` |
| 12 | [`docs/ventas/sql/functions/fn_anular_venta.sql`](docs/ventas/sql/functions/fn_anular_venta.sql) | Función | `ANULACION-VENTA` como UUID constante; elimina lookup por nombre; INSERT usa `categoria_sistema_id` |
| 13 | [`docs/recargas-virtuales/sql/functions/fn_pagar_proveedor_celular.sql`](docs/recargas-virtuales/sql/functions/fn_pagar_proveedor_celular.sql) | Función | `PAGO-PROV-CEL` como UUID constante; INSERT usa `categoria_sistema_id` |
| 14 | [`docs/recargas-virtuales/sql/functions/fn_registrar_compra_saldo_bus.sql`](docs/recargas-virtuales/sql/functions/fn_registrar_compra_saldo_bus.sql) | Función | `COMPRA-BUS` como UUID constante; INSERT usa `categoria_sistema_id` |

> ⚠️ **`fn_reparar_deficit_turno` cambió su firma** (eliminó 2 parámetros). El frontend que llama a esta función también debe actualizarse — ver sección frontend abajo.

### Archivos de schema actualizados (solo referencia — no re-ejecutar completos)

| Archivo | Qué cambió |
|---------|------------|
| [`docs/setup/schema.sql`](docs/setup/schema.sql) | Nueva tabla `categorias_sistema`, `operaciones_cajas` con `categoria_sistema_id` + CHECK XOR, trigger `fn_actualizar_saldo_caja_venta` usa `VENTA-POS` UUID fijo, `categorias_operaciones` sin columna `seleccionable` |

### Archivos de frontend modificados (requieren compilación)

| Archivo | Qué cambió |
|---------|------------|
| [`src/app/features/caja/models/categoria-operacion.model.ts`](src/app/features/caja/models/categoria-operacion.model.ts) | Eliminado `seleccionable` de `CategoriaOperacion` y `CategoriaOperacionInsert` |
| [`src/app/features/caja/services/categorias-operaciones.service.ts`](src/app/features/caja/services/categorias-operaciones.service.ts) | Eliminado `seleccionable: true` del `crear()` |
| [`src/app/features/caja/services/operaciones-caja.service.ts`](src/app/features/caja/services/operaciones-caja.service.ts) | Eliminado `.eq('seleccionable', true)` de `obtenerCategorias()` |
| [`src/app/features/configuracion/pages/categorias-operaciones/categorias-operaciones.page.ts`](src/app/features/configuracion/pages/categorias-operaciones/categorias-operaciones.page.ts) | Eliminado guard `if (!categoria.seleccionable) return` |
| [`src/app/features/configuracion/pages/categorias-operaciones/categorias-operaciones.page.html`](src/app/features/configuracion/pages/categorias-operaciones/categorias-operaciones.page.html) | Eliminado badge "Sistema" y lógica condicional de `seleccionable` |

### Cambio en llamada al frontend — `fn_reparar_deficit_turno`

La firma cambió de `(UUID, DECIMAL, DECIMAL, UUID, UUID)` a `(UUID, DECIMAL, DECIMAL)`.
Buscar en el frontend la llamada a `fn_reparar_deficit_turno` y eliminar los parámetros `p_cat_egreso_id` y `p_cat_ingreso_id`:

```typescript
// ❌ Antes
await this.supabase.rpc('fn_reparar_deficit_turno', {
  p_empleado_id:    empleadoId,
  p_deficit_varios: deficitVarios,
  p_fondo_apertura: fondoApertura,
  p_cat_egreso_id:  catEgresoId,   // ← eliminar
  p_cat_ingreso_id: catIngresoId,  // ← eliminar
});

// ✅ Ahora
await this.supabase.rpc('fn_reparar_deficit_turno', {
  p_empleado_id:    empleadoId,
  p_deficit_varios: deficitVarios,
  p_fondo_apertura: fondoApertura,
});
```
