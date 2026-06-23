# Operaciones de Caja — Referencia Técnica

## ¿Qué es?

Página de **historial de movimientos** de una caja específica. Muestra todos los ingresos, egresos y transferencias registrados, con filtro por período y scroll infinito. Desde aquí también se realizan los ingresos/egresos manuales de efectivo.

### Cajas del sistema

El sistema maneja hasta 5 cajas base + cajas personalizadas (`CUSTOM_*`). Esta página puede mostrar el historial de cualquiera. El menú `⋮` **siempre se muestra** — son sus opciones internas las que se filtran (getter `opcionesMenu`, según código de caja, `esMiTurno` y `esAdmin`):

| Código | Opciones del menú |
|---|---|
| `CAJA`, `VARIOS`, `CUSTOM_*` | Registrar Ingreso · Registrar Egreso · Editar caja |
| `CAJA_CHICA` | Ingreso/Egreso **solo si `esMiTurno`** · Historial de cierres (siempre) · Editar caja (solo ADMIN) |
| `CAJA_CELULAR`, `CAJA_BUS` | Solo "Editar caja" (sin operaciones manuales) |

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
Navegación desde Home (queryParams: { cajaId, cajaNombre, cajaCodigo, esMiTurno?, variosActiva? })
        ↓
ionViewWillEnter()
  ├─ suscripción a cajas$ (Realtime) → cajaSaldo actualizado en vivo
  └─ cargarOperaciones(reset)  → obtenerOperacionesCaja(cajaId, filtro, page=0)
        ↓
Página muestra:
  ├─ Balance card: saldo actual + resumen del período (total INGRESOS y EGRESOS del filtro activo)
  ├─ Filtros sticky: Todo / Hoy (default: Todo)
  └─ Lista agrupada por fecha con scroll infinito — cada fila muestra el saldo
     resultante de la caja tras esa operación (op.saldo_actual), bajo el monto
        ↓
Usuario toca "⋮" → OptionsMenuComponent con opciones filtradas (ver tabla de cajas)
  └─ onMenuOpcion(option)
       ├─ EDITAR           → NuevaCajaModalComponent (editar nombre/icono/color)
       ├─ HISTORIAL_TURNOS → navega a Historial de cierres
       └─ INGRESO/EGRESO   → abrirModalOperacion(tipo) → OperacionModalComponent
            └─ ejecutarOperacion() → registrarOperacion() → rpc('fn_registrar_operacion_manual')
                 └─ cargarOperaciones(reset) (el saldo se actualiza vía cajas$ Realtime)
```

> **Restricción de turno (Caja Chica):** el home pasa `esMiTurno` en query params. Si el turno
> activo no es del usuario, el menú simplemente no ofrece Ingreso/Egreso (sí Historial, y Editar
> para ADMIN). La validación final la hace `fn_registrar_operacion_manual` en BD (ver §Función SQL).

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

El tipo `FiltroFecha` (`models/operacion-caja.model.ts`) sigue soportando `'hoy' | 'semana' | 'mes' | 'todas'`, pero la UI solo ofrece **Todo / Hoy** (`readonly periodos` en la página, 2026-06-22) — para una caja individual no hay una pregunta real de negocio que responda "esta semana" o "este mes"; el análisis por período vive en Ventas → Resumen. El default cambió de `'hoy'` a `'todas'` (se entra a auditar el historial completo, no solo el turno actual).

| Filtro | Rango | ¿Disponible en la UI? |
|---|---|---|
| `hoy` | Desde las 00:00 del día actual | Sí |
| `semana` | Últimos 7 días | No (sigue soportado por el servicio/tipo, sin botón) |
| `mes` | Últimos 30 días | No (idem) |
| `todas` | Sin filtro de fecha | Sí — default |

---

## Agrupación por fecha

Las operaciones se agrupan client-side en `OperacionAgrupada[]` (`fecha`, `fechaDisplay`,
`operaciones[]`). El encabezado de cada grupo es la fecha larga local ("lunes, 3 de febrero").

> ⚠️ La clave de agrupación se construye con la fecha **local** (`getFullYear/Month/Date`),
> nunca con `toISOString()` — la versión anterior agrupaba por día UTC y las operaciones
> posteriores a las ~19:00 hora Ecuador aparecían bajo un encabezado de fecha duplicado.
> Corregido el 2026-06-10.

El resumen del período del balance card (`totalIngresos`/`totalEgresos` de la página) se calcula
sobre las operaciones **cargadas** (páginas ya traídas) — con filtros largos y muchas páginas es
parcial hasta scrollear. Mejora pendiente: agregado en SQL vía RPC.

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

**Lo que ejecuta (v3.2):**
1. `fn_assert_no_superadmin()` + negocio del JWT (`get_negocio_id()`)
2. Cast `TEXT → tipo_operacion_caja_enum` interno
3. **Si la caja es `CAJA_CHICA`:** verifica que `p_empleado_id` tenga **el turno activo** (`hora_fecha_cierre IS NULL`, sin filtro de fecha — ver `2_PROCESO_INGRESO_EGRESO.md` §Función SQL por el fix del corrimiento UTC). Si no → `RAISE EXCEPTION 'Solo el empleado con turno activo puede operar sobre Caja Chica'`
4. **Si la caja es `VARIOS`:** verifica `caja_varios_activa = 'true'` en `configuraciones`
5. `SELECT FOR UPDATE` en `cajas` → obtiene saldo y bloquea la fila (evita race conditions)
6. Calcula `saldo_nuevo` — si EGRESO y `saldo_nuevo < 0` → lanza `'Saldo insuficiente'`
7. `UPDATE cajas SET saldo_actual`
8. `INSERT INTO operaciones_cajas`
9. Retorna JSON `{ success, operacion_id, saldo_anterior, saldo_nuevo }`

> **Caso especial:** Si la caja tiene déficit del turno anterior (`saldo_actual = 0` pero hay deuda), usar `fn_reparar_deficit_turno` en lugar de un EGRESO normal — esta función bloquea si `saldo_nuevo < 0`.

---

## Comprobante (Storage)

`registrarOperacion()` resuelve el empleado primero (sin huérfanos si la sesión falló) y sube la foto **antes** de llamar al RPC:
1. `uploadImage(rawUrl, 'comprobantes/operaciones')` → retorna `path` en el bucket único `mi-tienda` (ej: `{negocio_id}/comprobantes/operaciones/2026/05/abc123.webp`)
2. RPC guarda el `path` en `operaciones_cajas.comprobante_url` (no la URL firmada)
3. Si el RPC falla → `storageService.deleteFile(path)` elimina la imagen huérfana

Desde el historial, el botón de comprobante abre un alert con dos acciones:
- **Ver comprobante** → `getSignedUrl(path)` → `ComprobanteModalComponent` (clase inline al final del mismo `.ts`, imagen a pantalla completa)
- **Cambiar foto** → `elegirFuenteFoto('libre', false, false)` (flujo centralizado, sin recorte) → `actualizarComprobante()` reemplaza la imagen y borra la anterior

---

## Navegación

La página recibe datos vía **query params**:

```typescript
// Desde Home — al tocar una caja
this.router.navigate([ROUTES.caja.operaciones], {
  queryParams: {
    cajaId: caja.id,                // UUID (string — nunca Number())
    cajaNombre: caja.nombre,
    cajaCodigo: caja.codigo,        // Para filtrar las opciones del ⋮
    esMiTurno: true,                // Solo Caja Chica: el turno activo es del usuario
  }
});

// En ionViewWillEnter de OperacionesCajaPage (NO ngOnInit — IonicRouteStrategy
// cachea la página y ngOnInit corre una sola vez)
const params = this.route.snapshot.queryParams;
this.cajaId     = params['cajaId']     || '';
this.cajaNombre = params['cajaNombre'] || '';
this.cajaCodigo = params['cajaCodigo'] || '';
this.esMiTurno  = params['esMiTurno']  === 'true';
// esAdmin se lee via authService.getUsuarioActual()
```

Si `cajaId` está vacío (navegación directa sin params) → redirige al home.

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
WHERE o.caja_id = '00000000-0000-0000-0000-000000000000'  -- UUID de la caja deseada
  AND o.fecha >= NOW() - INTERVAL '7 days'
ORDER BY o.fecha DESC;
```
