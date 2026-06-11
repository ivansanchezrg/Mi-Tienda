# Sincronización de UI en el módulo Caja

Explica cómo las páginas del módulo Caja mantienen la UI actualizada después de cada operación, sin recargas de página. La implementación usa tres capas complementarias con responsabilidades distintas.

---

## Las tres capas

```
┌──────────────────────────────────────────────────────────┐
│ Capa 1 — Realtime                                        │
│   Cambios desde OTRO dispositivo → actualización         │
│   automática, sin intervención del usuario               │
│   Latencia: ~1-3s                                        │
├──────────────────────────────────────────────────────────┤
│ Capa 2 — Pull-to-refresh                                 │
│   El usuario arrastra → recarga completa del dashboard   │
│   Cubre también el caso offline-→-online                 │
├──────────────────────────────────────────────────────────┤
│ Capa 3 — Recarga imperativa post-operación               │
│   El usuario ejecutó algo en ESTE dispositivo →          │
│   refrescarMovimientos() o cargarOperaciones()           │
│   No espera al Realtime para tener consistencia local    │
└──────────────────────────────────────────────────────────┘
```

Cada capa cubre exactamente lo que las otras no cubren. No se solapan.

---

## Capa 1: Realtime

### `CajasService` — saldos de cajas

`CajasService` abre un canal de Realtime sobre la tabla `cajas` en cuanto hay usuario autenticado. Cuando cualquier operación (local o remota) modifica `saldo_actual`, el evento llega y el BehaviorSubject se actualiza in-place:

```typescript
// cajas.service.ts — handleCajaChange()
if (eventType === 'UPDATE' && nueva) {
  // actualiza saldo_actual u otros campos sin reemplazar toda la lista
  this._cajas$.next(actual.map(c => c.id === nueva.id ? nueva : c));
}
```

Las páginas suscritas a `cajas$` reciben el nuevo saldo automáticamente. El Home y la página de Operaciones de Caja lo hacen así:

```typescript
// home.page.ts — ngOnInit()
this.cajasSub = this.cajasService.cajas$.subscribe(cajas => {
  if (!cajas.length) return;
  const saldos = this.cajasService.saldosValue;
  this.saldoCaja      = saldos.cajaPrincipal;
  this.saldoCajaChica = saldos.cajaChica;
  // ... resto de saldos
  this.cajas = cajas;
  this.cdr.markForCheck();
});

// operaciones-caja.page.ts — ionViewWillEnter()
this.cajasSub = this.cajasService.cajas$.subscribe(cajas => {
  const caja = cajas.find(c => c.id === this.cajaId);
  if (caja) this.cajaSaldo = caja.saldo_actual;
});
```

El canal se cierra automáticamente al hacer logout vía `registerBeforeCleanup()` — no hay canales huérfanos.

**Caso especial — activación de módulos desde `/admin`:** cuando el superadmin activa Celular, Bus o Varios, `fn_configurar_modulos_admin` inserta la caja nueva. El INSERT llega por Realtime al `CajasService` del negocio y la card aparece en el home sin recargar la página. Al **desactivar** un módulo la caja no se toca (solo cambia el flag en `configuraciones`) — ahí sí hace falta refrescar para que la card desaparezca.

### `TurnosCajaService` — estado del turno

`TurnosCajaService` hace lo mismo para `turnos_caja`. El Home se suscribe a `turnoActivo$` para actualizar el chip de estado (abierto/cerrado) sin ninguna acción del usuario:

```typescript
// home.page.ts — ngOnInit()
this.turnoSub = this.turnosCajaService.turnoActivo$.subscribe(turno => {
  if (turno) {
    this.estadoCaja.empleadoNombre = turno.empleado?.nombre ?? '';
    this.estadoCaja.estado = 'TURNO_EN_CURSO';
    // ...
  } else {
    // Turno cerrado desde otro dispositivo — resetear estado visual
    this.estadoCaja.estado = this.estadoCaja.turnosHoy > 0 ? 'CERRADA' : 'SIN_ABRIR';
  }
  this.cdr.markForCheck();
});
```

El Realtime hace refetch del turno completo en INSERT (necesita el JOIN con `usuarios` que el payload no trae), y pone `null` directamente en UPDATE/DELETE (sin query extra):

```typescript
// turnos-caja.service.ts — handleTurnoChange()
if (eventType === 'INSERT') {
  // Refetch porque TurnoCajaConEmpleado incluye JOIN con usuarios(nombre)
  const turno = await this.obtenerTurnoActivo();
  this._turnoActivo$.next(turno);
}
if (eventType === 'UPDATE') {
  // Si se cerró el turno activo, bajar el estado a null directo — sin query
  if (actual && nuevo.id === actual.id && nuevo.hora_fecha_cierre) {
    this._turnoActivo$.next(null);
  }
}
```

### Setup SQL requerido (una sola vez por entorno)

| Tabla | Script |
|---|---|
| `cajas` | [`sql/setup/realtime_cajas.sql`](./sql/setup/realtime_cajas.sql) |
| `turnos_caja` | [`sql/setup/realtime_turnos_caja.sql`](./sql/setup/realtime_turnos_caja.sql) |

Cada script publica la tabla en `supabase_realtime` y activa `REPLICA IDENTITY FULL`. Sin esto, Supabase solo envía las columnas modificadas en cada UPDATE — y los servicios necesitan la fila completa para reconstruir el estado.

> **Tras re-ejecutar `schema.sql`:** `DROP TABLE ... CASCADE` elimina la publicación Realtime — volver a correr ambos scripts y reiniciar la app para que los servicios abran canales nuevos. **No crear políticas SELECT propias en estos scripts:** las políticas `*_select` de `02_rls.sql` ya cubren el acceso; una política extra con `USING (true)` se combina con OR y anularía el filtro de `negocio_id` (ver CLAUDE.md → "No hacer").

### Qué NO cubre el Realtime

El Realtime actualiza **saldos y estado de turno**, pero no los movimientos recientes ni los contadores del dashboard. Si el usuario actual registra una operación, el panel de "Últimas operaciones" no se actualiza solo — eso lo hace la Capa 3.

---

## Capa 2: Pull-to-refresh

El Home implementa el patrón estándar del proyecto: `silencioso = true` para no mostrar el skeleton mientras el spinner nativo del `ion-refresher` ya indica actividad.

```typescript
// home.page.ts
async handleRefresh(event: CustomEvent) {
  try {
    await this.cargarDatos(true);  // silencioso: no muestra skeleton
  } finally {
    (event.target as HTMLIonRefresherElement).complete();
  }
}
```

`cargarDatos(true)` ejecuta la misma RPC consolidada `fn_home_dashboard` que la carga inicial, y llama `aplicarCajasExternas()` para actualizar también el BehaviorSubject de cajas — garantizando que el Realtime y la carga imperativa siempre queden en sincronía:

```typescript
// home.page.ts — aplicarDashboard()
if (dashboard.cajas.length) {
  const saldos = this.cajasService.aplicarCajasExternas(dashboard.cajas);
  this.cajas       = dashboard.cajas;
  this.saldoCaja   = saldos.cajaPrincipal;
  // ... resto de saldos
}
```

El pull-to-refresh de la página de Operaciones de Caja es más simple — solo recarga la lista paginada sin tener que coordinar con el BehaviorSubject de cajas (el saldo del header lo mantiene la Capa 1):

```typescript
// operaciones-caja.page.ts
async handleRefresh(event: CustomEvent) {
  await this.cargarOperaciones(true, true);  // isRefresh=true: no resetea la lista antes del fetch
  (event.target as HTMLIonRefresherElement).complete();
}
```

---

## Capa 3: Recarga imperativa post-operación

Cuando el usuario ejecuta una operación **en este dispositivo**, no se espera al Realtime para actualizar la UI — se recarga de forma inmediata.

### Home: `refrescarMovimientos()` vs `cargarDatos()`

El Home tiene dos métodos de recarga con alcance diferente:

| Método | Qué recarga | Cuándo usarlo |
|--------|-------------|---------------|
| `refrescarMovimientos()` | Solo dashboard: movimientos, saldos, estado turno | Después de un ingreso, egreso o traspaso |
| `cargarDatos()` | Dashboard + notificaciones + datos del empleado | Apertura/cierre de turno, regreso desde otra página con cierre pendiente |

```typescript
// home.page.ts — después de una operación de ingreso/egreso
private async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
  const success = await this.operacionesCajaService.registrarOperacion(...);
  if (success) await this.refrescarMovimientos();
}

// home.page.ts — después de abrir turno (necesita recargar todo)
if (!ok) { /* error */ return; }
await this.cargarDatos();

// home.page.ts — al volver de cierre diario (hay un pendiente de cierre)
const datosCierre = this.shareCierreService.consumirPendiente();
if (datosCierre) {
  await this.cargarDatos();
  await this.ofrecerCompartirCierre(datosCierre);
} else if (!this.cargando) {
  await this.refrescarMovimientos();  // volver de cualquier otra subpágina
}
```

`refrescarMovimientos()` hace exactamente 1 llamada RPC (`fn_home_dashboard`) y llama a `aplicarDashboard()`:

```typescript
// home.page.ts
async refrescarMovimientos() {
  this.cargandoMovimientos = true;
  try {
    const dashboard = await this.turnosCajaService.obtenerHomeDashboard();
    this.aplicarDashboard(dashboard);
  } finally {
    this.cargandoMovimientos = false;
    this.cdr.detectChanges();
  }
}
```

### Operaciones de Caja: `cargarOperaciones(reset = true)`

La página de operaciones de una caja no tiene `refrescarMovimientos()`. Después de registrar, simplemente recarga desde página 0:

```typescript
// operaciones-caja.page.ts
async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
  const success = await this.service.registrarOperacion(...);
  if (success) await this.cargarOperaciones(true);
}
```

El saldo del header (`cajaSaldo`) **no se recarga aquí** — la Capa 1 ya lo actualizó vía `cajas$` en cuanto la BD escribió el nuevo `saldo_actual`.

---

## Carga inicial: stale-while-revalidate

El Home implementa arranque instantáneo. Al abrir la app en frío, si hay un snapshot del dashboard guardado del mismo día y el mismo negocio, se pinta inmediatamente — sin skeleton — mientras la RPC real corre en background:

```typescript
// home.page.ts — cargarDatos()
async cargarDatos(silencioso = false) {
  if (!silencioso) {
    const snapshot = await this.turnosCajaService.obtenerHomeDashboardCacheado();
    if (snapshot) {
      this.aplicarDashboard(snapshot);
      this.cargando = false;
      this.cdr.detectChanges();
      // la RPC sigue corriendo abajo y reemplaza el snapshot con datos frescos
    } else {
      this.cargando = true;  // sin snapshot: skeleton normal
    }
  }
  // ...fetch real a fn_home_dashboard...
}
```

El snapshot se invalida automáticamente al cambiar de día (los turnos son diarios) y al cambiar de negocio. Se borra en logout vía `registerBeforeCleanup()`.

---

## Gotcha: Supabase INSERT devuelve `data: null`

Las mutaciones sin `.select()` retornan `data: null` aunque hayan tenido éxito. Verificar `error === null`, no `data !== null`.

En funciones RPC (`supabase.client.rpc()`), el patrón estándar es verificar el campo `success` del JSON de respuesta, que las funciones SQL del proyecto devuelven explícitamente:

```typescript
// Patrón para RPCs con lógica de negocio
const { data, error } = await this.supabase.client.rpc('fn_registrar_operacion_manual', { ... });

if (error) {
  // error.message puede contener 'superadmin_blocked:...' — extraer con regex
  const superadminMatch = error.message?.match(/superadmin_blocked:\s*(.+)/i);
  await this.ui.showError(superadminMatch ? superadminMatch[1].trim() : 'Error al registrar');
  return false;
}

if (!data?.success) {
  await this.ui.showError(data?.error || 'Error desconocido');
  return false;
}

return true;
```

Para mutaciones directas sobre tablas (sin RPC), el patrón es `.select().single()` si se necesita el registro devuelto, o verificar `error === null` si no:

```typescript
// Con dato de retorno
const caja = await this.supabase.call<Caja>(
  this.supabase.client.from('cajas').update({ nombre }).eq('id', id).select(...).single(),
  'Caja actualizada'
);

// Sin dato de retorno — verificar con call() que retorna null en error
const result = await this.supabase.call(
  this.supabase.client.from('tabla').insert(payload),
  'Guardado'
);
if (result !== null) { /* éxito */ }
```

> `supabase.call()` retorna `null` en error (ya mostró el toast) y el dato de la respuesta en éxito. Para INSERT/UPDATE sin `.select()`, ese dato es `null` aunque todo haya ido bien — es la única excepción donde `null` no significa error.
