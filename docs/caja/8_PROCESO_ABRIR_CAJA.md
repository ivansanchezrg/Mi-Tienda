# Abrir Caja — Referencia Técnica (v7.0 — 2026-07-18 — mutación ejecuta dentro del modal + feedback de red/timeout)

## 1. Arquitectura

### Archivos involucrados

| Archivo | Rol |
| --- | --- |
| `pages/home/home.page.ts` | `onAbrirCaja()`, `mostrarModalVerificacionFondo()` |
| `components/verificar-fondo-modal/verificar-fondo-modal.component.ts` | Modal de apertura. **Sin déficit:** un paso — input libre del fondo; el modal ejecuta `onAbrir()` (callback provisto por el home = `abrirTurno()`) **dentro de sí mismo** (patrón onConfirmar, 2026-07-18) y solo hace `dismiss` si tuvo éxito. **Con déficit (flujo secuencial, 2026-07-01):** primero aviso + checkbox "Ya hice el traspaso"; al confirmarlo se revela el input de fondo + botón. Llama `repararDeficit()` internamente y solo cierra si todo OK. |
| `services/turnos-caja.service.ts` | `obtenerDeficitTurnoAnterior()` (delegado a `fn_obtener_deficit_turno_anterior`), `abrirTurno(fondoApertura)`, `repararDeficit(deficitVarios, fondoApertura)` — ambas retornan `TurnoMutacionResult` (ver §11) |
| `models/turno-caja.model.ts` | `TurnoCaja`, `TurnoCajaConEmpleado`, `EstadoCaja` |
| `core/utils/timeout.util.ts` | `conTimeout()` + `TimeoutError` — envuelve una promesa con tope de tiempo (usado por `supabase.call({ timeoutMs })`, ver §11) |
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
       └─ componentProps: { deficitVarios, onAbrir: (fondo) => turnosCajaService.abrirTurno(fondo) }
        ↓
[VerificarFondoModalComponent] — cssClass: bottom-sheet-modal
  │  Input libre: "¿Cuánto efectivo dejas en el cajón?"
  │
  ├─ Sin déficit (hayDeficit = false) — patrón onConfirmar (2026-07-18)
  │    → botón "Abrir caja": abriendo=true, spinner "Abriendo..." REAL (ya no es
  │      cosmético) → ejecuta this.onAbrir(fondoApertura) DENTRO del modal
  │       ├─ ok: true  → dismiss { confirmado: true, fondoApertura }
  │       │              → HOME solo muestra el overlay de éxito + cargarDatos()
  │       └─ ok: false → el modal NO se cierra; aplica result.feedback (§11):
  │              'silenciar' → nada (banner offline ya avisa)
  │              'red'       → overlay "servidor no respondió" — reintentar sin perder el input
  │              'mensaje'   → texto inline en el modal (regla de negocio real)
  │      Sin `onAbrir` provisto → fail-closed: error inline, nunca finge éxito.
  │
  └─ Con déficit de VARIOS (hayDeficit = true) — FLUJO SECUENCIAL (2026-07-01)
       → PASO 1: se muestra SOLO una tarjeta única con el aviso + checklist:
           • Banner: "Toma $X en efectivo de Tienda y colócalos en Varios."
             + nota "El sistema registra el movimiento contable automáticamente
             al abrir."
           • Checkbox "Ya hice el traspaso" (dentro de la misma tarjeta, tras un
             divisor). El input de fondo y el botón "Abrir caja" AÚN NO aparecen.
             Solo "Cancelar" está disponible.
       → PASO 2: al marcar el checkbox (onConfirmoTraspasoChange):
           • el aviso+checklist desaparecen; aparece un chip verde "Traspaso a
             Varios realizado" + el input de fondo + el botón "Abrir caja"
             (revelados con .tab-animate). El foco pasa al input automáticamente.
       → MODAL llama repararDeficit(deficitVarios, fondoApertura) — mismo manejo
         de result.feedback que la rama sin déficit
       → dismiss { confirmado: true, turnoId: uuid, fondoApertura }  ← ya abierto atómicamente
        ↓
HOME: this.feedback.success({ titulo: 'Turno abierto', destacado: '$fondoApertura', ... })
  → cargarDatos() → refresca banner en Home
```

> **Por qué la mutación se movió adentro del modal (2026-07-18):** antes, en la rama sin déficit, el modal mostraba "Abriendo..." pero hacía `dismiss` **de inmediato** — el RPC real corría *después*, en el home, sin ningún indicador. Si la red fallaba en ese instante, el usuario veía el modal cerrarse sin explicación. Con el patrón onConfirmar (ya usado por la rama con déficit desde antes), el spinner refleja la mutación real y un fallo deja el modal abierto para reintentar, en vez de perder el fondo tecleado.

> **Por qué el checkbox (gate de responsabilidad humana, 2026-07-01):** el registro
> contable (EGRESO Tienda + INGRESO Varios) lo ejecuta el sistema automáticamente al
> abrir, pero el **traspaso físico del efectivo** (mover billetes de un cajón a otro)
> solo lo puede hacer el empleado — el sistema no puede verificarlo. El checkbox NO es
> una condición técnica (el asiento se registra igual); es un checkpoint de
> responsabilidad: si luego hay una discrepancia de efectivo, queda constancia de que
> el empleado confirmó explícitamente haber hecho el traspaso. El texto del checkbox es
> corto ("Ya hice el traspaso") porque el monto y las cuentas ya se leyeron en el aviso
> de arriba — no se repite. El subtítulo del header también cambia: "Hay una
> transferencia pendiente..." mientras no se confirma, "Indica con cuánto efectivo
> inicias el día" tras confirmar. **Sin déficit el checkbox no aparece** y el flujo es
> directo (input + botón visibles de entrada).

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

Cuando un cierre tuvo déficit en VARIOS, `fn_reparar_deficit_turno` inserta un `INGRESO` (cat `DEF-REPONER` de `categorias_sistema`) en VARIOS — no una `TRANSFERENCIA_ENTRANTE`. Sin esta verificación doble, el sistema re-detectaría el déficit del turno reparado.

> **Fix v1.1 (2026-07-18) — detección por `referencia_id`, no por fecha:** `fn_obtener_deficit_turno_anterior` ahora considera saldado el déficit del último turno cerrado si existe un `DEF-REPONER` cuyo `referencia_id` es **exactamente ese turno** (grabado por `fn_reparar_deficit_turno` v4.3), sin importar en qué día se ejecutó la reparación. Antes se buscaba por fecha en la ventana del día del último cierre; como la reparación ocurre al día siguiente, ese asiento caía fuera de la ventana y el sistema **re-detectaba un déficit ya reparado** si el turno se abría y cerraba en días distintos. Fallback por fecha para filas viejas sin referencia.

### Un día sin cierre NO genera déficit (por diseño)

La transferencia a VARIOS es **"una por cierre, máximo una por día"** — `fn_obtener_deficit_turno_anterior` (usada al abrir) solo mira el **último cierre**, no los días calendario transcurridos, así que el déficit que repara la apertura es siempre el de un solo día. Los días saltados cuando un turno estuvo abierto varios días no se acumulan ni se cobran retroactivamente: el dinero no se pierde (queda en Tienda). Ese pendiente multi-día lo cuantifica **el cierre** (no la apertura): `fn_datos_cierre_diario` v1.2 devuelve `varios_pendiente { dias, monto, desde, hasta }`, el wizard lo muestra en el Paso 2 y el home ofrece compensarlo con 1 tap (`fn_compensar_varios_pendiente`, traspaso Tienda → Varios). La compensación sigue siendo una acción explícita del usuario. Ver [3_PROCESO_CIERRE_CAJA.md](./3_PROCESO_CIERRE_CAJA.md) → "Turno abierto varios días".

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

> **v4.2:** La validación de turno abierto ya no filtra por fecha — un turno de un día anterior sin cerrar también bloquea con mensaje limpio (mismo criterio que `fn_abrir_turno` v3.3+).
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

Delega en `rpc('fn_abrir_turno', { p_empleado_id, p_fondo_apertura })`. La función SQL (v3.4) ejecuta en una sola transacción atómica:

1. Valida que el empleado tenga membresía activa en el negocio (multi-tenant).
2. Resuelve `caja_id` automáticamente buscando la `CAJA_CHICA` del negocio.
3. Valida que no exista **ningún** turno abierto en el negocio (`hora_fecha_cierre IS NULL`, sin filtro de fecha — un turno de un día anterior sin cerrar también bloquea). **v3.4 (2026-06-22):** el mensaje de rechazo incluye el nombre del empleado que tiene el turno (`'Ya hay un turno abierto por ' || nombre`, vía `LEFT JOIN usuarios` + `COALESCE('otro empleado')`) — antes decía solo "Ya hay un turno abierto", sin contexto de quién ni desde qué dispositivo.
4. Calcula `numero_turno = COUNT(turnos de hoy del negocio) + 1`.
5. `INSERT turnos_caja` con `hora_fecha_apertura = NOW()`, `caja_id` poblado y `fondo_apertura` declarado por el empleado.
6. **Si `p_fondo_apertura > 0`:** valida que Tienda (`CAJA`) tenga saldo suficiente (`RAISE EXCEPTION` si no alcanza — rollback de todo, incluido el INSERT del turno), luego registra el `EGRESO` en Tienda con categoría `FONDO-APERTURA` (trazabilidad contable del efectivo que sale hacia el cajón).
7. Retorna `{ success: true, turno_id, numero_turno, fondo_apertura }` o `{ success: false, error }`.

**Ventaja sobre el enfoque anterior** (3 queries separadas): elimina la race condition TOCTOU — el check y el INSERT ocurren en la misma transacción con lock implícito.

`abrirTurno()` retorna `TurnoMutacionResult` — ver §11 para el contrato completo y su historia. **La llamada ya no ocurre en el home:** desde 2026-07-18 el home solo provee `abrirTurno` como callback (`onAbrir`) al modal, que lo ejecuta él mismo dentro de `abrirCaja()` (patrón onConfirmar). El home únicamente reacciona al `dismiss` exitoso mostrando el overlay de éxito.

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

## 10. Feedback de éxito y error (`FeedbackOverlayService`)

**Éxito:** el home muestra un overlay (no toast) tras el `dismiss` exitoso del modal — antes no había ningún feedback al abrir turno, el usuario solo veía cambiar el chip en silencio:

```typescript
this.feedback.success({
  titulo: 'Turno abierto',
  destacado: `$${this.currency.format(resultado.fondoApertura)}`,
  subtitulo: 'Fondo declarado en el cajón',
});
```

**Error:** dentro del modal, según `result.feedback` (ver §11) — `'silenciar'` no muestra nada, `'red'` muestra overlay, `'mensaje'` pinta el texto inline (no overlay, para no interrumpir con un error de negocio que el usuario ya está viendo en el mismo formulario).

---

## 11. Contrato de red/timeout de las mutaciones de turno (2026-07-18)

**Problema resuelto:** con red "conectada pero rota" (WiFi asociado que no responde), el fetch podía colgarse hasta el timeout del sistema (30-60s+) sin ningún feedback — o, peor, un error de transporte silenciado por error mostraba el texto técnico del fetch (`Failed to fetch`) al usuario.

### `timeoutMs` y `silentError` en `supabase.call()`

Dos opciones nuevas, acotadas **solo** a mutaciones críticas que las piden explícitamente (el resto de la app no cambia de comportamiento):

| Opción | Efecto |
| --- | --- |
| `timeoutMs` | Envuelve la promesa con `conTimeout()` (`core/utils/timeout.util.ts`). Si el servidor no responde en ese tiempo, `call()` **relanza** `TimeoutError` — nunca lo traga. El `finally` de `call()` sigue garantizando `hideLoading()`. |
| `silentError` | `call()` no muestra su toast genérico de error; en su lugar **relanza** el error (de negocio o transporte) para que el caller decida el feedback exacto con el contexto que solo él tiene (ej. si el modal debe seguir abierto). Excepciones: "sin red" sigue retornando `null` (el banner global ya avisa) y el JWT expirado se sigue manejando igual (seguridad, no UX). |

`TIMING.turnoMutacionTimeoutMs` (`core/config/timing.config.ts`) = 20 segundos. Usado por `abrirTurno`, `repararDeficit` y `ejecutarCierreDiario` (ver `3_PROCESO_CIERRE_CAJA.md`).

### `TurnoMutacionResult` — contrato de retorno unificado

```typescript
// turnos-caja.service.ts
type TurnoFeedback = 'silenciar' | 'red' | 'mensaje';

interface TurnoMutacionResult {
  ok: boolean;
  turnoId?: string;
  feedback?: TurnoFeedback;   // presente solo cuando ok === false
  errorMsg?: string;          // solo con feedback === 'mensaje'
}
```

`abrirTurno()` y `repararDeficit()` retornan este tipo. El `feedback` es la **instrucción** de qué mostrar — el caller (modal) no re-deriva el tipo de error, solo aplica un `switch`:

| `feedback` | Cuándo | Qué hace el modal |
| --- | --- | --- |
| `'silenciar'` | Sin red detectada (`!isConnected()` + error de transporte) | Nada — el `<app-offline-banner>` global ya lo comunica |
| `'red'` | Timeout, o transporte con `isConnected() === true` ("conectada pero rota") | Overlay: *"No se pudo abrir el turno · El servidor no respondió. Verifica tu conexión e intenta de nuevo."* — el banner NO aparece en este caso, así que sin el overlay el usuario no tendría ninguna pista |
| `'mensaje'` + `errorMsg` | Excepción real del servidor / rechazo de negocio | Texto inline en el modal (nunca overlay — es una causa concreta que se lee en el mismo formulario) |

Clasificación centralizada en `TurnosCajaService.clasificarErrorMutacion(error, mensajeFallback)` (privado) — usa `supabase.debeSilenciarErrorOffline(error)` y `supabase.esErrorDeTransporte(error)` para no reinventar la detección en cada método.

### Por qué el `feedback` se decide en el servicio, no en el modal

Antes de esta unificación, el modal recibía solo `{ ok, errorMsg }` y decidía "overlay si no hay errorMsg" — ambiguo, porque tanto un timeout como una excepción inesperada llegaban sin `errorMsg`. Centralizar la clasificación en el servicio (que tiene el objeto `error` original) evita que el modal reinvente el criterio y garantiza que abrir/cerrar caja siempre den el mismo feedback ante el mismo tipo de fallo.

### Robustez del modal (`VerificarFondoModalComponent.abrirCaja()`)

- **Fail-closed sin callback:** si `onAbrir` no fue provisto por el home, el modal no asume éxito — muestra error y no cierra. Nunca "finge" abrir un turno sin ejecutar la mutación.
- **`try/catch` envolvente:** si la mutación rechaza de forma inesperada (los servicios normalmente devuelven `{ok:false}`, no lanzan, pero un fallo previo como `getUsuarioActual()` sí puede rechazar), el botón nunca queda atascado en "Abriendo..." — se restaura y se muestra el error.

---

## 12. Queries de auditoría

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
