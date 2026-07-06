# Plan — Dashboard "Resumen General" (multi-negocio, plan MAX)

> **Estado:** ✅ IMPLEMENTADO (Fases 0-7) — 2026-07-02. Falta solo ejecutar las funciones SQL en Supabase (ver §11 "Estado final y pasos manuales").
> **Fecha:** 2026-07-02
>
> **Actualización 2026-07-02 (UX):** el dashboard pasó de **modal fullscreen** a **page dedicada** `/resumen-general` (fuera del layout, con `ROUTES.resumenGeneral` + `roleGuard(['ADMIN'])`). El componente vive ahora en `src/app/features/grupo/pages/resumen-general/` (antes `components/resumen-general-modal/`, borrado). Se rediseñó con jerarquía ejecutiva (banner HERO de KPIs arriba, secciones con título), colores desde design tokens (`--app-*`, dark-mode aware), header con flecha de regreso al home e icono de imprimir/exportar (stub). El sidebar **navega** a la ruta (antes abría el modal). La clase `ion-modal.resumen-general-modal` de `modals.scss` se eliminó. Doc del módulo: `docs/grupo/GRUPO-README.md`. Las secciones §2/§3/§6 abajo describen el enfoque modal original — el patrón de datos, seguridad y métricas sigue igual; solo cambió el contenedor (modal → page).
> **Reemplaza dos enfoques previos ya descartados y eliminados del código:** (1) una pantalla `/grupo` standalone con entrada "Mis sucursales" en el sidebar, y (2) un selector de alcance ("Este negocio / Todas") integrado en las tabs de Ventas. Ambos se revirtieron por completo (Ventas volvió a single-tenant). El plan de aquel entonces (`PLAN-REPORTE-CONSOLIDADO-MULTINEGOCIO.md`) se borró por quedar obsoleto; la historia queda en git.

---

## 1. Qué se va a construir (en una frase)

Un **dashboard "Resumen General"** — un modal a pantalla completa, solo lectura — que muestra las métricas consolidadas de **todos los negocios del propietario** (plan MAX, hasta 3), al que se entra desde una nueva opción en el **selector de negocios** del sidebar. Ventas de cada negocio vuelve a ser simple (listado + resumen del negocio activo), sin cambios.

---

## 2. Por qué este enfoque (decisión de arquitectura)

Separa limpiamente **operar** de **analizar** — el error de los intentos anteriores era mezclarlos:

- **Operar** (listar/anular/compartir ventas) → vive en el módulo Ventas de cada negocio, single-tenant, como siempre.
- **Analizar el grupo** → vive en su propio espacio: un dashboard dedicado, solo lectura, superpuesto como modal fullscreen.

Es el patrón de **Shopify (Analytics a nivel organización)** y **Square (Dashboard)**: el análisis multi-sucursal es una capa aparte, no incrustada en la operación diaria.

**Ubicación (selector de negocios):** es el lugar ideal porque ese selector **ya solo lo ve el propietario multi-negocio** — el gate ya existe gratis. Conceptualmente encaja: "estos son mis negocios… y aquí, la vista de todos juntos".

**Por qué modal fullscreen y no una ruta:** el dashboard NO es un negocio activo (no cambia el JWT). Un modal fullscreen comunica "estás en una vista especial de análisis, ciérrala para volver a operar". Una ruta ensuciaría el layout con sidebar/tabs que no aplican a un consolidado. En Ionic se hace con `ModalController` + `cssClass` fullscreen.

**Patrón reutilizable ya en el proyecto:** existe `ion-modal.image-cropper-modal` (`src/theme/custom/modals.scss`) — modal fullscreen ya probado en Android, con `--width/--height: 100vw/100vh`, `--border-radius: 0` y manejo de safe-area de status bar (Android) y nav bar. El dashboard replica ese patrón (nueva clase, ej. `resumen-general-modal`), así que la parte de "modal a pantalla completa que funcione en Android" **no es riesgo nuevo** — solo se calca el patrón existente.

---

## 3. Seguridad (regla innegociable)

Toda la agregación multi-negocio vive en funciones **`SECURITY DEFINER`** que:
- Resuelven el propietario **del JWT** (`get_email()` → `usuarios.id`), nunca reciben `negocio_id` del cliente.
- Filtran por `negocios.propietario_usuario_id = <usuario del JWT>` — un usuario solo ve SUS negocios.
- Son de **solo lectura** — no mutan nada. No cambian el negocio activo del JWT.

Es el mismo mecanismo probado que ya usa el superadmin en `/admin`, aquí aplicado a "ser el dueño". **La RLS por `negocio_id` no se afloja en ninguna tabla.**

---

## 4. Métricas del dashboard (diseño de experto)

Organizadas en jerarquía visual — lo más accionable arriba. Todas salen de tablas reales del esquema (verificado).

### Fila 1 — KPIs financieros (con comparativa ↑↓ vs período anterior)
| KPI | Fuente | Valor para el dueño |
|---|---|---|
| **Ventas totales** | `SUM(ventas.total)` COMPLETADA | La foto financiera del grupo |
| **Ganancia neta** | `SUM((precio_unitario − precio_costo) × cantidad)` de `ventas_detalles` | Lo que de verdad queda |
| **Ticket promedio** | `total / COUNT(ventas)` | Salud de cada venta |
| **Órdenes** | `COUNT(ventas)` COMPLETADA | Volumen de operación |

Cada uno con su variación vs el período anterior (mismo # de días retrocedido).

### Fila 2 — Visualizaciones
- **Gráfico de líneas temporal**: una línea por sucursal, ventas por día en el rango (usa `ng-apexcharts`, ya en el proyecto). Es el corazón visual del dashboard.
- **Donut de participación**: cuánto aporta cada sucursal al total del grupo (%).

### Fila 3 — Alertas accionables (lo que separa un dashboard útil de uno bonito)
- Sucursal **sin ventas** en el período.
- Sucursal **cayendo** fuerte (variación ≤ −25% vs anterior).
- Sucursal con **productos en stock bajo** (`stock_actual < stock_minimo`) — cuántos.

### Fila 4 — Tabla de rendimiento por negocio (como tu imagen de referencia, mejorada)
Una fila por sucursal con: Ventas · Órdenes · Clientes · Ticket promedio · Productos vendidos · **Ganancia** · **Deuda por cobrar (fiado)**. Fila de totales al pie. La #1 destacada.

### Fila 5 — Inteligencia de producto y crédito (el plus que tu ejemplo no tiene)
- **Deuda por cobrar total del grupo** (fiado sin cobrar) — "plata en la calle", crítico en retail EC. Sale de `ventas` FIADO/pendientes menos abonos en `cuentas_cobrar`.
- **Top productos del grupo** (por ingreso y por ganancia), agrupados por nombre a través de las sucursales.

> **Nota:** las métricas exactas de cada fila se ajustan en implementación si algún dato resulta ruidoso; el diseño prioriza densidad útil sin saturar.

---

## 5. Filtros del dashboard

- Selector de período: **Hoy · Semana · Mes · Año · Rango personalizado** (como en Ventas hoy).
- Todo el dashboard reacciona al período elegido (KPIs, gráfico, tabla, alertas).

---

## 6. Plan de implementación POR FASES

Cada fase tiene un entregable verificable. Se puede pausar/aprobar entre fases.

### FASE 0 — Limpieza previa (rápida)
- Quitar del `GrupoService` el estado de alcance (`_alcance$`, `setAlcance`, `AlcanceVentas`) que quedó del enfoque anterior descartado. Dejar solo lo que el dashboard usará.
- **Entregable:** `GrupoService` limpio, sin código muerto del enfoque viejo.

### FASE 1 — Backend de agregación (fundacional)
Nuevas funciones SQL `SECURITY DEFINER` en `docs/grupo/sql/functions/`:
1. **`fn_grupo_dashboard(p_fecha_inicio, p_fecha_fin)`** → 1 RPC consolidada que devuelve en un solo JSON: KPIs del grupo + comparativa, participación por negocio (donut), y la tabla de rendimiento por negocio (ventas, clientes, ticket, productos vendidos, ganancia, deuda fiado). Minimiza round-trips.
2. **`fn_grupo_ventas_series(p_fecha_inicio, p_fecha_fin)`** → serie temporal: por cada día del rango y cada negocio, el monto vendido (para el gráfico de líneas).
   - **Nota técnica:** usa `generate_series` para producir todos los días del rango (incluidos los de $0, para que la línea no tenga huecos). Es un patrón nuevo en el proyecto (no existía). El agrupado por día debe hacerse convirtiendo `ventas.fecha` a fecha local Ecuador **antes** de agrupar (`(fecha AT TIME ZONE 'America/Guayaquil')::date`), pero acotando el WHERE con rango UTC en variables para no perder el índice (misma regla que el resto de funciones del proyecto — ver CLAUDE.md "No usar `(fecha AT TIME ZONE ...)::date = p_fecha` en WHERE").
3. **`fn_grupo_alertas(p_fecha_inicio, p_fecha_fin)`** → alertas por negocio: sin ventas, cayendo (≤ −25%), y conteo de productos en stock bajo.

Se **reutilizan** las funciones ya existentes (`fn_grupo_negocios`, `fn_grupo_ventas_por_sucursal`, `fn_grupo_top_productos`) donde apliquen, o se consolidan en `fn_grupo_dashboard` si conviene por performance.

**Convenciones obligatorias (todas las funciones nuevas)** — según CLAUDE.md:
- `SECURITY DEFINER` + `SET search_path = public`, `LANGUAGE plpgsql STABLE` (lectura pura).
- Asignaciones con `:= (SELECT ...)`, **nunca** `SELECT ... INTO` (rompe en Supabase).
- Cerrar con `REVOKE EXECUTE ... FROM anon; GRANT EXECUTE ... TO authenticated; NOTIFY pgrst, 'reload schema';`.
- Un archivo por función en `docs/grupo/sql/functions/`, con encabezado de comentario explicando qué hace y la garantía de seguridad.
- **Sin** `fn_assert_no_superadmin` (son de lectura; el superadmin no es propietario de negocios, recibe lista vacía naturalmente).

- **Entregable verificable:** llamar las funciones desde el SQL Editor de Supabase con un dueño de 2-3 negocios de prueba y ver los números correctos.

### FASE 2 — Modelo + servicio Angular
- Modelos TS que reflejen el contrato de las nuevas funciones.
- Métodos en `GrupoService`: `obtenerDashboard(filtro)`, `obtenerSeries(filtro)`, `obtenerAlertas(filtro)`.
- **Entregable:** servicio tipado, listo para consumir desde el modal.

### FASE 3 — Modal fullscreen "Resumen General" (estructura + KPIs + tabla)
- Componente `ResumenGeneralModalComponent` (modal fullscreen con clase SCSS propia calcada de `image-cropper-modal`; header con título + botón cerrar (✕) + selector de período).
- Renderiza: KPIs con comparativa, tabla de rendimiento por negocio, donut de participación.
- **Estados:** skeleton de carga · empty state (sin ventas en el período) · **estado de error/offline** (si la RPC falla, mensaje claro + botón reintentar, sin toast de red — coherente con el patrón offline del proyecto) · pull-to-refresh.
- Safe area: header respeta `safe-area-inset-top` (Android status bar), contenido respeta `safe-area-inset-bottom` (nav bar) — igual que el image-cropper.
- **Entregable verificable:** el dueño abre el dashboard y ve KPIs + tabla + donut con datos reales; con red caída ve el estado de error, no una pantalla en blanco.

### FASE 4 — Gráfico de líneas temporal
- Integrar `ng-apexcharts` con una línea por sucursal sobre la serie temporal.
- Responsive, colores consistentes con el donut.
- **Entregable verificable:** gráfico de líneas comparando la evolución de las sucursales en el rango.

### FASE 5 — Alertas + inteligencia de producto/crédito
- Bloque de alertas accionables.
- Deuda por cobrar del grupo + top productos.
- **Entregable verificable:** dashboard completo con las 5 filas de métricas.

### FASE 6 — Integración de acceso (selector de negocios)
- Agregar opción **"Ver resumen general"** al `SelectorNegocioModalComponent` (`shared/components/sidebar/selector-negocio-modal/`), como última opción separada visualmente de la lista de negocios (icono de gráfico/dashboard) — junto a la opción "Nueva sucursal" que ya existe ahí.
- **Gate (implementado):** doble condición — `estadoSuscripcion?.plan_codigo === 'MAX'` **y** `this.negocios.length >= 2`. El componente ya carga `getMisNegocios()` y `suscripcion.getEstado()` en `ngOnInit` (cero query extra — mismos datos que usa "Nueva sucursal"). El gate por plan es defensivo: aunque hoy solo MAX permite 2+ negocios, hace el beneficio explícito y a prueba de futuros planes multi-negocio.
- **Mecánica:** al tocarla, el modal se cierra con un rol nuevo (ej. `dismiss(null, 'dashboard')`), y el sidebar (que ya maneja los roles `'seleccionar'`/`'crear'` de este modal) abre el `ResumenGeneralModalComponent`. Así el dashboard no se anida dentro del selector — se abre limpio tras cerrarlo.
- **Entregable verificable:** flujo completo — sidebar → selector de negocios → "Ver resumen general" → dashboard fullscreen.

### FASE 7 — Cierre ✅
- Type-check (`tsc --noEmit`) — lo corre el dueño en su ciclo de build.
- **Decisión sobre las funciones SQL viejas (RESUELTA):** `fn_grupo_dashboard` **absorbió por completo** a `fn_grupo_resumen_ventas` (KPIs + comparativa) y `fn_grupo_ventas_por_sucursal` (tabla/ranking + participación). Ambas quedaron huérfanas → **archivos borrados** en la Fase 0. **No** requieren `DROP FUNCTION` en Supabase porque nunca se ejecutaron ahí (eran groundwork sin desplegar). Se **reutilizan tal cual** `fn_grupo_negocios` (gate) y `fn_grupo_top_productos`.
- **Gate por plan MAX** agregado al selector (ver Fase 6).
- Resto del enfoque anterior: ya limpiado en Fase 0 (estado de alcance del `GrupoService`, modelos e imports huérfanos).
- Estado final + pasos manuales documentados en §11.

---

## 7. Estado actual (qué YA está hecho vs qué FALTA)

> **Nota:** esta sección es la foto **al arrancar** (groundwork previo). El estado **final** implementado está en §11. En particular: `fn_grupo_negocios`, `fn_grupo_resumen_ventas` y `fn_grupo_ventas_por_sucursal` terminaron **borradas** (ver §11), no reutilizadas.

### ✅ Ya hecho (de iteraciones previas, se reutiliza)
- **4 funciones SQL** en `docs/grupo/sql/functions/`: `fn_grupo_negocios` (gate, se reutiliza tal cual), `fn_grupo_top_productos` (se reutiliza), `fn_grupo_resumen_ventas` y `fn_grupo_ventas_por_sucursal` (**candidatas a absorberse en `fn_grupo_dashboard`** → ver decisión en Fase 7). Todas `SECURITY DEFINER`, derivan propietario del JWT. **Aún no ejecutadas en Supabase.**
- **`src/app/features/grupo/models/grupo.model.ts`** — modelos base (negocio, resumen, ranking, top productos).
- **`src/app/features/grupo/services/grupo.service.ts`** — servicio base con `obtenerNegocios`, `obtenerResumen`, `obtenerRankingSucursales`, `obtenerTopProductos`, `esPropietarioMultiNegocio` (gate). *(Tiene código del alcance viejo que la Fase 0 limpia.)*

### 🗑️ Ya revertido/eliminado (enfoques descartados)
- Módulo Ventas **revertido a su estado original** (sin selector de alcance) — listado + resumen single-tenant como siempre.
- Eliminados: pantalla `/grupo` standalone, `grupo.routes.ts`, `grupo.guard.ts`, ruta `/grupo`, `ROUTES.grupo`, entrada "Mis sucursales" del sidebar, y los componentes `alcance-selector` y `grupo-consolidado`.

### ✅ Hecho en este plan (Fases 0-7, 2026-07-02)
- **Fase 0:** `GrupoService` limpio (sin estado de alcance); modelos e imports huérfanos borrados; `fn_grupo_resumen_ventas.sql` y `fn_grupo_ventas_por_sucursal.sql` eliminados (absorbidos por `fn_grupo_dashboard`).
- **Fase 1:** 3 funciones SQL nuevas en `docs/grupo/sql/functions/`: `fn_grupo_dashboard`, `fn_grupo_ventas_series`, `fn_grupo_alertas`.
- **Fase 2:** modelos TS (`GrupoDashboard*`, `GrupoVentasSeries`, `GrupoAlerta`) + métodos `obtenerDashboard`/`obtenerSeries`/`obtenerAlertas`.
- **Fase 3-5:** `ResumenGeneralModalComponent` (`src/app/features/grupo/components/resumen-general-modal/`) con KPIs+comparativa, alertas, donut, gráfico de líneas, tabla por negocio, deuda del grupo, top productos; estados skeleton/error-offline/empty/pull-to-refresh. Clase `ion-modal.resumen-general-modal` en `modals.scss`.
- **Fase 6:** opción "Ver resumen general" en `SelectorNegocioModalComponent` (gate MAX + 2 negocios) → el sidebar abre el modal con rol `'dashboard'`.
- **Fase 7:** decisión §7 resuelta, gate por plan, este documento.

### ⏳ Falta (paso manual del dueño, no código)
- **Ejecutar las funciones SQL en Supabase** — ver §11.

---

## 8. Lo que NO se toca (para que quede claro)

- El módulo Ventas de cada negocio (listado + resumen) — queda **exactamente como estaba**.
- La RLS de ninguna tabla.
- El flujo de `cambiarNegocio()` (entrar a operar en una sucursal) — sigue igual, es cosa distinta al dashboard.
- El esquema de BD — no se agregan tablas ni columnas; todo se calcula desde lo que ya existe.

---

## 9. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Fuga de datos entre propietarios | Funciones validan `propietario_usuario_id = <JWT>`; nunca reciben `negocio_id` |
| Performance del gráfico (serie por día × negocio) | MAX = 3 negocios; rango acotado; índices por `negocio_id` + `fecha` ya existen en `ventas` |
| Modal fullscreen + gráfico pesado en Android | Cargar datos antes de renderizar el chart; skeleton mientras carga |
| Confundir "ver dashboard" con "cambiar de negocio" | El dashboard es modal (no cambia contexto); copy claro "Resumen general de tus negocios" |

---

## 10. Decisión del dueño

✅ Aprobado (2026-07-02). Implementado en su totalidad (Fases 0-7). Ver §11 para el único paso manual restante.

---

## 11. Estado final y pasos manuales

### Archivos entregados

**Backend (SQL — en `docs/grupo/sql/functions/`):**
- `fn_grupo_dashboard.sql` — KPIs + comparativa + tabla por negocio (con productos vendidos, clientes, ganancia, participación %, variación, deuda fiado snapshot).
- `fn_grupo_ventas_series.sql` — serie temporal día×negocio (gráfico de líneas, `generate_series` sin huecos).
- `fn_grupo_alertas.sql` — alertas SIN_VENTAS / CAYENDO (≤ −25%) / STOCK_BAJO.
- Se reutiliza sin cambios: `fn_grupo_top_productos.sql`.
- **Borrados** (código muerto): `fn_grupo_resumen_ventas.sql` y `fn_grupo_ventas_por_sucursal.sql` (absorbidos por `fn_grupo_dashboard`); `fn_grupo_negocios.sql` (su único llamador `obtenerNegocios()` quedó sin uso — el gate del selector no lo necesita).

**Frontend** (estado final — page dedicada, ver nota de actualización arriba):
- `src/app/features/grupo/models/grupo.model.ts` — modelos del contrato nuevo.
- `src/app/features/grupo/services/grupo.service.ts` — `obtenerDashboard/Series/Alertas/TopProductos` (sin gate: el gate vive en el selector).
- `src/app/features/grupo/pages/resumen-general/` — la page (`.ts/.html/.scss`), jerarquía ejecutiva + design tokens.
- `src/app/features/grupo/grupo.routes.ts` — ruta con `roleGuard(['ADMIN'])`.
- `src/app/core/config/routes.config.ts` — `ROUTES.resumenGeneral`.
- `src/app/app.routes.ts` — `/resumen-general` fuera del layout (`authGuard` + `suscripcionGuard`).
- `src/app/shared/components/sidebar/selector-negocio-modal/` — opción "Ver resumen general" (gate MAX + 2 negocios).
- `src/app/shared/components/sidebar/sidebar.component.ts` — handler del rol `'dashboard'` → navega a `/resumen-general`.

### Paso manual: ejecutar las funciones en Supabase (SQL Editor, en orden)

Las funciones **aún no están en Supabase** (los `.sql` son la fuente de verdad). Ejecutar:

1. `docs/grupo/sql/functions/fn_grupo_top_productos.sql`  (si aún no está desplegada)
2. `docs/grupo/sql/functions/fn_grupo_dashboard.sql`
3. `docs/grupo/sql/functions/fn_grupo_ventas_series.sql`
4. `docs/grupo/sql/functions/fn_grupo_alertas.sql`

**Limpieza (solo si en algún momento las ejecutaste):** las 3 funciones borradas del repo — `fn_grupo_resumen_ventas`, `fn_grupo_ventas_por_sucursal` y `fn_grupo_negocios` — si nunca las desplegaste no hay nada que hacer; si sí, córrelas:

```sql
DROP FUNCTION IF EXISTS public.fn_grupo_resumen_ventas(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_grupo_ventas_por_sucursal(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_grupo_negocios();
NOTIFY pgrst, 'reload schema';
```

### Verificación rápida (con un dueño de 2-3 negocios de prueba)

```sql
SELECT public.fn_grupo_dashboard('2026-07-01', '2026-07-02');
SELECT public.fn_grupo_ventas_series('2026-06-01', '2026-07-02');
SELECT public.fn_grupo_alertas('2026-07-01', '2026-07-02');
```

Luego en la app (con sesión de ese dueño, plan MAX): sidebar → **Mis negocios** → **Ver resumen general**.

### Notas de seguridad (recordatorio)

- Las 3 funciones son `SECURITY DEFINER STABLE`, derivan el propietario del JWT (`get_email()` → `usuarios.id` → `propietario_usuario_id`), **nunca reciben `negocio_id`**. RLS intacta.
- Sin `fn_assert_no_superadmin` (son lectura pura; el superadmin no es propietario → lista vacía).
- La deuda fiado es **snapshot actual** (no acotada al período), espejando `fn_resumir_cuentas_cobrar`.

### Pendiente relacionado (ya registrado)

El gate por plan MAX en el frontend es de UX; el bloqueo técnico duro por plan (multisucursal/multiplataforma/IA) sigue en `docs/PENDIENTES.md` → §"Bloqueo técnico por dispositivo y multisucursal según plan (plan MAX)". Este dashboard no lo modifica.
