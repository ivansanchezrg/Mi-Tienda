# Ventas — Documentación de Feature

Módulo para consultar el historial de ventas registradas desde el POS.
Permite filtrar por período, buscar por cliente/comprobante, ver el detalle completo
de cada venta, anularla si es necesario, y consultar un resumen diario.

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
    └── resumen/                            # Resumen diario (KPIs, métodos, comprobantes)
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
| `Venta` | Venta completa con JOINs opcionales (detalle modal) |
| `VentaDetalle` | Ítem de producto: cantidad, precio_unitario, subtotal |
| `VentasResumen` | Totalizador: total_registros + total_monto |
| `ReporteVentasDia` | Resumen agregado del día: totales, métodos, comprobantes |

---

## Servicio (`ventas.service.ts`)

| Método | Fuente | Descripción |
|--------|--------|-------------|
| `obtenerVentas(filtro, page, busqueda?, estado?)` | RPC `fn_listar_ventas` | Lista paginada. `estado` = `'COMPLETADA'` (default) o `'ANULADA'` |
| `resumirVentas(filtro, busqueda?, estado?)` | RPC `fn_resumir_ventas` | Total registros + monto para el filtro activo |
| `obtenerReporteDia(fecha)` | RPC `reporte_ventas_dia` | Resumen agregado: totales, por método, por comprobante |
| `obtenerVentaDetalle(ventaId)` | Query directa `ventas` | Venta completa: ítems, cliente, empleado, pagos FIADO |
| `anularVenta(ventaId, motivo)` | RPC `anular_venta` | Anula atómicamente: revierte stock, caja y cuentas_cobrar |

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
- Búsqueda con debounce 500ms + chip indicador de búsqueda activa
- **Filtro de estado** (pill toggle): COMPLETADAS (default) o ANULADAS
- Menú por venta: solo aparece si `estado !== 'ANULADA'`
- **Anulación**: `AlertController` con textarea para motivo obligatorio

### Estados visuales en la lista

| Estado | Visual |
|--------|--------|
| `COMPLETADA` | Normal |
| `ANULADA` | Opacidad 55%, total tachado, badge rojo "Anulada" |

---

## Página resumen (`pages/resumen/`)

- Clase: `VentasResumenPage`
- Carga reporte del día + deuda pendiente en paralelo (`Promise.all`)
- Pull-to-refresh sin doble spinner

### Secciones

1. **Hero card** — Total del día + stats (ventas, promedio, anuladas)
2. **Métodos de pago** — Listado con iconos coloreados, cantidad, monto y porcentaje
3. **Comprobantes** — Desglose por tipo (Ticket, Nota Venta, Factura)
4. **Deuda pendiente** — Card de alerta con total clientes y monto (desde cuentas_cobrar)

---

## Modal de detalle (`venta-detalle-modal/`)

Componente reutilizable — se usa desde `VentasListadoPage` y `DetalleClientePage` (cuentas-cobrar).

### Secciones del comprobante

1. **Banner ANULADA** (solo si `estado === 'ANULADA'`) — fondo rojo con motivo extraído de `observaciones`
2. **Cabecera** — nombre negocio, tipo + número comprobante, fecha, cajero
3. **Datos del comprador** — solo si es FACTURA o cliente real
4. **Detalle de ítems** — tabla 4 columnas: descripción, cant., p.unit., subtotal
5. **Totales** — desglose IVA (solo FACTURA) + TOTAL grande
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

---

## Funciones SQL

Ubicación: `docs/ventas/sql/functions/`

### `fn_listar_ventas(p_filtro, p_busqueda, p_page, p_page_size, p_estado)`

- Filtra por período (hoy/semana/mes/todo/fecha exacta) en timezone Ecuador
- `p_estado`: `'COMPLETADA'` (default) o `'ANULADA'`
- Búsqueda ILIKE en nombre cliente, identificación, número comprobante
- Paginación LIMIT/OFFSET
- Devuelve campos planos (sin JOINs anidados)

### `fn_resumir_ventas(p_filtro, p_busqueda, p_estado)`

- Mismos filtros que la lista
- Retorna: `total_registros` + `total_monto` (1 fila siempre)

### `reporte_ventas_dia(p_fecha)`

- Resumen agregado de un día: totales, desglose por método y tipo comprobante
- Retorna JSON con `total_ventas`, `total_monto`, `total_anuladas`, `monto_anulado`, `por_metodo_pago[]`, `por_tipo_comprobante[]`

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
| `ventas_detalles` | Ítems de cada venta |
| `clientes` | Datos del cliente (JOIN en detalle) |
| `empleados` | Nombre del cajero (JOIN en detalle) |
| `cuentas_cobrar` | Pagos registrados (FIADO) — JOIN para calcular total_abonado |
| `kardex_inventario` | Reversión de stock al anular |
| `cajas` | Descuento de saldo CAJA_CHICA al anular ventas en efectivo |
| `operaciones_cajas` | Log del EGRESO de anulación |
