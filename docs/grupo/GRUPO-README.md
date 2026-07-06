# Módulo Grupo — Dashboard "Resumen General" (multi-negocio, plan MAX)

Vista **consolidada y de solo lectura** de todos los negocios del propietario. Es un beneficio del **plan MAX** (hasta 3 negocios bajo una sola suscripción): responde "¿cómo van mis negocios en conjunto?" sin tener que entrar a operar en cada sucursal por separado.

**Nota de vocabulario:** "grupo" es el nombre técnico del módulo (`GrupoService`, `fn_grupo_*`, `docs/grupo/`) — **nunca aparece así en la UI**. De cara al usuario, todo el texto dice **"tus negocios"** (coherente con "Mis negocios" del sidebar): "Ventas totales de tus negocios", "Deuda por cobrar de tus negocios", "Top productos de tus negocios", "Total de tus negocios". El campo `dashboard.grupo.*` del contrato TS/JSON es interno y no se traduce.

Diseño completo, decisiones de arquitectura y plan por fases en [`docs/PLAN-DASHBOARD-RESUMEN-GENERAL.md`](../PLAN-DASHBOARD-RESUMEN-GENERAL.md).

---

## Qué es (y qué NO es)

- **Es** una capa de **análisis** dedicada: una page a pantalla completa (`/resumen-general`, fuera del layout — sin tab bar/sidebar) que agrega las métricas de todos los negocios del dueño, con jerarquía visual ejecutiva estilo Tableau/Power BI.
- **NO es** un negocio activo — no cambia el `negocio_id` del JWT, no permite operar (crear ventas, mover caja, etc.). Solo lee.
- **NO reemplaza** el módulo Ventas de cada negocio, que sigue siendo single-tenant como siempre.

Separa limpiamente **operar** (Ventas de cada negocio) de **analizar el grupo** (este dashboard) — el patrón de Shopify Analytics / Square Dashboard.

---

## Acceso y gating

**Punto de entrada:** sidebar → header clickable ("Mis negocios") → opción **"Ver resumen general"**.

Tres capas de gate (de fuera hacia adentro):

| Capa | Dónde | Condición |
|---|---|---|
| Rol | `sidebar.component.ts` `abrirSelectorNegocios()` | Solo `ADMIN` (no superadmin, no empleado). Un empleado ni siquiera abre el selector. |
| Plan + cantidad | `SelectorNegocioModalComponent.mostrarResumenGeneral` | La opción se muestra solo si `plan_codigo === 'MAX'` **y** `negocios.length >= 2`. Reutiliza datos ya cargados (`getMisNegocios` + `estadoSuscripcion`) — cero query extra. |
| Datos | funciones SQL `fn_grupo_*` | Cada función deriva la lista de negocios del propietario del JWT; un no-propietario recibe listas/ceros. |

**Mecánica de apertura:** al tocar la opción, el selector se cierra con rol `'dashboard'` (`dismiss(null, 'dashboard')`); el sidebar lo detecta y **navega** a `/resumen-general` (`ROUTES.resumenGeneral`). No cambia el negocio activo del JWT.

**Regreso al home:** la flecha del header llama `NavController.back()` (**no** `ion-back-button [defaultHref]`) — hace un *pop* del stack de Ionic sin re-resolver `/caja` ni re-ejecutar `authGuard`/`suscripcionGuard`, evitando el delay visible que ese patrón introduce. Mismo fix ya usado en `suscripcion.page.ts`.

**Ruta:** `/resumen-general` está registrada en `app.routes.ts` **fuera del layout** (como `/suscripcion`), con `authGuard` + `suscripcionGuard`; el `roleGuard(['ADMIN'])` vive dentro de `grupo.routes.ts`.

---

## Seguridad (regla innegociable)

Toda la agregación vive en funciones **`SECURITY DEFINER`** que:

- Resuelven el propietario **del JWT** (`get_email()` → `usuarios.id`), **nunca reciben `negocio_id`** del cliente.
- Filtran por `negocios.propietario_usuario_id = <usuario del JWT>` — un usuario solo ve SUS negocios, jamás los de otro propietario.
- Son de **solo lectura** (`LANGUAGE plpgsql STABLE`) — no mutan nada, no cambian el negocio activo.
- **No** llevan `fn_assert_no_superadmin`: son lectura pura y el superadmin no es propietario de negocios → recibe listas vacías naturalmente.

La **RLS por `negocio_id` no se afloja en ninguna tabla.** Es el mismo mecanismo de confianza que ya usa la RLS de `negocios` para el superadmin, aquí aplicado a "ser el dueño".

**Zona horaria + índice:** el `WHERE` de cada función acota `fecha` por rango UTC en variables (`TIMESTAMPTZ`), nunca `(fecha AT TIME ZONE ...)::date` — así se conserva el índice `(negocio_id, fecha)`. La conversión a fecha local Ecuador (para agrupar por día) se hace dentro del `SELECT`/`GROUP BY`.

---

## Funciones SQL (`docs/grupo/sql/functions/`)

| Función | Retorna | Qué calcula |
|---|---|---|
| `fn_grupo_dashboard(inicio, fin)` | `JSON` | **1 RPC consolidada.** Bloque `grupo` (KPIs: ventas, ganancia, ticket, clientes, descuentos, anuladas, unidades, deuda fiado) + comparativa período anterior; y `negocios[]` (una fila por negocio: ventas, clientes, unidades, ganancia, ticket, participación %, variación, deuda fiado). Alimenta KPIs + tabla + donut. |
| `fn_grupo_ventas_series(inicio, fin)` | `JSON` | Serie temporal día×negocio para el gráfico de líneas. `{ dias: [...], series: [{ negocio_id, nombre, valores: [...] }] }`, alineado por posición. Usa `generate_series` para **no dejar huecos** (días de $0 incluidos). |
| `fn_grupo_alertas(inicio, fin)` | `JSON` | Array de alertas accionables por negocio: `SIN_VENTAS` (0 en el período), `CAYENDO` (≤ −25% vs anterior, con base previa), `STOCK_BAJO` (# productos activos con `stock_actual < stock_minimo`, snapshot). |
| `fn_grupo_top_productos(inicio, fin)` | `JSON` | Top productos del grupo por ingreso y por ganancia, agrupados por **nombre** (no `producto_id`) para sumar el mismo producto a través de sucursales. |

**Deuda fiado = SNAPSHOT actual**, no acotada al período. Espeja `fn_resumir_cuentas_cobrar` del módulo Clientes: ventas `FIADO` + `COMPLETADA` + `estado_pago IN ('PENDIENTE','PAGADO_PARCIAL')`, menos abonos en `cuentas_cobrar`. Es "plata en la calle" — un estado de hoy, no una métrica de rango.

**Historia:** `fn_grupo_dashboard` **absorbió** a `fn_grupo_resumen_ventas` y `fn_grupo_ventas_por_sucursal` (borradas). `fn_grupo_negocios` también se borró (su único llamador quedó sin uso: el gate del selector no la necesita).

---

## Frontend (`src/app/features/grupo/`)

```
grupo/
├── grupo.routes.ts              # Ruta '' con roleGuard(['ADMIN']) → carga la page
├── models/grupo.model.ts        # Contrato de las funciones (GrupoDashboard*, GrupoVentasSeries, GrupoAlerta, GrupoTopProducto*)
├── services/grupo.service.ts    # obtenerDashboard/Series/Alertas/TopProductos (sin gate: el gate vive en el selector)
└── pages/resumen-general/
    ├── .ts                      # Estado, filtro de período, carga en paralelo, donut + gráfico de líneas, variaciones, estados, back a /caja, stub imprimir
    ├── .html                    # ion-header (back + título + icono imprimir) + period-filter + HERO KPIs + alertas + gráficos + tabla + deuda + top productos
    └── .scss                    # Estilos con design tokens (--app-*, --spacing-*, --radius-*, --shadow-*) — dark-mode aware
```

- **Page dedicada** (`/resumen-general`, fuera del layout) con `ion-header`: flecha de regreso al home vía `navCtrl.back()` (ver "Regreso al home" arriba — no `ion-back-button`), título, e **icono de imprimir/exportar** (stub — toast "próximamente", funcionalidad futura). El selector de período va en un subheader pegado al toolbar.
- **Jerarquía ejecutiva** (Tableau/Power BI): banner HERO arriba con la foto financiera (ventas totales grandes + ganancia/ticket/ventas/clientes), luego secciones con título: Alertas · Visualizaciones (donut + líneas lado a lado en desktop) · Rendimiento por negocio · Crédito y productos.
- **Colores desde design tokens** — todo el SCSS usa variables CSS del proyecto (`--app-surface`, `--app-text`, `--app-hero-bg`, `--spacing-*`, `--radius-*`, `--shadow-level-*`), por lo que es **dark-mode aware** automáticamente. Sin hex hardcodeados (salvo la paleta de series de los gráficos).
- **Carga:** las 4 RPC en paralelo (`Promise.all`). El dashboard es la fuente del estado de error (devuelve `null` en red/RPC caída); series/alertas/top tienen fallback seguro.
- **Estados:** skeleton (solo la **primera** carga) · error/offline (mensaje + reintentar, **sin toast de red**) · empty (sin ventas — pero **sí muestra alertas y deuda fiado**, que son accionables aunque no haya ventas: la deuda es snapshot y no depende del período) · pull-to-refresh. Al **cambiar de período** con datos ya en pantalla NO hay skeleton: el contenido se atenúa (`.rg-body--refetching`) mientras llega la data nueva (evita el parpadeo). Las cargas llevan **token anti-carrera** (`cargaId`): una respuesta obsoleta que llegue después de otra más nueva se descarta, así los filtros nunca muestran datos de un período distinto al seleccionado.
- **Gráfico de líneas:** una línea por negocio, color alineado por posición a donut y tabla. Se omite con ≤ 1 día en el rango (filtro "Hoy" — un punto no aporta).
- **Iconos:** nombres estáticos por rama (`@if`/`@switch`) — cumple la regla anti-tree-shaking de Android.

---

## Lo que NO se toca

- El módulo **Ventas** de cada negocio (listado + resumen) — single-tenant, sin cambios.
- La **RLS** de ninguna tabla.
- El **esquema de BD** — no se agregan tablas ni columnas; todo se calcula desde lo que ya existe.
- `cambiarNegocio()` (entrar a operar en una sucursal) — flujo distinto, sigue igual.

---

## Pasos manuales (deploy)

Las funciones SQL son la fuente de verdad pero **aún no están en Supabase**. Ejecutar en el SQL Editor (en orden): `fn_grupo_top_productos` (si aún no está), `fn_grupo_dashboard`, `fn_grupo_ventas_series`, `fn_grupo_alertas`. Detalle + `DROP` de las funciones borradas en [`docs/PLAN-DASHBOARD-RESUMEN-GENERAL.md`](../PLAN-DASHBOARD-RESUMEN-GENERAL.md) §11.

---

## Pendiente relacionado

El gate por plan MAX en el frontend es de UX; el bloqueo técnico duro por plan (multisucursal/multiplataforma/IA) se documenta en [`docs/PENDIENTES.md`](../PENDIENTES.md) y [`docs/PLAN-PLANES-SUSCRIPCION.md`](../PLAN-PLANES-SUSCRIPCION.md) §11. Este dashboard no lo modifica.
