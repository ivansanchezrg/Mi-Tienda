# Plan de Migración a Multicaja

Migración del modelo actual (1 turno por negocio) al modelo multicaja (1 turno por caja física).
Diseñado para ser **transparente hacia atrás**: tiendas con 1 cajero no cambian su flujo en absoluto.

**Estado general:** `[~] Preparación BD completada — Fases 1-2 parcialmente ejecutadas`
**Última revisión:** 2026-06-10 — prep BD verificada contra el código ✅; agregada sección
"Realidades post-plan" (offline POS, fn_home_dashboard, funciones nuevas mono-caja) que las
Fases 3-9 deben incorporar antes de implementarse.

---

## Contexto y decisión arquitectónica

### Modelo actual
- `turnos_caja` no tiene `caja_id` — el turno pertenece al negocio, no a una caja específica.
- La validación "solo 1 turno abierto" se hace por `negocio_id` en `fn_abrir_turno`.
- El POS asume que el turno abierto es el único y de la caja implícita `CAJA_CHICA`.

### Modelo objetivo
- Cada `turnos_caja` pertenece a una `caja_id` específica.
- Pueden coexistir múltiples turnos abiertos (uno por caja con `puede_tener_turno = true`).
- Para negocios con 1 cajero: flujo idéntico al actual (sin selector de caja).
- Para negocios con 2+ cajeros: selector de caja al abrir turno.

### Impacto en cada capa

| Capa | Archivos afectados | Complejidad |
|------|--------------------|-------------|
| BD — schema | `schema.sql` | Baja |
| BD — funciones SQL | 4 funciones | Media |
| Modelos TS | 2 modelos | Baja |
| Servicios TS | 3 servicios | Media |
| Guard | `caja-abierta.guard.ts` | Baja |
| Layout / tabs | `main-layout.page.ts/html` | Baja |
| Home (caja) | `home.page.ts/html/scss` | Alta |
| POS | `pos.page.ts`, `pos.service.ts` | Baja |
| Cierre diario | `cierre-diario.page.ts/html` | Media |
| Configuración | Página + modal nuevos + función SQL | Media |

---

## ✅ Preparación BD ya ejecutada (2026-05-27)

Cambios aplicados al schema y funciones sin romper la app actual. Estos cambios se pueden ejecutar en Supabase hoy, antes de implementar el resto del plan.

### ALTER TABLE a ejecutar en Supabase

```sql
-- 1. Columna puede_tener_turno en cajas (DEFAULT false para no romper filas existentes)
ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS puede_tener_turno BOOLEAN NOT NULL DEFAULT false;

-- 2. Actualizar cajas existentes: CAJA_CHICA = true, resto = false
UPDATE cajas SET puede_tener_turno = true  WHERE codigo = 'CAJA_CHICA';
UPDATE cajas SET puede_tener_turno = false WHERE codigo IN ('CAJA', 'VARIOS', 'CAJA_CELULAR', 'CAJA_BUS');

-- 3. Columna caja_id en turnos_caja (nullable — se poblará automáticamente desde hoy via fn_abrir_turno v2.1)
ALTER TABLE turnos_caja
  ADD COLUMN IF NOT EXISTS caja_id UUID REFERENCES cajas(id) ON DELETE RESTRICT;

-- 4. Poblar caja_id en turnos existentes (retrocompatibilidad)
UPDATE turnos_caja t
SET caja_id = (
    SELECT c.id FROM cajas c
    WHERE c.negocio_id = t.negocio_id AND c.codigo = 'CAJA_CHICA'
    LIMIT 1
)
WHERE t.caja_id IS NULL;

-- 5. Índice de búsqueda por caja_id
CREATE INDEX IF NOT EXISTS idx_turnos_caja_id
    ON turnos_caja(caja_id) WHERE caja_id IS NOT NULL;

-- 6. Índice único: solo 1 turno abierto por caja a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_un_turno_abierto_por_caja
    ON turnos_caja(caja_id)
    WHERE hora_fecha_cierre IS NULL AND caja_id IS NOT NULL;

-- 7. Reemplazar índice de fecha+numero para incluir caja_id
DROP INDEX IF EXISTS idx_turnos_caja_fecha_turno;
CREATE UNIQUE INDEX IF NOT EXISTS idx_turnos_caja_fecha_turno
    ON turnos_caja(
        negocio_id,
        caja_id,
        (CAST(hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS date)),
        numero_turno
    );
```

### Funciones a re-ejecutar en Supabase

Ejecutar estos archivos en el **SQL Editor de Supabase**, en este orden:

1. `docs/caja/sql/functions/fn_abrir_turno.sql` — v2.1: auto-resuelve `caja_id = CAJA_CHICA` sin cambiar la firma. Desde hoy cada turno nuevo tendrá `caja_id` poblado.
2. `docs/onboarding/sql/functions/fn_completar_onboarding.sql` — INSERT de cajas incluye `puede_tener_turno` correcto.
3. `docs/onboarding/sql/functions/fn_configurar_modulos.sql` — INSERT de CAJA_CELULAR/CAJA_BUS/VARIOS incluye `puede_tener_turno = FALSE`.
4. `docs/admin/sql/functions/fn_configurar_modulos_admin.sql` — Igual que el anterior, para el flujo desde `/admin`.

### Qué queda pendiente para el futuro (cuando se implemente multicaja)

- Columna `caja_id` en `turnos_caja` pasar de nullable a `NOT NULL` (un simple `ALTER TABLE ... SET NOT NULL` cuando todos los turnos estén poblados).
- Cambiar firma de `fn_abrir_turno` para aceptar `p_caja_id` explícito (en lugar del auto-resolve actual).
- Resto del plan (Fases 1–9 abajo).

---

## ⚠️ Realidades post-plan a incorporar (revisión 2026-06-10)

Este plan se escribió el 2026-05-27. Desde entonces se construyeron features que **asumen
mono-caja** y que las Fases 3-9 DEBEN contemplar — implementarlas tal como están escritas
abajo rompería estas piezas en silencio:

### A. Capa offline del POS (2026-06-10 — ver `PLAN-OFFLINE-POS-2026-06-08.md`)

| Pieza | Supuesto mono-caja que rompe | Qué necesita multicaja |
|---|---|---|
| `TurnoLocalService` / tabla local `turno_activo_local` | `negocio_id` es PRIMARY KEY — "1 turno abierto por negocio" explícito en el schema local (`local-db.service.ts`) | Snapshot con `caja_id`; la clave pasa a ser el turno del EMPLEADO (o negocio+caja). Migrar el schema local (SQLite/IndexedDB) con versión nueva |
| `PosService.resolverTurno()` | Lee `turnosService.turnoActivoValue` (turno global único) | Resolver el turno DEL empleado actual desde el mapa `_turnosActivosPorCaja$` (Fase 4.1f) |
| Barrera del cierre (`colaSincronizadaParaCerrar()` en `cierre-diario.page.ts`) | `outbox.cantidadPendientes()` cuenta TODAS las ventas en cola del negocio | Contar solo las del `turno_id`/caja que se cierra — sin esto, cerrar la caja A se bloquea por ventas en cola de la caja B |
| `cajaAbiertaGuard` (fallback offline) | Valida `snapshot.empleadoId === usuario.id` sobre el único snapshot | Sigue válido si el snapshot pasa a ser "el turno del empleado"; revisar al cambiar la clave |
| `OutboxService` | Guarda `turno_id` por venta — OK | Sin cambio (la caja viaja implícita en el turno) |

### B. `fn_home_dashboard` + cache del home (2026-05-30 / 2026-06-10)

La Fase 6 dice "cargar con `getCajasConTurno()`", pero el home real ya no funciona así:
usa la RPC consolidada `fn_home_dashboard` (que devuelve UN `turno_activo` global en
`estado_caja`) + snapshot stale-while-revalidate en Preferences (`obtenerHomeDashboardCacheado()`,
ver `PERFORMANCE-STARTUP.md` §10). **La Fase 6 real es evolucionar `fn_home_dashboard`**
(estado de turno POR caja en el JSON) y adaptar `aplicarDashboard()`/el snapshot — no
reemplazar la carga por queries sueltas.

### C. Funciones nuevas con supuesto mono-caja (no listadas en las fases)

- `fn_obtener_deficit_turno_anterior` (2026-06-03) — busca el último turno del NEGOCIO;
  con multicaja el déficit es por caja.
- `fn_listar_cierres_turno` v2.1 + historial de turnos (v6.3) — listan cierres por negocio;
  necesitarán filtro/columna de caja en la UI.
- `fn_datos_cierre_diario` — consolida datos del cierre asumiendo el turno único.

> Regla para quien implemente: antes de empezar la Fase 3, re-auditar
> `grep -r "CAJA_CHICA" docs/**/sql src/` — toda referencia hardcodeada es un candidato
> a romperse con un segundo cajón.

---

## Fase 1 — Base de datos: schema

**Estado:** `[x] Completado` (ver sección "Preparación BD ya ejecutada" arriba)

Todo el schema se ejecuta antes que cualquier cambio de código. Sin estos cambios el resto no compila.

### 1.1 — Columna `puede_tener_turno` en `cajas`

Diferencia cajas operativas (cajón con cajero asignado) de cajas contables (vault, fondos, digitales).

**Archivo:** `docs/setup/schema.sql` (tabla `cajas`, línea ~231)

```sql
-- Agregar columna en la definición de cajas
puede_tener_turno  BOOLEAN NOT NULL DEFAULT false
```

Valor por caja según tipo:

| Código | `puede_tener_turno` | Razón |
|--------|---------------------|-------|
| `CAJA_CHICA` | `true` | Cajón físico diario — siempre tiene cajero |
| `CAJA` | `false` | Vault — recibe depósitos, no tiene cajero |
| `VARIOS` | `false` | Fondo de emergencia — no tiene cajero |
| `CAJA_CELULAR` | `false` | Digital — no tiene cajero |
| `CAJA_BUS` | `false` | Digital — no tiene cajero |

Script de migración para negocios existentes:
```sql
UPDATE cajas SET puede_tener_turno = true  WHERE codigo = 'CAJA_CHICA';
UPDATE cajas SET puede_tener_turno = false WHERE codigo IN ('CAJA', 'VARIOS', 'CAJA_CELULAR', 'CAJA_BUS');
```

### 1.2 — Columna `caja_id` en `turnos_caja`

**Archivo:** `docs/setup/schema.sql` (tabla `turnos_caja`, línea ~272)

```sql
-- Agregar columna en la definición de turnos_caja
caja_id  UUID NOT NULL REFERENCES cajas(id) ON DELETE RESTRICT
```

`ON DELETE RESTRICT` — nunca borrar una caja que tenga turnos históricos.

Migración de datos existentes (si hay registros):
```sql
-- Paso 1: agregar nullable primero
ALTER TABLE turnos_caja ADD COLUMN caja_id UUID REFERENCES cajas(id) ON DELETE RESTRICT;

-- Paso 2: poblar con CAJA_CHICA de cada negocio
UPDATE turnos_caja t
SET caja_id = (
    SELECT c.id FROM cajas c
    WHERE c.negocio_id = t.negocio_id AND c.codigo = 'CAJA_CHICA'
    LIMIT 1
)
WHERE t.caja_id IS NULL;

-- Paso 3: poner NOT NULL
ALTER TABLE turnos_caja ALTER COLUMN caja_id SET NOT NULL;
```

### 1.3 — Actualizar índice único de turnos

**Archivo:** `docs/setup/schema.sql` (línea ~674)

El índice único actual garantiza que no haya dos registros del mismo turno en el mismo día del mismo negocio. Con multicaja debe incluir `caja_id`:

```sql
-- Eliminar índice actual
DROP INDEX IF EXISTS idx_turnos_caja_fecha_turno;

-- Nuevo índice único: 1 numero_turno por (negocio, caja, día)
CREATE UNIQUE INDEX idx_turnos_caja_fecha_turno
    ON turnos_caja(
        negocio_id,
        caja_id,
        (CAST(hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS date)),
        numero_turno
    );
```

### 1.4 — Índice único: solo 1 turno abierto por caja

Constraint a nivel de BD — no puede haber dos turnos sin `hora_fecha_cierre` en la misma caja. Es el reemplazo del guard que hoy hace `fn_abrir_turno` por código.

**Archivo:** `docs/setup/schema.sql` (sección de índices, línea ~680)

```sql
CREATE UNIQUE INDEX idx_un_turno_abierto_por_caja
    ON turnos_caja(caja_id)
    WHERE hora_fecha_cierre IS NULL;
```

### 1.5 — Índice de búsqueda por `caja_id`

Para que las queries por caja sean eficientes:

```sql
CREATE INDEX IF NOT EXISTS idx_turnos_caja_id
    ON turnos_caja(caja_id, hora_fecha_cierre);
```

**Checklist Fase 1:**
- [x] 1.1 — Columna `puede_tener_turno` en `cajas` (schema.sql + script migración negocios existentes)
- [x] 1.2 — Columna `caja_id` en `turnos_caja` (nullable — se hace NOT NULL en la migración final)
- [x] 1.3 — Índice único `idx_turnos_caja_fecha_turno` actualizado (negocio + caja + día + numero)
- [x] 1.4 — Índice único `idx_un_turno_abierto_por_caja` (partial index, `WHERE hora_fecha_cierre IS NULL AND caja_id IS NOT NULL`)
- [x] 1.5 — Índice `idx_turnos_caja_id` para búsquedas por caja

---

## Fase 2 — Base de datos: funciones SQL

**Estado:** `[~] Parcialmente completado` (2.1 y 2.4 ya aplicados; 2.2, 2.3, 2.5, 2.6 pendientes para cuando se implemente multicaja)

### 2.1 — `fn_abrir_turno` — nueva firma con `p_caja_id`

**Archivo:** `docs/caja/sql/functions/fn_abrir_turno.sql`

Firma actual: `fn_abrir_turno(p_empleado_id UUID)`
Firma nueva: `fn_abrir_turno(p_empleado_id UUID, p_caja_id UUID)`

Cambios internos:
- Agregar `v_caja_id UUID;` en DECLARE.
- Validar que `p_caja_id` pertenece al negocio del JWT Y tiene `puede_tener_turno = true` Y `activo = true`.
- Reemplazar el guard `WHERE negocio_id = v_negocio_id AND hora_fecha_cierre IS NULL` por `WHERE caja_id = p_caja_id AND hora_fecha_cierre IS NULL` (el índice único 1.4 también lo protege).
- `numero_turno`: contar solo los turnos de ESA CAJA ese día (no todos los del negocio).
- INSERT incluye `caja_id = p_caja_id`.
- Respuesta JSON incluye `caja_id`.
- Actualizar DROP, GRANT, COMMENT.

```sql
-- Nuevas validaciones a reemplazar (bloque IF EXISTS actual)
IF NOT EXISTS (
    SELECT 1 FROM cajas
    WHERE id = p_caja_id
      AND negocio_id = v_negocio_id
      AND puede_tener_turno = true
      AND activo = true
) THEN
    RETURN json_build_object('success', false, 'error', 'Caja no válida para abrir turno');
END IF;

IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE caja_id = p_caja_id
      AND hora_fecha_cierre IS NULL
) THEN
    RETURN json_build_object('success', false, 'error', 'Esta caja ya tiene un turno abierto');
END IF;
```

### 2.2 — `fn_ejecutar_cierre_diario_v5` — validar `caja_id`

**Archivo:** `docs/caja/sql/functions/fn_ejecutar_cierre_diario_v5.sql`

La función ya recibe `p_turno_id` — el turno tiene `caja_id` embebido. No necesita nuevo parámetro de firma.

Cambio necesario: al recuperar el turno al inicio, hacer JOIN con `cajas` para leer `caja_id` y usarlo en las transferencias internas (si hoy asume hardcoded `CAJA_CHICA`).

Revisar específicamente:
- Cualquier `WHERE codigo = 'CAJA_CHICA'` que no esté ya filtrado por `negocio_id` — con multicaja podría haber más de un cajón, así que debe preferirse `JOIN turnos_caja → cajas` para saber la caja del turno.
- El campo `caja_id` del turno recuperado debe usarse en las operaciones de transferencia al vault.

### 2.3 — `fn_reparar_deficit_turno` — nueva firma con `p_caja_id`

**Archivo:** `docs/caja/sql/functions/fn_reparar_deficit_turno.sql`

La función abre un nuevo turno internamente. Necesita saber a qué caja:

Firma actual (tras migración de categorías 2026-06-02): `(p_empleado_id UUID, p_deficit_varios DECIMAL, p_fondo_apertura DECIMAL)` — las categorías de ajuste son constantes internas de `categorias_sistema`.
Firma nueva: agregar `p_caja_id UUID`.

El INSERT de `turnos_caja` interno debe incluir `caja_id = p_caja_id`.

### 2.4 — `fn_completar_onboarding` — `CAJA_CHICA` con `puede_tener_turno = true`

**Archivo:** `docs/onboarding/sql/functions/fn_completar_onboarding.sql` (o equivalente)

Al crear el negocio, el INSERT de `CAJA_CHICA` debe incluir `puede_tener_turno = true`. El resto de las cajas base (`CAJA`, `VARIOS`) se crean con `false`.

### 2.5 — Verificar `fn_registrar_venta_pos` (sin cambio de firma)

**Archivo:** `docs/pos/sql/functions/fn_registrar_venta_pos.sql`

Recibe `p_turno_id` — la caja está implícita en el turno. No requiere cambio de firma.

Verificar que internamente no busque `CAJA_CHICA` por código sin filtrar por la caja del turno. Si lo hace, usar JOIN `turnos_caja → cajas` para obtener la caja real.

### 2.6 — Verificar trigger `trg_actualizar_caja_por_venta`

**Archivo:** `docs/pos/sql/triggers/trg_actualizar_caja_por_venta.sql`

Verificar si hay `WHERE codigo = 'CAJA_CHICA'` sin filtro de caja. Con multicaja, el trigger debe obtener la `caja_id` del turno de la venta y acreditar el saldo a esa caja, no a "la CAJA_CHICA" hardcodeada.

Cambio: `JOIN ventas → turnos_caja → cajas` para saber en qué cajón físico acreditar.

**Checklist Fase 2:**
- [x] 2.1 — `fn_abrir_turno` v2.1: auto-resuelve `caja_id = CAJA_CHICA` y lo persiste en el INSERT. Firma sin cambio (preparada para multicaja: reemplazar auto-resolve por `p_caja_id` explícito)
- [ ] 2.2 — `fn_ejecutar_cierre_diario_v5` verificada (JOIN a cajas para obtener `caja_id` del turno, no hardcoded `CAJA_CHICA`) — pendiente para multicaja
- [ ] 2.3 — `fn_reparar_deficit_turno` actualizada (nueva firma con `p_caja_id`) — pendiente para multicaja
- [x] 2.4 — `fn_completar_onboarding` actualizada (`CAJA_CHICA` con `puede_tener_turno = true`, otras cajas con `false`)
- [x] 2.4b — `fn_configurar_modulos` y `fn_configurar_modulos_admin` actualizadas (CAJA_CELULAR, CAJA_BUS, VARIOS con `puede_tener_turno = FALSE`)
- [ ] 2.5 — `fn_registrar_venta_pos` verificada (sin cambio de firma, revisar referencias a `CAJA_CHICA`) — pendiente para multicaja
- [ ] 2.6 — Trigger `trg_actualizar_caja_por_venta` verificado (caja del turno, no hardcoded) — pendiente para multicaja

---

## Fase 3 — Modelos TypeScript

**Estado:** `[ ] Pendiente`

### 3.1 — `turno-caja.model.ts`

**Archivo:** `src/app/features/caja/models/turno-caja.model.ts`

Agregar `caja_id` y datos JOIN de la caja:

```typescript
export interface TurnoCaja {
  id: string;
  negocio_id: string;
  caja_id: string;          // NUEVO
  numero_turno: number;
  empleado_id: string;
  hora_fecha_apertura: string;
  hora_fecha_cierre: string | null;
  fondo_apertura: number;   // monto declarado libremente al abrir el turno
}

export interface TurnoCajaConEmpleado extends TurnoCaja {
  empleado?: { id: string; nombre: string; };
  caja?: { id: string; codigo: string; nombre: string; };  // NUEVO — JOIN opcional
}
```

### 3.2 — Interface `Caja` en `cajas.service.ts`

**Archivo:** `src/app/features/caja/services/cajas.service.ts` (líneas ~9–19)

```typescript
export interface Caja {
  // ...campos actuales...
  puede_tener_turno: boolean;  // NUEVO
}
```

**Checklist Fase 3:**
- [ ] 3.1 — `TurnoCaja` y `TurnoCajaConEmpleado` con `caja_id` y join `caja`
- [ ] 3.2 — Interface `Caja` con `puede_tener_turno`

---

## Fase 4 — Servicios TypeScript

**Estado:** `[ ] Pendiente`

### 4.1 — `TurnosCajaService`

**Archivo:** `src/app/features/caja/services/turnos-caja.service.ts`

#### A) `abrirTurno(cajaId: string)` — nueva firma
Actualmente no recibe parámetros. Pasar `p_caja_id` al RPC:
```typescript
async abrirTurno(cajaId: string): Promise<boolean>
// rpc('fn_abrir_turno', { p_empleado_id, p_caja_id: cajaId })
```

#### B) `obtenerTurnoActivo(cajaId?: string)` — opcional por caja
Con multicaja puede haber varios abiertos. Agregar parámetro opcional para filtrar:
```typescript
async obtenerTurnoActivo(cajaId?: string): Promise<TurnoCajaConEmpleado | null>
// Si cajaId: WHERE caja_id = cajaId AND hora_fecha_cierre IS NULL
// Si no: buscar turno del empleado actual (compatibilidad legacy)
```

Incluir en el SELECT: `caja:cajas(id, codigo, nombre)` para que el modelo venga con datos de caja.

#### C) `obtenerEstadoCaja(cajaId: string)` — nueva firma
Agregar parámetro:
```typescript
async obtenerEstadoCaja(cajaId: string): Promise<EstadoCaja>
```

#### D) `obtenerTurnosDeFecha(fecha?, cajaId?)` — parámetro opcional
```typescript
async obtenerTurnosDeFecha(fecha?: string, cajaId?: string): Promise<TurnoCajaConEmpleado[]>
```

#### E) `repararDeficit(cajaId, ...)` — nueva firma
Agregar `cajaId` para pasarlo a `fn_reparar_deficit_turno`:
```typescript
async repararDeficit(cajaId: string, deficitVarios: number, fondoApertura: number): Promise<...>
```

#### F) Estado reactivo — agregar `_turnosActivosPorCaja$`
Mantener `_turnoActivo$` y `esMiTurno$` existentes (para compatibilidad con guard y POS).
Agregar nuevo observable para el dashboard multicaja:
```typescript
// Mapa: caja_id → TurnoCajaConEmpleado | null
private readonly _turnosActivosPorCaja$ = new BehaviorSubject<Map<string, TurnoCajaConEmpleado | null>>(new Map());
readonly turnosActivosPorCaja$ = this._turnosActivosPorCaja$.asObservable();
```

`inicializarEstadoReactivo()` debe poblar este mapa consultando todas las cajas con `puede_tener_turno = true`.

El listener Realtime de `turnos_caja` debe actualizar el mapa cuando llega un evento (apertura/cierre).

### 4.2 — `CajasService`

**Archivo:** `src/app/features/caja/services/cajas.service.ts`

#### A) Nuevo método `getCajasConTurno()`
Devuelve las cajas que pueden tener turno, con su turno activo cargado:
```typescript
async getCajasConTurno(): Promise<(Caja & { turno_activo: TurnoCajaConEmpleado | null })[]>
// SELECT cajas.*, turno (LEFT JOIN) WHERE puede_tener_turno = true AND activo = true
```

#### B) Nuevo método `getCajasParaAbrirTurno()`
Solo las cajas con `puede_tener_turno = true`, sin turno abierto actualmente:
```typescript
async getCajasParaAbrirTurno(): Promise<Caja[]>
```

### 4.3 — `PosService`

**Archivo:** `src/app/features/pos/services/pos.service.ts`

#### A) `hayTurnoActivo(cajaId?: string)`
Actualmente no filtra por caja. Agregar parámetro opcional:
```typescript
async hayTurnoActivo(cajaId?: string): Promise<boolean>
```

Con multicaja, la verificación antes del cobro debe ser específica de la caja del POS activo.

#### B) `obtenerTurnoActivo(cajaId?: string)` — si lo llama internamente
Verificar que la llamada a `TurnosCajaService.obtenerTurnoActivo()` pase el `cajaId` correcto.

**Checklist Fase 4:**
- [ ] 4.1a — `TurnosCajaService.abrirTurno(cajaId)` con nueva firma y `p_caja_id` en RPC
- [ ] 4.1b — `TurnosCajaService.obtenerTurnoActivo(cajaId?)` con SELECT que incluye JOIN caja
- [ ] 4.1c — `TurnosCajaService.obtenerEstadoCaja(cajaId)` con nueva firma
- [ ] 4.1d — `TurnosCajaService.obtenerTurnosDeFecha(fecha?, cajaId?)` con parámetro opcional
- [ ] 4.1e — `TurnosCajaService.repararDeficit(cajaId, ...)` con nueva firma
- [ ] 4.1f — `_turnosActivosPorCaja$` agregado + `inicializarEstadoReactivo()` lo puebla + Realtime lo actualiza
- [ ] 4.2a — `CajasService.getCajasConTurno()` implementado
- [ ] 4.2b — `CajasService.getCajasParaAbrirTurno()` implementado
- [ ] 4.3a — `PosService.hayTurnoActivo(cajaId?)` con parámetro opcional
- [ ] 4.3b — Verificar que `PosService` pasa `cajaId` correcto a `TurnosCajaService`

---

## Fase 5 — Guard y Layout

**Estado:** `[ ] Pendiente`

### 5.1 — `caja-abierta.guard.ts`

**Archivo:** `src/app/core/guards/caja-abierta.guard.ts`

Actualmente verifica `esMiTurnoValue` global.

Con multicaja, `esMiTurno$` sigue siendo válido — el empleado tiene turno en ALGUNA caja. El guard no necesita saber en cuál. Sin cambio funcional.

Único ajuste: el mensaje cuando hay turno pero no es del usuario. Actualmente muestra el nombre del empleado del turno único. Con multicaja, si dos cajas están abiertas con distintos empleados, el mensaje podría no aplicar. Revisar lógica para mostrar el turno más relevante (o simplemente "otro empleado ya abrió una caja").

### 5.2 — `main-layout.page.ts` / `.html`

**Archivos:**
- `src/app/features/layout/pages/main/main-layout.page.ts`
- `src/app/features/layout/pages/main/main-layout.page.html`

`posHabilitado` se basa en `esMiTurno$` — sin cambio.

`posDisabledMessage` — actualmente usa `turnoActivo$.empleado.nombre`. Con multicaja, `turnoActivo$` podría ser null aunque haya turnos de otras cajas. Ajustar lógica:
- Si hay turnos abiertos pero ninguno es del usuario → mostrar "Caja ocupada" genérico o lista de cajas ocupadas.
- Si no hay ningún turno → "Abre la caja desde Inicio para usar el POS".

**Checklist Fase 5:**
- [ ] 5.1 — `caja-abierta.guard.ts` verificado (lógica válida, ajuste de mensaje si hay múltiples turnos)
- [ ] 5.2 — `main-layout.page.ts` — `posDisabledMessage` adaptado para múltiples turnos activos

---

## Fase 6 — Home de caja (UI principal)

**Estado:** `[ ] Pendiente`

Es la fase de mayor cambio visible. El Home pasa de mostrar estado global a mostrar estado por caja.

### 6.1 — `home.page.ts`

**Archivo:** `src/app/features/caja/pages/home/home.page.ts`

#### A) Eliminar estado global de turno, reemplazar por mapa por caja
```typescript
// ANTES
cajaAbierta = false;
turnoActivo: TurnoCajaConEmpleado | null = null;
esMiTurno = false;

// DESPUÉS — mantener para compatibilidad con 1 caja, agregar mapa
cajasConTurno: (Caja & { turno_activo: TurnoCajaConEmpleado | null })[] = [];
```

#### B) `abrirTurno()` — recibe `cajaId`
```typescript
async abrirTurno(cajaId: string): Promise<void>
```
Si solo hay 1 caja disponible: abrir directo (sin modal).
Si hay 2+ cajas sin turno: mostrar `OptionsModalComponent` con las opciones.

#### C) Cierre, operaciones, traspasos — pasar `cajaId` explícito
Actualmente estas acciones asumen la caja del turno implícito. Ahora deben recibir `cajaId` del turno de la caja seleccionada.

#### D) `cargarDatos()` — usar `getCajasConTurno()`
Reemplazar la carga actual de estado de turno por `CajasService.getCajasConTurno()` para obtener todas las cajas con su estado de turno.

### 6.2 — `home.page.html`

**Archivo:** `src/app/features/caja/pages/home/home.page.html`

#### A) Cards de cajas — iterar con `@for`
Reemplazar el estado global (1 indicador) por una card por caja:
```html
@for (caja of cajasConTurno; track caja.id) {
  <div class="caja-card" [class.caja-card--abierta]="caja.turno_activo">
    <!-- nombre, saldo, estado del turno, botón abrir/cerrar -->
  </div>
}
```

Para negocios con 1 caja: exactamente igual visualmente a hoy.
Para negocios con 2+ cajas: cards lado a lado o apiladas.

#### B) Botones de acción (abrir turno, operaciones, cierre)
Cada card tiene sus propios botones contextuales según estado:
- Sin turno: botón "Abrir turno"
- Con turno: botones "Operación", "Traspaso", "Cerrar"
- Con turno de otro empleado: solo lectura (saldo, info)

### 6.3 — `home.page.scss`

**Archivo:** `src/app/features/caja/pages/home/home.page.scss`

Nuevas clases para la grid de cajas:
- `.cajas-grid` — layout flex/grid que se adapta a 1, 2 o 3 cajas
- `.caja-card--abierta` / `.caja-card--cerrada` — estados visuales
- Para 1 caja: ocupa el 100% (sin cambio visual respecto a hoy)
- Para 2+ cajas: grid de 2 columnas en mobile, 3 en tablet

**Checklist Fase 6:**
- [ ] 6.1a — `home.page.ts` carga `cajasConTurno` desde `CajasService.getCajasConTurno()`
- [ ] 6.1b — `abrirTurno(cajaId)` con lógica 1-caja (directo) / N-cajas (modal selector)
- [ ] 6.1c — Operaciones, traspasos y cierre pasan `cajaId` explícito
- [ ] 6.2a — `home.page.html` con `@for` sobre cajas (card por caja)
- [ ] 6.2b — Botones contextuales por card según estado del turno
- [ ] 6.3  — `home.page.scss` con `.cajas-grid` y estados visuales por caja

---

## Fase 7 — POS

**Estado:** `[ ] Pendiente`

El POS es la sección que menos cambia. El turno sigue siendo único por empleado en uso.

### 7.1 — `pos.page.ts`

**Archivo:** `src/app/features/pos/pages/pos/pos.page.ts`

- Verificar que `hayTurnoActivo()` y el cobro usen `turnoActivo.caja_id` al llamar a `PosService`.
- Si el usuario tiene turno en caja específica, esa `caja_id` se pasa al procesar la venta.
- Sin cambios visibles en la UI del POS.

### 7.2 — `pos.service.ts`

**Archivo:** `src/app/features/pos/services/pos.service.ts`

- `procesarVenta()` — verificar que el `turno_id` que pasa a `fn_registrar_venta_pos` ya trae `caja_id` en el turno.
- `hayTurnoActivo(cajaId?)` — ajuste del método según cambio en Fase 4.

**Checklist Fase 7:**
- [ ] 7.1 — `pos.page.ts` verificado (pasa `caja_id` correcto en cobro)
- [ ] 7.2 — `pos.service.ts` ajustado (`hayTurnoActivo` y `procesarVenta` con `caja_id` explícito)

---

## Fase 8 — Cierre diario

**Estado:** `[ ] Pendiente`

### 8.1 — `cierre-diario.page.ts` (o wizard de cierre)

**Archivo:** `src/app/features/caja/pages/cierre-diario/` (o equivalente)

Con multicaja, el cierre es por caja. El empleado solo puede cerrar el turno de SU caja.

Cambios:
- Al entrar al wizard de cierre, pasar `cajaId` del turno activo del usuario.
- Si el usuario tiene turno en caja X, el cierre es de caja X.
- `fn_ejecutar_cierre_diario_v5` ya recibe `p_turno_id` — el turno tiene `caja_id`. Sin cambio de firma.
- Verificar que los resúmenes y cálculos del wizard sean específicos de esa caja.

### 8.2 — `operaciones-caja.page.ts` / `.html`

**Archivo:** `src/app/features/caja/pages/operaciones-caja/operaciones-caja.page.ts`

Las operaciones ya están ligadas a `caja_id` directamente (no via turno). Sin cambio de lógica.

Verificar que los filtros de lista usen el `caja_id` correcto cuando hay múltiples cajas abiertas.

**Checklist Fase 8:**
- [ ] 8.1 — Wizard de cierre pasa `cajaId` del turno activo del usuario
- [ ] 8.2 — `operaciones-caja.page.ts` verificado (filtros por `caja_id` correctos)

---

## Fase 9 — Configuración: gestión de cajas operativas

**Estado:** `[ ] Pendiente`

Sección nueva en `Configuración` (solo ADMIN) para gestionar cuántos cajones tiene el negocio.

### 9.1 — Función SQL `fn_crear_caja_operativa`

**Archivo nuevo:** `docs/caja/sql/functions/fn_crear_caja_operativa.sql`

```sql
fn_crear_caja_operativa(p_nombre VARCHAR, p_icono VARCHAR, p_color VARCHAR) RETURNS JSON
```

- Valida que el negocio no tenga más de 5 cajas operativas (`puede_tener_turno = true`).
- Genera `codigo` autoincrementado: `CAJA_CHICA_2`, `CAJA_CHICA_3`, etc.
- Crea la caja con `puede_tener_turno = true`, `activo = true`.
- `PERFORM public.fn_assert_no_superadmin();` al inicio.
- Agrega política RLS `superadmin_no_write` en `docs/setup/02_rls.sql` si no está ya.

### 9.2 — `ConfiguracionCajasPage` (página nueva)

**Ruta:** `src/app/features/configuracion/pages/cajas/configuracion-cajas.page.ts`

Lista todas las cajas del negocio con:
- Nombre, icono, color, saldo actual
- Badge: "Cajón" (puede_tener_turno) vs "Contable"
- Estado: activo / inactivo
- Turno abierto actualmente (si hay) con nombre del empleado

Solo ADMIN ve la opción de crear/desactivar.

### 9.3 — `NuevaCajaModal` (modal nuevo)

**Ruta:** `src/app/features/configuracion/components/nueva-caja-modal/`

Campos:
- Nombre (texto libre)
- Icono (selector con `OptionsModalComponent`)
- Color (selector de paleta)

Patrón `bottom-sheet-modal` estándar.

### 9.4 — Desactivar caja operativa

Solo si la caja no tiene turno abierto actualmente. Soft delete (`activo = false`).
Mostrar alerta de confirmación con `AlertController`.

### 9.5 — Rutas y navegación

**Archivo:** `src/app/features/configuracion/configuracion.routes.ts`

Agregar ruta:
```typescript
{ path: 'cajas', loadComponent: () => import('./pages/cajas/configuracion-cajas.page') }
```

**Archivo:** `src/app/core/config/routes.config.ts`

```typescript
configuracion: {
  // ...rutas actuales...
  cajas: '/configuracion/cajas',   // NUEVO
}
```

**Archivo:** `src/app/features/configuracion/pages/configuracion/configuracion.page.html`

Agregar ítem de menú "Cajas" visible solo para ADMIN.

**Checklist Fase 9:**
- [ ] 9.1 — `fn_crear_caja_operativa` SQL creada + política `superadmin_no_write` si aplica
- [ ] 9.2 — `ConfiguracionCajasPage` implementada (listado con estado de turno)
- [ ] 9.3 — `NuevaCajaModal` implementado (nombre, icono, color)
- [ ] 9.4 — Desactivar caja (solo si sin turno, confirmación alert)
- [ ] 9.5a — Ruta `configuracion/cajas` en `configuracion.routes.ts`
- [ ] 9.5b — `ROUTES.configuracion.cajas` en `routes.config.ts`
- [ ] 9.5c — Ítem de menú en `configuracion.page.html` (solo ADMIN)

---

## Reglas de compatibilidad hacia atrás

Estas reglas garantizan que negocios con 1 cajero no noten ningún cambio:

1. **1 sola caja con `puede_tener_turno = true`** → `abrirTurno()` abre directo sin selector.
2. **`esMiTurno$` y `cajaAbierta$`** → siguen funcionando igual (el turno único del usuario).
3. **POS** → sin cambios visuales, el turno del usuario ya identifica la caja.
4. **Dashboard Home** → con 1 caja, el `@for` produce exactamente 1 card, visualmente idéntico a hoy.
5. **Guard** → `esMiTurnoValue` sigue siendo el criterio de acceso al POS.

---

## Orden de ejecución y dependencias

```
Fase 1 (schema)
    ↓
Fase 2 (funciones SQL)        ← depende de Fase 1
    ↓
Fase 3 (modelos TS)           ← depende de Fase 1 (campos nuevos)
    ↓
Fase 4 (servicios TS)         ← depende de Fases 2 y 3
    ↓
Fase 5 (guard + layout)       ← depende de Fase 4
Fase 6 (home caja)            ← depende de Fase 4
Fase 7 (pos)                  ← depende de Fase 4
Fase 8 (cierre)               ← depende de Fase 4
    ↓
Fase 9 (configuración cajas)  ← depende de Fases 1-4 (puede hacerse en paralelo con 5-8)
```

Cada fase es deployable por separado. No iniciar Fase 6 sin Fase 4 completa.

---

## Archivos que NO requieren cambios

| Archivo | Por qué no cambia |
|---------|-------------------|
| `fn_registrar_venta_pos.sql` | Recibe `p_turno_id`; la caja es implícita via turno |
| `venta.model.ts` | Ya tiene `turno_id`; caja es implícita |
| `movimiento-empleado.model.ts` | `turno_id` opcional, caja implícita |
| `operaciones-caja.service.ts` | Las operaciones ya tienen `caja_id` propio |
| `recargas.service.ts` | Trabaja con `turno_id` existente |
| `auth.service.ts` | Sin relación con turno de caja |
| `rls (02_rls.sql)` | `cajas` y `turnos_caja` ya tienen sus políticas |
| `realtime_turnos_caja.sql` | Sin cambio; `caja_id` viaja en el payload automáticamente |
