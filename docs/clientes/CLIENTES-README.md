# Clientes — Documentación de Feature

Módulo unificado para gestionar clientes y sus créditos (ventas fiadas). Un solo listado
muestra todos los clientes con su saldo pendiente visible. Tap en cualquier cliente abre
su ficha completa con datos, historial de deuda y acciones de cobro.

> El término contable interno (`cuentas_cobrar`, `fn_registrar_pago_fiado`, etc.)
> no cambia en BD ni funciones SQL — solo los labels de UI difieren.

---

## Estructura de archivos

```
src/app/features/clientes/
├── clientes.routes.ts                        # Rutas: '' | ':clienteId'
├── models/
│   ├── cliente.model.ts                      # Interface Cliente
│   └── cuenta-cobrar.model.ts                # ClienteConSaldo, VentaFiada, PagoFiado, etc.
├── services/
│   ├── clientes.service.ts                   # CRUD completo + búsqueda
│   ├── cuentas-cobrar.service.ts             # Listado unificado + detalle + pagos
│   └── share-estado-cuenta.service.ts        # Generación de imagen + compartir
├── components/
│   ├── seleccionar-cliente-modal/            # Modal selector/creación (POS y listado)
│   ├── editar-cliente-modal/                 # Modal de edición de datos
│   └── pago-fiado-modal/                     # Modal de cobro/abono
└── pages/
    ├── listado/                              # Listado unificado con saldo por cliente
    └── detalle/                              # Ficha completa: datos + deuda + acciones
```

---

## Routing

```typescript
// clientes.routes.ts
{ path: '',           component: ClientesListadoPage }   // listado unificado
{ path: ':clienteId', component: DetalleClientePage }    // ficha del cliente

// layout.routes.ts
{ path: 'clientes', loadChildren: () => CLIENTES_ROUTES }
```

Acceso:
- Sidebar → "Clientes" → `/clientes`
- Sidebar → "Cobros y Pagos" → card "Créditos" → `/clientes` (mismo listado, filtrado por búsqueda o scroll)
- Tap en cualquier cliente → `/clientes/:clienteId`

---

## Modelos (`cuenta-cobrar.model.ts`)

| Interface | Uso |
|-----------|-----|
| `ClienteConSaldo` | Fila del listado unificado: nombre, cédula, teléfono, `total_deuda`, `cantidad_ventas_fiadas`, `ultima_venta_fecha` |
| `VentaFiada` | Venta fiada con saldo pendiente, IVA, descuento |
| `VentaFiadaItem` | Ítem de producto de una venta (para el ticket compartible) |
| `PagoFiado` | Registro de pago contra una venta |
| `CuentasCobrarResumen` | Usado por `VentasResumenPage`: total clientes + total deuda global |
| `CuentaCliente` | Legacy — solo usado internamente por `fn_listar_cuentas_cobrar` |

---

## Servicios

### `clientes.service.ts`

| Método | Descripción |
|--------|-------------|
| `buscarClientes(texto)` | Búsqueda rápida (límite 20). Usada por el modal de selección |
| `buscarPorIdentificacion(id)` | Busca exacto por cédula/RUC. Deduplicación |
| `obtenerClientePorId(id)` | Obtiene un cliente por UUID |
| `obtenerConsumidorFinal()` | Registro especial "Consumidor Final" |
| `crearCliente(data)` | Crea cliente. Toast de éxito automático |
| `actualizarCliente(id, data)` | Actualiza nombre, teléfono, email. Toast de éxito automático |

### `cuentas-cobrar.service.ts`

| Método | Fuente | Descripción |
|--------|--------|-------------|
| `listarClientesConSaldo(page, busqueda?)` | RPC `fn_listar_clientes_con_saldo` | **Listado unificado** — todos los clientes con `total_deuda` (0 si están al día). Orden: con deuda primero, luego por nombre |
| `obtenerResumen(busqueda?)` | RPC `fn_resumir_cuentas_cobrar` | Total clientes con deuda + total $ adeudado (usado por Ventas Resumen) |
| `obtenerVentasFiadas(clienteId)` | Query directa | Ventas FIADO pendientes del cliente |
| `obtenerItemsVenta(ventaId)` | Query directa | Productos de la venta (para el ticket) |
| `obtenerPagosVenta(ventaId)` | Query directa | Historial de pagos |
| `registrarPago(ventaId, monto, metodoPago, obs?, silencioso?)` | RPC `fn_registrar_pago_fiado` | Registra pago, actualiza estado, ingresa a CAJA_CHICA si es efectivo |

#### Cálculo de saldo pendiente (detalle)

```
saldo_pendiente = venta.total - SUM(cuentas_cobrar.monto WHERE venta_id = venta.id)
```

Se calcula en TypeScript al mapear `obtenerVentasFiadas()`, no como columna en BD.

---

## Páginas

### Listado unificado (`pages/listado/`)

- Clase: `ClientesListadoPage` — extiende `PaginatedListPage<ClienteConSaldo>`
- Llama a `fn_listar_clientes_con_saldo` — devuelve **todos** los clientes
- Orden: con deuda pendiente primero (mayor deuda arriba), luego el resto por nombre
- Avatar **azul** cuando `total_deuda > 0`, **gris** cuando está al día
- Monto en rojo solo aparece si hay deuda; fila sin deuda no muestra monto
- Debajo del nombre: cédula/teléfono + "X ventas · Última: fecha" (solo si tiene deuda)
- Búsqueda con debounce 500ms por nombre, cédula o teléfono
- Botón "Nuevo" en header → `EditarClienteModalComponent` en modo creación
- Tap en cliente → navega a `/clientes/:clienteId`

### Detalle de cuenta (`pages/detalle/`)

- Recibe `clienteId` del route param
- Carga secuencial: primero el cliente (header visible de inmediato), luego las ventas
- Items de cada venta se cargan en paralelo (`Promise.all`) para el Share
- `ionViewWillEnter` → `hideTabs()` / `ionViewWillLeave` → `showTabs()`

**Header:**
- Título: "Detalle de cuenta" (fijo)
- Botón compartir (solo si hay deuda)
- Botón editar (lápiz) → `EditarClienteModalComponent` en modo edición

**Tarjeta del cliente:**
- Nombre centrado grande
- Cédula centrada (si tiene)
- Teléfono centrado (si tiene)
- Resumen financiero: Total fiado / Pagado / Pendiente

**Acciones:**
- **Cobrar** (footer, solo si hay deuda) → `PagoFiadoModalComponent`
- **Ver detalle** (ojo en cada venta) → `VentaDetalleModalComponent`
- **Compartir** (header, solo si hay deuda) → `ShareEstadoCuentaService`

---

## Componentes

### Modal de edición (`editar-cliente-modal/`)

Modo creación (`cliente: null`) y modo edición (`cliente: Cliente`).

- Creación: valida cédula ecuatoriana, detecta duplicados antes de crear
- Edición: cédula de solo lectura, edita nombre/teléfono/email
- "Guardar" solo habilitado si hay cambios

### Modal de selección (`seleccionar-cliente-modal/`)

Reutilizable — usado desde `PosPage`.

Flujo "cédula primero": ingresa cédula → valida → busca en BD → si existe muestra card para seleccionar, si no habilita campos de creación.

### Modal de pago (`pago-fiado-modal/`)

**Dos modos:** cobro total (default) o abono parcial (solo si `totalDeuda >= $25`).

**Distribución FIFO:** el abono se distribuye de la venta más antigua a la más nueva automáticamente.

**Flujo de guardado:** loop secuencial `for...of` → cada pago es una RPC independiente con `silencioso = true` → toast final único → dismiss con `{ pagado: true }`.

---

## Compartir estado de cuenta (`share-estado-cuenta.service.ts`)

```
1. HTML vanilla con CSS inline → div oculto
2. setTimeout(100ms) → html2canvas captura
3. base64 → Filesystem.Cache → Share nativo del OS
4. finally: limpia DOM + elimina archivo temporal
```

**Fallback web:** si `Share.canShare()` es false → envía resumen en texto por WhatsApp (`api.whatsapp.com`, prefijo Ecuador `593...`).

---

## Funciones SQL

Ubicación: `docs/clientes/sql/functions/`

### `fn_listar_clientes_con_saldo(p_busqueda, p_page, p_page_size)` ← principal del listado

- FROM `clientes` LEFT JOIN subconsulta de deuda pendiente por cliente
- Devuelve **todos** los clientes (sin deuda = `total_deuda: 0`)
- Orden: `total_deuda DESC NULLS LAST`, luego `nombre ASC`
- Búsqueda: ILIKE en nombre, identificación, teléfono

### `fn_listar_cuentas_cobrar(p_busqueda, p_page, p_page_size)`

- Solo clientes **con** deuda pendiente (`HAVING total_deuda > 0`)
- Usado por el listado de cuentas por cobrar (paginado) — NO por `obtenerResumen()`

### `fn_resumir_cuentas_cobrar(p_busqueda)` — v1.1

- Retorna: `total_clientes` (con deuda) + `total_deuda` global del negocio activo
- Siempre retorna 1 fila con COALESCE a 0
- **v1.1 (2026-05-30):** fix multi-tenant. Antes la función no filtraba por `negocio_id`, devolviendo la suma de todos los tenants. Ahora cada JOIN (ventas, clientes, cuentas_cobrar) filtra por `get_negocio_id()` del JWT — obligatorio porque `SECURITY DEFINER` bypasea RLS.

### `fn_registrar_pago_fiado(p_venta_id, p_monto, p_metodo_pago, p_observaciones)`

1. Valida venta FIADO activa con `FOR UPDATE` (previene race conditions)
2. Verifica `monto ≤ saldo_pendiente`
3. INSERT en `cuentas_cobrar`
4. UPDATE `ventas.estado_pago` → `PAGADO_PARCIAL` o `PAGADO`
5. Si `EFECTIVO` → operación en `CAJA_CHICA`

---

## Tablas de BD

| Tabla | Rol |
|-------|-----|
| `clientes` | Registro de clientes, `identificacion` UNIQUE |
| `ventas` | Ventas con `metodo_pago = 'FIADO'` + `estado_pago` |
| `ventas_detalles` | Ítems de cada venta |
| `cuentas_cobrar` | Pagos registrados contra ventas fiadas |
| `cajas` | Saldo CAJA_CHICA (pagos en efectivo) |
| `operaciones_cajas` | Log de ingresos |

### Estados de pago (`ventas.estado_pago`)

```
PENDIENTE → pago parcial → PAGADO_PARCIAL → pago que cubre el resto → PAGADO
PENDIENTE → pago total   → PAGADO
```

`NO_APLICA` = ventas con método distinto a FIADO.

---

## Quién consume este módulo

| Consumidor | Qué usa | Para qué |
|-----------|---------|----------|
| POS | `SeleccionarClienteModalComponent`, `ClientesService` | Asignar cliente a venta |
| Ventas (resumen) | `CuentasCobrarService.obtenerResumen()` | Deuda total en el panel de resumen |
| Cobros y Pagos (hub) | Ruta `/clientes` | Acceso al listado unificado |

---

## Gotchas para mantenimiento

1. **html2canvas no renderiza `ion-*`** — el ticket usa solo HTML vanilla con CSS inline.

2. **Share cancelado no es error** — `@capacitor/share` lanza excepción al cancelar. El catch filtra por "cancel"/"dismiss"/"abort".

3. **Saldo se calcula en TypeScript** — `obtenerVentasFiadas()` calcula `total - SUM(pagos)` al mapear. No es una columna de BD.

4. **FIFO no es configurable** — distribución siempre de la venta más antigua a la más nueva.

5. **Solo EFECTIVO ingresa a CAJA_CHICA** — transferencia y tarjeta no generan movimiento de caja físico.

6. **`cuentas_cobrar` se dropea antes que `ventas`** — tiene FK a `ventas(id)`. Orden en schema: `DROP cuentas_cobrar` → `DROP ventas`.

7. **`fn_listar_clientes_con_saldo` vs `fn_listar_cuentas_cobrar`** — son funciones distintas con propósito distinto. `fn_listar_clientes_con_saldo` trae todos los clientes (listado principal UI con saldo). `fn_listar_cuentas_cobrar` trae solo clientes con deuda > 0 (listado de cuentas por cobrar). El resumen del panel de ventas usa `fn_resumir_cuentas_cobrar` (1 fila: total clientes + total deuda).
