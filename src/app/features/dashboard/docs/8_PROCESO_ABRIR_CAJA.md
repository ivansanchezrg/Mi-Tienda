# Proceso de Abrir Caja

Flujo completo para iniciar un turno de caja desde el Home.

## Relación con otros módulos

| Módulo | Doc | Qué hace |
|--------|-----|----------|
| **Este doc** | `8_PROCESO_ABRIR_CAJA.md` | Apertura de turno: modal de fondo + reparación de déficit + INSERT en `turnos_caja` |
| Cierre diario | `3_PROCESO_CIERRE_CAJA.md` | Cierre por turno: distribuye efectivo y cierra el turno abierto por este proceso |
| Ingreso/Egreso | `2_PROCESO_INGRESO_EGRESO.md` | Operaciones manuales que ocurren durante el turno abierto |
| Historial | `1_OPERACIONES-CAJA.md` | Visualización de las operaciones generadas durante el turno |

**Relación clave con el cierre:** Abrir caja crea el `turno_id` que el cierre diario necesita obligatoriamente. Sin turno abierto no se puede ejecutar `ejecutar_cierre_diario`.

---

## Descripción General

Abrir caja significa crear un nuevo **turno** en la tabla `turnos_caja`. Un turno es el período de trabajo entre apertura y cierre. El sistema permite múltiples turnos por día (ej: mañana y tarde), cada uno con su propio cierre contable.

**El turno NO afecta saldos** — solo registra quién está operando y desde cuándo.

Antes de abrir, el sistema verifica dos cosas:
1. **Déficit del turno anterior** — si el turno previo cerró con fondos insuficientes, el operador debe reponer el fondo y/o el monto pendiente de Varios antes de abrir
2. **Fondo fijo presente** — el operador confirma que el fondo físico ($40) está en la caja antes de operar

---

## Ubicación de Archivos

```
dashboard/
├── pages/
│   └── home/
│       ├── home.page.ts        → onAbrirCaja(), mostrarModalVerificacionFondo()
│       │                          VerificarFondoModalComponent (inline)
│       └── home.page.html      → botón "Abrir Caja" + banner de estado
├── services/
│   └── turnos-caja.service.ts  → abrirTurno(), obtenerEstadoCaja(), obtenerFondoFijo(),
│                                  obtenerDeficitTurnoAnterior(), repararDeficit()
└── models/
    └── turno-caja.model.ts     → TurnoCaja, TurnoCajaConEmpleado, EstadoCaja
```

---

## Flujo Completo

```
Usuario presiona "Abrir Caja"
        ↓
Home.onAbrirCaja()
  ├─ obtenerFondoFijo()          → $40 desde configuraciones
  └─ obtenerDeficitTurnoAnterior() → déficit pendiente del turno anterior (si existe)
        ↓
[Modal] VerificarFondoModalComponent (2 pasos)
  │
  ├─ PASO 1: Reparar Déficit (solo si hay déficit)
  │   → Muestra montos: fondoFaltante + deficitCajaChica
  │   → Instrucciones físicas numeradas
  │   → Usuario ejecuta acciones físicas
  │   → Botón "Confirmar Reposición"
  │       ↓
  │   turnosCajaService.repararDeficit()
  │       └─ RPC: reparar_deficit_turno
  │           ├─ EGRESO de Tienda (EG-012) por totalAReponer
  │           └─ INGRESO a Varios (IN-004) por deficitCajaChica (si > 0)
  │
  └─ PASO 2: Verificar Fondo
      → Muestra fondo fijo ($40)
      → Checkbox: "He verificado el fondo en la caja física"
      → Botón "Abrir Caja" habilitado solo con checkbox marcado
      → Modal retorna { confirmado: true, role: 'confirm' }
        ↓
[Service] abrirTurno()
  ├─ Valida: no hay turno abierto hoy (hora_cierre IS NULL)
  ├─ Obtiene empleado actual (desde Preferences, sin BD)
  ├─ Calcula número de turno (COUNT turnos hoy + 1)
  └─ INSERT turnos_caja
        ↓
Home.cargarDatos()
  └─ Refresca banner → "Caja Abierta · Turno N · Juan · 08:30 AM"
```

---

## Estados del Banner

El banner en Home refleja el estado actual de la caja:

| Estado | Condición en BD | Banner | Botón visible |
|--------|-----------------|--------|---------------|
| `SIN_ABRIR` | Sin turnos hoy | 🔴 Caja Cerrada | "Abrir Caja" |
| `TURNO_EN_CURSO` | Turno con `hora_cierre = NULL` | 🟢 Caja Abierta · empleado · hora | "Cerrar Turno" |
| `CERRADA` | Turnos hoy pero todos con `hora_cierre` | 🔴 Caja Cerrada | "Abrir Caja" |

El banner también muestra `turnosHoy` — cuántos turnos ya ocurrieron hoy — útil para saber si es el primer o segundo turno del día.

---

## Modal de Verificación de Fondo (2 Pasos)

### PASO 1 — Solo aparece si hay déficit del turno anterior

```
┌──────────────────────────────────┐
│   ⚠️  Reponer Déficit Anterior   │
│                                  │
│  Paso 1 de 2                     │
│                                  │
│  El turno anterior cerró con     │
│  fondos insuficientes.           │
│                                  │
│  Fondo faltante:     $20.00      │
│  Pendiente Varios:   $20.00      │
│  Total a reponer:    $40.00      │
│                                  │
│  Acciones físicas:               │
│  1. Toma $40.00 de la funda      │
│     TIENDA                       │
│  2. Coloca $20.00 en caja física │
│     (fondo para operar)          │
│  3. Coloca $20.00 en funda VARIOS│
│                                  │
│  [ Confirmar Reposición ]        │
│  [ Cancelar ]                    │
└──────────────────────────────────┘
```

- Si el usuario confirma → `repararDeficit()` registra las operaciones contables
- Si falla la reparación → muestra error específico del RPC y bloquea la apertura
- Si no hay déficit → este paso se salta directamente al Paso 2

### PASO 2 — Siempre aparece

```
┌──────────────────────────────────┐
│         Abrir Caja               │
│                                  │
│  Paso 2 de 2                     │
│                                  │
│      💵  Fondo fijo inicial      │
│           $40.00                 │
│                                  │
│  Confirma que este monto está    │
│  en la caja física antes de      │
│  continuar.                      │
│                                  │
│  ☐  He verificado el fondo       │
│     en la caja                   │
│                                  │
│  [  Abrir Caja  ]  (verde)       │
│  [   Cancelar   ]                │
└──────────────────────────────────┘
```

- El monto `$40.00` viene de `configuraciones.fondo_fijo_diario`
- El botón "Abrir Caja" está **deshabilitado** hasta que se marque el checkbox
- Si cancela → no se crea ningún turno

---

## Servicio: `TurnosCajaService`

### `obtenerDeficitTurnoAnterior()`

Busca el último cierre del día anterior que tenga `deficit_caja_chica > 0` o fondo incompleto. Retorna los montos pendientes que deben reponerse antes de abrir.

```typescript
// Retorna null si no hay déficit pendiente, o:
{
  deficitCajaChica: number,  // Monto pendiente a Varios
  fondoFaltante: number      // Diferencia entre fondo requerido y efectivo disponible
}
```

### `repararDeficit(deficitCajaChica, fondoFaltante): Promise<{ok, errorMsg?}>`

Llama al RPC `reparar_deficit_turno` que en una transacción atómica:
1. `EGRESO` de Tienda por `(deficitCajaChica + fondoFaltante)` — categoría `EG-012`
2. `INGRESO` a Varios por `deficitCajaChica` si es > 0 — categoría `IN-004`

Valida que Tienda tenga saldo suficiente. Si no → retorna `{ ok: false, errorMsg: '...' }`.

### `abrirTurno(): Promise<boolean>`

```typescript
async abrirTurno(): Promise<boolean> {
  const fechaHoy = this.getFechaLocal();

  // 1. Validar: no debe haber turno abierto
  const { data: turnoAbierto } = await this.supabase.client
    .from('turnos_caja')
    .select('id')
    .eq('fecha', fechaHoy)
    .is('hora_cierre', null)
    .maybeSingle();

  if (turnoAbierto) return false; // Ya hay turno abierto

  // 2. Obtener empleado actual (desde Preferences, sin BD)
  const empleado = await this.authService.getEmpleadoActual();
  if (!empleado) return false;

  // 3. Calcular número de turno
  const { count } = await this.supabase.client
    .from('turnos_caja')
    .select('id', { count: 'exact', head: true })
    .eq('fecha', fechaHoy);

  const numeroTurno = (count || 0) + 1;

  // 4. Insertar turno
  const respuesta = await this.supabase.client
    .from('turnos_caja')
    .insert({
      fecha: fechaHoy,
      numero_turno: numeroTurno,
      empleado_id: empleado.id,
      hora_apertura: new Date().toISOString()  // UTC correcto para TIMESTAMP WITH TIME ZONE
    });

  return !respuesta.error;
}
```

> **Nota de fechas:** `hora_apertura` usa `toISOString()` (UTC) porque es un `TIMESTAMP WITH TIME ZONE` — se almacena en UTC y se convierte al mostrar. La `fecha` del turno sí usa `getFechaLocal()` porque es un `DATE` que representa el día local.

### `obtenerEstadoCaja(): Promise<EstadoCaja>`

Consulta el turno activo del día y cuenta cuántos turnos hubo hoy:

```typescript
// Retorna uno de:
{ estado: 'SIN_ABRIR',      turnoActivo: null,   empleadoNombre: '',     horaApertura: '', turnosHoy: 0 }
{ estado: 'TURNO_EN_CURSO', turnoActivo: {...},  empleadoNombre: 'Juan', horaApertura: '08:30 AM', turnosHoy: 1 }
{ estado: 'CERRADA',        turnoActivo: null,   empleadoNombre: '',     horaApertura: '', turnosHoy: 2 }
```

### `obtenerFondoFijo(): Promise<number>`

Lee `configuraciones.fondo_fijo_diario`. Fallback: `$40.00` si no hay configuración.

---

## Base de Datos

### Tabla `turnos_caja`

```sql
CREATE TABLE turnos_caja (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha          DATE NOT NULL,                           -- Fecha local del turno (getFechaLocal())
  numero_turno   SMALLINT NOT NULL DEFAULT 1,             -- 1, 2, 3... si hay múltiples turnos
  empleado_id    INTEGER NOT NULL REFERENCES empleados(id),
  hora_apertura  TIMESTAMP WITH TIME ZONE NOT NULL,       -- UTC (toISOString())
  hora_cierre    TIMESTAMP WITH TIME ZONE,                -- NULL = turno abierto; se llena al ejecutar cierre
  observaciones  TEXT,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(fecha, numero_turno)
);

CREATE INDEX idx_turnos_caja_fecha    ON turnos_caja(fecha);
CREATE INDEX idx_turnos_caja_empleado ON turnos_caja(empleado_id);
```

### Lógica de turno abierto

```sql
-- Turno activo = el que tiene hora_cierre NULL para la fecha de hoy
fecha = HOY  AND  hora_cierre IS NULL
```

Solo puede haber **un turno abierto a la vez** (validado en `abrirTurno()`).
El `hora_cierre` lo escribe automáticamente la función `ejecutar_cierre_diario` al finalizar el cierre — no se cierra manualmente.

---

## Modelos TypeScript

```typescript
interface TurnoCaja {
  id: string;
  fecha: string;
  numero_turno: number;
  empleado_id: number;
  hora_apertura: string;
  hora_cierre: string | null;   // null = turno abierto
  observaciones: string | null;
  created_at: string;
}

interface TurnoCajaConEmpleado extends TurnoCaja {
  empleado: { id: number; nombre: string };
}

type EstadoCajaTipo = 'SIN_ABRIR' | 'TURNO_EN_CURSO' | 'CERRADA';

interface EstadoCaja {
  estado: EstadoCajaTipo;
  turnoActivo: TurnoCajaConEmpleado | null;
  empleadoNombre: string;
  horaApertura: string;   // Formateado: "08:30 AM"
  turnosHoy: number;      // Cuántos turnos hubo hoy (incluyendo el activo si lo hay)
}
```

---

## Validaciones

| Validación | Dónde | Resultado si falla |
|---|---|---|
| Ya hay turno abierto hoy | `abrirTurno()` service | Retorna `false`, no crea turno |
| No hay empleado autenticado | `abrirTurno()` service | Retorna `false` |
| Usuario no confirmó fondo | Modal Paso 2 (checkbox) | Botón deshabilitado, no llama al service |
| Tienda sin saldo para reparar déficit | `repararDeficit()` → RPC | Error con mensaje específico, bloquea apertura |

---

## Coherencia con el Cierre Diario

| Apertura | Cierre |
|---|---|
| Crea `turnos_caja` con `hora_cierre = NULL` | Lee ese `turno_id` para ejecutar `ejecutar_cierre_diario` |
| Repara déficit anterior (si existe) antes de operar | Registra nuevo déficit en `caja_fisica_diaria.deficit_caja_chica` si efectivo insuficiente |
| Verifica fondo físico ($40) mediante checkbox | Calcula distribución del efectivo en base a ese fondo fijo |
| Usa `getFechaLocal()` para `fecha` | Usa misma función `getFechaLocal()` para `p_fecha` |
| `hora_apertura` en UTC | `hora_cierre` también en UTC — escrita por `ejecutar_cierre_diario` |
| 1 sola apertura activa por vez | 1 sola transferencia a Varios por día (v4.7) |

---

## Notas Importantes

- **Múltiples turnos por día** son posibles — el `numero_turno` se incrementa automáticamente
- **El turno NO afecta saldos** de cajas — solo es registro de auditoría y trazabilidad
- **El cierre cierra el turno** — `hora_cierre` la escribe `ejecutar_cierre_diario`, no hay botón separado de cerrar turno
- **Si el 2do turno cierra con déficit**, el 3er turno al abrir verá el paso de reparación
- **`reparar_deficit_turno`** usa `SECURITY DEFINER` + `GRANT EXECUTE` + `NOTIFY pgrst` (mismo patrón de estabilidad que `ejecutar_cierre_diario`)

---

**Fecha de Actualización:** 2026-02-21
**Versión:** 2.0 (modal de 2 pasos + reparación de déficit + coherencia con cierre v4.7)
