# Ventas — Documentación de Feature

Módulo para consultar el historial de ventas registradas desde el POS.
Permite filtrar por período, buscar por cliente/comprobante, ver el detalle completo
de cada venta, anularla si es necesario, y consultar un resumen por período.

---

## Estructura de archivos

```
src/app/features/ventas/
├── ventas.routes.ts                        # Rutas: '' → listado, 'resumen' → resumen
├── models/
│   └── venta.model.ts                      # Interfaces + tipos
├── services/
│   └── ventas.service.ts                   # Queries, detalle, anulación, reporte
├── components/
│   ├── ventas-tabs/                        # Tabs internas (Lista / Resumen)
│   └── venta-detalle-modal/                # Modal de detalle reutilizable
└── pages/
    ├── listado/                            # Lista paginada con filtros
    │   ├── ventas-listado.page.ts
    │   ├── ventas-listado.page.html
    │   └── ventas-listado.page.scss
    └── resumen/                            # Resumen por período (KPIs, métodos, comprobantes, top productos)
        ├── ventas-resumen.page.ts
        ├── ventas-resumen.page.html
        └── ventas-resumen.page.scss
```

### Patrón de tabs internas

El módulo usa **tabs internas** (`VentasTabsComponent`) para navegar entre Listado y Resumen.
Cada página incluye su propio `ion-header` con el componente de tabs — Ionic no soporta
un layout wrapper con `router-outlet` hijo sin conflictos de `ion-content`.

```
VentasTabsComponent detecta la ruta activa automáticamente (NavigationEnd).
Tab "Lista"   → router.navigate(['/ventas'])
Tab "Resumen" → router.navigate(['/ventas/resumen'])
```

**Este patrón debe seguirse en cualquier módulo que necesite tabs internas:**
1. Crear un componente de tabs en `components/` (no en `pages/`)
2. Cada página incluye `ion-header` + el componente de tabs
3. Las rutas son planas en el routes file (no usar layout wrapper con children)

---

## Modelos (`venta.model.ts`)

| Tipo / Interface | Descripción |
|-----------------|-------------|
| `MetodoPagoType` | `'EFECTIVO' \| 'DEUNA' \| 'TRANSFERENCIA' \| 'FIADO'` |
| `TipoComprobanteType` | `'TICKET' \| 'NOTA_VENTA' \| 'FACTURA'` |
| `EstadoVentaType` | `'COMPLETADA' \| 'ANULADA' \| 'PENDIENTE'` |
| `EstadoPagoType` | `'NO_APLICA' \| 'PENDIENTE' \| 'PAGADO_PARCIAL' \| 'PAGADO'` |
| `Venta` | Venta completa con JOINs opcionales (detalle modal). Incluye `descuento`, `descuento_pct` |
| `VentaDetalle` | Ítem de producto: cantidad, precio_unitario, subtotal |
| `VentasResumen` | Totalizador: total_registros + total_monto |
| `ReporteVentasDia` | Resumen agregado por período: totales, ganancia bruta, margen %, métodos, comprobantes, top productos |
| `ReporteMetodoPago` | `{ metodo, cantidad, monto }` |
| `ReporteTipoComprobante` | `{ tipo, cantidad, monto }` |
| `ProductoMasVendido` | `{ producto_id, nombre, total_unidades, total_monto, total_ventas }` |

---

## Servicio (`ventas.service.ts`)

| Método | Fuente | Descripción |
|--------|--------|-------------|
| `obtenerVentas(filtro, page, busqueda?, estado?, turnoId?)` | RPC `fn_listar_ventas` | Lista paginada. `estado` = `'COMPLETADA'` (default) o `'ANULADA'`. `turnoId` filtra por turno específico (solo ADMIN lo usa) |
| `resumirVentas(filtro, busqueda?, estado?, turnoId?)` | RPC `fn_resumir_ventas` | Total registros + monto para el filtro activo |
| `obtenerReportePeriodo(filtro, turnoId?)` | RPC `fn_reporte_ventas_periodo` | Resumen agregado: totales, por método, por comprobante, top productos |
| `obtenerVentaDetalle(ventaId)` | Query directa `ventas` | Venta completa: ítems, cliente, empleado, pagos FIADO |
| `anularVenta(ventaId, motivo)` | RPC `fn_anular_venta` | Anula atómicamente: revierte stock, caja y cuentas_cobrar |

### Control de acceso por rol

| Funcionalidad | ADMIN | EMPLEADO |
|---------------|-------|----------|
| Ver ventas | Todas | Todas (necesita atender reclamos de clientes) |
| Filtro por turno | ✅ Visible (si hay 2+ turnos) | ❌ Oculto |
| Anular venta | Cualquier venta | Solo sus propias ventas (`empleado_id === usuario.id`) |

### `calcularRangoFiltro(filtro)` (privado)

Convierte el filtro de período a rango `{ inicio, fin }` en fecha local Ecuador:

| Filtro | inicio | fin |
|--------|--------|-----|
| `'hoy'` | hoy | hoy |
| `'semana'` | lunes de la semana actual | hoy |
| `'mes'` | primer día del mes actual | hoy |
| `'todo'` | `'2000-01-01'` | hoy |

### `mapVentaDetalle(raw)`

Aplana los JOINs anidados de Supabase:
- `clientes.nombre` → `cliente_nombre`
- `clientes.identificacion` → `cliente_identificacion`
- `empleados.nombre` → `empleado_nombre`
- `cuentas_cobrar[].monto` → `total_abonado` (suma acumulada de pagos)

---

## Página listado (`pages/listado/`)

- Clase: `VentasListadoPage` — extiende `PaginatedListPage<Venta>`
- Filtros de período en el header: Hoy / Semana / Mes / Todo + calendario custom
- **Filtro por turno**: visible solo para ADMIN cuando hay 2+ turnos en el día (Hoy o fecha custom). Abre `OptionsModalComponent` con `"Todos los turnos"` + turnos del día. Se resetea al cambiar de período
- Búsqueda con debounce 500ms + chip indicador de búsqueda activa
- **Filtro de estado** (pill toggle): COMPLETADAS (default) o ANULADAS
- Menú por venta: aparece si `estado !== 'ANULADA'` **y** el usuario puede anular (ADMIN siempre, EMPLEADO solo en sus propias ventas)
- **Anulación**: `AlertController` con textarea para motivo obligatorio

### Estados visuales en la lista

| Estado | Visual |
|--------|--------|
| `COMPLETADA` | Normal |
| `ANULADA` | Opacidad 55%, total tachado, badge rojo "Anulada" |

---

## Página resumen (`pages/resumen/`)

- Clase: `VentasResumenPage`
- Filtro de período: **Hoy / Semana / Mes / Todo** (selector en la parte superior)
- **Filtro por turno**: visible solo para ADMIN con filtro "Hoy" y 2+ turnos
- Carga reporte del período + deuda pendiente en paralelo (`Promise.all`)
- Pull-to-refresh sin doble spinner

### Secciones

1. **Hero card** — Total del período + stats (ventas, ticket promedio, anuladas)
2. **Métodos de pago** — Listado con iconos coloreados, cantidad, monto y % del total
3. **Comprobantes** — Desglose por tipo (Ticket, Nota de Venta, Factura) con badge de cantidad
4. **Más vendidos** — Top productos: unidades vendidas, número de ventas y monto total
5. **Ganancia bruta** — Ingresos, costo, ganancia en verde y badge de % de margen
6. **Deuda pendiente** — Card de alerta con total clientes y monto (desde cuentas_cobrar)

---

## Modal de detalle (`venta-detalle-modal/`)

Componente reutilizable — se usa desde `VentasListadoPage` y `DetalleClientePage` (cuentas-cobrar).

### Secciones del comprobante

1. **Banner ANULADA** (solo si `estado === 'ANULADA'`) — fondo rojo con motivo extraído de `observaciones`
2. **Cabecera** — nombre negocio, tipo + número comprobante, fecha, cajero
3. **Datos del comprador** — solo si es FACTURA o cliente real
4. **Detalle de ítems** — tabla 4 columnas: descripción, cant., p.unit., subtotal
5. **Totales** — desglose IVA (solo FACTURA, filas con valor $0 se ocultan) + descuento (si aplica: subtotal + `Descuento (X%)`) + TOTAL grande
6. **Estado de cuenta FIADO** (solo si `metodo_pago === 'FIADO' && !esAnulada && totalAbonado > 0`):
   - Abonado (verde)
   - Pendiente (naranja) — solo si `estado_pago !== 'PAGADO'`
   - "Deuda cancelada" (verde) — si `estado_pago === 'PAGADO'`
7. **Pie** — método de pago, "Pendiente de cobro" (solo FIADO no pagado, no anulada), mensaje final

### Getters del componente

| Getter | Descripción |
|--------|-------------|
| `esAnulada` | `estado === 'ANULADA'` |
| `motivoAnulacion` | Extrae motivo de `observaciones` con regex `/ANULADA:\s*(.+)/` |
| `esFiado` | `metodo_pago === 'FIADO'` |
| `totalAbonado` | `total_abonado ?? 0` (calculado desde cuentas_cobrar) |
| `totalPendiente` | `total - totalAbonado` |
| `estadoPago` | `estado_pago ?? 'NO_APLICA'` |
| `tieneClienteReal` | `cliente_nombre` existe y no es "Consumidor Final" |

### Descuento en detalle

Si `venta.descuento > 0`, el modal muestra:
- Subtotal (sin descuento)
- `Descuento (X%)` en verde con el porcentaje histórico (`descuento_pct`)
- Total final

El porcentaje se lee de `ventas.descuento_pct` (columna SMALLINT), no se calcula desde los montos. Esto garantiza trazabilidad histórica independiente de la configuración actual.

---

## Funciones SQL

Ubicación: `docs/ventas/sql/functions/`

### `fn_listar_ventas(p_filtro, p_busqueda, p_page, p_page_size, p_estado, p_turno_id)` — v1.4

- Filtra por período (hoy/semana/mes/todo/fecha exacta) en timezone Ecuador
- `p_estado`: `'COMPLETADA'` (default) o `'ANULADA'`
- `p_turno_id`: UUID del turno. `NULL` = todos los turnos. Solo el ADMIN lo envía desde el frontend
- Búsqueda ILIKE en nombre cliente, identificación, número comprobante
- Paginación LIMIT/OFFSET
- Devuelve campos planos (sin JOINs anidados)

### `fn_resumir_ventas(p_filtro, p_busqueda, p_estado, p_turno_id)` — v1.3

- Mismos filtros que la lista (incluye `p_turno_id`)
- Retorna: `total_registros` + `total_monto` (1 fila siempre)

### `fn_reporte_ventas_periodo(p_fecha_inicio, p_fecha_fin, p_turno_id)` — v1.4

- Resumen agregado de un rango de fechas en timezone Ecuador
- `p_turno_id`: UUID del turno. `NULL` = todos los turnos. Solo el ADMIN lo envía desde el frontend
- Solo incluye ventas `COMPLETADAS` (excluye `ANULADAS` de totales)
- Retorna JSON con:
  - `total_ventas`, `total_monto`, `total_anuladas`, `monto_anulado`
  - `costo_total` — suma de `vd.precio_costo × cantidad` (snapshot histórico, no el costo actual del producto)
  - `ganancia_bruta` — `total_monto - costo_total`
  - `margen_pct` — `ganancia_bruta / total_monto × 100` (redondeado a 2 decimales)
  - `por_metodo_pago[]` — `{ metodo, cantidad, monto }`
  - `por_tipo_comprobante[]` — `{ tipo, cantidad, monto }`
  - `top_productos[]` — `{ producto_id, nombre, total_unidades, total_monto, total_ventas }`

> **v1.4**: usa `vd.precio_costo` de `ventas_detalles` en lugar de `p.precio_costo` de `productos`. Los reportes históricos ya no cambian si se modifica el costo de un producto en inventario.

---

## Función de anulación

Ubicación: `docs/pos/sql/functions/fn_anular_venta.sql` (v1.1)

### Qué hace (atómico en una transacción)

1. Valida que la venta existe y está `COMPLETADA`
2. **Si es FIADO**: bloquea la anulación si ya hay entradas en `cuentas_cobrar` (dinero ya recibido no se puede revertir automáticamente)
3. Revierte stock → INSERT en `kardex_inventario` tipo `ANULACION_VENTA` por cada ítem
4. Si es EFECTIVO → EGRESO en `operaciones_cajas` + descuenta saldo de `CAJA_CHICA`
5. Si es FIADO sin pagos → DELETE en `cuentas_cobrar`
6. UPDATE `ventas.estado = 'ANULADA'`, `observaciones = 'ANULADA: {motivo}'`

### Restricciones de negocio

| Caso | Comportamiento |
|------|---------------|
| Venta ya anulada | Error: "La venta ya está anulada" |
| FIADO con abonos | Error: "No se puede anular... ya tiene abonos registrados" |
| FIADO sin abonos | Anula y elimina la cuenta por cobrar |

---

## Tablas de BD involucradas

| Tabla | Rol |
|-------|-----|
| `ventas` | Registro principal con estado y estado_pago |
| `ventas_detalles` | Ítems de cada venta. Incluye `precio_costo` (snapshot al momento de la venta) |
| `clientes` | Datos del cliente (JOIN en detalle) |
| `empleados` | Nombre del cajero (JOIN en detalle) |
| `cuentas_cobrar` | Pagos registrados (FIADO) — JOIN para calcular total_abonado |
| `kardex_inventario` | Reversión de stock al anular |
| `cajas` | Descuento de saldo CAJA_CHICA al anular ventas en efectivo |
| `operaciones_cajas` | Log del EGRESO de anulación |

---

## Seed de prueba

Ubicación: `docs/ventas/sql/seeds/seed_ventas_prueba.sql`

Inserta 15 ventas distribuidas en 4 períodos para verificar `fn_reporte_ventas_periodo`.
Inserta directamente en `ventas` + `ventas_detalles` (sin trigger de stock).

| Período | Ventas | Total esperado |
|---------|--------|---------------|
| Hoy | 3 completadas + 1 anulada | $12.20 |
| Semana (ayer + anteayer) | 4 | $36.50 |
| Mes (hace 8 y 12 días) | 4 | $74.00 acumulado |
| Todo (hace 35 días) | 3 | $113.80 acumulado |
