# Abrir Caja — Referencia Técnica (v5.3 — 2026-03-12)

## 1. Arquitectura

### Archivos involucrados

| Archivo | Rol |
| --- | --- |
| `pages/home/home.page.ts` | `onAbrirCaja()`, `mostrarModalVerificacionFondo()` |
| `components/verificar-fondo-modal/verificar-fondo-modal.component.ts` | Modal multi-paso: verifica fondo y repara déficit |
| `services/turnos-caja.service.ts` | `obtenerFondoFijo()`, `obtenerDeficitTurnoAnterior()`, `abrirTurno()`, `repararDeficit()` |
| `models/turno-caja.model.ts` | `TurnoCaja`, `TurnoCajaConEmpleado`, `EstadoCaja` |
| `sql/functions/fn_abrir_turno.sql` | Apertura atómica sin déficit: validación + cálculo número turno + INSERT en una transacción |
| `sql/functions/fn_reparar_deficit_turno.sql` | Apertura con déficit: EGRESO + INGRESO + INSERT turno en una transacción |

### Tablas involucradas

| Tabla | Rol |
| --- | --- |
| `turnos_caja` | 1 registro por apertura. `hora_fecha_cierre IS NULL` = turno activo. `fondo_cubierto` indica si el fondo físico estuvo completo al cierre anterior. |
| `operaciones_cajas` | `repararDeficit()` inserta el EGRESO de CAJA y el INGRESO a VARIOS cuando hay déficit. |
| `configuraciones` | `caja_fondo_fijo_diario` y `caja_varios_transferencia_dia` (clave/valor). Fuente de verdad. |

> **Principio clave:** En el caso normal, abrir caja **no afecta saldos** — solo crea el registro en `turnos_caja`. Cuando hay déficit, `fn_reparar_deficit_turno` mueve saldos (EGRESO de CAJA + INGRESO a VARIOS) **y** abre el turno en la misma transacción atómica.

> ⚠️ **Primer uso del sistema (solo una vez):** El fondo físico no se autoconstituye. Antes de abrir caja por primera vez:
> 1. Tomar físicamente `caja_fondo_fijo_diario` (ej. $20) de la funda **Tienda**.
> 2. Ponerlo en el cajón físico.
> 3. Registrar un **EGRESO manual en Tienda** por ese monto (para que el saldo digital refleje los $20 que salieron).
> 4. **No registrar INGRESO en Cajón** — rompería la fórmula del cierre (`efectivo_esperado = saldo_digital + fondo_fijo`).
>
> A partir del segundo día el fondo se gestiona automáticamente (ver §7).

---

## 2. Flujo del proceso

```
onAbrirCaja()
  │
  ├─ [Guard] estadoCaja.estado === 'TURNO_EN_CURSO'
  │    └─ Error: "Ya hay un turno abierto por [nombre]. Solo ese empleado puede cerrarlo."
  │         → return (no navega, no abre modal)
  │
  └─ mostrarModalVerificacionFondo()
       ├─ obtenerFondoFijo()             → caja_fondo_fijo_diario desde configuraciones
       └─ obtenerDeficitTurnoAnterior()  → ver §4
        ↓
[VerificarFondoModalComponent]
  │
  ├─ Sin déficit  (hayDeficit = false)
  │    └─ Paso 2 directamente: verifica fondo → "Confirmar y Abrir Caja"
  │         → dismiss { confirmado: true }  ← sin turnoId
  │         → home llama abrirTurno()       ← rpc('abrir_turno') — fn_abrir_turno.sql
  │
  └─ Con déficit  (hayDeficit = true)
       ├─ Paso 1: montos del déficit + instrucciones físicas
       │    → "Ya lo hice — Continuar"  (avanza el paso, sin tocar BD)
       └─ Paso 2: verifica fondo → "Confirmar y Abrir Caja"
            → llama repararDeficit(deficitVarios, fondoFaltante)
            → dismiss { confirmado: true, turnoId: uuid }  ← el turno ya está abierto
            → home detecta turnoId → NO llama abrirTurno()
        ↓
cargarDatos() → refresca banner en Home
```

---

## 3. Estados del banner (Home)

El banner usa `estadoCaja.estado` + el getter `esMiTurno` (compara `turnoActivo.empleado_id === empleadoActualId`) para determinar qué mostrar.

| Estado | `esMiTurno` | Título | Subtítulo | Botón | Estilo card |
| --- | --- | --- | --- | --- | --- |
| `SIN_ABRIR` | — | Sin Turno Hoy | "Abre Caja Chica para habilitar ventas POS" | Abrir Caja Chica | Normal |
| `TURNO_EN_CURSO` | `true` | Turno Activo | "Caja Chica abierta · Ventas POS habilitadas" | Cerrar Turno | Normal |
| `TURNO_EN_CURSO` | `false` | Turno en Progreso | "Caja Chica abierta por [nombre]" | — (sin botón) | Tinte amarillo (`.ajeno`) |
| `CERRADA` | — | Turno Cerrado | "Caja Chica cerrada · Ventas POS deshabilitadas" | Abrir Caja Chica | Normal |

> **Turno en Progreso:** cuando el turno activo pertenece a otro empleado, el card muestra la información de forma pasiva (sin acción disponible). El empleado logueado no puede ni abrir ni cerrar — solo el dueño del turno puede cerrarlo.

> **Menú ⋮ de Caja Chica en turno ajeno:** cuando el estado es "Turno en Progreso", el botón `⋮` de la tarjeta Caja Chica aparece atenuado (opacity 35%) con cursor prohibido y no abre el popover. Las otras 4 cajas no se ven afectadas. La misma restricción aplica dentro de `OperacionesCajaPage`: si se navega a Caja Chica con turno ajeno, el `⋮` del header queda deshabilitado (`turnoAjeno=true` via query param).

`turnosHoy` en `EstadoCaja` indica si es el 1° o 2° turno del día.

---

## 4. Detección de déficit: `obtenerDeficitTurnoAnterior()`

Determina si el último turno cerrado tuvo déficit y cuánto debe reponerse al abrir.

### Lógica (en orden)

1. Obtiene el último turno cerrado: `hora_fecha_cierre IS NOT NULL ORDER BY hora_fecha_cierre DESC LIMIT 1`. Incluye `fondo_cubierto`.
2. Extrae la **fecha local** del cierre (sin desfase UTC).
3. En paralelo: busca el ID de VARIOS en `cajas` y lee `caja_fondo_fijo_diario` + `caja_varios_transferencia_dia` de `configuraciones` (vía `ConfigService`).
4. Verifica si VARIOS ya cobró ese día buscando en `operaciones_cajas` cualquiera de:
   - `tipo_operacion = 'TRANSFERENCIA_ENTRANTE'` → cierre normal sin déficit
   - `tipo_operacion = 'INGRESO'` + `categorias_operaciones.codigo = 'IN-004'` → reparación de apertura ya ejecutada hoy
5. Calcula los dos déficits **de forma independiente**:

```typescript
const variosYaCobro = !!(transferenciaEncontrada || ingresoIN004Encontrado);

// Los dos déficits son independientes — puede haber uno, ambos o ninguno
const deficitVarios = variosYaCobro
  ? 0
  : caja_varios_transferencia_dia;

const fondoFaltante = (ultimoTurno.fondo_cubierto === false)
  ? caja_fondo_fijo_diario
  : 0;

if (deficitVarios <= 0 && fondoFaltante <= 0) return null;
return { deficitVarios, fondoFaltante };
```

### Los 4 escenarios posibles

| VARIOS cobró | `fondo_cubierto` | `deficitVarios` | `fondoFaltante` | Acción en modal |
| :---: | :---: | :---: | :---: | --- |
| No | `true` | $20 | $0 | Paso 1 + Paso 2 |
| No | `false` | $20 | $20 | Paso 1 + Paso 2 |
| Sí | `true` | $0 | $0 | `null` → solo Paso 2 |
| Sí | `false` | $0 | $20 | Paso 1 + Paso 2 |

> `fondo_cubierto` lo escribe `fn_ejecutar_cierre_diario`: `TRUE` si `p_efectivo_fisico >= caja_fondo_fijo_diario`, `FALSE` si el cajón no tenía suficiente ni para el fondo.

### Por qué se verifica INGRESO IN-004 además de TRANSFERENCIA_ENTRANTE

Cuando un cierre tuvo déficit en VARIOS, `fn_reparar_deficit_turno` inserta un `INGRESO` (cat `IN-004`) en VARIOS — no una `TRANSFERENCIA_ENTRANTE`. Sin esta verificación doble, el sistema re-detectaría el déficit al re-abrir el mismo día y mostraría el modal de reparación por segunda vez.

---

## 5. Reparación de déficit: `repararDeficit(deficitVarios, fondoFaltante)`

Llama a `rpc('reparar_deficit_turno', params)`. Todo en una sola transacción atómica — si algo falla, rollback completo (sin operaciones a medias).

> 📄 Código fuente: [`docs/dashboard/sql/functions/fn_reparar_deficit_turno.sql`](./sql/functions/fn_reparar_deficit_turno.sql)

### Parámetros

```typescript
{
  p_empleado_id:        number,   // empleado que abre
  p_deficit_varios: number,        // monto a VARIOS (0 si ya cobró)
  p_fondo_faltante:     number,   // monto del fondo físico faltante (0 si fondo_cubierto = true)
  p_cat_egreso_id:      number,   // ID de categoría EG-012 (Ajuste Déficit Turno Anterior)
  p_cat_ingreso_id:     number    // ID de categoría IN-004 (Reposición Déficit Turno Anterior)
}
```

### Lo que ejecuta (atómico)

1. **Valida saldo** de CAJA ≥ `deficitVarios + fondoFaltante`. Si no alcanza, retorna error con mensaje descriptivo.
2. **EGRESO** de CAJA por el total — categoría `EG-012`.
3. **INGRESO** a VARIOS por `deficitVarios` (solo si > 0) — categoría `IN-004`. Este INGRESO es lo que `obtenerDeficitTurnoAnterior()` detecta el día siguiente para no re-detectar el déficit.
4. **INSERT** en `turnos_caja` — abre el turno nuevo en la misma transacción atómica (igual que `fn_abrir_turno` pero combinado con las operaciones de déficit).

> **Nota:** el déficit de VARIOS y del fondo son costos operacionales del negocio — no se tocan `movimientos_empleados`. Los faltantes de conteo físico se registran como `FALTANTE_CAJA` en `movimientos_empleados` por `fn_ejecutar_cierre_diario` y se descuentan automáticamente al pagar la nómina.

### Retorno

```typescript
// Éxito
{ success: true, turno_id: uuid, op_egreso_id, op_ingreso_id, total_retirado, saldo_tienda_nuevo }

// Error
{ success: false, error: 'Saldo insuficiente en Tienda ($X) para cubrir el ajuste de $Y...' }
```

Si retorna error, el modal muestra el mensaje y el operador debe registrar primero un INGRESO manual en CAJA antes de reintentar.

---

## 6. Apertura normal (sin déficit): `abrirTurno()`

> 📄 Código fuente: [`docs/dashboard/sql/functions/fn_abrir_turno.sql`](./sql/functions/fn_abrir_turno.sql)

Delega en `rpc('abrir_turno', { p_empleado_id })`. La función SQL ejecuta en una sola transacción atómica:

1. Valida que no exista turno abierto hoy (rango `>= inicio_día AND < inicio_día_siguiente`).
2. Calcula `numero_turno = COUNT(turnos hoy) + 1`.
3. `INSERT turnos_caja` con `hora_fecha_apertura = NOW()`.
4. Retorna `{ success: true, turno_id, numero_turno }` o `{ success: false, error }`.

**Ventaja sobre el enfoque anterior** (3 queries separadas): elimina la race condition TOCTOU — el check y el INSERT ocurren en la misma transacción con lock implícito.

`abrirTurno()` retorna `false` tanto si la función reporta error como si hay fallo de conexión. `home.page.ts` gestiona tres sub-casos releyendo el turno activo con `obtenerTurnoActivo()`:

| Sub-caso | Condición | Resultado |
| --- | --- | --- |
| Lock timeout propio | Turno existe y `empleado_id === empleadoActualId` | Toast éxito + `cargarDatos()` |
| Datos desactualizados | Turno existe y `empleado_id !== empleadoActualId` | Error con nombre del otro empleado + `cargarDatos()` |
| Error real | No existe turno activo | Error: "No se pudo abrir el turno. Verificá tu conexión." |

---

## 7. El fondo fijo: por qué no genera operación contable en aperturas normales

CAJA_CHICA siempre termina en **$0 digital** al cierre (`UPDATE cajas SET saldo_actual = 0`). El fondo físico ($20) permanece en el cajón pero **no está reflejado en el saldo digital**.

El cierre lo compensa con: `efectivo_esperado = saldo_digital + fondo_fijo`. Si el saldo digital del cajón es $30 y el fondo es $20, el sistema espera contar $50 físicos. Esta fórmula absorbe correctamente el fondo sin necesidad de registrarlo al abrir.

Registrar un INGRESO a CAJA_CHICA por el fondo en cada apertura rompería la fórmula: el cierre esperaría `$20 (ingreso fondo) + $20 (constante fondo) = $40`, generando siempre un ajuste negativo de $20.

**El fondo solo genera operación contable cuando hay déficit:** `fn_reparar_deficit_turno` registra el EGRESO de CAJA que representa el dinero físico que se saca para reponer el cajón. A partir del segundo día el fondo queda en el cajón si `fondo_cubierto = true`, o se repone automáticamente si `fondo_cubierto = false`.

---

## 8. Esquema DB: `turnos_caja`

```sql
CREATE TABLE turnos_caja (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_turno        SMALLINT NOT NULL DEFAULT 1,           -- 1, 2, 3... por día
  empleado_id         INTEGER NOT NULL REFERENCES usuarios(id),
  hora_fecha_apertura TIMESTAMPTZ NOT NULL,                  -- UTC (toISOString())
  hora_fecha_cierre   TIMESTAMPTZ,                           -- NULL = activo; escrito por fn_ejecutar_cierre_diario
  fondo_cubierto      BOOLEAN,                               -- TRUE si efectivo_fisico >= fondo_fijo al cierre; NULL hasta que se cierra
  observaciones       TEXT
);

CREATE UNIQUE INDEX idx_turnos_caja_fecha_turno
  ON turnos_caja
  ((hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date, numero_turno);
```

---

## 9. Restricciones de sesión (v5.3)

### Turno único activo

Solo puede existir un turno activo a la vez. La restricción opera en dos capas:

| Capa | Dónde | Qué hace |
| --- | --- | --- |
| **Frontend** | `onAbrirCaja()` — guard al inicio | Bloquea inmediatamente si `estadoCaja.estado === 'TURNO_EN_CURSO'` con mensaje que incluye el nombre del empleado que lo tiene abierto |
| **BD** | `fn_abrir_turno` — `IF EXISTS (... hora_fecha_cierre IS NULL)` | Validación atómica: retorna `{ success: false }` si ya hay turno abierto, independientemente del estado del frontend |

### Logout bloqueado con turno activo

`SidebarComponent.logout()` verifica antes de cerrar sesión:

```typescript
const turno = await this.turnosCajaService.obtenerTurnoActivo();
if (turno && turno.empleado_id === this.empleadoId) {
  // Bloquea: el empleado tiene el turno abierto
  showError('Tienes un turno activo. Realizá el cierre diario antes de cerrar sesión.');
  return;
}
// Procede con logout
```

Solo se bloquea si **el turno activo pertenece al usuario logueado**. Si el turno es de otro empleado, el logout procede normalmente.

---

## 10. Queries de auditoría

### Estado de turnos del día

```sql
SELECT
  t.numero_turno,
  e.nombre,
  t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS apertura_local,
  t.hora_fecha_cierre   AT TIME ZONE 'America/Guayaquil' AS cierre_local,
  t.fondo_cubierto,
  CASE WHEN t.hora_fecha_cierre IS NULL THEN 'ABIERTO' ELSE 'CERRADO' END AS estado
FROM turnos_caja t
JOIN usuarios e ON t.empleado_id = e.id
WHERE (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY t.numero_turno;
```

### Verificar déficit del último cierre

```sql
-- Muestra si el último cierre tuvo fondo_cubierto = false y si VARIOS ya cobró hoy
SELECT
  t.hora_fecha_cierre AT TIME ZONE 'America/Guayaquil' AS cierre_local,
  t.fondo_cubierto,
  oc.tipo_operacion,
  co.codigo AS categoria,
  oc.monto
FROM turnos_caja t
LEFT JOIN operaciones_cajas oc
  ON oc.caja_id = (SELECT id FROM cajas WHERE codigo = 'VARIOS')
  AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date =
      (t.hora_fecha_cierre AT TIME ZONE 'America/Guayaquil')::date
  AND (
    oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
    OR (
      oc.tipo_operacion = 'INGRESO'
      AND EXISTS (
        SELECT 1 FROM categorias_operaciones co
        WHERE co.id = oc.categoria_id AND co.codigo = 'IN-004'
      )
    )
  )
LEFT JOIN categorias_operaciones co ON co.id = oc.categoria_id
WHERE t.hora_fecha_cierre IS NOT NULL
ORDER BY t.hora_fecha_cierre DESC
LIMIT 1;
```

### Operaciones de reparación de déficit (apertura)

```sql
-- Muestra las reparaciones de déficit registradas hoy al abrir
SELECT
  oc.tipo_operacion,
  c.codigo AS caja,
  co.codigo AS categoria,
  oc.monto,
  oc.descripcion,
  oc.fecha AT TIME ZONE 'America/Guayaquil' AS fecha_local
FROM operaciones_cajas oc
JOIN cajas c ON c.id = oc.caja_id
JOIN categorias_operaciones co ON co.id = oc.categoria_id
WHERE co.codigo IN ('EG-012', 'IN-004')
  AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY oc.fecha;
```
