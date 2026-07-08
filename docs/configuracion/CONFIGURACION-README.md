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
        └── trg_set_codigo_categoria_operacion.sql
```

---

## Tabla BD: `configuraciones`

Tabla clave/valor simple. Cada fila tiene `clave` (PK, TEXT) y `valor` (TEXT).

### Convencion de claves

Prefijo por modulo seguido de guion bajo:

| Prefijo | Modulo | Ejemplo |
|---------|--------|---------|
| `caja_` | Dashboard/Cajas | `caja_varios_transferencia_dia` |
| `recargas_` | Modulos opt-in (superadmin) | `recargas_celular_habilitada` |
| `bus_` | Recargas Bus | `bus_alerta_saldo_bajo` |
| `pos_` | POS | `pos_descuentos_habilitados` |
| `nomina_` | Movimientos Empleados | `nomina_sueldo_base` |

> **Nota (2026-06-03):** El prefijo `negocio_` fue **eliminado**. `negocio_nombre`, `negocio_telefono` y `negocio_direccion` ya NO viven en `configuraciones` — fueron migrados a la tabla `negocios` como columnas propias (`nombre`, `telefono`, `direccion`, más campos SRI). Leerlos de `ConfiguracionService.getDatosNegocio()`, no de `ConfigService`.

### Claves actuales

| Clave | Tipo | Default | Descripcion |
|-------|------|---------|-------------|
| `caja_varios_activa` | boolean | `false` | Si la caja VARIOS esta activa para este negocio. Reversible: el ADMIN la activa/desactiva via `fn_configurar_caja_varios` (desactivar exige saldo $0). |
| `caja_varios_transferencia_dia` | number | `0` | Transferencia diaria a caja VARIOS ($) — solo aplica si `caja_varios_activa = true`. Se conserva al desactivar para facilitar reactivacion. |
| `recargas_celular_habilitada` | boolean | `false` | Habilita el modulo de recargas CELULAR (crea CAJA_CELULAR + categorias). Solo lo activa el superadmin. |
| `recargas_bus_habilitada` | boolean | `false` | Habilita el modulo de recargas BUS (crea CAJA_BUS + categorias). Solo lo activa el superadmin. |
| `bus_alerta_saldo_bajo` | number | `10` | Umbral de alerta saldo bajo bus ($) |
| `bus_dias_antes_facturacion` | number | `3` | Dias antes de facturacion para notificar |
| `pos_descuentos_habilitados` | boolean | `false` | Activa/desactiva descuentos automaticos POS |
| `pos_descuento_maximo_pct` | number | `0` | Porcentaje de descuento a aplicar (%) |
| `pos_umbral_monto_descuento` | number | `0` | Monto minimo del subtotal para aplicar descuento ($) |
| `pos_iva_porcentaje` | number | `15` | Tarifa IVA vigente en %. Usado en POS/Factura para extraer base gravada |
| `nomina_sueldo_base` | number | `0` | Sueldo base mensual de empleados (precarga al pagar nomina) |
| `nomina_dia_pago` | number | `1` | Dia del mes en que se realiza el pago de nomina |

> **Nota (2026-04-11):** `pos_habilitado` fue **eliminado** de la tabla. El estado del POS ahora se deriva automaticamente de si hay un turno de caja abierto (`turnos_caja.hora_fecha_cierre IS NULL`) via `TurnosCajaService.turnoActivo$`/`esMiTurno$`. Single Source of Truth — elimina la duplicacion entre `configuraciones` y `turnos_caja`.

> **Nota (2026-05-01):** `recargas_celular_habilitada` y `recargas_bus_habilitada` reemplazan al flag unificado anterior. Cada modulo es independiente — el superadmin elige cual activar por negocio desde Parametros → Modulos.

> **Nota (2026-05-29):** `caja_fondo_fijo_diario` fue **eliminado**. El fondo del cajón ya no es un valor global: cada empleado declara libremente cuánto deja al abrir caja, y ese valor se guarda en `turnos_caja.fondo_apertura` (por turno). El cierre lo lee directamente del turno.

---

## Dos servicios, dos propositos

### `ConfigService` (core — lectura con cache)

Ubicacion: `src/app/core/services/config.service.ts`

- **Proposito**: lectura rapida desde cualquier modulo de la app
- **Cache en cascada (3 niveles)** desde 2026-05-30:
  1. **RAM** (~0ms) — hit en `cache: Configuracion | null`
  2. **Preferences** (~5-10ms) — snapshot persistido con TTL 1h y `negocio_id` para invalidación cross-tenant automática
  3. **BD** (~200-400ms) — query a Supabase como fallback
- **Stale-while-revalidate**: si sirve del cache persistido, dispara refresh contra BD en background. El próximo `get()` ya tiene el valor fresco en RAM.
- **Reactivo (`config$`, 2026-07-08)**: `BehaviorSubject` que emite en cada carga/refresh del cache. Los consumidores que muestran flags dependientes de config (sidebar, FAB del layout) se suscriben para auto-corregirse cuando llega un valor fresco — sin bloquear su render esperando la BD.
- **`revalidar()` (2026-07-08)**: refresh NO destructivo — trae BD en background y emite en `config$`, **sin borrar** el cache vigente. Reemplaza el patrón "`invalidar()` al montar el layout": aquél forzaba una query bloqueante en cada arranque (con red mala, el sidebar/FAB esperaban segundos). Con `revalidar()`, la UI pinta del cache al instante y se auto-corrige por reactividad. Ver `PERFORMANCE-STARTUP.md` §20.
- **Invalidación**:
  - Automática al cambiar de negocio (snapshot guarda `negocio_id`)
  - Automática en logout (`registerBeforeCleanup` borra la key)
  - Manual con `invalidar()` **solo tras una ESCRITURA** de configuración (parámetros, toggle de módulos del superadmin, descuentos POS, cierre) — ahí el cache local es obsoleto con certeza. Para lecturas de arranque usar `revalidar()`.
- **Metodos**: `get()`, `revalidar()`, `invalidar()`, `config$`
- **Quien lo usa**: POS (descuentos, IVA), Dashboard (transferencia Varios), Recargas (alertas bus), sidebar + layout (flags de módulos via `config$`)
- **Nombre del negocio**: ya NO viene de `ConfigService`. Leer de `authService.usuarioActualValue?.negocio_nombre` (JWT/cache).

```typescript
// Lectura tipada con cache (lee de RAM → Preferences → BD, en ese orden)
const config = await this.configService.get();

// Arranque de una vista que muestra flags de config: pinta del cache + revalida atrás
this.configService.revalidar();
this.configSub = this.configService.config$.subscribe(cfg => { if (cfg) this.aplicarFlags(cfg); });

// Despues de que el admin GUARDA cambios (escritura):
this.configService.invalidar(); // limpia cache RAM + Preferences → proxima lectura va a BD
```

> El cache persistido reduce ~200-400ms del cold start del home. Ver [PERFORMANCE-STARTUP.md](../guides/PERFORMANCE-STARTUP.md#6-cache-persistido-de-configservice-stale-while-revalidate) para detalle.

> El estado reactivo del POS vive en `TurnosCajaService.turnoActivo$`/`esMiTurno$` — no en `ConfigService`.

### `ConfiguracionService` (feature — CRUD admin)

Ubicacion: `src/app/features/configuracion/services/configuracion.service.ts`

- **Proposito**: lectura y escritura desde la pagina de administracion
- **Sin cache**: siempre consulta BD (el admin necesita ver el valor actual)
- **Metodos**: `get()`, `update(cambios)`, `getDatosNegocio()`, `actualizarDatosNegocio(datos)`
- **Quien lo usa**: solo `ParametrosPage`
- **Separación de responsabilidades**:
  - `get()` / `update()` → tabla `configuraciones` (parámetros operativos: flags, montos, umbrales)
  - `getDatosNegocio()` / `actualizarDatosNegocio()` → tabla `negocios` vía RPC (identidad: nombre, teléfono, dirección, RUC, datos SRI)

```typescript
// Parámetros operativos (configuraciones)
const config = await this.configuracionService.get();
await this.configuracionService.update({ pos_descuentos_habilitados: true });

// Datos de identidad del negocio (negocios)
const negocio = await this.configuracionService.getDatosNegocio();
await this.configuracionService.actualizarDatosNegocio({ nombre: 'Nueva Panadería', ruc: '0999999990001' });
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

Formulario reactivo (`FormGroup`) agrupado en secciones visuales. Cada seccion (excepto Modulos) tiene su propio boton "Guardar" que aparece **solo cuando hay cambios pendientes** en esa seccion (comparacion por snapshot con `valueChanges`).

| Seccion | Icono | Campos | Fuente | Visibilidad |
|---------|-------|--------|--------|-------------|
| Negocio | `storefront-outline` | Nombre, Telefono, Direccion, Correo | tabla `negocios` | Todos |
| Datos SRI | `document-text-outline` | RUC, Razon social, Nombre comercial, Cod. establecimiento, Cod. punto emision, Ambiente SRI, Obligado contabilidad | tabla `negocios` | Todos |
| Caja Varios | `archive-outline` | Toggle activar/desactivar + Monto diario a separar | RPC `fn_configurar_caja_varios` | Todos (la BD exige rol ADMIN y bloquea superadmin) |
| Modulos | `apps-outline` | Toggles: Recargas Celular, Recargas Bus | tabla `configuraciones` | **Solo superadmin** |
| Bus | `bus-outline` | Alerta saldo bajo, Dias antes facturacion | tabla `configuraciones` | Solo si `recargas_bus_habilitada` |
| POS | `cart-outline` | Descuentos, Porcentaje, Monto minimo, IVA | tabla `configuraciones` | Todos |
| Nomina | `people-outline` | Sueldo base, Dia de pago | tabla `configuraciones` | Todos |

**Comportamiento condicional de secciones**:
- POS: `pos_descuentos_habilitados = OFF` → oculta los campos de porcentaje y monto minimo. El campo IVA siempre es visible.
- Modulos: los toggles de cada modulo (Celular, Bus) llaman directamente a `fn_configurar_modulos` (sin boton Guardar). La funcion crea las cajas y categorias solo del modulo activado y actualiza los flags correspondientes.
- Caja Varios (2026-06-11 — potestad del admin, antes del superadmin): estado staged — el toggle y el monto se aplican al pulsar Guardar via `fn_configurar_caja_varios`. Desactivar pide confirmacion (`AlertController`); si la caja tiene saldo > 0 la BD bloquea con mensaje claro (toast) y el toggle se revierte. Activar exige monto > 0.
- Bus: la seccion entera depende de `recargas_bus_habilitada`. Si esta OFF, no aparece.

**Flujo de guardado por seccion:**

Secciones **Negocio** y **Datos SRI** (tabla `negocios`):
1. Detecta cambios con `valueChanges` comparando snapshot vs valor actual
2. Aparece boton "Guardar" solo si hay diferencias
3. Valida campos de la seccion (markAsTouched)
4. `ConfiguracionService.actualizarDatosNegocio()` → RPC `fn_actualizar_datos_negocio` (SECURITY DEFINER)
5. Si cambio el nombre → `AuthService.actualizarNombreNegocio()` → actualiza sidebar sin recargar
6. Actualiza snapshot → oculta boton

Resto de secciones (tabla `configuraciones`):
1. Detecta cambios con `valueChanges`
2. Aparece boton "Guardar" solo si hay diferencias
3. Valida campos de la seccion
4. `ConfiguracionService.update()` con UPSERT solo de esos campos
5. `ConfigService.invalidar()` → limpia cache global
6. Actualiza snapshot → oculta boton

### Categorias de Operaciones (`pages/categorias-operaciones/`)

CRUD de categorias de usuario para clasificar operaciones manuales de caja
(INGRESO/EGRESO). Las categorias de sistema (`DEF-RETIRAR`, `DEF-REPONER`, etc.)
viven en la tabla global `categorias_sistema` — nunca aparecen en este listado
ni pasan por este CRUD.

- Toggle Egresos/Ingresos (filtra la lista) — pildora fija bajo el header, mismo
  diseno que el toggle Mensual/Anual de Suscripcion (`.cop-periodo`), color
  `--ion-color-primary` propio del modulo (`border-radius: 8px`)
- FAB: crear nueva categoria
- Modal `categoria-operacion-modal`: tipo (fijo, no editable) + nombre + descripcion
  (opcional) + toggle "Exigir descripcion" (`requiere_descripcion`) + toggle
  activo/inactivo (solo en edicion) + boton "Eliminar categoria" (solo en edicion)
- Eliminar: bloqueado en BD si la categoria ya tiene operaciones registradas
  (`operaciones_cajas.categoria_id` sin `ON DELETE`) — el servicio traduce el
  error de FK (`23503`) a un mensaje claro pidiendo desactivarla en su lugar.
  Sin historial, se borra sin problema.
- Pull-to-refresh

#### `CategoriaOperacionModalComponent`

Ubicacion: `features/configuracion/components/categoria-operacion-modal/`

```typescript
// API
@Input() categoria?: CategoriaOperacion;            // undefined = modo crear
@Input() tipoInicial: 'EGRESO' | 'INGRESO' = 'EGRESO'; // tipo preseleccionado al crear

// Guardar — retorna via modalCtrl.dismiss(data, 'confirm')
// data: CategoriaOperacionInsert (tipo, nombre, descripcion?, requiere_descripcion, activo)

// Eliminar (solo edicion) — pide confirmacion (AlertController) y, si se acepta,
// retorna via modalCtrl.dismiss(null, 'delete'). El borrado real (y la
// traduccion del error de FK) lo hace CategoriasOperacionesService.eliminar()
// en la pagina llamadora — el modal solo confirma la intencion.
```

- El campo `tipo` siempre esta deshabilitado en el form (`form.get('tipo')?.disable()`)
  — viene fijo del segmento activo (crear) o de la categoria existente (editar)
- Boton "Eliminar categoria" solo visible cuando `categoria` esta presente (modo editar)

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

---

## Funciones SQL relacionadas

| Funcion | Donde vive | Quien puede ejecutarla | Que hace |
|---------|-----------|------------------------|----------|
| `fn_completar_onboarding` | `docs/onboarding/sql/functions/` | Cualquier authenticated (con email propio) o superadmin | Crea negocio + 3 cajas base (CAJA, CAJA_CHICA, VARIOS opcional) + categorias + configuraciones iniciales en una sola transaccion. |
| `fn_configurar_caja_varios` | `docs/configuracion/sql/functions/` | Solo ADMIN del negocio (superadmin bloqueado) | Activa/desactiva la Caja Varios (reversible). Activar: crea o reactiva la caja + flag + monto. Desactivar: exige saldo $0 y pone `cajas.activo = FALSE` conservando historial. Parametros: `p_activar BOOLEAN`, `p_monto DECIMAL`. |
| `fn_configurar_modulos` | `docs/onboarding/sql/functions/` | Solo superadmin (desde dentro del negocio) | Habilita los modulos CELULAR y/o BUS. Crea las cajas y categorias del modulo activado y actualiza los flags. Parametros: `p_celular BOOLEAN`, `p_bus BOOLEAN`. |
| `fn_configurar_modulos_admin` | `docs/admin/sql/functions/` | Solo superadmin (desde `/admin`) | Igual que `fn_configurar_modulos` pero opera sobre un negocio especificado por parametro, sin necesitar JWT del negocio. |

> Los flags `recargas_celular_habilitada`, `recargas_bus_habilitada` y `caja_varios_activa` se leen via `ConfigService.get()` desde el dashboard, sidebar, paginas de recargas e historial para ocultar UI y saltear queries de modulos inactivos.
