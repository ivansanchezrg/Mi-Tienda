# Caja Feature

Feature principal de la app. Contiene el panel de inicio y las operaciones diarias de caja.

---

## Páginas

### Home (`pages/home/`)

Panel principal con 3 secciones:

| Sección | Descripción | Visibilidad |
| --- | --- | --- |
| Hero card | Total efectivo (display bancario partido) + deltas de ingresos/egresos del día + chip de estado "Caja abierta/cerrada" | Siempre. El total excluye el Cajón cuando no hay turno activo |
| Mis Cuentas | Grid de cards por caja (base + opt-in + custom) con saldo. Click navega a `OperacionesCajaPage` | Cards según flags de módulos. Cajón con turno cerrado → modal "Cajón cerrado" |
| Acciones Rápidas | Ingreso, Gasto, Traspaso + botón de turno: **Abrir** (sin turno), **Cerrar** (turno propio) o **Cierre** deshabilitado (turno ajeno) | Siempre. El botón de turno se oculta al superadmin |
| Banner del turno | Card informativa "Turno en curso": quién abrió, hora de apertura, N° de turno, fondo del cajón (solo si > 0) y la regla de cierre. Reusa `estadoCaja.turnoActivo` + `esMiTurno` (cero queries) y se sincroniza vía `turnoActivo$` (Realtime) — aparece/desaparece cuando otro dispositivo abre o cierra | **Solo con turno abierto.** Acento verde con `bannerTurnoEsPropio` (es tu turno); neutro para el resto. El mensaje de cierre se adapta a 3 variantes: propio (2ª persona), ajeno (3ª persona con nombre) y superadmin (observador, tono neutro) |

> **Sección "Últimos 5 movimientos" ELIMINADA (2026-07-03).** El historial completo vive en el detalle de cada cuenta (`OperacionesCajaPage`). Los deltas del hero (+ingresos / -egresos) ahora vienen agregados del **día completo** desde `fn_home_dashboard` v2 (`resumen_dia`) — antes se calculaban sumando solo los últimos 5 movimientos, lo que subestimaba los totales. La RPC quedó más liviana (sin la lista ni sus 4 JOINs por fila).

> El **Cuadre de Caja** no es una sección del home — se abre desde el FAB central del tab bar (`main-layout`, opción visible solo con `cuadreDisponible`).

> **Banner del turno — comportamiento en arranque en frío.** El banner reusa dos rutas de datos del turno que ya alimentan el home (ver [PERFORMANCE-STARTUP.md](../guides/PERFORMANCE-STARTUP.md)): el snapshot del dashboard en Preferences (`home-dashboard-cache:v2`) guarda el `turno_activo` **completo** (incluye `numero_turno` y `fondo_apertura`) → mismo día, el banner arranca lleno sin red; otro día, el snapshot se degrada a `turnoActivo: null` y el banner **no se muestra** hasta que el fetch fresco reconcilia (~1s), correcto para no pintar un turno de ayer. La otra ruta es el snapshot local mínimo de SQLite (`turno_activo_local`, §18) que hidrata `turnoActivo$` local-first offline: ahí `fondo_apertura` llega en **0** (no se persiste) y la hora es aproximada. Por eso el banner solo muestra el fondo si es `> 0` (`mostrarFondoApertura`) — evita un "$0.00" falso en ese borde; el valor real reaparece al reconciliar. Quién abrió, hora y N° de turno son siempre confiables.

**Estado "caja abierta"** se deriva de `TurnosCajaService.turnoActivo$` (turno con `hora_fecha_cierre IS NULL`). Cuando no hay turno activo: oculta la fila de Caja Chica y la excluye del cálculo de Total Efectivo. Ver [Estado reactivo de turno](#estado-reactivo-de-turno--single-source-of-truth) más abajo.

**Saldos en tiempo real:** Los saldos de las cards de cajas se actualizan automáticamente vía Supabase Realtime (`CajasService.cajas$`) — sin recargar la página ni emitir queries adicionales. Ver [Realtime — tabla cajas](#realtime--tabla-cajas) más abajo.

**Refresco al volver de subpáginas:** en `ionViewWillEnter`, `refrescarDashboard()` recarga el dashboard con 1 RPC — incluye resumen del día **y** saldos de cajas (`aplicarCajasExternas()`). El Realtime cubre los cambios entre cargas imperativas. Ver [5_ACTUALIZACION-UI-SIN-RECARGA.md](./5_ACTUALIZACION-UI-SIN-RECARGA.md).

**Datos:** Conectado a Supabase mediante servicios. La carga inicial del home (`HomePage.cargarDatos()`) usa la RPC consolidada `fn_home_dashboard` desde 2026-05-30 — 1 round-trip para estado de caja + saldos virtuales CELULAR/BUS + resumen ingresos/egresos del día. Ver [PERFORMANCE-STARTUP.md](../guides/PERFORMANCE-STARTUP.md#9-fn_home_dashboard--rpc-consolidada-del-home) para detalle.

**Notificaciones:** `NotificacionesService.getNotificaciones()` se llama al cargar y muestra un badge con el total de alertas activas. Tipos posibles: `DEUDA_CELULAR`, `SALDO_BAJO_BUS`, `FACTURACION_BUS_PENDIENTE`, `FACTURACION_BUS_PROXIMA`, `STOCK_BAJO`. Ver detalle en [RECARGAS-VIRTUALES-README.md](../recargas-virtuales/RECARGAS-VIRTUALES-README.md#notificaciones-bus-en-home).

El modal de notificaciones (`NotificacionesModalComponent`) soporta un ítem expandible para `STOCK_BAJO`: si hay 1 producto navega directo a su Kárdex; si hay 2+ despliega la lista con acceso individual a cada producto.

**Cajón con turno cerrado:** al tocar la card del Cajón sin turno activo, el home abre el modal "Cajón cerrado" (`OptionsModalComponent`) con las opciones "Historial de cierres" y "Salir". Si se elige historial, navega con `?from=home` para que el volver regrese al home.

**`VerificarFondoModalComponent`:** en el caso **con déficit** llama `repararDeficit()` internamente (apertura atómica) y solo se cierra si todo sale bien; si falla, permanece abierto con el error para que el usuario corrija. En el caso **sin déficit** solo devuelve `fondoApertura` al cerrarse — es el home (`onAbrirCaja()`) quien llama `abrirTurno()`. Ver [8_PROCESO_ABRIR_CAJA.md](./8_PROCESO_ABRIR_CAJA.md).

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
- 🔍 **Filtros sticky** (Todo, Hoy) estilo bancario — default "Todo" (2026-06-22; antes 4 opciones con default "Hoy")
- 📜 **Scroll infinito** con agrupación por fecha
- 📱 **Header dinámico** - saldo aparece al hacer scroll
- 🎨 **Diseño adaptativo** dark/light mode
- 🔒 **Restricción de turno ajeno:** el home pasa `esMiTurno=true` en query params solo cuando el turno del Cajón es del usuario logueado. Sin ese flag, el menú `⋮` de Caja Chica omite "Registrar Ingreso/Egreso" (quedan "Historial de cierres" y, para ADMIN, "Editar caja"). La función SQL también lo rechaza como última línea de defensa.
- 👤 **Menú por rol:** CELULAR y BUS solo muestran el `⋮` a usuarios con rol `ADMIN`. Para empleados el menú está oculto. El rol se lee desde `AuthService.getUsuarioActual()` (Preferences, sin consulta a BD).

**Documentación completa:** Ver [1_OPERACIONES-CAJA.md](./1_OPERACIONES-CAJA.md)

---

---

## Componentes Modales

### Registrar Recarga / Pagar Deudas / Liquidación Bus / Historial Modal

> ⚠️ **Movidos a** `src/app/features/recargas-virtuales/components/`

---

~~### Movimientos Hoy Modal (`components/movimientos-hoy-modal/`)~~

> **ELIMINADO 2026-06-02.** El modal "Ver todos los movimientos" y su componente `MovimientosHoyModalComponent` fueron eliminados. El historial completo de operaciones vive en cada `OperacionesCajaPage` (filtro Hoy + filtros por período). El widget de "últimos 5 movimientos" del home también fue eliminado después (2026-07-03) — ver la nota al inicio de este documento.

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
/caja/historial-turnos       → HistorialTurnosPage (cierres pasados, paginado con infinite scroll)
/caja/recargas-virtuales     → RecargasVirtualesPage
```

> **Historial de Turnos:** punto de entrada desde el menú ⋮ del Cajón (OperacionesCajaPage cuando `cajaCodigo === 'CAJA_CHICA'`) y también al elegir "Historial de cierres" en el modal "Cajón cerrado" del home (navega con `?from=home` para que el volver regrese al home). Muestra cierres pasados agrupados por fecha. Al tocar una card se abre `CierreTurnoDetalleModalComponent` con el layout del cierre (Cajón Físico + Saldos al Cierre). La sección "Saldos Virtuales" fue eliminada del modal. El campo `usa_pos` (leído de `fn_listar_cierres_turno`) determina si se muestra el modo B (sin POS): en modo B se oculta la sección de movimientos del turno y el bloque de resultado. Botón para compartir el resumen por WhatsApp. Reconstruye el snapshot desde `operaciones_cajas` + `recargas` vía `fn_listar_cierres_turno`. FAB "subir al inicio" en `.bs-content` cuando el detalle es largo (Varios + Celular + Bus + observaciones simultáneos) — usa `crearScrollToTopElemento()`, la variante del patrón scroll-to-top para modales bottom-sheet (ver `docs/shared/SHARED-README.md`).

---

## Estado reactivo de turno — Single Source of Truth

Desde 2026-04-11 el estado "POS habilitado" ya **no** vive en `configuraciones.pos_habilitado` (eliminado). Ahora se deriva automáticamente de si hay un turno de caja abierto.

### TurnosCajaService como fuente única

`TurnosCajaService` expone el estado del turno que todo el resto de la app consume:

```typescript
turnoActivo$: Observable<TurnoCajaConEmpleado | null>  // turno completo (con JOIN empleado) o null
esMiTurno$:   Observable<boolean>                      // derivado: el turno activo es del usuario logueado
turnoActivoValue / esMiTurnoValue                      // valores síncronos (guards, código imperativo)
esperarEstadoListo(): Promise<void>                    // resuelve cuando la carga inicial de BD terminó
```

**Arranque del servicio:**
- Instanciado en `AppComponent` via `inject(TurnosCajaService)` porque `providedIn: 'root'` es lazy y necesitamos que el constructor corra al bootstrap.
- El constructor se suscribe a `AuthService.usuarioActual$` y llama `inicializarEstadoReactivo()` al login / `cerrarRealtimeTurnos()` al logout. Se registra en `SupabaseService.registerBeforeCleanup` para limpiar canales antes del sign out.
- Inversión de dependencia: no es `AuthService` quien llama a `TurnosCajaService` (evita ciclo), sino al revés.
- **Local-first (2026-07-08):** `inicializarEstadoReactivo()` hidrata `turnoActivo$` desde el snapshot local `turno_activo_local` (SQLite, ~ms) **antes** de tocar la red, luego reconcilia con el servidor. La reconciliación usa `consultarTurnoActivoServidor()` — que distingue "respuesta real" de "fallo de transporte" — para que un fallo de red con `isConnected()=true` (red mala, lejos del router) **no** pise el turno local ni borre el snapshot. Así `esMiTurno` y el POS funcionan de inmediato aunque la red esté lenta o caída. Ver `PERFORMANCE-STARTUP.md` §18.

**Realtime:** el canal `turnos-caja-activo` propaga apertura, cierre y eliminación de turnos a todos los dispositivos. Mecánica completa de eventos y setup SQL en [5_ACTUALIZACION-UI-SIN-RECARGA.md](./5_ACTUALIZACION-UI-SIN-RECARGA.md).

**Sincronización proactiva (evita flash de UI incorrecta):**
- `abrirTurno()` llama `refrescarTurnoActivo()` tras éxito. Retorna `{ ok: boolean, errorHandled: boolean }` (no `boolean`).
- `repararDeficit()` (apertura atómica + ajuste) también.
- `CierreDiarioPage` llama `refrescarTurnoActivo()` tras `fn_ejecutar_cierre_diario`.

De esta forma la UI reacciona instantáneamente sin esperar el round-trip del evento Realtime.

### Consumidores del estado

| Elemento | Comportamiento cuando NO hay turno activo |
|----------|-------------------------------------------|
| Tab "POS" en tab bar | `DisabledTabComponent` — grisado con candado, click muestra toast. También se deshabilita con turno **ajeno** (`posHabilitado = esMiTurno`), con mensaje que incluye el nombre del dueño del turno |
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

- Espera `esperarEstadoListo()` antes de decidir — evita la race condition al hacer refresh (el BehaviorSubject aún no cargó de BD).
- Permite el paso solo si `esMiTurnoValue` es `true` — el POS es exclusivo del empleado que abrió el turno.
- Turno abierto por otro empleado → toast con su nombre + redirección a `/caja`.
- Offline sin turno en memoria → fallback al snapshot local `turno_activo_local` (escrito al abrir turno con red); permite el acceso solo si el turno cacheado es del propio usuario.
- Sin turno → toast + redirección a `/caja`. Protege `/pos` de deep-links, historial de navegación o URLs directas.

---

## Realtime — tabla `cajas`

Los saldos de las cards del home y el header de Operaciones de Caja se sincronizan en tiempo real vía Supabase Realtime (`CajasService.cajas$`). Cualquier cambio en `saldo_actual` (ingreso, egreso, traspaso, cierre) se propaga a todos los dispositivos conectados sin query adicional.

La mecánica completa — eventos por canal, setup SQL, `REPLICA IDENTITY FULL`, activación de módulos desde `/admin` y limpieza de canales — está documentada en [5_ACTUALIZACION-UI-SIN-RECARGA.md](./5_ACTUALIZACION-UI-SIN-RECARGA.md).

> **Operativo:** tras re-ejecutar `schema.sql`, volver a correr [`sql/setup/realtime_cajas.sql`](./sql/setup/realtime_cajas.sql) y [`sql/setup/realtime_turnos_caja.sql`](./sql/setup/realtime_turnos_caja.sql) — `DROP TABLE ... CASCADE` elimina la publicación Realtime.

---

## Servicios

| Servicio                 | Archivo                                                | Descripción                                         |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------- |
| RecargasService          | `caja/services/recargas.service.ts`               | Operaciones de cierre diario, historial de recargas |
| CajasService             | `caja/services/cajas.service.ts`                  | Operaciones de cajas, transferencias, saldos        |
| OperacionesCajaService   | `caja/services/operaciones-caja.service.ts`       | Consulta de operaciones con filtros y paginación    |
| TurnosCajaService        | `caja/services/turnos-caja.service.ts`            | Gestión de turnos + estado reactivo global (`turnoActivo$`, `esMiTurno$`) + RPC consolidada del home `obtenerHomeDashboard()`. `abrirTurno()` retorna `{ ok: boolean, errorHandled: boolean }` |
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
5. **[5_ACTUALIZACION-UI-SIN-RECARGA.md](./5_ACTUALIZACION-UI-SIN-RECARGA.md)** - Sincronización de UI en 3 capas (Realtime, pull-to-refresh, recarga post-operación), setup SQL de Realtime, stale-while-revalidate del home y gotcha de Supabase data:null
6. **[RECARGAS-VIRTUALES-README.md](../recargas-virtuales/RECARGAS-VIRTUALES-README.md)** - Sistema completo de gestión de saldo virtual (CELULAR/BUS), deudas, liquidaciones y comisiones
7. ~~**GASTOS-DIARIOS-README.md**~~ — **ELIMINADO en v5** (2026-03-06). Los gastos operativos se registran como EGRESO desde CAJA_CHICA en `operacion-modal`.
8. **[8_PROCESO_ABRIR_CAJA.md](./8_PROCESO_ABRIR_CAJA.md)** - Flujo de apertura de turno, modal de verificación de fondo, estado del turno en la UI y tabla turnos_caja

### Otros Recursos

- **[Schema de Base de Datos](../schema.sql)** - Estructura completa de tablas, índices y datos iniciales
- **[SQL Queries](./sql/)** - Funciones PostgreSQL y queries comunes

### Cambios recientes en funciones SQL (v6.3 — 2026-06-01 / 2026-06-02)

| Función | Versión | Cambio |
|---------|---------|--------|
| `fn_abrir_turno` | v3.4 | (2026-06-22) El rechazo por turno ya abierto incluye el nombre del empleado ("Ya hay un turno abierto por X") — antes solo "Ya hay un turno abierto", causaba que el frontend mostrara un mensaje genérico de conexión en vez del motivo real (race condition con otro dispositivo). `TurnosCajaService.abrirTurno()` retorna `{ ok, errorHandled, errorMsg? }` y propaga ese mensaje; `home.page.ts → onAbrirCaja()` lo muestra y refresca el estado. v3.3: validación de turno abierto sin filtro de fecha — un turno de un día anterior sin cerrar bloquea con mensaje limpio. v3.1: si `fondo_apertura > 0`, registra un EGRESO en Tienda con categoría `Fondo Apertura Turno`, validando saldo suficiente. |
| `fn_reparar_deficit_turno` | v4.2 | (2026-06-11) Misma validación sin filtro de fecha que `fn_abrir_turno` v3.3. v4.1: validación de saldo incluye déficit + fondo; EGRESO `FONDO-APERTURA` cuando fondo > 0. |
| `fn_registrar_operacion_manual` | v3.1 | Nueva validación: si la caja destino es VARIOS, verifica que `caja_varios_activa = 'true'` en `configuraciones`. |
| `fn_ejecutar_cierre_diario` | v6.3 | El depósito de Tienda al cierre lleva `categoria_id`: `Cierre — Ventas con POS` si el turno usó POS, `Cierre — Ventas del dia` si no. |
| `fn_listar_cierres_turno` | v2.2 | (2026-06-24) `p_limit`/`p_offset` paginan el CTE `turnos` antes de los JOINs pesados a ventas/recargas — con el filtro "Todo" el payload ya no crece sin tope. `HistorialTurnosPage` consume esto con `ion-infinite-scroll` (`cargarMas()`, `hasMore`, `PAGINATION_CONFIG.historialTurnos.pageSize`). v2.1: `usa_pos` ahora refleja cualquier movimiento del cajón (ventas POS, ingresos manuales o egresos). Antes solo consideraba ventas POS — dejaba el cuadre desactivado cuando había ingresos/egresos manuales sin POS. |
| `fn_obtener_deficit_turno_anterior` | v1.0 | Nueva RPC (2026-06-03). Reemplaza 4 round-trips de `obtenerDeficitTurnoAnterior()` en 1 sola llamada. `STABLE`, ventana UTC para uso de índices. |
| `fn_home_dashboard` | v2.0 | (2026-07-03) Elimina la lista de "últimos 5 movimientos" (la sección del home se borró). Devuelve `resumen_dia` con ingresos/egresos agregados del día completo para los deltas del hero. **Pendiente de re-ejecutar en Supabase.** |

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
- El estado "POS habilitado" ya **no** es una configuración: se deriva automáticamente de `turnos_caja` via `TurnosCajaService.turnoActivo$`/`esMiTurno$` (ver [Estado reactivo de turno](#estado-reactivo-de-turno--single-source-of-truth))

### Transactional PostgreSQL Functions

- Operaciones multi-tabla usando funciones PostgreSQL
- Atomicidad garantizada (all or nothing)
- Uso: `supabase.client.rpc('function_name', params)`

### Modales para Flujos Complejos

- Wizards paso a paso con navegación clara
- Verificación final antes de confirmar
- PendingChangesGuard en páginas críticas

### Optimización de Imágenes

- Flujo unificado `StorageService.elegirFuenteFoto()`: captura 1920×1920 quality 92 → cropper → compresión WebP 1600×1600 a 0.92
- Nunca llamar `Camera.getPhoto` directamente — ver CLAUDE.md → "Imágenes"
- Resultado: ~200-500 KB vs 3-10 MB originales

---

## Notas Importantes

### Inmutabilidad de operaciones_cajas

`operaciones_cajas` es un **ledger de auditoría inmutable**: ningún registro puede borrarse ni modificarse (salvo los campos `descripcion` y `comprobante_url`). Esto lo garantiza el trigger `trg_bloquear_delete_operacion_caja` / `trg_proteger_operacion_caja` (`fn_proteger_operacion_caja`). Cualquier corrección de monto se hace registrando una operación inversa, nunca editando la original. La única excepción es la purga administrativa de un negocio vencido (`fn_purgar_negocio`), que activa el setting de sesión `app.purga_en_curso = 'true'` para que el trigger ceda durante el CASCADE.

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

**Última actualización:** 2026-06-22 — **v6.7** (`fn_abrir_turno` v3.4: mensaje de turno ya abierto incluye el empleado, `abrirTurno()` propaga `errorMsg` real de la BD en vez de texto genérico de conexión; banner de déficit en `verificar-fondo-modal` reescrito para distinguir la acción física manual de la contable automática; filtros de Operaciones de Caja e Historial de Turnos reducidos a Todo/Hoy con default "Todo"; cada fila de Operaciones de Caja muestra el saldo resultante de la operación)

**Histórico:** 2026-06-11 — v6.6 (docs consolidadas: [5_ACTUALIZACION-UI-SIN-RECARGA.md](./5_ACTUALIZACION-UI-SIN-RECARGA.md) como único deep-dive de sincronización de UI; aviso `aperturaEnOtroDia` post-cierre cuando el turno se abrió un día anterior; `fn_abrir_turno` v3.3 / `fn_reparar_deficit_turno` v4.2 con validación de turno abierto sin filtro de fecha; eliminados métodos muertos de `OperacionesCajaService`)

**Módulos completados:**

- ✅ Home con saldos en tiempo real (CAJA, CAJA_CHICA, VARIOS, CELULAR, BUS) y reactivo a `turnoActivo$`
- ✅ Cierre Diario (v5.5 — wizard 2 pasos, sincronización proactiva de `turnoActivo$` tras cierre)
- ✅ Operaciones de Caja con historial
- ✅ Cuadre de Caja (calculadora)
- ✅ Recargas Virtuales (CELULAR/BUS)
- ✅ Pagar Deudas con comprobantes
- ✅ Ingreso/Egreso con categorías contables (reemplaza Gastos Diarios)

**Pendientes:** el backlog técnico vive en [docs/PENDIENTES.md](../PENDIENTES.md) — ahí están el testing (puntero M-6 de la auditoría), backup automático y reportes avanzados.
