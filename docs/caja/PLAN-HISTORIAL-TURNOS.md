# PLAN — Historial de Cierres de Turno (Cajón)

> **Estado:** Borrador para aprobación del usuario antes de implementar.
> **Autor:** Claude (sesión 2026-05-30)
> **Contexto:** El empleado/admin necesita poder consultar los cierres pasados del cajón (lo mismo que se enviaba por WhatsApp al dueño) desde la pantalla del cajón, navegables por fecha y turno.

---

## 1. Objetivo

Permitir que el usuario consulte, desde la pantalla **Operaciones de Caja (Cajón)**, el **historial de cierres de turno** del cajón con el mismo detalle visual del Paso 2 del wizard de cierre (Cajón Físico + Saldos al Cierre).

Cada cierre se reconstruye a partir de los datos ya persistidos en BD — **sin migración de schema**, sin nuevas columnas, sin cambios en `fn_ejecutar_cierre_diario_v5`.

---

## 2. Análisis del schema actual (revisión exhaustiva)

### 2.1 Tablas implicadas

| Tabla | Rol en la reconstrucción del cierre |
|---|---|
| `turnos_caja` | Cabecera del turno: `id`, `numero_turno`, `empleado_id`, `hora_fecha_apertura`, `hora_fecha_cierre`, `fondo_apertura` |
| `operaciones_cajas` | Ledger inmutable con `saldo_anterior` y `saldo_actual` por operación. Linkea al turno vía `referencia_id` + `tipo_referencia_id` |
| `recargas` | Snapshot exacto del cierre virtual: `UNIQUE (turno_id, tipo_servicio_id)` → 1 fila por servicio por turno con `venta_dia`, `saldo_virtual_anterior`, `saldo_virtual_actual`, `saldo_caja` |
| `ventas` | Para totalizar ventas POS efectivo del turno (`turno_id` + `metodo_pago = EFECTIVO` + `estado = COMPLETADA`) |
| `usuarios` | Nombre del cajero (JOIN con `turnos_caja.empleado_id`) |
| `cajas` | IDs de CAJA, CAJA_CHICA, VARIOS, CAJA_CELULAR, CAJA_BUS (por código, filtrado por `negocio_id`) |
| `categorias_operaciones` | Identificar el AJUSTE de conteo: `IN-005` (sobrante) y `EG-013` (faltante) |
| `tipos_referencia` | Filtrar operaciones que provienen de `turnos_caja` (cierre) o `recargas` (cuadre virtual) |

### 2.2 Cómo `fn_ejecutar_cierre_diario_v5` registra cada concepto

Al cerrar un turno, la función SQL crea estas filas en `operaciones_cajas` con `tipo_referencia = turnos_caja` y `referencia_id = p_turno_id`:

| Concepto del Paso 2 | Tabla / Patrón de lectura |
|---|---|
| Fondo de apertura | `turnos_caja.fondo_apertura` |
| Ventas POS efectivo del turno | `SUM(ventas.total)` con `turno_id` + `EFECTIVO` + `COMPLETADA` |
| Egresos del turno | `operaciones_cajas` `tipo_operacion='EGRESO'`, `caja_id=CAJA_CHICA`, `fecha >= apertura AND fecha < cierre` |
| Ingresos manuales | Calculado: `saldo_cajon_digital - ventas_pos + egresos` (igual que hoy en `cierre-diario.page.ts`) |
| Efectivo contado físico | Derivado: `deposito_a_CAJA + transferencia_a_VARIOS + ajuste_conteo`. Los tres están en `operaciones_cajas` linkados al turno |
| Depósito a Tienda (CAJA) | `operaciones_cajas` `tipo_operacion='TRANSFERENCIA_ENTRANTE'`, `caja_id=CAJA`, `referencia_id=turno_id` |
| Transferencia a Varios | `operaciones_cajas` `tipo_operacion='TRANSFERENCIA_ENTRANTE'`, `caja_id=VARIOS`, `referencia_id=turno_id` |
| Ajuste sobrante/faltante | `operaciones_cajas` `tipo_operacion='AJUSTE'`, `categoria_id=IN-005 o EG-013`, `referencia_id=turno_id`. El signo se deriva del `categoria.tipo` |
| Saldo anterior y final de CAJA | `saldo_anterior` y `saldo_actual` de la fila TRANSFERENCIA_ENTRANTE de CAJA |
| Saldo anterior y final de VARIOS | Idem para VARIOS |
| Venta Celular / saldo final | `recargas` JOIN `tipos_servicio` `codigo='CELULAR'`: `venta_dia` + `saldo_caja` |
| Venta Bus / saldo final | Idem `codigo='BUS'` |
| Saldo virtual celular/bus | `recargas.saldo_virtual_anterior`, `recargas.saldo_virtual_actual` |
| Observaciones del cierre | `operaciones_cajas.descripcion` de la fila `tipo_operacion='CIERRE'` (CAJA_CHICA) |

### 2.3 Verificación de viabilidad

He recorrido `fn_ejecutar_cierre_diario_v5.sql` y `schema.sql` línea por línea. Todos los conceptos del Paso 2 son reconstruibles. Los únicos casos especiales:

- **Turnos antiguos donde el módulo Varios estaba inactivo:** no habrá `TRANSFERENCIA_ENTRANTE` a VARIOS → la lectura debe ser `LEFT JOIN` (no `INNER JOIN`) y mostrar `0`/sin cambio cuando no exista.
- **Turnos con celular/bus deshabilitados:** no habrá filas en `recargas` para ese servicio → idem `LEFT JOIN`.
- **Turnos con conteo exacto:** no habrá fila `AJUSTE` → `diferencia = 0`.
- **Turnos con cajón vacío (sin ventas ni movimientos):** no habrá `TRANSFERENCIA_ENTRANTE` a CAJA tampoco. Hay que detectar este caso para mostrar "sin movimiento" en lugar de un saldo `null`.

**Conclusión técnica:** el plan es 100% viable sin tocar el schema.

---

## 3. Lo que se va a implementar

### 3.1 Backend (SQL — 1 archivo nuevo)

**Archivo:** `docs/caja/sql/functions/fn_listar_cierres_turno.sql`

Función `fn_listar_cierres_turno(p_fecha_desde DATE, p_fecha_hasta DATE)` que retorna `TABLE (...)`:

- 1 fila por turno cerrado en el rango (`hora_fecha_cierre IS NOT NULL`)
- Ordenada por `hora_fecha_cierre DESC` (más reciente primero)
- Filtrada por `negocio_id = get_negocio_id()` (RLS-safe, función `SECURITY DEFINER`)
- Retorna **todas** las columnas necesarias para renderizar el mismo Paso 2 del cierre

Columnas de retorno:
```sql
turno_id              UUID,
numero_turno          SMALLINT,
empleado_nombre       VARCHAR,
hora_fecha_apertura   TIMESTAMP WITH TIME ZONE,
hora_fecha_cierre     TIMESTAMP WITH TIME ZONE,
fondo_apertura        DECIMAL(12,2),
ventas_pos_efectivo   DECIMAL(12,2),
otros_ingresos        DECIMAL(12,2),  -- calculado en SQL
egresos               DECIMAL(12,2),
efectivo_fisico       DECIMAL(12,2),  -- derivado: deposito + transferencia + ajuste
diferencia            DECIMAL(12,2),  -- ajuste signado
deposito_caja         DECIMAL(12,2),
transferencia_varios  DECIMAL(12,2),
saldo_anterior_caja   DECIMAL(12,2),
saldo_final_caja      DECIMAL(12,2),
saldo_anterior_varios DECIMAL(12,2),
saldo_final_varios    DECIMAL(12,2),
saldo_anterior_celular DECIMAL(12,2),
saldo_final_celular   DECIMAL(12,2),
venta_celular         DECIMAL(12,2),
saldo_anterior_bus    DECIMAL(12,2),
saldo_final_bus       DECIMAL(12,2),
venta_bus             DECIMAL(12,2),
saldo_virtual_anterior_celular  DECIMAL(12,2),
saldo_virtual_final_celular     DECIMAL(12,2),
saldo_virtual_anterior_bus      DECIMAL(12,2),
saldo_virtual_final_bus         DECIMAL(12,2),
observaciones        TEXT
```

**Por qué función SQL y no query directa desde Angular:**
- 5+ JOINs con lógica condicional (LEFT JOIN, COALESCE)
- Filtro por categoría AJUSTE con signo derivado del tipo
- Imposible o muy frágil con el query builder de Supabase
- Reutilizable para futuros reportes

**Patrón obligatorio (CLAUDE.md):**
- `SECURITY DEFINER` + `SET search_path = public`
- `REVOKE EXECUTE ... FROM anon; GRANT EXECUTE ... TO authenticated;`
- `NOTIFY pgrst, 'reload schema'`
- Filtrado interno por `public.get_negocio_id()`
- **NO** llamar `fn_assert_no_superadmin` (es función de **lectura**, el superadmin sí necesita revisar cierres pasados)

---

### 3.2 Frontend — Servicio

**Archivo:** `src/app/features/caja/services/cierres-turno.service.ts` (nuevo)

```typescript
@Injectable({ providedIn: 'root' })
export class CierresTurnoService {
  async listar(fechaDesde: string, fechaHasta: string): Promise<CierreTurnoSnapshot[]>;
}
```

- Llama `fn_listar_cierres_turno` vía `supabase.call()`
- Retorna array tipado `CierreTurnoSnapshot[]` (modelo nuevo)

**Archivo:** `src/app/features/caja/models/cierre-turno.model.ts` (nuevo)

Interface `CierreTurnoSnapshot` con los campos del SQL.

---

### 3.3 Frontend — Nueva página

**Ruta nueva en `routes.config.ts`:**
```typescript
caja: {
  operacionesCaja: '/caja/operaciones-caja',
  cierreDiario:    '/caja/cierre-diario',
  historialTurnos: '/caja/historial-turnos',   // ← nueva
}
```

**Archivos nuevos:**
- `src/app/features/caja/pages/historial-turnos/historial-turnos.page.ts`
- `src/app/features/caja/pages/historial-turnos/historial-turnos.page.html`
- `src/app/features/caja/pages/historial-turnos/historial-turnos.page.scss`

**Estructura UI (mobile-first, multiplataforma, Material Design):**

```
┌─────────────────────────────────┐
│ ← Historial de Turnos           │ ← ion-header
├─────────────────────────────────┤
│                                 │
│ [ Hoy ] [Semana] [Mes] [...]    │ ← app-period-filter (reusa el del módulo)
│                                 │
│ ───────  Viernes 30 Mayo  ──── │ ← date-header (igual al de operaciones)
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Turno #2 · Iván              │ │
│ │ 08:00 — 18:30                │ │
│ │                              │ │
│ │ 💵 Cajón: $245.00            │ │
│ │ ✅ Cuadrado                  │ │ ← o ⚠️ Faltante / Sobrante
│ │                              │ │
│ │ Depositado a Tienda  +$225   │ │
│ │ Transferencia Varios +$20    │ │
│ │                              │ │
│ │              [ Ver detalle ⌄]│ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Turno #1 · Carlos            │ │
│ │ ...                          │ │
│ └─────────────────────────────┘ │
│                                 │
└─────────────────────────────────┘
```

- Lista paginada usando `PaginatedListPage<CierreTurnoSnapshot>` (CLAUDE.md → patrón obligatorio)
- Agrupada por fecha de cierre (mismo patrón visual que `operaciones-caja`)
- `app-period-filter` reusado del módulo (Hoy / Semana / Mes / Año / Todo)
- Empty state vía `app-empty-state` ("Sin cierres en este período")
- Pull-to-refresh
- FAB scroll-to-top heredado de `PaginatedListPage`

**Card de turno cerrado — diseño:**
- Header: `Turno #N · Nombre cajero` + chip con estado del cuadre (cuadrado/faltante/sobrante)
- Stripe color en el lado izquierdo según estado (`success` / `warning` / `danger`)
- Resumen rápido en 2 líneas (cajón contado + distribución)
- Tap en la card → abre **modal de detalle completo** (sección 3.4)

---

### 3.4 Modal de detalle del cierre

**Archivo:** `src/app/features/caja/components/cierre-turno-detalle-modal/cierre-turno-detalle-modal.component.ts` (nuevo)

Bottom-sheet modal (`bottom-sheet-modal` cssClass + `breakpoints: [0, 1]`) que renderiza **exactamente el mismo layout del Paso 2 del cierre actual**:

- Card 1: Cajón Físico (movimientos + conteo esperado + resultado del conteo)
- Card 2: Saldos al Cierre (Tienda, Varios, Celular, Bus con antes → después)
- Card 3 (nueva): Saldos Virtuales (anterior → final de celular y bus, solo si están habilitados)
- Card 4: Observaciones (solo si existen)
- Botón al final: "Compartir resumen" → reusa `ShareCierreService.enviarResumenWhatsApp()`

**Reúso máximo:** el HTML del modal copia las cards del Paso 2 actual reemplazando los getters por campos del `CierreTurnoSnapshot`. **No se duplica lógica de cálculo** — el SQL ya retorna los valores finales.

> **Importante:** el modal **no permite editar nada**. Es solo lectura. Eso lo deja claro visualmente (sin inputs, solo cards).

---

### 3.5 Punto de entrada — Menú de opciones del Cajón

**Donde se agrega:** `src/app/features/caja/pages/operaciones-caja/operaciones-caja.page.ts`

En el getter `opcionesMenu`, agregar una opción nueva **solo cuando `cajaCodigo === 'CAJA_CHICA'`**:

```typescript
get opcionesMenu(): MenuOption[] {
  const soloEditar = this.cajaCodigo === 'CAJA_CELULAR' || this.cajaCodigo === 'CAJA_BUS';
  if (soloEditar) {
    return [{ label: 'Editar caja', icon: 'create-outline', value: 'EDITAR' }];
  }

  const opciones: MenuOption[] = [
    { label: 'Registrar Ingreso', icon: 'arrow-down-outline', value: 'INGRESO' },
    { label: 'Registrar Egreso',  icon: 'arrow-up-outline',   value: 'EGRESO',  color: 'danger' },
    { label: 'Editar caja',       icon: 'create-outline',     value: 'EDITAR' },
  ];

  // Solo en el Cajón: ver historial de cierres
  if (this.cajaCodigo === 'CAJA_CHICA') {
    opciones.push({
      label: 'Historial de turnos',
      icon: 'time-outline',
      value: 'HISTORIAL_TURNOS'
    });
  }

  return opciones;
}
```

En `onMenuOpcion`, agregar el case que navega a la nueva ruta:

```typescript
if (option.value === 'HISTORIAL_TURNOS') {
  this.router.navigate([ROUTES.caja.historialTurnos]);
  return;
}
```

**Por qué solo en el Cajón:** los cierres pertenecen al cajón físico (CAJA_CHICA). En CAJA (Tienda), VARIOS, CELULAR y BUS no tiene sentido un "historial de cierres de turno" — esas cajas no abren turno (`puede_tener_turno = false`).

**Por qué `mostrarMenuOpciones` ya cubre el caso:** hoy el menú del Cajón solo aparece si `esMiTurno = true`. **Hay que cambiarlo** porque el historial debería poder consultarse incluso sin turno propio abierto (un admin viendo cierres pasados, un empleado revisando lo que hizo ayer). Propuesta:

```typescript
get mostrarMenuOpciones(): boolean {
  if (this.cajaCodigo === 'CAJA_CHICA') {
    // El menú siempre aparece en el Cajón. Las opciones internas se filtran por estado.
    return true;
  }
  return true;
}
```

Y en `opcionesMenu`, filtrar INGRESO/EGRESO si no es mi turno:

```typescript
if (this.cajaCodigo === 'CAJA_CHICA') {
  if (this.esMiTurno) {
    opciones.unshift(
      { label: 'Registrar Ingreso', icon: 'arrow-down-outline', value: 'INGRESO' },
      { label: 'Registrar Egreso',  icon: 'arrow-up-outline',   value: 'EGRESO', color: 'danger' },
    );
  }
  opciones.push({ label: 'Historial de turnos', icon: 'time-outline', value: 'HISTORIAL_TURNOS' });
  // 'Editar caja' solo si es ADMIN
  if (this.esAdmin) opciones.push({ label: 'Editar caja', icon: 'create-outline', value: 'EDITAR' });
  return opciones;
}
```

> **Nota UX:** esto significa que en el Cajón, cualquier usuario que abra la página verá el menú con al menos "Historial de turnos". Las acciones de mutación (Ingreso/Egreso) siguen restringidas a su propio turno como hoy.

---

## 4. Lo que se va a corregir

Aprovecho esta implementación para corregir 2 items relacionados detectados en sesiones previas:

### 4.1 Confirmar el fix de `resetState()` antes de leer el form
Ya aplicado en sesión anterior — los valores del paso 2 ahora se capturan en `datosCierre` **antes** de `resetState()`. **No requiere cambios adicionales.**

### 4.2 Mensaje de WhatsApp completo (`construirTexto`)
Ya se agregaron `efectivoFisico` + `diferencia` + indicador de cajón cuadrado. **No requiere cambios adicionales.**

> Ambos quedaron implementados en la sesión actual.

---

## 5. Lo que NO se va a hacer (fuera de scope)

- ❌ Modificar `turnos_caja` con columnas nuevas (no es necesario)
- ❌ Modificar `fn_ejecutar_cierre_diario_v5` (no es necesario)
- ❌ Crear vista global "Cierres" en sidebar como módulo separado (innecesario — punto de entrada único en el Cajón)
- ❌ Permitir editar/anular un cierre (lectura pura)
- ❌ Exportar a PDF/Excel (puede ser una iteración futura)
- ❌ Reporte de resumen del empleado dentro del cierre (idea anterior que dijiste posponer)

---

## 6. Orden de implementación

1. Crear `fn_listar_cierres_turno.sql` y ejecutar en Supabase
2. Crear modelo `cierre-turno.model.ts`
3. Crear servicio `cierres-turno.service.ts`
4. Crear modal `cierre-turno-detalle-modal` (reúso del HTML del Paso 2)
5. Crear página `historial-turnos` (lista + filtros)
6. Agregar ruta en `routes.config.ts`
7. Registrar ruta en `caja.routes.ts`
8. Agregar opción al menú de `operaciones-caja` + handler `HISTORIAL_TURNOS`
9. Ajustar `mostrarMenuOpciones` para que el Cajón siempre muestre menú
10. Verificación manual: cierres de hoy / semana / mes deben aparecer correctos

---

## 7. Verificación previa al merge

- [ ] Un cierre con módulos completos (Varios + Celular + Bus) muestra los 4 saldos correctamente
- [ ] Un cierre con Varios inactivo muestra solo Tienda
- [ ] Un cierre con celular/bus inactivos no muestra esas filas
- [ ] Un cierre cuadrado muestra "Cajón cuadrado" sin valor de diferencia
- [ ] Un cierre con faltante muestra el ajuste en `danger`
- [ ] Un cierre con sobrante muestra el ajuste en `success`
- [ ] La fecha local de Ecuador se respeta (no UTC) — usar `getFechaLocal()` en filtros
- [ ] El superadmin puede ver el historial (sin bloqueo de `fn_assert_no_superadmin`, ya que es lectura)
- [ ] El historial respeta RLS — solo cierres del `negocio_id` del JWT
- [ ] Compartir por WhatsApp desde el detalle reusa `ShareCierreService` (no duplicación de lógica)

---

## 8. Tiempo estimado

- SQL + modelo + servicio: ~30 min
- Página historial (lista + filtros + paginación): ~45 min
- Modal de detalle (con reúso del HTML actual): ~30 min
- Wiring del menú + ruta + ajustes: ~15 min
- **Total estimado:** ~2 horas

---

**Esperando aprobación del usuario para implementar.**
