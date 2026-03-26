# Ventas — Documentación de Feature

Módulo para consultar el historial de ventas registradas desde el POS.
Permite filtrar por período, buscar por cliente/comprobante, ver el detalle completo
de cada venta y anularla si es necesario.

---

## Estructura de archivos

```
src/app/features/ventas/
├── models/
│   └── venta.model.ts                    # Interfaces + tipos
├── services/
│   └── ventas.service.ts                 # Queries, detalle, anulación
├── components/
│   └── venta-detalle-modal/              # Modal de detalle reutilizable
└── pages/
    └── main/                             # Lista paginada con filtros
```

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
| `VentasResumen` | Footer totalizador: total_registros + total_monto |

---

## Servicio (`ventas.service.ts`)

| Método | Fuente | Descripción |
|--------|--------|-------------|
| `obtenerVentas(filtro, page, busqueda?, estado?)` | RPC `fn_listar_ventas` | Lista paginada. `estado` = `'COMPLETADA'` (default) o `'ANULADA'` |
| `resumirVentas(filtro, busqueda?, estado?)` | RPC `fn_resumir_ventas` | Total registros + monto para el filtro activo |
| `obtenerVentaDetalle(ventaId)` | Query directa `ventas` | Venta completa: ítems, cliente, empleado, pagos FIADO |
| `anularVenta(ventaId, motivo)` | RPC `anular_venta` | Anula atómicamente: revierte stock, caja y cuentas_cobrar |

### `mapVentaDetalle(raw)`

Aplana los JOINs anidados de Supabase:
- `clientes.nombre` → `cliente_nombre`
- `clientes.identificacion` → `cliente_identificacion`
- `empleados.nombre` → `empleado_nombre`
- `cuentas_cobrar[].monto` → `total_abonado` (suma acumulada de pagos)

---

## Página principal (`pages/main/`)

- Extiende `PaginatedListPage<Venta>`
- Filtros de período: Hoy / Semana / Mes / Todo (tabs)
- Búsqueda con debounce 500ms
- **Filtro de estado** (pill toggle): muestra COMPLETADAS (default) o ANULADAS
- Resumen paralelo con `Promise.all([fetchPage, resumirVentas])`
- Menú por venta: solo aparece si `estado !== 'ANULADA'`
- **Anulación**: `AlertController` con textarea para motivo obligatorio

### Estados visuales en la lista

| Estado | Visual |
|--------|--------|
| `COMPLETADA` | Normal |
| `ANULADA` | Opacidad 55%, total tachado, badge rojo "Anulada" |

---

## Modal de detalle (`venta-detalle-modal/`)

Componente reutilizable — se usa desde `VentasPage` y `DetalleClientePage` (cuentas-cobrar).

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
