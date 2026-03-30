# Operaciones de Caja — Referencia Técnica

## ¿Qué es?

Página de **historial de movimientos** de una caja específica. Muestra todos los ingresos, egresos y transferencias registrados, con filtro por período y scroll infinito. Desde aquí también se realizan los ingresos/egresos manuales de efectivo.

### Cajas del sistema

El sistema maneja 5 cajas. Esta página puede mostrar el historial de cualquiera. Las operaciones manuales dependen del rol:

| Código | Nombre | EMPLEADO | ADMIN |
|---|---|---|---|
| `CAJA` | Tienda | ✅ Ingreso/Egreso | ✅ Ingreso/Egreso |
| `CAJA_CHICA` | Cajón | ✅ Si es su turno | ✅ Si es su turno |
| `VARIOS` | Varios | ✅ Ingreso/Egreso | ✅ Ingreso/Egreso |
| `CAJA_CELULAR` | Celular | ❌ Menú oculto | ✅ Ingreso/Egreso |
| `CAJA_BUS` | Bus | ❌ Menú oculto | ✅ Ingreso/Egreso |

> El `⋮` del header se oculta con `@if (mostrarMenuOpciones)` — getter que combina el código de caja y el rol del usuario (`esAdmin`).

---

## Archivos

| Archivo | Rol |
|---|---|
| `pages/operaciones-caja/operaciones-caja.page.ts` | Página de historial + `ComprobanteModalComponent` (clase inline al final del mismo archivo) |
| `services/operaciones-caja.service.ts` | `obtenerOperacionesCaja()`, `obtenerCategorias()`, `registrarOperacion()` |
| `services/cajas.service.ts` | `obtenerCajas()` — lee saldo actual de la caja |
| `models/operacion-caja.model.ts` | `OperacionCaja`, `TipoOperacion`, `FiltroFecha`, `OperacionesPaginadas` |

### Fuente de datos

`operaciones_cajas` contiene **dos tipos de registros**:
- **Automáticos** — creados por `fn_ejecutar_cierre_diario` (INGRESO/EGRESO del cierre, TRANSFERENCIA\_ENTRANTE a Varios, etc.) con `categoria_id = NULL`
- **Manuales** — creados por `fn_registrar_operacion_manual` vía el modal de ingreso/egreso

---

## Flujo de la página

```
Navegación desde Home (queryParams: { cajaId, cajaNombre, turnoAjeno? })
        ↓
ionViewWillEnter()
  ├─ cargarSaldoCaja()         → cajas.obtenerCajas() → cajaSaldo
  └─ cargarOperaciones(reset)  → obtenerOperacionesCaja(cajaId, filtro, page=0)
        ↓
Página muestra:
  ├─ Balance card: saldo actual + resumen del período (total INGRESOS y EGRESOS del filtro activo)
  ├─ Filtros sticky: Hoy / Semana / Mes / Todo
  └─ Lista agrupada por fecha con scroll infinito
        ↓
Usuario toca "⋮" (menú) — deshabilitado si turnoAjeno=true (Caja Chica con turno de otro empleado)
  └─ mostrarMenuOperaciones() → OptionsModal: Ingreso / Egreso
       └─ abrirModalOperacion(tipo) → OperacionModalComponent
            └─ ejecutarOperacion() → registrarOperacion() → rpc('fn_registrar_operacion_manual')
                 └─ cargarSaldoCaja() + cargarOperaciones(reset)
```

> **Restricción de turno ajeno (Caja Chica):** si el home navega a Caja Chica mientras hay un turno activo de otro empleado, pasa `turnoAjeno=true` en query params. La página lee el param en `ngOnInit` y deshabilita el `⋮` del header (atenuado + cursor prohibido). `mostrarMenuOperaciones()` retorna inmediatamente si `turnoAjeno=true`. La validación final la hace `fn_registrar_operacion_manual` en BD (ver §Función SQL).

---

## Paginación y scroll infinito

`PAGINATION_CONFIG.operacionesCaja.pageSize` registros por página. Definido en:
```
src/app/core/config/pagination.config.ts
```

El scroll infinito usa `IonInfiniteScroll` — cuando el usuario llega al final de la lista, se dispara `cargarMas()`:
1. Incrementa `currentPage++`
2. Llama `obtenerOperacionesCaja(cajaId, filtro, currentPage)` — trae la siguiente página
3. **Append** (no replace) al array `operacionesAgrupadas`
4. Si la respuesta tiene menos registros que `pageSize` → `infiniteScrollDisabled = true`

Al cambiar filtro → `cargarOperaciones(reset=true)` → `currentPage = 0`, reemplaza el array completo.

---

## Servicio: `obtenerOperacionesCaja()`

Query con JOIN a `cajas`, `empleados` y `categorias_operaciones`. Ordenado por `fecha DESC`.

| Filtro | Rango |
|---|---|
| `hoy` | Desde las 00:00 del día actual |
| `semana` | Últimos 7 días |
| `mes` | Últimos 30 días |
| `todas` | Sin filtro de fecha |

---

## Agrupación por fecha

Las operaciones se agrupan client-side en `OperacionAgrupada[]` con subtotales por día:

| Fecha | Display |
|---|---|
| Hoy | "Hoy" |
| Ayer | "Ayer" |
| Otros | "lunes, 3 feb" |

Cada grupo tiene: `fecha`, `operaciones[]`, `totalIngresos`, `totalEgresos`.

---

## Tipos de operación

| Tipo | Clasificación | Color | Icono |
|---|---|---|---|
| `INGRESO` | Entrada | success (verde) | arrow-down |
| `EGRESO` | Salida | danger (rojo) | arrow-up |
| `TRANSFERENCIA_ENTRANTE` | Entrada | success | arrow-down |
| `TRANSFERENCIA_SALIENTE` | Salida | danger | arrow-up |
| `APERTURA` | — | primary | lock-open |
| `CIERRE` | — | medium | lock-closed |
| `AJUSTE` | — | warning | create |

`esIngreso()` y `esEgreso()` determinan el signo (+/−) en los subtotales del resumen.

---

## Función SQL: `fn_registrar_operacion_manual`

> 📄 Código fuente completo: [`docs/sql/functions/fn_registrar_operacion_manual.sql`](./sql/functions/fn_registrar_operacion_manual.sql)

Llamada vía `supabase.rpc('fn_registrar_operacion_manual', params)`. Transacción atómica — si falla cualquier paso, rollback completo.

**Parámetros:**
```
p_caja_id          → ID de la caja
p_empleado_id
p_tipo_operacion   → 'INGRESO' | 'EGRESO' como TEXT
                     ⚠️ PostgREST no castea strings a ENUMs automáticamente (genera 400).
                     La función castea internamente: v_tipo := p_tipo_operacion::tipo_operacion_caja_enum
p_categoria_id
p_monto
p_descripcion      → nullable
p_comprobante_url  → PATH en Storage (no URL firmada), nullable
```

**Lo que ejecuta (v2.2):**
1. Cast `TEXT → tipo_operacion_caja_enum` interno
2. **Si la caja es `CAJA_CHICA`:** verifica que `p_empleado_id` tenga un turno activo hoy (`hora_fecha_cierre IS NULL`). Si no → `RAISE EXCEPTION 'Solo el empleado con turno activo puede operar sobre Caja Chica'`
3. `SELECT FOR UPDATE` en `cajas` → obtiene saldo y bloquea la fila (evita race conditions)
4. Calcula `saldo_nuevo` — si EGRESO y `saldo_nuevo < 0` → lanza `'Saldo insuficiente'`
5. `UPDATE cajas SET saldo_actual`
6. `INSERT INTO operaciones_cajas`
7. Retorna JSON `{ success, operacion_id, saldo_anterior, saldo_nuevo }`

> **Caso especial:** Si la caja tiene déficit del turno anterior (`saldo_actual = 0` pero hay deuda), usar `fn_reparar_deficit_turno` en lugar de un EGRESO normal — esta función bloquea si `saldo_nuevo < 0`.

---

## Comprobante (Storage)

`registrarOperacion()` sube la foto **antes** de llamar al RPC:
1. `storageService.uploadImage(dataUrl)` → retorna `path` en Storage (ej: `comprobantes/2026/02/abc123.jpg`)
2. RPC guarda el `path` en `operaciones_cajas.comprobante_url` (no la URL firmada)
3. Si el RPC falla → `storageService.deleteFile(path)` elimina la imagen huérfana

Para ver el comprobante → `verComprobante(path)`:
1. `storageService.getSignedUrl(path)` → URL temporal firmada (bucket privado)
2. Abre `ComprobanteModalComponent` (clase inline al final del mismo `.ts`, muestra la imagen a pantalla completa)

---

## Navegación

La página recibe datos vía **query params**:

```typescript
// Desde Home — al tocar una caja
this.router.navigate(['/home/operaciones-caja'], {
  queryParams: {
    cajaId: caja.id,
    cajaNombre: caja.nombre,
    cajaCodigo: caja.codigo,        // Para decidir si mostrar el ⋮ según rol
    // turnoAjeno: true             // Solo para Caja Chica con turno de otro empleado
  }
});

// En ngOnInit de OperacionesCajaPage
const params = this.route.snapshot.queryParams;
this.cajaId    = Number(params['cajaId']) || 0;
this.cajaNombre = params['cajaNombre'] || '';
this.cajaCodigo = params['cajaCodigo'] || '';
this.turnoAjeno = params['turnoAjeno'] === 'true';
// esAdmin se lee en ionViewWillEnter via authService.getUsuarioActual()
```

Si `cajaId` es `0` (navegación directa sin params) → redirige a `/home`.

---

## Query de auditoría (Supabase SQL Editor)

```sql
-- Operaciones de una caja en los últimos 7 días
SELECT
  o.fecha AT TIME ZONE 'America/Guayaquil' AS fecha_local,
  o.tipo_operacion,
  c2.nombre AS categoria,
  o.monto,
  o.saldo_anterior,
  o.saldo_actual,
  e.nombre AS empleado,
  o.descripcion
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
LEFT JOIN categorias_operaciones c2 ON o.categoria_id = c2.id
LEFT JOIN usuarios e ON o.empleado_id = e.id
WHERE o.caja_id = 1  -- cambiar por el ID de la caja deseada
  AND o.fecha >= NOW() - INTERVAL '7 days'
ORDER BY o.fecha DESC;
```
