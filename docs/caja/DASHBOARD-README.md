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
- Muestra los **últimos 5 movimientos** del día (todas las cajas, excluye solo APERTURA — CIERRE sí aparece).
- Título: **"ÚLTIMOS 5 MOVIMIENTOS"** (fijo, sin contador — el contador generaba confusión al mostrar un número mayor que los 5 visibles).
- Si `totalMovimientosHoy > 5`, aparece un footer con el hint **"Para ver el historial completo, entra a cada cuenta."** — no hay modal de "Ver todos" (eliminado). El detalle completo vive en cada página de cuenta (OperacionesCajaPage con filtro por caja).
- El nombre de la cuenta aparece como badge sobre el título de cada movimiento (jerarquía visual: badge → título → motivo → empleado · hora).
- Al volver de cualquier subpágina (`ionViewWillEnter`), los movimientos se refrescan automáticamente. Los saldos no se re-fetchean — Realtime ya los mantiene actualizados.

**Datos:** Conectado a Supabase mediante servicios. La carga inicial del home (`HomePage.cargarDatos()`) usa la RPC consolidada `fn_home_dashboard` desde 2026-05-30 — 1 round-trip para estado de caja + saldos virtuales CELULAR/BUS + últimos 5 movimientos + count. Ver [PERFORMANCE-STARTUP.md](../guides/PERFORMANCE-STARTUP.md#9-fn_home_dashboard--rpc-consolidada-del-home) para detalle.

**Notificaciones:** `NotificacionesService.getNotificaciones()` se llama al cargar y muestra un badge con el total de alertas activas. Tipos posibles: `DEUDA_CELULAR`, `SALDO_BAJO_BUS`, `FACTURACION_BUS_PENDIENTE`, `FACTURACION_BUS_PROXIMA`, `STOCK_BAJO`. Ver detalle en [RECARGAS-VIRTUALES-README.md](../recargas-virtuales/RECARGAS-VIRTUALES-README.md#notificaciones-bus-en-home).

El modal de notificaciones (`NotificacionesModalComponent`) soporta un ítem expandible para `STOCK_BAJO`: si hay 1 producto navega directo a su Kárdex; si hay 2+ despliega la lista con acceso individual a cada producto.

**Banner "cajón cerrado":** cuando no hay turno activo, hacer click en el banner navega al historial de turnos con `?from=home`. El modal "Cajón cerrado" confirma la acción e incluye una opción "Ver historial de turnos".

**`VerificarFondoModalComponent`:** llama `TurnosCajaService.abrirTurno()` internamente (ya no lo hace el home). El modal solo se cierra si el turno se abre correctamente; si la apertura falla, permanece abierto para que el usuario corrija.

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
- **Modo B (sin POS activo):** paso 2 muestra "Fondo inicial" + "Total contado" sin bloque de cuadre (sin diferencia cuadrado/faltante/sobrante). El campo de observaciones sigue disponible.
- **Modal de compartir:** al finalizar correctamente, la página guarda los datos en `ShareCierreService.guardarPendiente()` y navega al home. Es el home quien abre el modal de compartir al detectar el pendiente con `ShareCierreService.consumirPendiente()`.

**Sincronización del estado POS tras cierre:**
Al finalizar con éxito, la página llama a `TurnosCajaService.refrescarTurnoActivo()` **antes** de navegar. Esto sincroniza `turnoActivo$` de inmediato para que tabs/sidebar/home deshabiliten el POS sin esperar al round-trip del evento Realtime UPDATE sobre `turnos_caja`.

**Patrones utilizados:**
- `ScrollResetDirective` para scroll al top al cambiar de paso
- `PendingChangesGuard` para prevenir salida accidental con datos sin guardar
- `CurrencyService` para parseo inteligente de moneda
- `TurnosCajaService.refrescarTurnoActivo()` para sincronización proactiva post-cierre
- `ShareCierreService.guardarPendiente()` para pasar datos del cierre al home (modal de compartir)
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

~~### Movimientos Hoy Modal (`components/movimientos-hoy-modal/`)~~

> **ELIMINADO 2026-06-02.** El modal "Ver todos los movimientos" y su componente `MovimientosHoyModalComponent` fueron eliminados. El historial completo de operaciones vive en cada `OperacionesCajaPage` (filtro Hoy + filtros por período). El widget del home muestra los últimos 5 con el hint "Para ver el historial completo, entra a cada cuenta."

---

### Operación Modal (`components/operacion-modal/`)

Modal genérico para registrar operaciones de Ingreso/Egreso/Transferencia.

**Características:**

- 💰 **Tipo de operación** configurable
- 📋 **Categorías contables** según tipo
- 📸 **Comprobantes** opcionales u obligatorios según categoría
- 💸 **Actualización automática** de saldos de cajas
- **VARIOS opt-in:** si `variosActiva = false` (recibido como `queryParam`), la caja VARIOS se excluye del selector de cajas. `fn_registrar_operacion_manual` (v3.1) también valida esto internamente: si la caja destino es VARIOS y `caja_varios_activa = 'false'` en configuraciones, la función lanza error.

**Documentación completa:** Ver [2_PROCESO_INGRESO_EGRESO.md](./2_PROCESO_INGRESO_EGRESO.md)

---

## Rutas

```
/caja                        → HomePage
/caja/operaciones-caja       → OperacionesCajaPage
/caja/cierre-diario          → CierreDiarioPage (con pendingChangesGuard)
/caja/historial-turnos       → HistorialTurnosPage (lista paginada de cierres pasados)
/caja/recargas-virtuales     → RecargasVirtualesPage
```

> **Historial de Turnos:** punto de entrada desde el menú ⋮ del Cajón (OperacionesCajaPage cuando `cajaCodigo === 'CAJA_CHICA'`) y también al hacer click en el banner "cajón cerrado" del home (navega con `?from=home` para que el volver regrese al home). Muestra cierres pasados agrupados por fecha. Al tocar una card se abre `CierreTurnoDetalleModalComponent` con el layout del cierre (Cajón Físico + Saldos al Cierre). La sección "Saldos Virtuales" fue eliminada del modal. El campo `usa_pos` (leído de `fn_listar_cierres_turno`) determina si se muestra el modo B (sin POS): en modo B se oculta la sección de movimientos del turno y el bloque de resultado. Botón para compartir el resumen por WhatsApp. Reconstruye el snapshot desde `operaciones_cajas` + `recargas` vía `fn_listar_cierres_turno`.

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
- `abrirTurno()` llama `refrescarTurnoActivo()` tras éxito. Retorna `{ ok: boolean, errorHandled: boolean }` (no `boolean`).
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
| `INSERT` | Creación de caja custom (`NuevaCajaModalComponent`) o activación de módulo desde `/admin` (`fn_configurar_modulos_admin`) |
| `UPDATE (activo=false)` | Desactivación de caja (aún no implementado en UI) |

**Activación de módulos desde `/admin` — comportamiento en tiempo real:** cuando el superadmin activa Celular, Bus o Varios, `fn_configurar_modulos_admin` inserta la caja nueva. El INSERT llega por Realtime al `CajasService` del negocio. El subscribe de `cajas$` en `HomePage` detecta que la caja nueva tiene un código de módulo (`VARIOS`, `CAJA_CELULAR`, `CAJA_BUS`) que no estaba en el array anterior, invalida el `ConfigService` y re-lee los flags de configuración — las cards aparecen sin recargar la página.

Al **desactivar** un módulo, la caja no se toca — solo cambia el flag en `configuraciones`. El admin del negocio debe refrescar la página para que la card desaparezca.

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
| TurnosCajaService        | `caja/services/turnos-caja.service.ts`            | Gestión de turnos + estado reactivo global (`turnoActivo$`, `cajaAbierta$`) + RPC consolidada del home `obtenerHomeDashboard()`. `abrirTurno()` retorna `{ ok: boolean, errorHandled: boolean }` |
| ShareCierreService       | `caja/services/share-cierre.service.ts`           | Transfiere datos del cierre entre `CierreDiarioPage` y `HomePage` para abrir el modal de compartir. Métodos: `guardarPendiente(datos)` / `consumirPendiente()` |
| NotificacionesService    | `core/services/notificaciones.service.ts` ⬆️           | Agrega y expone todas las notificaciones de la app  |
| RecargasVirtualesService | `recargas-virtuales/services/recargas-virtuales.service.ts` | Gestión de saldo virtual, deudas, liquidaciones     |
| GananciasService         | `recargas-virtuales/services/ganancias.service.ts`          | Cálculo y verificación de ganancias mensuales BUS   |
> `NotificacionesService` vive en `core/services/` — usado por caja e inventario. `RecargasVirtualesService` y `GananciasService` viven en `features/recargas-virtuales/services/`.

---

## Dependencias Core

| Archivo                                         | Uso                                           |
| ----------------------------------------------- | --------------------------------------------- |
| `core/services/ui.service.ts`                   | Loading, toasts y alertas en toda la app      |
| `core/services/currency.service.ts`             | Parseo y formato de montos. Métodos: `format()`, `parse()`, `parteEntera()`, `centavos()` |
| `shared/pipes/app-currency.pipe.ts`             | Pipe `\| appCurrency` — usa `CurrencyService.format()`. Estándar para todo display de dinero en templates |
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

### Cambios recientes en funciones SQL (v6.3 — 2026-06-01 / 2026-06-02)

| Función | Versión | Cambio |
|---------|---------|--------|
| `fn_abrir_turno` | v3.1 | Si `fondo_apertura > 0`, registra un EGRESO en Tienda usando la categoría `Fondo Apertura Turno`. Valida que Tienda tenga saldo suficiente antes de proceder. |
| `fn_registrar_operacion_manual` | v3.1 | Nueva validación: si la caja destino es VARIOS, verifica que `caja_varios_activa = 'true'` en `configuraciones`. |
| `fn_ejecutar_cierre_diario` | v6.3 | El depósito de Tienda al cierre lleva `categoria_id`: `Cierre — Ventas con POS` si el turno usó POS, `Cierre — Ventas del dia` si no. |
| `fn_listar_cierres_turno` | v2.1 | `usa_pos` ahora refleja cualquier movimiento del cajón (ventas POS, ingresos manuales o egresos). Antes solo consideraba ventas POS — dejaba el cuadre desactivado cuando había ingresos/egresos manuales sin POS. |
| `fn_obtener_deficit_turno_anterior` | v1.0 | Nueva RPC (2026-06-03). Reemplaza 4 round-trips de `obtenerDeficitTurnoAnterior()` en 1 sola llamada. `STABLE`, ventana UTC para uso de índices. |
| `fn_home_dashboard` | v1.2 | JOIN a `categorias_sistema` para mostrar nombre correcto de categoría (igual que `v_operaciones_cajas`). v1.1: excluye solo APERTURA (CIERRE ahora visible). |

---

## Patrones de Diseño Utilizados

### Ultra-Simplified UX (v4.0)

- Reducir input del usuario al mínimo (1 campo cuando sea posible)
- Sistema calcula todo lo demás desde configuración
- Guías visuales para acciones físicas

### Configuration-Driven Design

- Constantes centralizadas en tabla `configuraciones`
- Fácil modificación sin redeploy
- Claves con prefijo por módulo: `caja_varios_transferencia_dia`, `bus_alerta_saldo_bajo`, `pos_descuentos_habilitados`, `pos_iva_porcentaje`
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

**Última actualización:** 2026-06-03 — **v6.5** (widget movimientos: título "ÚLTIMOS 5 MOVIMIENTOS", CIERRE visible, badge de cuenta, hint en lugar de modal "Ver todos"; `MovimientosHoyModalComponent` eliminado; `AppCurrencyPipe` como estándar de display de dinero; `fn_home_dashboard` v1.2 con JOIN a `categorias_sistema`)

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
