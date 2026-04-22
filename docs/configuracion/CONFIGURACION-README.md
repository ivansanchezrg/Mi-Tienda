# Configuracion — Documentacion del modulo

Modulo de administracion para parametros del negocio, categorias de operaciones de caja
y categorias de productos. Solo accesible para el rol ADMIN.

---

## Estructura de archivos

```
features/configuracion/
├── pages/
│   ├── main/                       # Menu principal de configuracion
│   ├── parametros/                 # Formulario de parametros del negocio
│   ├── categorias-operaciones/     # CRUD de categorias de operaciones de caja
│   └── categorias-productos/       # CRUD de categorias de productos del inventario
├── components/
│   ├── categoria-operacion-modal/  # Modal crear/editar categoria de operacion
│   ├── categoria-producto-modal/   # Modal crear/editar categoria de producto
│   └── logs-modal/                 # Modal visor de logs del dispositivo
├── services/
│   └── configuracion.service.ts    # CRUD tabla configuraciones (sin cache)
├── models/
│   └── configuracion.model.ts      # ConfiguracionRow, Configuracion, ConfiguracionKey
│                                   # + CONFIGURACION_DEFAULTS, mapRowsToConfig() (funcion compartida)
└── configuracion.routes.ts         # Rutas: '' | 'parametros' | 'categorias-operaciones' | 'categorias-productos'

docs/configuracion/
├── CONFIGURACION-README.md
└── sql/
    ├── setup/
    │   └── realtime_configuraciones.sql  # Habilitar Realtime + politica RLS (ejecutar 1 vez)
    └── triggers/
        ├── trg_set_codigo_categoria_gasto.sql
        └── trg_set_codigo_categoria_operacion.sql
```

---

## Tabla BD: `configuraciones`

Tabla clave/valor simple. Cada fila tiene `clave` (PK, TEXT) y `valor` (TEXT).

### Convencion de claves

Prefijo por modulo seguido de guion bajo:

| Prefijo | Modulo | Ejemplo |
|---------|--------|---------|
| `negocio_` | General | `negocio_nombre` |
| `caja_` | Dashboard/Cajas | `caja_fondo_fijo_diario` |
| `bus_` | Recargas Bus | `bus_alerta_saldo_bajo` |
| `pos_` | POS | `pos_descuentos_habilitados` |
| `nomina_` | Movimientos Empleados | `nomina_sueldo_base` |

### Claves actuales

| Clave | Tipo | Default | Descripcion |
|-------|------|---------|-------------|
| `negocio_nombre` | string | `'Mi Tienda'` | Nombre del negocio (header tickets, estado de cuenta) |
| `caja_fondo_fijo_diario` | number | `20` | Fondo fijo que inicia cada turno de caja ($) |
| `caja_varios_transferencia_dia` | number | `20` | Transferencia diaria a caja VARIOS ($) |
| `bus_alerta_saldo_bajo` | number | `75` | Umbral de alerta saldo bajo bus ($) |
| `bus_dias_antes_facturacion` | number | `3` | Dias antes de facturacion para notificar |
| `pos_descuentos_habilitados` | boolean | `false` | Activa/desactiva descuentos automaticos POS |
| `pos_descuento_maximo_pct` | number | `10` | Porcentaje de descuento a aplicar (%) |
| `pos_umbral_monto_descuento` | number | `50` | Monto minimo del subtotal para aplicar descuento ($) |
| `pos_iva_porcentaje` | number | `15` | Tarifa IVA vigente en %. Usado en POS/Factura para extraer base gravada |

> **Nota (2026-04-11):** `pos_habilitado` fue **eliminado** de la tabla. El estado del POS ahora se deriva automaticamente de si hay un turno de caja abierto (`turnos_caja.hora_fecha_cierre IS NULL`) via `TurnosCajaService.cajaAbierta$`. Single Source of Truth — elimina la duplicacion entre `configuraciones` y `turnos_caja`.

---

## Dos servicios, dos propositos

### `ConfigService` (core — lectura con cache)

Ubicacion: `src/app/core/services/config.service.ts`

- **Proposito**: lectura rapida desde cualquier modulo de la app
- **Cache**: en memoria, una sola query por sesion
- **Metodos**: `get()`, `getNombreNegocio()`, `invalidar()`
- **Quien lo usa**: POS (descuentos, IVA), Dashboard (fondo fijo), Recargas (alertas bus), Share tickets (nombre negocio)

```typescript
// Lectura tipada con cache
const config = await this.configService.get();
const nombre = config.negocio_nombre;

// Despues de que el admin guarda cambios:
this.configService.invalidar(); // limpia cache → proxima lectura va a BD
```

> El estado reactivo del POS vive en `TurnosCajaService.cajaAbierta$` — no en `ConfigService`.

### `ConfiguracionService` (feature — CRUD admin)

Ubicacion: `src/app/features/configuracion/services/configuracion.service.ts`

- **Proposito**: lectura y escritura desde la pagina de administracion
- **Sin cache**: siempre consulta BD (el admin necesita ver el valor actual)
- **Metodos**: `get()`, `update(cambios)`
- **Quien lo usa**: solo `ParametrosPage`
- **Mapper compartido**: ambos servicios delegan a `mapRowsToConfig()` exportada desde el modelo. Agregar un campo nuevo = editar solo `configuracion.model.ts`.

```typescript
// Lectura sin cache (admin)
const config = await this.configuracionService.get();

// Escritura con UPSERT
await this.configuracionService.update({
    pos_descuentos_habilitados: true,
    pos_descuento_maximo_pct: 15
});
```

---

## Paginas

### Menu principal (`pages/main/`)

Lista de opciones agrupadas en secciones:

**Seccion General:**

| Opcion | Ruta | Descripcion |
|--------|------|-------------|
| Parametros del Negocio | `/configuracion/parametros` | Formulario de valores del negocio |
| Categorias de Operacion | `/configuracion/categorias-operaciones` | CRUD para clasificar operaciones de caja |
| Categorias de Producto | `/configuracion/categorias-productos` | CRUD para clasificar el catalogo de inventario |

**Seccion Sistema:**

| Opcion | Accion | Descripcion |
|--------|--------|-------------|
| Ver Logs | Modal | Visor de logs del dispositivo (LoggerService) |
| Limpiar Logs | Alert de confirmacion | Elimina todos los logs |

### Parametros del Negocio (`pages/parametros/`)

Formulario reactivo (`FormGroup`) agrupado en secciones visuales. Cada seccion tiene su propio boton "Guardar" que aparece **solo cuando hay cambios pendientes** en esa seccion (comparacion por snapshot con `valueChanges`).

| Seccion | Icono | Campos |
|---------|-------|--------|
| Negocio | `storefront-outline` | Nombre del negocio |
| Caja | `wallet-outline` | Fondo fijo diario, Transferencia diaria VARIOS |
| Bus | `bus-outline` | Alerta saldo bajo, Dias antes facturacion |
| POS | `cart-outline` | Descuentos, Porcentaje, Monto minimo, IVA |

**Comportamiento condicional de la seccion POS**:
- `pos_descuentos_habilitados = OFF` → oculta los campos de porcentaje y monto minimo.
- El campo IVA siempre es visible.

**Flujo de guardado por seccion**:
1. Detecta cambios con `valueChanges` comparando snapshot guardado vs valor actual
2. Aparece boton "Guardar" solo si hay diferencias en esa seccion
3. Valida solo los campos de esa seccion (markAsTouched)
4. `ConfiguracionService.update()` con UPSERT solo de esos campos
5. `ConfigService.invalidar()` → limpia cache global
6. Actualiza snapshot → oculta boton

### Categorias de Operaciones (`pages/categorias-operaciones/`)

CRUD de categorias para clasificar operaciones manuales de caja (INGRESO/EGRESO).

- Segmento: INGRESO / EGRESO (filtra la lista)
- FAB: crear nueva categoria
- Modal `categoria-operacion-modal`: nombre + tipo (INGRESO/EGRESO)
- Categorias del sistema (`es_sistema = true`): no se pueden eliminar ni editar
- Pull-to-refresh

### Categorias de Productos (`pages/categorias-productos/`)

CRUD de categorias para clasificar el catalogo de inventario. Estas categorias son
las que aparecen en los chips de filtro del grid de inventario.

- Lista flat (sin segmentos): todas las categorias activas
- FAB: crear nueva categoria
- Modal `categoria-producto-modal` (bottom-sheet): nombre + toggle activo/inactivo
  - **Modo crear**: solo campo nombre
  - **Modo editar**: nombre + toggle para desactivar
  - No se puede desactivar una categoria que tenga productos activos o desactivados asignados (validacion en el servicio antes de llamar a BD)
- Pull-to-refresh
- Al tocar una categoria: abre modal en modo editar

#### `CategoriaProductoModalComponent`

Ubicacion: `features/configuracion/components/categoria-producto-modal/`

```typescript
// API
@Input() categoria?: CategoriaProducto;  // undefined = modo crear

// Retorna via modalCtrl.dismiss(data, 'confirm')
// data: { nombre: string; activo: boolean }
```

- Se abre como modal estandar (no bottom-sheet) por tener boton de activo/inactivo
- El toggle de `activo` solo aparece cuando `categoria` esta presente (modo editar)
- La pagina padre valida si se puede desactivar antes de llamar a `desactivarCategoria()`

---

## Routing

```typescript
// configuracion.routes.ts
{ path: '',                        component: ConfiguracionPage }
{ path: 'parametros',              component: ParametrosPage }
{ path: 'categorias-operaciones',  component: CategoriasOperacionesPage }
{ path: 'categorias-productos',    component: CategoriasProductosPage }  // ← nuevo

// layout.routes.ts
{ path: 'configuracion', loadChildren: () => CONFIGURACION_ROUTES }
```

Menu sidebar: "Configuracion" con icono `settings-outline`.

---

## Propagacion de cambios

Cuando el admin guarda parametros:

1. `ConfiguracionService.update()` escribe en BD
2. `ConfigService.invalidar()` limpia cache en memoria
3. La proxima lectura va a BD y obtiene el valor nuevo

El POS implementa `ion-refresher` para que el empleado recargue la configuracion de descuentos sin perder el carrito tras un cambio del admin.

### Realtime — tabla `configuraciones`

La tabla sigue publicada en Realtime para propagar cambios entre dispositivos.
Setup ejecutado una sola vez: [`sql/setup/realtime_configuraciones.sql`](./sql/setup/realtime_configuraciones.sql)

**`DisabledTabComponent`** (`shared/components/disabled-tab/`): componente reutilizable para tabs deshabilitadas por estado del sistema (ej: POS sin caja abierta). Recibe `[icon]` (objeto ionicon, NO string — evita tree-shaking en Android), `label` y `disabledMessage` opcional. Muestra el icono con un badge candado en la esquina superior derecha. Al hacer click muestra un toast explicativo en lugar de navegar.
