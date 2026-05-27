# Caja Feature

Feature principal de la app. Contiene el panel de inicio y las operaciones diarias de caja.

---

## Páginas

### Home (`pages/home/`)

Panel principal con 4 secciones:

| Sección             | Descripción                                                       | Visible                      |
| ------------------- | ----------------------------------------------------------------- | ---------------------------- |
| Estado Banner       | Indicador verde/rojo si la caja está abierta o cerrada            | Siempre                      |
| Saldos              | Lista con saldos de Tienda, Varios, Celular, Bus + total efectivo | Siempre                      |
| Caja Chica          | Saldo del cajón diario (CAJA_CHICA)                               | Solo si caja abierta         |
| Operaciones Rápidas | Botones de Ingreso, Egreso, Transferir, Gasto                     | Solo caja abierta            |
| Cuadre de Caja      | Acceso rápido para iniciar un cuadre                              | Solo caja abierta            |
| Cierre Diario       | Botón para cerrar o abrir el día                                  | Siempre                      |

**Estado "caja abierta"** se lee de `TurnosCajaService.cajaAbierta$` (derivado reactivo de `turnoActivo$`). Cuando no hay turno activo: oculta la fila de Caja Chica y la excluye del cálculo de Total Efectivo. Ver [Estado reactivo de turno](#estado-reactivo-de-turno--single-source-of-truth) más abajo.

**Saldos en tiempo real:** Los saldos de las cards de cajas se actualizan automáticamente vía Supabase Realtime (`CajasService.cajas$`) — sin recargar la página ni emitir queries adicionales. Ver [Realtime — tabla cajas](#realtime--tabla-cajas) más abajo.

**Widget de movimientos del día:**
- Muestra los **últimos 5 movimientos** del día (todas las cajas, excluye APERTURA/CIERRE).
- Botón de refresh `↺` junto al título recarga solo esa sección (skeleton parcial, sin afectar el resto del home).
- Si `totalMovimientosHoy > 5`, aparece un footer **"Ver los N movimientos →"** que abre `MovimientosHoyModalComponent` con el historial completo paginado.
- Al volver de cualquier subpágina (`ionViewWillEnter`), los movimientos se refrescan automáticamente. Los saldos no se re-fetchean — Realtime ya los mantiene actualizados.

**Datos:** Conectado a Supabase mediante servicios.

**Notificaciones:** `NotificacionesService.getNotificaciones()` se llama al cargar y muestra un badge con el total de alertas activas. Tipos posibles: `DEUDA_CELULAR`, `SALDO_BAJO_BUS`, `FACTURACION_BUS_PENDIENTE`, `FACTURACION_BUS_PROXIMA`, `STOCK_BAJO`. Ver detalle en [RECARGAS-VIRTUALES-README.md](../recargas-virtuales/RECARGAS-VIRTUALES-README.md#notificaciones-bus-en-home).

El modal de notificaciones (`NotificacionesModalComponent`) soporta un ítem expandible para `STOCK_BAJO`: si hay 1 producto navega directo a su Kárdex; si hay 2+ despliega la lista con acceso individual a cada producto.

**Documentación completa:** Ver [8_PROCESO_ABRIR_CAJA.md](./8_PROCESO_ABRIR_CAJA.md)

---

### Cierre Diario (`pages/cierre-diario/`)

Wizard de **2 pasos** para cerrar el día (v5 — 2026-03-06):

**Paso 1 — Datos del Turno (3 inputs):**
- Saldo virtual celular final (input)
- Saldo virtual bus final (input)
- Efectivo contado en cajón (input `.destacado`)
- Feedback en tiempo real: ventas calculadas, diferencia de conteo, alertas
- Bloquea "Ver Resumen" si algún campo es inválido o hay ventas negativas

**Paso 2 — Resumen y Confirmación:**
- **Card "Conteo del Cajón"** siempre visible (el cierre requiere turno abierto, siempre hay cajón que conciliar)
- Distribución del cajón: desglose efectivo → VARIOS → CAJA; cajón queda en $0
- Alerta de déficit si VARIOS no recibió su fondo hoy
- Verificación antes→después de los 4 saldos: Tienda, Varios, Celular, Bus
- Observaciones opcionales + botón "Cerrar Caja"

**Sincronización del estado POS tras cierre:**
Al finalizar con éxito, la página llama a `TurnosCajaService.refrescarTurnoActivo()` **antes** de navegar. Esto sincroniza `turnoActivo$` de inmediato para que tabs/sidebar/home deshabiliten el POS sin esperar al round-trip del evento Realtime UPDATE sobre `turnos_caja`.

**Patrones utilizados:**
- `ScrollResetDirective` para scroll al top al cambiar de paso
- `PendingChangesGuard` para prevenir salida accidental con datos sin guardar
- `CurrencyService` para parseo inteligente de moneda
- `TurnosCajaService.refrescarTurnoActivo()` para sincronización proactiva post-cierre
- `UiService` para loading y toasts

**Documentación completa:** Ver [3_PROCESO_CIERRE_CAJA.md](./3_PROCESO_CIERRE_CAJA.md)

---

### Recargas Virtuales

> ⚠️ **Movido a feature independiente:** `src/app/features/recargas-virtuales/`
> La ruta `/caja/recargas-virtuales` carga el componente desde `features/recargas-virtuales/pages/recargas-virtuales/` — solo cambió la ubicación física de los archivos.
> **Documentación completa:** Ver [RECARGAS-VIRTUALES-README.md](../recargas-virtuales/RECARGAS-VIRTUALES-README.md)

---

### Cuadre de Caja (`pages/cuadre-caja/`)

Calculadora visual para verificar efectivo físico esperado (NO guarda en BD).

**Características:**

- 🧮 **Solo calculadora** - NO guarda nada en base de datos
- 📱 **Saldos virtuales** Celular y Bus
- 💰 **Calcula efectivo esperado** basado en comisiones
- 🔄 **Usa saldos anteriores** del último cierre como base
- ⚡ **Verificación instantánea** sin afectar datos

**Flujo:**

1. Usuario ingresa saldos virtuales actuales (Celular y Bus)
2. Sistema calcula: `efectivo_esperado = ventas_celular + ventas_bus`
3. Muestra resultado visual
4. NO se guarda nada (solo vista informativa)

**Diferencia con Cierre Diario:**

- Cuadre: Solo calcula y muestra (ilimitado)
- Cierre: Guarda en BD, actualiza cajas, crea operaciones (1 vez por turno)

**Documentación completa:** Ver [4_PROCESO_CUADRE_RECARGAS.md](./4_PROCESO_CUADRE_RECARGAS.md)

---

### Historial Recargas (`pages/historial-recargas/`)

Historial completo de recargas registradas con filtros.

**Características:**

- Lista agrupada por fecha con scroll infinito
- Filtros por servicio (Todas, Celular, Bus)
- Pull-to-refresh para actualizar datos

**Fuentes de datos — dos tablas distintas:**

| Tipo en UI | Tabla | Quién escribe |
|---|---|---|
| `CIERRE` | `recargas` | `fn_ejecutar_cierre_diario` (pasos 13 y 14) — un registro CELULAR + uno BUS por cada cierre de turno |
| `CARGA_VIRTUAL` | `recargas_virtuales` | `fn_registrar_recarga_proveedor_celular`, `fn_registrar_compra_saldo_bus` |

La página combina ambas fuentes en `HistorialRecargasPage.cargarHistorial()` con `Promise.all` y las ordena por `created_at` descendente antes de agrupar por fecha.

> Ver flujo completo en [RECARGAS-VIRTUALES-README.md](../recargas-virtuales/RECARGAS-VIRTUALES-README.md#base-de-datos).

---

### Operaciones de Caja (`pages/operaciones-caja/`)

Historial de movimientos por caja con diseño híbrido (Home pattern + empresarial/bancario).

**Características:**

- 💰 **Balance card** con saldo disponible y resumen de entradas/salidas
- 🔍 **Filtros sticky** (Hoy, Semana, Mes, Todo) estilo bancario
- 📜 **Scroll infinito** con agrupación por fecha
- 📱 **Header dinámico** - saldo aparece al hacer scroll
- 🎨 **Diseño adaptativo** dark/light mode
- 🔒 **Restricción de turno ajeno:** si se navega a Caja Chica con turno activo de otro empleado (`turnoAjeno=true` en query params), el `⋮` del header queda deshabilitado. La función SQL también lo rechaza como última línea de defensa.
- 👤 **Menú por rol:** CELULAR y BUS solo muestran el `⋮` a usuarios con rol `ADMIN`. Para empleados el menú está oculto. El rol se lee desde `AuthService.getUsuarioActual()` (Preferences, sin consulta a BD).

**Documentación completa:** Ver [1_OPERACIONES-CAJA.md](./1_OPERACIONES-CAJA.md)

---

---

## Componentes Modales

### Registrar Recarga / Pagar Deudas / Liquidación Bus / Historial Modal

> ⚠️ **Movidos a** `src/app/features/recargas-virtuales/components/`

---

### Movimientos Hoy Modal (`components/movimientos-hoy-modal/`)

Modal de historial completo de movimientos del día (todas las cajas). Se abre desde el footer del widget "MOVIMIENTOS DE HOY" cuando hay más de 5 movimientos.

**Características:**
- Lista paginada con botón "Cargar más" (sin `ion-infinite-scroll` — no funciona fuera de `ion-content`)
- Mismo estilo visual que el widget del home: iconos de color por tipo, meta-info (caja, motivo, empleado, hora)
- Botón de comprobante visible solo si el movimiento tiene imagen adjunta
- Skeleton de 5 filas en primera carga
- Empty state si no hay movimientos
- `totalMovimientosHoy` se pasa como `@Input()` desde el home (sin re-fetch)

**Apertura desde home:**
```typescript
const modal = await this.modalCtrl.create({
  component: MovimientosHoyModalComponent,
  componentProps: { totalMovimientosHoy: this.totalMovimientosHoy },
  cssClass: 'bottom-sheet-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1,
});
await modal.present();
```

**Servicio usado:** `OperacionesCajaService.obtenerMovimientosHoy(page)` — método dedicado sin filtro de caja, paginado con `pageSize` de `PAGINATION_CONFIG.operacionesCaja`.

---

### Operación Modal (`components/operacion-modal/`)

Modal genérico para registrar operaciones de Ingreso/Egreso/Transferencia.

**Características:**

- 💰 **Tipo de operación** configurable
- 📋 **Categorías contables** según tipo
- 📸 **Comprobantes** opcionales u obligatorios según categoría
- 💸 **Actualización automática** de saldos de cajas

**Documentación completa:** Ver [2_PROCESO_INGRESO_EGRESO.md](./2_PROCESO_INGRESO_EGRESO.md)

---

## Rutas

```
/caja                        → HomePage
/caja/operaciones-caja       → OperacionesCajaPage
/caja/cuadre-caja            → CuadreCajaPage
/caja/cierre-diario          → CierreDiarioPage (con pendingChangesGuard)
/caja/recargas-virtuales     → RecargasVirtualesPage
/caja/pagar-deudas           → PagarDeudasPage
```

---

## Estado reactivo de turno — Single Source of Truth

Desde 2026-04-11 el estado "POS habilitado" ya **no** vive en `configuraciones.pos_habilitado` (eliminado). Ahora se deriva automáticamente de si hay un turno de caja abierto.

### TurnosCajaService como fuente única

`TurnosCajaService` expone dos observables de estado que todo el resto de la app consume:

```typescript
turnoActivo$: Observable<TurnoCaja | null>     // turno completo o null
cajaAbierta$: Observable<boolean>              // derivado: turnoActivo !== null
turnoActivoValue: TurnoCaja | null             // valor sincrono (para guards)
```

**Arranque del servicio:**
- Instanciado en `AppComponent` via `inject(TurnosCajaService)` porque `providedIn: 'root'` es lazy y necesitamos que el constructor corra al bootstrap.
- El constructor se suscribe a `AuthService.usuarioActual$` y llama `inicializarEstadoReactivo()` al login / `cerrarRealtimeTurnos()` al logout. Se registra en `SupabaseService.registerBeforeCleanup` para limpiar canales antes del sign out.
- Inversión de dependencia: no es `AuthService` quien llama a `TurnosCajaService` (evita ciclo), sino al revés.

**Realtime:**
- Canal `turnos-caja-global` filtrado por `hora_fecha_cierre IS NULL`.
- `INSERT` → si el turno creado está abierto, refresca `turnoActivo$`.
- `UPDATE` → si el turno en curso se cerró, emite `null`.
- `DELETE` → si es el turno actual, emite `null`.
- Requiere `REPLICA IDENTITY FULL` sobre la tabla + política RLS de SELECT — ver [`sql/setup/realtime_turnos_caja.sql`](./sql/setup/realtime_turnos_caja.sql).

**Sincronización proactiva (evita flash de UI incorrecta):**
- `abrirTurno()` llama `refrescarTurnoActivo()` tras éxito.
- `repararDeficit()` (apertura atómica + ajuste) también.
- `CierreDiarioPage` llama `refrescarTurnoActivo()` tras `fn_ejecutar_cierre_diario`.

De esta forma la UI reacciona instantáneamente sin esperar el round-trip del evento Realtime.

### Consumidores del estado

| Elemento | Comportamiento cuando NO hay turno activo |
|----------|-------------------------------------------|
| Tab "POS" en tab bar | `DisabledTabComponent` — grisado con candado, click muestra toast |
| Item "POS" en sidebar | Oculto |
| Caja Chica en home | Oculto |
| Total efectivo en home | Excluye saldo Caja Chica |
| Ruta `/pos` (URL directa) | Bloqueada por `cajaAbiertaGuard` → redirige a `/caja` con toast |

**Nota:** el tab "Ventas" y su sidebar item son **siempre visibles** — el historial de ventas no requiere caja abierta.

### Guard de ruta: `cajaAbiertaGuard`

Ubicación: `src/app/core/guards/caja-abierta.guard.ts`

```typescript
canActivate: [cajaAbiertaGuard]
```

- Lee `turnoActivoValue` (O(1), sin query).
- Fallback: primer valor del `turnoActivo$` si el BehaviorSubject aún no emitió.
- Si no hay turno → toast + redirección a `/caja`.
- Protege `/pos` de deep-links, historial de navegación o URLs directas.

---

## Realtime — tabla `cajas`

Los saldos del home se sincronizan en tiempo real via Supabase Realtime. Cualquier cambio en `saldo_actual` (ingreso, egreso, traspaso, cierre) se propaga a todos los dispositivos conectados sin query adicional.

### Setup SQL (ejecutar una sola vez en Supabase)

Archivo: [`sql/setup/realtime_cajas.sql`](./sql/setup/realtime_cajas.sql)

```sql
-- 1. Publicar tabla en el canal Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE cajas;

-- 2. REPLICA IDENTITY FULL — entrega la fila completa en UPDATE (no solo columnas modificadas)
ALTER TABLE cajas REPLICA IDENTITY FULL;

-- 3. Política RLS SELECT para que Realtime respete aislamiento multi-tenant
CREATE POLICY "authenticated puede leer cajas" ON cajas FOR SELECT TO authenticated USING (true);
```

> **Nota:** Si se re-ejecuta `schema.sql` (reset completo), hay que volver a ejecutar este archivo — `DROP TABLE ... CASCADE` elimina la publicación y la política RLS automáticamente.

### Flujo en el cliente (`CajasService`)

```
Supabase Realtime UPDATE en cajas
  → CajasService recibe el evento
  → Actualiza cajas$ (BehaviorSubject)
  → HomePage.ngOnInit() está suscrito a cajas$
  → Actualiza saldoCaja, saldoCajaChica, etc. + totalSaldos
  → cdr.markForCheck() — Angular re-renderiza las cards
```

**Qué eventos propaga:**
| Evento | Cuándo ocurre |
|--------|---------------|
| `UPDATE` | Ingreso, egreso, traspaso, apertura de turno, cierre diario |
| `INSERT` | Creación de caja custom desde `NuevaCajaModalComponent` |
| `UPDATE (activo=false)` | Desactivación de caja (aún no implementado en UI) |

**Por qué `REPLICA IDENTITY FULL`:** sin esto, Supabase solo envía las columnas que cambiaron en el UPDATE. `CajasService` necesita la fila completa (id, nombre, código, saldo_actual, color, icono) para reconstruir el estado.

### Limpieza de canales

`CajasService` cierra el canal Realtime en `ngOnDestroy` del componente que lo usa, o via `SupabaseService.registerBeforeCleanup()` al hacer sign out.

---

## Servicios

| Servicio                 | Archivo                                                | Descripción                                         |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------- |
| RecargasService          | `caja/services/recargas.service.ts`               | Operaciones de cierre diario, historial de recargas |
| CajasService             | `caja/services/cajas.service.ts`                  | Operaciones de cajas, transferencias, saldos        |
| OperacionesCajaService   | `caja/services/operaciones-caja.service.ts`       | Consulta de operaciones con filtros y paginación    |
| TurnosCajaService        | `caja/services/turnos-caja.service.ts`            | Gestión de turnos de caja + estado reactivo global (`turnoActivo$`, `cajaAbierta$`) |
| NotificacionesService    | `core/services/notificaciones.service.ts` ⬆️           | Agrega y expone todas las notificaciones de la app  |
| RecargasVirtualesService | `recargas-virtuales/services/recargas-virtuales.service.ts` | Gestión de saldo virtual, deudas, liquidaciones     |
| GananciasService         | `recargas-virtuales/services/ganancias.service.ts`          | Cálculo y verificación de ganancias mensuales BUS   |
> `NotificacionesService` vive en `core/services/` — usado por caja e inventario. `RecargasVirtualesService` y `GananciasService` viven en `features/recargas-virtuales/services/`.

---

## Dependencias Core

| Archivo                                         | Uso                                           |
| ----------------------------------------------- | --------------------------------------------- |
| `core/services/ui.service.ts`                   | Loading, toasts y alertas en toda la app      |
| `core/services/currency.service.ts`             | Parseo y formato de montos                    |
| `core/services/storage.service.ts`              | Subida de imágenes a Supabase Storage         |
| `core/guards/pending-changes.guard.ts`          | Protege cierre-diario de salidas accidentales |
| `shared/directives/scroll-reset.directive.ts`      | Resetea scroll al top entre pasos de wizards  |
| `shared/directives/currency-input.directive.ts`    | Formato automático en inputs de moneda        |
| `shared/directives/numbers-only.directive.ts`      | Solo permite números en inputs                |
| `shared/directives/horizontal-scroll.directive.ts` | Wheel vertical → scroll horizontal en grid de cajas (desktop) |

---

## Documentación Relacionada

### Procesos de Negocio (Orden recomendado)

1. **[1_OPERACIONES-CAJA.md](./1_OPERACIONES-CAJA.md)** - Historial de movimientos por caja, filtros, diseño híbrido y scroll infinito
2. **[2_PROCESO_INGRESO_EGRESO.md](./2_PROCESO_INGRESO_EGRESO.md)** - Sistema completo de operaciones con categorías contables y comprobantes fotográficos
3. **[3_PROCESO_CIERRE_CAJA.md](./3_PROCESO_CIERRE_CAJA.md)** - Flujo completo del cierre diario, arquitectura del sistema de 4 cajas, validaciones y trazabilidad
4. **[4_PROCESO_CUADRE_RECARGAS.md](./4_PROCESO_CUADRE_RECARGAS.md)** - Calculadora de verificación de efectivo (solo vista, no guarda)
5. **[5_ACTUALIZACION-UI-SIN-RECARGA.md](./5_ACTUALIZACION-UI-SIN-RECARGA.md)** - Patrón de actualización de UI post-operación (cargarDatos) y gotcha de Supabase INSERT/UPDATE devuelve data:null
6. **[RECARGAS-VIRTUALES-README.md](../recargas-virtuales/RECARGAS-VIRTUALES-README.md)** - Sistema completo de gestión de saldo virtual (CELULAR/BUS), deudas, liquidaciones y comisiones
7. ~~**GASTOS-DIARIOS-README.md**~~ — **ELIMINADO en v5** (2026-03-06). Los gastos operativos se registran como EGRESO desde CAJA_CHICA en `operacion-modal`.
8. **[8_PROCESO_ABRIR_CAJA.md](./8_PROCESO_ABRIR_CAJA.md)** - Flujo de apertura de turno, modal de verificación de fondo, estados del banner y tabla turnos_caja

### Otros Recursos

- **[Schema de Base de Datos](../schema.sql)** - Estructura completa de tablas, índices y datos iniciales
- **[SQL Queries](./sql/)** - Funciones PostgreSQL y queries comunes

---

## Patrones de Diseño Utilizados

### Ultra-Simplified UX (v4.0)

- Reducir input del usuario al mínimo (1 campo cuando sea posible)
- Sistema calcula todo lo demás desde configuración
- Guías visuales para acciones físicas

### Configuration-Driven Design

- Constantes centralizadas en tabla `configuraciones`
- Fácil modificación sin redeploy
- Claves con prefijo por módulo: `caja_fondo_fijo_diario`, `bus_alerta_saldo_bajo`, `pos_descuentos_habilitados`, `pos_iva_porcentaje`
- El estado "POS habilitado" ya **no** es una configuración: se deriva automáticamente de `turnos_caja` via `TurnosCajaService.cajaAbierta$` (ver [Estado reactivo de turno](#estado-reactivo-de-turno--single-source-of-truth))

### Transactional PostgreSQL Functions

- Operaciones multi-tabla usando funciones PostgreSQL
- Atomicidad garantizada (all or nothing)
- Uso: `supabase.client.rpc('function_name', params)`

### Modales para Flujos Complejos

- Wizards paso a paso con navegación clara
- Verificación final antes de confirmar
- PendingChangesGuard en páginas críticas

### Optimización de Imágenes

- Capacitor Camera con `width/height` límites
- Quality 80%, max 1200x1600px
- Resultado: 200-500 KB vs 3-10 MB originales

---

## Notas Importantes

### Date Handling

- **NUNCA usar** `new Date().toISOString()` (da UTC, zona horaria incorrecta)

- **SIEMPRE usar** `getFechaLocal()` desde `@core/utils/date.util`:

  ```typescript
  import { getFechaLocal } from '@core/utils/date.util';

  // Uso:
  const fecha = getFechaLocal(); // → '2026-02-26'
  ```

### Gestión de Iconos

- Importar desde `ionicons/icons`
- Registrar con `addIcons()` en constructor
- **CRITICAL:** No eliminar iconos sin verificar uso en templates HTML
- Iconos en `[name]` bindings no se detectan en imports TypeScript

### PostgreSQL Functions

- Usar `SECURITY DEFINER` para permisos persistentes
- `SET search_path = public` para resolución explícita de schema
- `GRANT EXECUTE` explícito a roles `authenticated` y `anon`
- `NOTIFY pgrst, 'reload schema'` para refrescar cache de PostgREST
- Consultar MEMORY.md para más detalles sobre persistencia de funciones

---

## Estado del Proyecto

**Última actualización:** 2026-05-26 — **v5.6** (Realtime en tabla `cajas`; widget movimientos rediseñado — 5 ítems + modal historial completo; directiva `appHorizontalScroll` en grid de cajas)

**Módulos completados:**

- ✅ Home con saldos en tiempo real (CAJA, CAJA_CHICA, VARIOS, CELULAR, BUS) y reactivo a `turnoActivo$`
- ✅ Cierre Diario (v5.5 — wizard 2 pasos, sincronización proactiva de `turnoActivo$` tras cierre)
- ✅ Operaciones de Caja con historial
- ✅ Cuadre de Caja (calculadora)
- ✅ Recargas Virtuales (CELULAR/BUS)
- ✅ Pagar Deudas con comprobantes
- ✅ Ingreso/Egreso con categorías contables (reemplaza Gastos Diarios)

**Pendientes:**

- 🔄 Testing completo de flujos end-to-end
- 🔄 Reportes y estadísticas avanzadas
- 🔄 Backup automático de datos
