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
│                                   # + CONFIGURACION_DEFAULTS, mapRowsToConfig() (funcion compartida)
└── configuracion.routes.ts         # Rutas: '' → main, 'parametros', 'categorias-operaciones'

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
| `pos_habilitado` | boolean | `true` | Activa/desactiva el modulo POS completo. Cuando es false oculta POS, Ventas y Caja Chica |
| `pos_descuentos_habilitados` | boolean | `false` | Activa/desactiva descuentos automaticos POS |
| `pos_descuento_maximo_pct` | number | `10` | Porcentaje de descuento a aplicar (%) |
| `pos_umbral_monto_descuento` | number | `50` | Monto minimo del subtotal para aplicar descuento ($) |
| `pos_iva_porcentaje` | number | `15` | Tarifa IVA vigente en %. Usado en POS/Factura para extraer base gravada |

---

## Dos servicios, dos propositos

### `ConfigService` (core — lectura con cache)

Ubicacion: `src/app/core/services/config.service.ts`

- **Proposito**: lectura rapida desde cualquier modulo de la app
- **Cache**: en memoria, una sola query por sesion
- **Metodos**: `get()`, `getNombreNegocio()`, `invalidar()`, `actualizarPosHabilitado(valor)`
- **Realtime**: `posHabilitado$` — `BehaviorSubject<boolean>` que emite cada vez que `pos_habilitado` cambia, ya sea en el mismo dispositivo o en otro via Supabase Realtime
- **Quien lo usa**: POS (descuentos), Dashboard (cierre, fondo fijo), Recargas (alertas bus), Share tickets (nombre negocio), MainLayout y Sidebar (reaccionan a `posHabilitado$`)

```typescript
// Lectura tipada con cache
const config = await this.configService.get();
const nombre = config.negocio_nombre;

// Despues de que el admin guarda cambios:
this.configService.invalidar(); // limpia cache → proxima lectura va a BD

// Suscribirse a cambios de pos_habilitado en tiempo real:
this.posSub = this.configService.posHabilitado$.subscribe(v => this.posHabilitado = v);

// Al guardar la seccion POS (notifica al mismo dispositivo; Realtime notifica a los demas):
this.configService.actualizarPosHabilitado(nuevoValor);
```

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

Lista de opciones de configuracion:

| Opcion | Ruta | Descripcion |
|--------|------|-------------|
| Parametros del Negocio | `/configuracion/parametros` | Formulario de valores de negocio |
| Categorias de Operaciones | `/configuracion/categorias-operaciones` | CRUD de categorias para operaciones de caja |
| Ver Logs | Modal | Visor de logs del dispositivo (LoggerService) |
| Limpiar Logs | Alert | Elimina todos los logs con confirmacion |

### Parametros del Negocio (`pages/parametros/`)

Formulario reactivo (`FormGroup`) agrupado en secciones visuales. Cada seccion tiene su propio boton "Guardar" que aparece **solo cuando hay cambios pendientes** en esa seccion (comparacion por snapshot con `valueChanges`).

| Seccion | Icono | Campos |
|---------|-------|--------|
| Negocio | `storefront-outline` | Nombre del negocio |
| Caja | `wallet-outline` | Fondo fijo diario, Transferencia diaria VARIOS |
| Bus | `bus-outline` | Alerta saldo bajo, Dias antes facturacion |
| POS | `cart-outline` | Toggle POS habilitado, Descuentos, Porcentaje, Monto minimo, IVA |

**Comportamiento condicional de la seccion POS**:
- `pos_habilitado = OFF` → muestra solo el toggle con hint explicativo. Oculta todos los demas campos.
- `pos_habilitado = ON` → muestra todos los campos.
- `pos_descuentos_habilitados = OFF` → oculta los campos de porcentaje y monto minimo.

**Flujo de guardado por seccion**:
1. Detecta cambios con `valueChanges` comparando snapshot guardado vs valor actual
2. Aparece boton "Guardar" solo si hay diferencias en esa seccion
3. Valida solo los campos de esa seccion (markAsTouched)
4. `ConfiguracionService.update()` con UPSERT solo de esos campos
5. `ConfigService.invalidar()` → limpia cache global
6. Si es la seccion POS: `ConfigService.actualizarPosHabilitado()` → notifica al mismo dispositivo de inmediato
7. Actualiza snapshot → oculta boton

**Efectos de `pos_habilitado` en la app** (gestionados por cada modulo al leer `ConfigService`):

| Elemento | Comportamiento cuando POS = OFF |
|----------|--------------------------------|
| Tab "POS" en tab bar | `DisabledTabComponent` — grisado con candado |
| Tab "Ventas" en tab bar | `DisabledTabComponent` — grisado con candado |
| Item "POS" en sidebar | Oculto |
| Item "Ventas" en sidebar | Oculto |
| Caja Chica en home | Oculto |
| Total efectivo en home | Excluye saldo Caja Chica |

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
3. **Mismo dispositivo (seccion POS)**: `ConfigService.actualizarPosHabilitado()` emite en `posHabilitado$` → tab bar y sidebar reaccionan instantaneamente
4. **Otros dispositivos**: Supabase Realtime detecta el UPDATE en `configuraciones` y lo entrega via websocket → `ConfigService` emite en `posHabilitado$` → misma reaccion instantanea sin recargar la app

El POS implementa `ion-refresher` para que el empleado recargue la configuracion de descuentos sin perder el carrito. Para `pos_habilitado` no hace falta — el Realtime lo maneja automaticamente.

### Realtime — configuracion de BD requerida

La propagacion multi-dispositivo requiere dos pasos ejecutados **una sola vez** en Supabase:

```sql
-- 1. Publicar la tabla en el canal Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE configuraciones;

-- 2. Politica RLS para que usuarios autenticados reciban los eventos
CREATE POLICY "authenticated puede leer configuraciones"
ON configuraciones FOR SELECT TO authenticated USING (true);
```

Script completo con verificacion: [`sql/setup/realtime_configuraciones.sql`](./sql/setup/realtime_configuraciones.sql)

### Como funciona el listener en `ConfigService`

- Se abre **una sola conexion websocket** por sesion (canal `config-changes`)
- Filtra solo la clave `pos_habilitado` — no recibe todos los cambios de la tabla
- Al recibir un evento: actualiza el cache en memoria + emite en `posHabilitado$`
- `MainLayoutPage` y `SidebarComponent` se suscriben en `ngOnInit()` y limpian en `ngOnDestroy()`

**`DisabledTabComponent`** (`shared/components/disabled-tab/`): componente reutilizable para tabs deshabilitadas por config. Recibe `[icon]` (objeto ionicon, NO string — evita tree-shaking en Android) y `label`. Muestra el icono con un badge candado en la esquina superior derecha. Usar siempre con `[icon]="iconObj"` desde el componente padre.

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
