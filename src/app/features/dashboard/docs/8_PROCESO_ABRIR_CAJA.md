# Abrir Caja — Referencia Técnica

## ¿Qué es?

Proceso para **abrir el turno de trabajo** al inicio del día. Crea el registro en `turnos_caja` que el cierre diario necesita para ejecutar `ejecutar_cierre_diario`. Si el turno anterior cerró con déficit, primero se repara ese déficit antes de abrir el nuevo turno.

**Principio clave:** Abrir caja **no afecta saldos**. Solo crea el `turno_id` del día.

---

## 1. Archivos involucrados

| Archivo | Rol |
|---|---|
| `pages/home/home.page.ts` | `onAbrirCaja()`, `mostrarModalVerificacionFondo()`, `VerificarFondoModalComponent` (inline) |
| `services/turnos-caja.service.ts` | `abrirTurno()`, `obtenerEstadoCaja()`, `obtenerFondoFijo()`, `obtenerDeficitTurnoAnterior()`, `repararDeficit()` |
| `models/turno-caja.model.ts` | `TurnoCaja`, `TurnoCajaConEmpleado`, `EstadoCaja` |

### Tablas involucradas

| Tabla | Rol |
|---|---|
| `turnos_caja` | 1 registro por apertura. `hora_cierre IS NULL` = turno activo. `hora_cierre` la escribe `ejecutar_cierre_diario` — no se cierra manualmente. |
| `caja_fisica_diaria` | El cierre escribe aquí el `deficit_caja_chica`. Lo lee `obtenerDeficitTurnoAnterior()` al abrir el turno siguiente. |
| `operaciones_cajas` | `repararDeficit()` inserta aquí el EGRESO de Tienda y el INGRESO a Varios. |
| `configuraciones` | `fondo_fijo_diario` — cuánto debe haber en la caja física para operar. |

---

## 2. Flujo del proceso

```
Usuario presiona "Abrir Caja"
        ↓
onAbrirCaja()
  └─ mostrarModalVerificacionFondo()
       ├─ obtenerFondoFijo()             → fondo_fijo_diario desde configuraciones
       └─ obtenerDeficitTurnoAnterior()  → último caja_fisica_diaria con déficit
        ↓
[Modal: VerificarFondoModalComponent]
  │
  ├─ PASO 1 (solo si hayDeficit)
  │    → Muestra montos: fondoFaltante + deficitCajaChica + totalAReponer
  │    → Instrucciones físicas numeradas
  │    → "Ya lo hice — Registrar en sistema"  →  repararDeficit()
  │    → "Cancelar"  →  modal descarta sin crear turno
  │
  └─ PASO 2 (siempre)
       → Muestra fondoFijo desde configuraciones
       → Checkbox obligatorio: "He verificado el fondo en la caja"
       → "Abrir Caja" (habilitado solo con checkbox) → role: 'confirm'
       → "Cancelar" → modal descarta sin crear turno
        ↓
abrirTurno()
  ├─ Valida: no hay turno con hora_cierre IS NULL para la fecha de hoy
  ├─ Obtiene empleado desde Preferences (sin BD)
  ├─ Calcula numero_turno = COUNT(turnos hoy) + 1
  └─ INSERT turnos_caja
        ↓
cargarDatos() → refresca banner en Home
```

---

## 3. Estados del banner (Home)

| Estado | Condición en BD | Título | Descripción | Botón |
|---|---|---|---|---|
| `SIN_ABRIR` | Sin turnos hoy | Sin Turno | "Abrí turno para iniciar operaciones" | Abrir Caja |
| `TURNO_EN_CURSO` | Turno con `hora_cierre IS NULL` | Turno Activo | Nombre del empleado | Cerrar Turno |
| `CERRADA` | Todos los turnos tienen `hora_cierre` | Turno Cerrado | "Caja cerrada por hoy" | Abrir Caja |

`turnosHoy` se incluye en `EstadoCaja` — útil para saber si es el 1er o 2do turno del día.

---

## 4. Reparación de déficit

`obtenerDeficitTurnoAnterior()` consulta el último registro de `caja_fisica_diaria` y retorna:

```typescript
{
  deficitCajaChica: number,  // monto que faltó transferir a Varios en el turno anterior
  fondoFaltante:    number,  // max(0, fondo_fijo - efectivo_recaudado_anterior)
  efectivoRecaudado: number
}
```

Si ambos son `0` → no hay déficit → el modal salta directamente al Paso 2.

> 📄 Código fuente completo: [`docs/sql/reparar_deficit_turno.sql`](./sql/reparar_deficit_turno.sql)

`repararDeficit(deficitCajaChica, fondoFaltante)` llama a `rpc('reparar_deficit_turno', {...})` que en una transacción atómica:
1. `EGRESO` de Tienda por `(deficitCajaChica + fondoFaltante)` — categoría `EG-012`
2. `INGRESO` a Varios por `deficitCajaChica` si > 0 — categoría `IN-004`

> **Nota:** No valida saldo mínimo en Tienda — el dinero existe físicamente aunque el saldo digital sea bajo.

Si el RPC retorna error → `repararDeficit()` devuelve `{ ok: false, errorMsg: '...' }`. El modal muestra el mensaje y no avanza.

---

## 5. `abrirTurno()`

Validaciones (retorna `false` en cualquiera — Home muestra error al usuario):
1. Ya existe un turno con `hora_cierre IS NULL` para la fecha de hoy → solo puede haber 1 activo
2. No se pudo obtener el empleado desde Preferences → sesión inválida

Si todo OK → `INSERT turnos_caja` con `fecha = getFechaLocal()` y `hora_apertura = toISOString()` (UTC correcto para `TIMESTAMP WITH TIME ZONE`).

---

## 6. Esquema DB: `turnos_caja`

```sql
CREATE TABLE turnos_caja (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha          DATE NOT NULL,                            -- Fecha local (getFechaLocal())
  numero_turno   SMALLINT NOT NULL DEFAULT 1,              -- 1, 2, 3... por día
  empleado_id    INTEGER NOT NULL REFERENCES empleados(id),
  hora_apertura  TIMESTAMP WITH TIME ZONE NOT NULL,        -- UTC (toISOString())
  hora_cierre    TIMESTAMP WITH TIME ZONE,                 -- NULL = abierto; lo escribe ejecutar_cierre_diario
  observaciones  TEXT,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(fecha, numero_turno)
);
```

---

## 7. Queries de auditoría

### Turnos del día

```sql
SELECT
  t.numero_turno,
  e.nombre,
  t.hora_apertura AT TIME ZONE 'America/Guayaquil' AS apertura,
  t.hora_cierre   AT TIME ZONE 'America/Guayaquil' AS cierre,
  CASE WHEN t.hora_cierre IS NULL THEN 'ABIERTO' ELSE 'CERRADO' END AS estado
FROM turnos_caja t
JOIN empleados e ON t.empleado_id = e.id
WHERE t.fecha = CURRENT_DATE
ORDER BY t.numero_turno;
```

### Verificar si hay déficit para el turno que va a abrir

```sql
SELECT efectivo_recaudado, deficit_caja_chica
FROM caja_fisica_diaria
ORDER BY created_at DESC
LIMIT 1;
```
