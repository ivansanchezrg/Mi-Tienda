# Plan de Refactor — Tabla `negocios` como fuente de verdad del negocio

> Fecha: 2026-06-03
> Estado: **PENDIENTE DE APROBACIÓN**
> Autor: análisis + plan generado en sesión con Claude

---

## 1. Problema actual

Los datos de identidad del negocio están duplicados en dos tablas:

| Campo | `negocios` | `configuraciones` |
|-------|-----------|-------------------|
| Nombre | `nombre` ✅ | `negocio_nombre` ❌ duplicado |
| Teléfono | — | `negocio_telefono` |
| Dirección | — | `negocio_direccion` |
| Datos SRI | — | — (no existen) |

Consecuencias:
- El panel admin y el sidebar leen de `negocios.nombre` (vía JWT)
- Los comprobantes y el WhatsApp leen de `configuraciones.negocio_nombre` (vía `ConfigService`)
- Al editar en Parámetros, solo se actualiza `configuraciones` → desincronización visible

---

## 2. Arquitectura objetivo

### `negocios` — fuente de verdad de identidad del negocio

```sql
CREATE TABLE negocios (
    id                     UUID PRIMARY KEY,
    -- Identidad comercial
    nombre                 VARCHAR(255) NOT NULL,      -- nombre comercial / display
    slug                   VARCHAR(50)  NOT NULL UNIQUE,
    telefono               VARCHAR(20),
    direccion              VARCHAR(200),
    correo_electronico     VARCHAR(100),
    -- Datos SRI (facturación electrónica Ecuador)
    ruc                    VARCHAR(13),
    razon_social           VARCHAR(300),
    nombre_comercial       VARCHAR(300),
    codigo_establecimiento VARCHAR(3)   DEFAULT '001',
    codigo_punto_emision   VARCHAR(3)   DEFAULT '001',
    ambiente_sri           SMALLINT     DEFAULT 1,     -- 1=pruebas, 2=producción
    obligado_contabilidad  BOOLEAN      DEFAULT FALSE,
    -- Control
    propietario_usuario_id UUID NOT NULL,
    created_at             TIMESTAMPTZ  DEFAULT NOW()
);
```

### `configuraciones` — solo parámetros operativos

Eliminar las claves: `negocio_nombre`, `negocio_telefono`, `negocio_direccion`.
Quedan: `caja_varios_activa`, `caja_varios_transferencia_dia`, `recargas_celular_habilitada`, `recargas_bus_habilitada`, `bus_alerta_saldo_bajo`, `bus_dias_antes_facturacion`, `pos_descuentos_habilitados`, `pos_descuento_maximo_pct`, `pos_umbral_monto_descuento`, `pos_iva_porcentaje`, `pos_tipo_comprobante`, `nomina_sueldo_base`, `nomina_dia_pago`.

---

## 3. Inventario de impacto (todos los archivos afectados)

### SQL / Backend

| Archivo | Qué cambia |
|---------|-----------|
| `docs/setup/schema.sql` | Agregar columnas a `negocios` + eliminar `negocio_nombre/telefono/direccion` del seed de `configuraciones` |
| `docs/setup/02_rls.sql` | Nueva política UPDATE en `negocios` para ADMIN del negocio (hoy solo superadmin puede escribir) |
| `docs/onboarding/sql/functions/fn_completar_onboarding.sql` | Escribir `telefono`, `direccion` en `negocios` en lugar de `configuraciones`. Eliminar insert de `negocio_nombre/telefono/direccion` en `configuraciones` |
| Nueva función SQL | `fn_actualizar_datos_negocio(nombre, telefono, direccion, correo, ruc, razon_social, ...)` — `SECURITY DEFINER`, valida rol ADMIN, hace UPDATE en `negocios` |

### Frontend — modelos

| Archivo | Qué cambia |
|---------|-----------|
| `src/app/features/configuracion/models/configuracion.model.ts` | Eliminar `negocio_nombre`, `negocio_telefono`, `negocio_direccion` de la interfaz `Configuracion`, defaults y `mapRowsToConfig()` |
| `src/app/features/auth/models/usuario-actual.model.ts` | Agregar `negocio_telefono?: string`, `negocio_direccion?: string` al modelo `UsuarioActual` (opcional — si se quiere cachear en JWT) |
| `src/app/features/admin/models/negocio-admin.model.ts` | Agregar `telefono`, `direccion`, `correo_electronico`, `ruc`, `razon_social`, etc. al modelo `NegocioAdmin` |

### Frontend — servicios

| Archivo | Qué cambia |
|---------|-----------|
| `src/app/core/services/config.service.ts` | Eliminar `getNombreNegocio()` (ya no necesario — viene del JWT). Limpiar cache de los 3 campos eliminados |
| `src/app/features/configuracion/services/configuracion.service.ts` | Eliminar el UPDATE extra a `negocios` que se agregó hoy. Agregar método `actualizarDatosNegocio()` que llama al nuevo RPC |
| `src/app/features/onboarding/services/onboarding.service.ts` | Ajustar parámetros pasados a `fn_completar_onboarding` |
| `src/app/features/caja/services/share-cierre.service.ts` | Leer `negocio_nombre` de `UsuarioActual.negocio_nombre` (JWT) en lugar de `config.negocio_nombre`. Leer `telefono` del nuevo modelo del negocio |
| `src/app/features/ventas/services/share-venta.service.ts` | Leer `negocio_nombre` de `UsuarioActual.negocio_nombre` en lugar de `config.getNombreNegocio()` |
| `src/app/features/clientes/services/share-estado-cuenta.service.ts` | Igual que share-venta |

### Frontend — páginas y componentes

| Archivo | Qué cambia |
|---------|-----------|
| `src/app/features/configuracion/pages/parametros/parametros.page.ts` | Separar la sección "Negocio" del form: ahora llama a `actualizarDatosNegocio()` en lugar de `configuracionService.update()`. Agregar campos nuevos (correo, RUC, razón social, etc.) |
| `src/app/features/configuracion/pages/parametros/parametros.page.html` | Agregar inputs para los campos SRI (correo, RUC, razón social, nombre comercial, etc.) |
| `src/app/shared/components/sidebar/sidebar.component.ts` | Ya usa `UsuarioActual.negocio_nombre` como fuente primaria — sin cambio de lógica, pero eliminar la llamada a `configService.getNombreNegocio()` |
| `src/app/features/admin/pages/dashboard/admin-dashboard.page.ts` | Agregar los campos nuevos al SELECT de negocios para mostrarlos en el panel |
| `src/app/features/onboarding/pages/negocio/onboarding-negocio.page.ts` | Sin cambio de lógica — los mismos campos, se pasan al servicio igual |

### Comprobantes — datos a agregar

Actualmente los comprobantes (tickets, notas de venta) solo muestran el nombre del negocio. Con los nuevos campos se puede agregar:

| Campo | Comprobante de venta | Estado de cuenta | WhatsApp cierre |
|-------|---------------------|-----------------|-----------------|
| Nombre | ✅ ya está | ✅ ya está | ✅ ya está |
| Teléfono | ➕ agregar | ➕ agregar | ✅ ya está (lee de config — mover fuente) |
| Dirección | ➕ agregar | ➕ agregar | — |
| RUC | ➕ agregar (para FACTURA/NOTA_VENTA) | — | — |
| Razón social | ➕ agregar (para FACTURA/NOTA_VENTA) | — | — |

---

## 4. Fases de implementación

### Fase 1 — BD: extender `negocios` y nueva función SQL
**Archivos:**
- `docs/setup/schema.sql` — agregar columnas a `negocios`
- `docs/setup/02_rls.sql` — política UPDATE para ADMIN
- `docs/configuracion/sql/functions/fn_actualizar_datos_negocio.sql` (nuevo)
- `docs/setup/migrations/002_negocios_datos_identidad.sql` (migration: copiar datos existentes de `configuraciones` → `negocios` y borrar claves migradas)

### Fase 2 — SQL: actualizar funciones existentes
**Archivos:**
- `docs/onboarding/sql/functions/fn_completar_onboarding.sql` — escribir en `negocios` directamente

### Fase 3 — Frontend: modelos y servicios
**Archivos:**
- `configuracion.model.ts` — eliminar 3 campos
- `config.service.ts` — eliminar `getNombreNegocio()`
- `configuracion.service.ts` — nuevo método `actualizarDatosNegocio()`
- `share-cierre.service.ts` — cambiar fuente de nombre y teléfono
- `share-venta.service.ts` — cambiar fuente de nombre
- `share-estado-cuenta.service.ts` — cambiar fuente de nombre
- `onboarding.service.ts` — ajustar parámetros

### Fase 4 — Frontend: páginas y UI
**Archivos:**
- `parametros.page.ts` y `.html` — sección negocio llama nuevo RPC, agregar campos SRI
- `sidebar.component.ts` — limpieza menor (eliminar llamada a getNombreNegocio)
- `admin-dashboard.page.ts` y modelo — agregar campos nuevos al SELECT

### Fase 5 — Comprobantes: agregar datos del negocio
**Archivos:**
- `share-venta.service.ts` — agregar teléfono, dirección, RUC/razón social según tipo comprobante
- `share-estado-cuenta.service.ts` — agregar teléfono, dirección

---

## 5. Puntos de decisión antes de implementar

1. **¿Los campos SRI son todos opcionales (nullable)?** — Sí, hasta que el negocio los configure. No afectan a negocios que solo usan TICKET.

2. **¿`correo_electronico` va en `negocios`?** — Sí, es dato de identidad del negocio (para envío de comprobantes y contacto SRI).

3. **¿`pos_tipo_comprobante` se queda en `configuraciones`?** — Sí, es parámetro operativo (puede cambiar sin tocar datos legales).

4. **¿El sidebar necesita mostrar teléfono/dirección?** — No, solo nombre. El sidebar no cambia de lógica.

5. **¿Los comprobantes de tipo TICKET muestran RUC y razón social?** — No. Solo NOTA_VENTA y FACTURA los necesitan. La lógica en `share-venta.service.ts` ya tiene acceso al `tipo_comprobante` de la venta para condicionar.

6. **¿`negocio_nombre` del JWT se actualiza automáticamente al cambiar el nombre?** — No inmediatamente. El JWT se actualiza en el próximo login o `cambiarNegocio()`. Para la sesión actual, el sidebar ya lee de `ConfigService` primero — con los campos en `negocios`, necesitamos asegurarnos de que el sidebar lea correctamente sin config cache.

---

## 6. Lo que NO cambia

- Tabla `ventas` y sus campos SRI (`secuencial_sri`, `clave_acceso_sri`, etc.) — son datos del comprobante individual, correctos donde están
- `pos_tipo_comprobante` en `configuraciones` — parámetro operativo, se queda
- La lógica de `fn_set_negocio_activo` — solo necesita leer `negocios.nombre` (ya lo hace)
- El modelo `NegocioDisponible` en `AuthService` — ya mapea `negocio_nombre` desde `negocios.nombre`

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| `getNombreNegocio()` llamado desde muchos lados | Búsqueda exhaustiva realizada — solo 3 servicios la usan. Reemplazar por `AuthService.usuarioActualValue?.negocio_nombre` |
| Sidebar muestra nombre vacío si JWT no se actualizó | `fn_set_negocio_activo` ya lee `negocios.nombre` — el JWT siempre tendrá el nombre correcto al cambiar de negocio |
| Datos de negocio perdidos en migración | Script de migration copia datos de `configuraciones` → `negocios` antes de borrarlos |
| RLS bloquea UPDATE en `negocios` para ADMIN | Nueva política en `02_rls.sql` lo resuelve. La función `fn_actualizar_datos_negocio` usa `SECURITY DEFINER` como respaldo adicional |
