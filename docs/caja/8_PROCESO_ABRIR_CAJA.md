# Abrir Caja — Referencia Técnica (v6.0 — 2026-05-29 — fondo libre)

## 1. Arquitectura

### Archivos involucrados

| Archivo | Rol |
| --- | --- |
| `pages/home/home.page.ts` | `onAbrirCaja()`, `mostrarModalVerificacionFondo()` |
| `components/verificar-fondo-modal/verificar-fondo-modal.component.ts` | Modal de un paso: input libre del fondo a dejar + aviso de déficit (si aplica) |
| `services/turnos-caja.service.ts` | `obtenerDeficitTurnoAnterior()`, `abrirTurno(fondoApertura)`, `repararDeficit(deficitVarios, fondoApertura)` |
| `models/turno-caja.model.ts` | `TurnoCaja`, `TurnoCajaConEmpleado`, `EstadoCaja` |
| `sql/functions/fn_abrir_turno.sql` | Apertura atómica sin déficit: validación + cálculo número turno + INSERT en una transacción |
| `sql/functions/fn_reparar_deficit_turno.sql` | Apertura con déficit: EGRESO + INGRESO + INSERT turno en una transacción |

### Tablas involucradas

| Tabla | Rol |
| --- | --- |
| `turnos_caja` | 1 registro por apertura. `hora_fecha_cierre IS NULL` = turno activo. `fondo_apertura` guarda el monto libre declarado por el empleado al abrir. |
| `operaciones_cajas` | `repararDeficit()` inserta el EGRESO de CAJA y el INGRESO a VARIOS cuando hay déficit. |
| `configuraciones` | `caja_varios_transferencia_dia` (clave/valor). `caja_fondo_fijo_diario` eliminado — el fondo es libre. |

> **Principio clave:** En el caso normal, abrir caja **no afecta saldos** — solo crea el registro en `turnos_caja`. Cuando hay déficit, `fn_reparar_deficit_turno` mueve saldos (EGRESO de CAJA + INGRESO a VARIOS) **y** abre el turno en la misma transacción atómica.

> **Fondo libre (v6.0):** Ya no existe un fondo fijo predeterminado. Al abrir caja, el empleado declara libremente cuánto efectivo deja en el cajón. Este valor se guarda en `turnos_caja.fondo_apertura` y el cierre lo usa como referencia para la distribución.

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
       └─ obtenerDeficitTurnoAnterior()  → verifica si VARIOS tiene pendiente
        ↓
[VerificarFondoModalComponent]
  │  Input libre: "¿Cuánto efectivo dejas en el cajón?"
  │
  ├─ Sin déficit (hayDeficit = false)
  │    → dismiss { confirmado: true, fondoApertura: N }
  │    → home llama abrirTurno(fondoApertura) → fn_abrir_turno(empleado, fondoApertura)
  │
  └─ Con déficit de VARIOS (hayDeficit = true)
       → "Se tomará $X de Tienda para reponer Varios"
       → dismiss { confirmado: true, turnoId: uuid }  ← ya abierto atómicamente
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

Determina si el último turno cerrado tuvo déficit **solo en VARIOS** (el fondo ya no se repone automáticamente — el empleado lo declara libremente al abrir).

### Lógica (en orden)

1. Obtiene el último turno cerrado: `hora_fecha_cierre IS NOT NULL ORDER BY hora_fecha_cierre DESC LIMIT 1`.
2. Extrae la **fecha local** del cierre (sin desfase UTC).
3. En paralelo: busca el ID de VARIOS en `cajas` y lee `caja_varios_transferencia_dia` de `configuraciones`.
4. Verifica si VARIOS ya cobró ese día buscando en `operaciones_cajas` cualquiera de:
   - `tipo_operacion = 'TRANSFERENCIA_ENTRANTE'` → cierre normal sin déficit
   - `tipo_operacion = 'INGRESO'` + `categorias_operaciones.codigo = 'IN-004'` → reparación de apertura ya ejecutada hoy
5. Calcula el déficit:

```typescript
const variosYaCobro = !!(transferenciaEncontrada || ingresoIN004Encontrado);
const deficitVarios = variosYaCobro ? 0 : caja_varios_transferencia_dia;
if (deficitVarios <= 0) return null;
return { deficitVarios };
```

### Los 2 escenarios posibles

| VARIOS cobró | `deficitVarios` | Acción en modal |
| :---: | :---: | --- |
| No | $X (monto config) | Aviso + input fondo libre |
| Sí | $0 | Solo input fondo libre |

### Por qué se verifica INGRESO IN-004 además de TRANSFERENCIA_ENTRANTE

Cuando un cierre tuvo déficit en VARIOS, `fn_reparar_deficit_turno` inserta un `INGRESO` (cat `IN-004`) en VARIOS — no una `TRANSFERENCIA_ENTRANTE`. Sin esta verificación doble, el sistema re-detectaría el déficit al re-abrir el mismo día.

---

## 5. Reparación de déficit: `repararDeficit(deficitVarios, fondoApertura)`

Llama a `rpc('reparar_deficit_turno', params)`. Todo en una sola transacción atómica — si algo falla, rollback completo (sin operaciones a medias).

> 📄 Código fuente: [`docs/caja/sql/functions/fn_reparar_deficit_turno.sql`](./sql/functions/fn_reparar_deficit_turno.sql)

### Parámetros

```typescript
{
  p_empleado_id:    UUID,     // empleado que abre
  p_deficit_varios: number,   // monto pendiente a VARIOS
  p_fondo_apertura: number,   // monto libre declarado por el empleado en el cajón
  p_cat_egreso_id:  UUID,     // ID de categoría EG-012 (Ajuste Déficit Turno Anterior)
  p_cat_ingreso_id: UUID      // ID de categoría IN-004 (Reposición Déficit Turno Anterior)
}
```

### Lo que ejecuta (atómico)

1. **Valida saldo** de CAJA ≥ `deficitVarios`. Si no alcanza, retorna error con mensaje descriptivo.
2. **EGRESO** de CAJA por `deficitVarios` — categoría `EG-012`.
3. **INGRESO** a VARIOS por `deficitVarios` — categoría `IN-004`. Este INGRESO es lo que `obtenerDeficitTurnoAnterior()` detecta el día siguiente para no re-detectar el déficit.
4. **INSERT** en `turnos_caja` con `fondo_apertura` — abre el turno en la misma transacción atómica.

> El déficit de VARIOS es costo operacional del negocio — no se registra en `movimientos_empleados`. Los faltantes de conteo físico sí se registran como `FALTANTE_CAJA` por `fn_ejecutar_cierre_diario`.

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

> 📄 Código fuente: [`docs/caja/sql/functions/fn_abrir_turno.sql`](./sql/functions/fn_abrir_turno.sql)

Delega en `rpc('fn_abrir_turno', { p_empleado_id, p_fondo_apertura })`. La función SQL (v3.0) ejecuta en una sola transacción atómica:

1. Resuelve `caja_id` automáticamente buscando la `CAJA_CHICA` del negocio.
2. Valida que no exista turno abierto hoy en esa caja (rango `>= inicio_día AND < inicio_día_siguiente`).
3. Calcula `numero_turno = COUNT(turnos hoy de esa caja) + 1`.
4. `INSERT turnos_caja` con `hora_fecha_apertura = NOW()`, `caja_id` poblado y `fondo_apertura` declarado por el empleado.
5. Retorna `{ success: true, turno_id, numero_turno, fondo_apertura }` o `{ success: false, error }`.

**Ventaja sobre el enfoque anterior** (3 queries separadas): elimina la race condition TOCTOU — el check y el INSERT ocurren en la misma transacción con lock implícito.

`abrirTurno()` retorna `false` tanto si la función reporta error como si hay fallo de conexión. `home.page.ts` gestiona tres sub-casos releyendo el turno activo con `obtenerTurnoActivo()`:

| Sub-caso | Condición | Resultado |
| --- | --- | --- |
| Lock timeout propio | Turno existe y `empleado_id === empleadoActualId` | Toast éxito + `cargarDatos()` |
| Datos desactualizados | Turno existe y `empleado_id !== empleadoActualId` | Error con nombre del otro empleado + `cargarDatos()` |
| Error real | No existe turno activo | Error: "No se pudo abrir el turno. Verificá tu conexión." |

---

## 7. El fondo de apertura: libre y sin operación contable

CAJA_CHICA siempre termina en **$0 digital** al cierre (`UPDATE cajas SET saldo_actual = 0`). El efectivo que el empleado declara al abrir (`fondo_apertura`) permanece físicamente en el cajón pero **no se registra digitalmente**.

El cierre lo compensa con: `efectivo_esperado = saldo_digital + fondo_apertura`. Si el saldo digital del cajón es $30 y el empleado declaró $15 al abrir, el sistema espera contar $45 físicos.

No se registra un INGRESO a CAJA_CHICA por el fondo — hacerlo rompería la fórmula y generaría siempre un ajuste negativo.

**El fondo ya no es fijo ni predeterminado.** Cada empleado declara libremente cuánto deja al abrir. Si deja $0, la fórmula sigue funcionando correctamente.

---

## 8. Esquema DB: `turnos_caja`

```sql
CREATE TABLE turnos_caja (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id          UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  caja_id             UUID REFERENCES cajas(id) ON DELETE RESTRICT,  -- nullable hoy, NOT NULL al implementar multicaja
  numero_turno        SMALLINT NOT NULL DEFAULT 1,                   -- 1, 2, 3... por día por caja
  empleado_id         UUID NOT NULL REFERENCES usuarios(id),
  hora_fecha_apertura TIMESTAMPTZ NOT NULL,
  hora_fecha_cierre   TIMESTAMPTZ,                                   -- NULL = activo
  fondo_apertura      DECIMAL(12,2) NOT NULL DEFAULT 0               -- monto libre declarado por el empleado al abrir
);

-- 1 numero_turno por (negocio, caja, día)
CREATE UNIQUE INDEX idx_turnos_caja_fecha_turno
  ON turnos_caja(negocio_id, caja_id,
    (CAST(hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS date)),
    numero_turno);

-- Máximo 1 turno abierto por caja a la vez
CREATE UNIQUE INDEX idx_un_turno_abierto_por_caja
  ON turnos_caja(caja_id)
  WHERE hora_fecha_cierre IS NULL AND caja_id IS NOT NULL;
```

> **Preparación multicaja (2026-05-27):** `caja_id` es nullable hoy. `fn_abrir_turno` lo puebla automáticamente con la `CAJA_CHICA` del negocio en cada apertura. Cuando se implemente multicaja se añade `p_caja_id` a la firma y se hace `NOT NULL`.

---

## 9. Restricciones de sesión

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
  t.fondo_apertura,
  CASE WHEN t.hora_fecha_cierre IS NULL THEN 'ABIERTO' ELSE 'CERRADO' END AS estado
FROM turnos_caja t
JOIN usuarios e ON t.empleado_id = e.id
WHERE (t.hora_fecha_apertura AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY t.numero_turno;
```

### Verificar déficit del último cierre

```sql
-- Muestra el fondo declarado al abrir el último turno y si VARIOS ya cobró ese día
SELECT
  t.hora_fecha_cierre AT TIME ZONE 'America/Guayaquil' AS cierre_local,
  t.fondo_apertura,
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
