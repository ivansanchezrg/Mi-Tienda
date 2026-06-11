# Abrir Caja — Referencia Técnica (v6.5 — 2026-06-11 — UI del home sincronizada; validación de turno abierto sin filtro de fecha)

## 1. Arquitectura

### Archivos involucrados

| Archivo | Rol |
| --- | --- |
| `pages/home/home.page.ts` | `onAbrirCaja()`, `mostrarModalVerificacionFondo()` |
| `components/verificar-fondo-modal/verificar-fondo-modal.component.ts` | Modal de un paso: input libre del fondo a dejar + aviso de déficit (si aplica). En caso sin déficit hace `dismiss` con `fondoApertura`; el home llama `abrirTurno()`. En caso con déficit llama `repararDeficit()` internamente y solo cierra el modal si todo OK. |
| `services/turnos-caja.service.ts` | `obtenerDeficitTurnoAnterior()` (delegado a `fn_obtener_deficit_turno_anterior`), `abrirTurno(fondoApertura)`, `repararDeficit(deficitVarios, fondoApertura)` |
| `models/turno-caja.model.ts` | `TurnoCaja`, `TurnoCajaConEmpleado`, `EstadoCaja` |
| `sql/functions/fn_abrir_turno.sql` | Apertura atómica sin déficit: validación + cálculo número turno + INSERT en una transacción |
| `sql/functions/fn_reparar_deficit_turno.sql` | Apertura con déficit: EGRESO + INGRESO + INSERT turno en una transacción |
| `sql/functions/fn_obtener_deficit_turno_anterior.sql` | **RPC consolidada** (v1.0 — 2026-06-03). Reemplaza 4 round-trips del cliente en 1 sola llamada al servidor. Retorna `{ deficit_varios: number }` |

### Tablas involucradas

| Tabla | Rol |
| --- | --- |
| `turnos_caja` | 1 registro por apertura. `hora_fecha_cierre IS NULL` = turno activo. `fondo_apertura` guarda el monto libre declarado por el empleado al abrir. |
| `operaciones_cajas` | `repararDeficit()` inserta el EGRESO de CAJA y el INGRESO a VARIOS cuando hay déficit. |
| `configuraciones` | `caja_varios_transferencia_dia` (clave/valor). `caja_fondo_fijo_diario` eliminado — el fondo es libre. |

> **Principio clave (v6.4):** En el caso normal con fondo = 0, abrir caja **no afecta saldos**. Si el empleado declara fondo > 0, tanto `fn_abrir_turno` como `fn_reparar_deficit_turno` registran un EGRESO de Tienda (`CAJA`) con categoría `Fondo Apertura Turno` — trazabilidad contable del efectivo que sale de la bóveda hacia el cajón. Cuando hay déficit, `fn_reparar_deficit_turno` mueve saldos (EGRESO de CAJA por déficit + INGRESO a VARIOS + EGRESO de CAJA por fondo si > 0) **y** abre el turno en la misma transacción atómica. El saldo de Tienda se valida contra el **total** que saldrá: `déficit + fondo`.

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
       └─ fn_obtener_deficit_turno_anterior()  ← 1 RPC, reemplaza 4 round-trips
        ↓
[VerificarFondoModalComponent]
  │  Input libre: "¿Cuánto efectivo dejas en el cajón?"
  │
  ├─ Sin déficit (hayDeficit = false)
  │    → dismiss { confirmado: true, fondoApertura }
  │    → HOME llama abrirTurno(fondoApertura) → fn_abrir_turno(empleado, fondoApertura)
  │       ├─ Si ok: cargarDatos() → refresca home
  │       └─ Si error: muestra toast (errorHandled) o mensaje genérico
  │
  └─ Con déficit de VARIOS (hayDeficit = true)
       → "Se tomará $X de Tienda para reponer Varios"
       → MODAL llama repararDeficit(deficitVarios, fondoApertura)
       → dismiss { confirmado: true, turnoId: uuid }  ← ya abierto atómicamente
       → home detecta turnoId → NO llama abrirTurno()
        ↓
cargarDatos() → refresca banner en Home
```

---

## 3. Estado del turno en la UI (Home)

El home expone el estado mediante `estadoCaja.estado` (`SIN_ABRIR` | `TURNO_EN_CURSO` | `CERRADA`) + el getter `esMiTurno` (delegado a `turnosCajaService.esMiTurnoValue`). Se refleja en dos lugares:

**Chip de estado** (hero card): "Caja abierta" (punto verde) cuando `cajaAbierta`, "Caja cerrada" en caso contrario. Solo informativo, sin acción.

**Botón de turno** (4ª acción rápida, oculto para superadmin):

| Condición | Botón | Acción |
| --- | --- | --- |
| `cajaAbierta && esMiTurno` | Cerrar | `onCerrarCaja()` → valida y navega al wizard de cierre |
| `!cajaAbierta` | Abrir | `onAbrirCaja()` → modal de verificación de fondo |
| `cajaAbierta && !esMiTurno` (turno ajeno) | Cierre (deshabilitado) | — solo el dueño del turno puede cerrarlo |

> **Cajón con turno cerrado:** las cards de cajas no tienen menú `⋮` — navegan a `OperacionesCajaPage` al tocarlas. Si se toca el Cajón (`CAJA_CHICA`) sin turno activo, el home abre el modal "Cajón cerrado" (`OptionsModalComponent`) con la opción "Historial de cierres".

> **Restricción de turno ajeno en `OperacionesCajaPage`:** el home pasa `esMiTurno: true` en query params **solo** cuando el turno del Cajón es del usuario logueado. Sin ese flag, el menú `⋮` de la página omite "Registrar Ingreso/Egreso" (quedan "Historial de cierres" y, para ADMIN, "Editar caja"). La función SQL rechaza la operación como última línea de defensa.

`turnosHoy` en `EstadoCaja` indica si es el 1° o 2° turno del día.

---

## 4. Detección de déficit: `obtenerDeficitTurnoAnterior()`

Delega completamente en la RPC `fn_obtener_deficit_turno_anterior` (v1.0 — 2026-06-03).

> 📄 Código fuente: [`docs/caja/sql/functions/fn_obtener_deficit_turno_anterior.sql`](./sql/functions/fn_obtener_deficit_turno_anterior.sql)

**Antes (4 round-trips secuenciales):** query turnos → query cajas + config → 2 queries operaciones_cajas.
**Ahora (1 RPC):** todo consolidado en el servidor en una sola llamada.

### Lógica de la función SQL (en orden)

1. Si VARIOS no existe (módulo desactivado) → `{ deficit_varios: 0 }`.
2. Si no hay ningún turno cerrado → `{ deficit_varios: 0 }`.
3. Si VARIOS se creó **después** del último cierre (módulo recién activado por el superadmin o el onboarding) → `{ deficit_varios: 0 }` — ese día no existía obligación de transferir.
4. Calcula la **ventana UTC** del día local del último cierre (UTC-5 Ecuador, sin `AT TIME ZONE` en el `WHERE` — permite usar el índice de `operaciones_cajas.fecha`).
5. Verifica si VARIOS ya cobró ese día buscando en `operaciones_cajas` cualquiera de:
   - `tipo_operacion = 'TRANSFERENCIA_ENTRANTE'` → cierre normal sin déficit
   - `tipo_operacion = 'INGRESO'` + `categoria_sistema_id = DEF-REPONER` → reparación de apertura ya ejecutada hoy
6. Si no cobró → retorna `caja_varios_transferencia_dia` de `configuraciones` (si la clave no existe o es ≤ 0 → `{ deficit_varios: 0 }`).

```typescript
// TurnosCajaService — ahora son 5 líneas
async obtenerDeficitTurnoAnterior(): Promise<{ deficitVarios: number } | null> {
  const data = await this.supabase.call<{ deficit_varios: number }>(
    this.supabase.client.rpc('fn_obtener_deficit_turno_anterior')
  );
  if (!data || data.deficit_varios <= 0) return null;
  return { deficitVarios: data.deficit_varios };
}
```

### Los 2 escenarios posibles

| VARIOS cobró | `deficitVarios` | Acción en modal |
| :---: | :---: | --- |
| No | $X (monto config) | Aviso + input fondo libre |
| Sí | $0 | Solo input fondo libre |

### Por qué se verifica INGRESO DEF-REPONER además de TRANSFERENCIA_ENTRANTE

Cuando un cierre tuvo déficit en VARIOS, `fn_reparar_deficit_turno` inserta un `INGRESO` (cat `DEF-REPONER` de `categorias_sistema`) en VARIOS — no una `TRANSFERENCIA_ENTRANTE`. Sin esta verificación doble, el sistema re-detectaría el déficit al re-abrir el mismo día.

### Un día sin cierre NO genera déficit (por diseño)

La transferencia a VARIOS es **"una por cierre, máximo una por día"** — la detección evalúa el día local del **último cierre**, no los días calendario transcurridos. Si un turno se abrió un día y se cerró al siguiente, el día saltado no se acumula ni se cobra retroactivamente: el dinero no se pierde (queda en Tienda en vez de en Varios). El cierre detecta el caso (`aperturaEnOtroDia`) y el home muestra un alert post-cierre sugiriendo compensarlo con un **traspaso manual** de Tienda a Varios. Ver [3_PROCESO_CIERRE_CAJA.md](./3_PROCESO_CIERRE_CAJA.md) → "Turno abierto en un día anterior".

---

## 5. Reparación de déficit: `repararDeficit(deficitVarios, fondoApertura)`

Llama a `rpc('fn_reparar_deficit_turno', params)`. Todo en una sola transacción atómica — si algo falla, rollback completo (sin operaciones a medias).

> 📄 Código fuente: [`docs/caja/sql/functions/fn_reparar_deficit_turno.sql`](./sql/functions/fn_reparar_deficit_turno.sql)

### Parámetros

```typescript
{
  p_empleado_id:    UUID,     // empleado que abre
  p_deficit_varios: number,   // monto pendiente a VARIOS
  p_fondo_apertura: number,   // monto libre declarado por el empleado en el cajón
}
```

> **v4.2:** La validación de turno abierto ya no filtra por fecha — un turno de un día anterior sin cerrar también bloquea con mensaje limpio (mismo criterio que `fn_abrir_turno` v3.3).
> **v4.1:** Validación de saldo incluye `fondoApertura` (`déficit + fondo`). Agrega EGRESO `FONDO-APERTURA` de Tienda cuando `fondoApertura > 0`, espejando el comportamiento de `fn_abrir_turno`. Saldo retornado (`saldo_tienda_nuevo`) refleja el descuento total.
> **v4.0:** `p_cat_egreso_id` y `p_cat_ingreso_id` fueron eliminados. Las categorías `DEF-RETIRAR` y `DEF-REPONER` son UUIDs fijos de `categorias_sistema` resueltos internamente por la función.

### Lo que ejecuta (atómico)

1. **Valida saldo** de CAJA ≥ `deficitVarios + fondoApertura`. Si no alcanza, retorna error con mensaje descriptivo que muestra los tres montos. La validación suma ambos conceptos porque ambos salen de Tienda en la misma transacción.
2. **EGRESO** de CAJA por `deficitVarios` — categoría `DEF-RETIRAR` (`categorias_sistema`). Actualiza `saldo_actual` de CAJA.
3. **INGRESO** a VARIOS por `deficitVarios` — categoría `DEF-REPONER` (`categorias_sistema`). Este INGRESO es lo que `obtenerDeficitTurnoAnterior()` detecta el día siguiente para no re-detectar el déficit.
4. **INSERT** en `turnos_caja` con `fondo_apertura` — abre el turno.
5. **Si `fondoApertura > 0`:** EGRESO de CAJA por `fondoApertura` — categoría `FONDO-APERTURA` (misma que `fn_abrir_turno`). El `saldo_anterior` de este EGRESO es el saldo de Tienda **después** del paso 2 (`saldo_tienda - déficit`). Actualiza `saldo_actual` de CAJA con el descuento final.

> El déficit de VARIOS es costo operacional del negocio — no se registra en `movimientos_empleados`. Los faltantes de conteo físico sí se registran como `FALTANTE_CAJA` por `fn_ejecutar_cierre_diario`.

### Retorno

```typescript
// Éxito
{
  success: true,
  turno_id: uuid,
  op_egreso_id: uuid,          // EGRESO déficit en CAJA
  op_ingreso_id: uuid,         // INGRESO DEF-REPONER en VARIOS
  total_retirado: number,      // = deficitVarios (sin fondo)
  saldo_tienda_nuevo: number   // saldo_tienda - déficit - fondo
}

// Error — saldo insuficiente
{ success: false, error: 'Saldo insuficiente en Tienda ($X) para cubrir el déficit de VARIOS ($Y) más el fondo de apertura ($Z). Registra un ingreso manual en Tienda primero.' }
```

Si retorna error, el modal muestra el mensaje y el operador debe registrar primero un INGRESO manual en CAJA antes de reintentar.

---

## 6. Apertura normal (sin déficit): `abrirTurno()`

> 📄 Código fuente: [`docs/caja/sql/functions/fn_abrir_turno.sql`](./sql/functions/fn_abrir_turno.sql)

Delega en `rpc('fn_abrir_turno', { p_empleado_id, p_fondo_apertura })`. La función SQL (v3.3) ejecuta en una sola transacción atómica:

1. Valida que el empleado tenga membresía activa en el negocio (multi-tenant).
2. Resuelve `caja_id` automáticamente buscando la `CAJA_CHICA` del negocio.
3. Valida que no exista **ningún** turno abierto en el negocio (`hora_fecha_cierre IS NULL`, sin filtro de fecha — un turno de un día anterior sin cerrar también bloquea).
4. Calcula `numero_turno = COUNT(turnos de hoy del negocio) + 1`.
5. `INSERT turnos_caja` con `hora_fecha_apertura = NOW()`, `caja_id` poblado y `fondo_apertura` declarado por el empleado.
6. **Si `p_fondo_apertura > 0`:** valida que Tienda (`CAJA`) tenga saldo suficiente (`RAISE EXCEPTION` si no alcanza — rollback de todo, incluido el INSERT del turno), luego registra el `EGRESO` en Tienda con categoría `FONDO-APERTURA` (trazabilidad contable del efectivo que sale hacia el cajón).
7. Retorna `{ success: true, turno_id, numero_turno, fondo_apertura }` o `{ success: false, error }`.

**Ventaja sobre el enfoque anterior** (3 queries separadas): elimina la race condition TOCTOU — el check y el INSERT ocurren en la misma transacción con lock implícito.

`abrirTurno()` retorna `{ ok: boolean, errorHandled: boolean }`. La llamada ocurre en el **home** (`onAbrirCaja()`) cuando el modal devuelve el resultado sin déficit — el modal no llama `abrirTurno()` directamente. Si `ok === false` y `errorHandled === false`, el home muestra un toast genérico; si `errorHandled === true`, `SupabaseService.call()` ya mostró el error al usuario.

---

## 7. El fondo de apertura: libre, con EGRESO contable en Tienda

CAJA_CHICA siempre termina en **$0 digital** al cierre (`UPDATE cajas SET saldo_actual = 0`). El efectivo que el empleado declara al abrir (`fondo_apertura`) sale de Tienda digitalmente (EGRESO con categoría `Fondo Apertura Turno`) pero **no entra como INGRESO al cajón**.

El cierre lo compensa con: `efectivo_esperado = saldo_digital_cajón + fondo_apertura`. Si el saldo digital del cajón es $30 y el empleado declaró $15 al abrir, el sistema espera contar $45 físicos.

**¿Por qué no se registra INGRESO en CAJA_CHICA?** Hacerlo rompería la fórmula y generaría siempre un ajuste negativo. El EGRESO de Tienda es solo para trazabilidad — el cajón lo recibe físicamente, y el cierre lo re-deposita a Tienda junto con las ventas del día.

Si `fondo_apertura = 0`, no se genera ninguna operación contable al abrir.

**El fondo ya no es fijo ni predeterminado.** Cada empleado declara libremente cuánto deja al abrir. Si deja $0, la fórmula sigue funcionando correctamente.

---

## 8. Esquema DB: `turnos_caja`

```sql
CREATE TABLE turnos_caja (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  showError('Tienes un turno activo. Realiza el cierre diario antes de cerrar sesión.');
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
  cs.codigo AS categoria,
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
      AND oc.categoria_sistema_id = 'a1000001-0000-0000-0000-000000000005'  -- DEF-REPONER
    )
  )
LEFT JOIN categorias_sistema cs ON cs.id = oc.categoria_sistema_id
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
  cs.codigo AS categoria,
  oc.monto,
  oc.descripcion,
  oc.fecha AT TIME ZONE 'America/Guayaquil' AS fecha_local
FROM operaciones_cajas oc
JOIN cajas c ON c.id = oc.caja_id
JOIN categorias_sistema cs ON cs.id = oc.categoria_sistema_id
WHERE cs.codigo IN ('DEF-RETIRAR', 'DEF-REPONER')
  AND (oc.fecha AT TIME ZONE 'America/Guayaquil')::date = CURRENT_DATE
ORDER BY oc.fecha;
```
