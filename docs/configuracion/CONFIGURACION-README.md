# Configuracion — Documentacion del modulo

Modulo de administracion para parametros del negocio y categorias de operaciones de caja.
Solo accesible para el rol ADMIN.

---

## Estructura de archivos

```
features/configuracion/
├── pages/
│   ├── main/                       # Menu principal de configuracion
│   ├── parametros/                 # Formulario de parametros del negocio
│   └── categorias-operaciones/     # CRUD de categorias de operaciones
├── components/
│   ├── categoria-operacion-modal/  # Modal crear/editar categoria
│   └── logs-modal/                 # Modal visor de logs del dispositivo
├── services/
│   └── configuracion.service.ts    # CRUD tabla configuraciones (sin cache)
├── models/
│   └── configuracion.model.ts      # ConfiguracionRow, Configuracion, ConfiguracionKey
└── configuracion.routes.ts         # Rutas: '' → main, 'parametros', 'categorias-operaciones'
```

---

## Tabla BD: `configuraciones`

Tabla clave/valor simple. Cada fila tiene `clave` (PK, TEXT) y `valor` (TEXT).

### Convención de claves

Prefijo por módulo seguido de guion bajo:

| Prefijo | Módulo | Ejemplo |
|---------|--------|---------|
| `negocio_` | General | `negocio_nombre` |
| `caja_` | Dashboard/Cajas | `caja_fondo_fijo_diario` |
| `bus_` | Recargas Bus | `bus_alerta_saldo_bajo` |
| `pos_` | POS | `pos_descuentos_habilitados` |

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

---

## Dos servicios, dos propositos

### `ConfigService` (core — lectura con cache)

Ubicacion: `src/app/core/services/config.service.ts`

- **Proposito**: lectura rapida desde cualquier modulo de la app
- **Cache**: en memoria, una sola query por sesion
- **Metodos**: `get()`, `getNombreNegocio()`, `invalidar()`
- **Quien lo usa**: POS (descuentos), Dashboard (cierre, fondo fijo), Recargas (alertas bus), Share tickets (nombre negocio)

```typescript
// Lectura tipada con cache
const config = await this.configService.get();
const nombre = config.negocio_nombre;

// Despues de que el admin guarda cambios:
this.configService.invalidar(); // limpia cache → proxima lectura va a BD
```

### `ConfiguracionService` (feature — CRUD admin)

Ubicacion: `src/app/features/configuracion/services/configuracion.service.ts`

- **Proposito**: lectura y escritura desde la pagina de administracion
- **Sin cache**: siempre consulta BD (el admin necesita ver el valor actual)
- **Metodos**: `get()`, `update(cambios)`
- **Quien lo usa**: solo `ParametrosPage`

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

Lista de opciones de configuracion:

| Opcion | Ruta | Descripcion |
|--------|------|-------------|
| Parametros del Negocio | `/configuracion/parametros` | Formulario de valores de negocio |
| Categorias de Operaciones | `/configuracion/categorias-operaciones` | CRUD de categorias para operaciones de caja |
| Ver Logs | Modal | Visor de logs del dispositivo (LoggerService) |
| Limpiar Logs | Alert | Elimina todos los logs con confirmacion |

### Parametros del Negocio (`pages/parametros/`)

Formulario reactivo (`FormGroup`) agrupado en secciones visuales por modulo:

| Seccion | Icono | Campos |
|---------|-------|--------|
| Negocio | `storefront-outline` | Nombre del negocio |
| Cajas | `wallet-outline` | Fondo fijo diario, Transferencia diaria VARIOS |
| Recargas Bus | `bus-outline` | Alerta saldo bajo, Dias antes facturacion |
| POS Descuentos | `cart-outline` | Toggle habilitado (ON/OFF), Porcentaje, Monto minimo |

**Toggle de descuentos**: CSS puro (no `ion-toggle`), switch visual OFF gris / ON verde. Los campos de porcentaje y umbral siempre son visibles (el admin configura antes de activar).

**Flujo de guardado**:
1. Valida formulario (todos los campos required, min/max)
2. `ConfiguracionService.update()` con UPSERT
3. `ConfigService.invalidar()` → limpia cache global
4. Los modulos que usen `ConfigService.get()` obtendran los nuevos valores en su proxima lectura

### Categorias de Operaciones (`pages/categorias-operaciones/`)

CRUD de categorias para clasificar operaciones manuales de caja (INGRESO/EGRESO).

- Segmento: INGRESO / EGRESO (filtra la lista)
- FAB: crear nueva categoria
- Modal: nombre + tipo (INGRESO/EGRESO)
- Categorias del sistema (`es_sistema = true`): no se pueden eliminar ni editar
- Pull-to-refresh

---

## Propagacion de cambios

Cuando el admin guarda parametros:

1. `ConfiguracionService.update()` escribe en BD
2. `ConfigService.invalidar()` limpia cache en memoria
3. **Mismo dispositivo**: la proxima llamada a `ConfigService.get()` va a BD
4. **Otro dispositivo** (ej: empleado en POS): debe hacer pull-to-refresh o salir/entrar de la pagina para recargar config

El POS implementa `ion-refresher` para que el empleado recargue la configuracion de descuentos sin perder el carrito.

---

## Routing

```typescript
// configuracion.routes.ts
{ path: '',                        component: ConfiguracionPage }
{ path: 'parametros',              component: ParametrosPage }
{ path: 'categorias-operaciones',  component: CategoriasOperacionesPage }

// layout.routes.ts
{ path: 'configuracion', loadChildren: () => CONFIGURACION_ROUTES }
```

Menu sidebar: "Configuracion" con icono `settings-outline`.
