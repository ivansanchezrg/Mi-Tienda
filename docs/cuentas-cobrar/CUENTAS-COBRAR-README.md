# Cuentas por Cobrar — Documentación de Feature

Módulo para gestionar deudas de ventas fiadas. Permite listar clientes con saldo pendiente,
ver detalle por cliente, registrar pagos (total o parcial con distribución FIFO)
y compartir estado de cuenta como imagen profesional.

---

## Estructura de archivos

```
src/app/features/cuentas-cobrar/
├── models/
│   └── cuenta-cobrar.model.ts           # Interfaces del módulo
├── services/
│   ├── cuentas-cobrar.service.ts        # Queries y pagos
│   └── share-estado-cuenta.service.ts   # Generación de imagen + compartir
├── components/
│   └── pago-fiado-modal/                # Modal de cobro/abono
├── pages/
│   ├── main/                            # Lista de clientes con deuda
│   └── detalle-cliente/                 # Detalle + ventas de un cliente
└── cuentas-cobrar.routes.ts             # Rutas: '' y ':clienteId'
```

---

## Modelos (`cuenta-cobrar.model.ts`)

| Interface | Uso |
|-----------|-----|
| `CuentaCliente` | Fila en lista principal: nombre, teléfono, total deuda, cantidad ventas |
| `VentaFiada` | Venta fiada con saldo pendiente, campos IVA (para facturas), `subtotal`, `descuento`, `descuento_pct` |
| `VentaFiadaItem` | Ítem de producto: nombre, cantidad, precio unitario, subtotal |
| `PagoFiado` | Registro de pago contra una venta |
| `CuentasCobrarResumen` | Footer totalizador: total clientes + total deuda |

---

## Servicio principal (`cuentas-cobrar.service.ts`)

| Método | Fuente | Descripción |
|--------|--------|-------------|
| `listarClientesConDeuda(page, busqueda?)` | RPC `fn_listar_cuentas_cobrar` | Lista paginada de clientes con deuda, ordenados por mayor deuda |
| `obtenerResumen(busqueda?)` | RPC `fn_resumir_cuentas_cobrar` | Total clientes + total $ adeudado |
| `obtenerVentasFiadas(clienteId)` | Query directa | Ventas FIADO pendientes del cliente, calcula saldo con pagos existentes |
| `obtenerItemsVenta(ventaId)` | Query directa | Productos de una venta (para imagen de estado de cuenta) |
| `obtenerPagosVenta(ventaId)` | Query directa | Historial de pagos de una venta |
| `registrarPago(ventaId, monto, metodoPago, obs?, silencioso?)` | RPC `fn_registrar_pago_fiado` | Registra pago, actualiza estado_pago, ingresa a CAJA_CHICA si es efectivo |

### Cálculo de saldo pendiente

```
saldo_pendiente = venta.total - SUM(cuentas_cobrar.monto WHERE venta_id = venta.id)
```

Se calcula en TypeScript al mapear la respuesta de `obtenerVentasFiadas()`, no en la BD.

---

## Páginas

### Lista principal (`pages/main/`)

- Extiende `PaginatedListPage<CuentaCliente>`
- Búsqueda con debounce 500ms (`distinctUntilChanged`)
- Carga resumen en paralelo con `Promise.all`
- Footer totalizador con total clientes + total deuda
- Oculta tabs al entrar (`ionViewWillEnter`)

### Detalle cliente (`pages/detalle-cliente/`)

- Recibe `clienteId` del route param
- Carga en paralelo: cliente + ventas fiadas
- Luego carga items de cada venta en paralelo (para el Share)
- Almacena items en `Map<string, VentaFiadaItem[]>` (`itemsPorVenta`)

**Acciones:**
- **Cobrar** → abre `PagoFiadoModalComponent` con todas las ventas
- **Ver detalle** → abre `VentaDetalleModalComponent` (del módulo ventas). Muestra banner ANULADA si corresponde, y desglose Abonado/Pendiente/"Deuda cancelada" cuando hay pagos registrados
- **Compartir** → genera imagen vía `ShareEstadoCuentaService`

---

## Modal de pago (`pago-fiado-modal/`)

### Dos modos de operación

| Modo | Default | Descripción |
|------|---------|-------------|
| **Cobro total** | Sí | Muestra monto total centrado. Un toque cobra todo. |
| **Abono parcial** | No | Input editable + distribución FIFO + preview visual. |

El usuario alterna con "Hacer abono parcial" / "Cobrar todo".

> **Restricción:** el botón "Hacer abono parcial" solo aparece cuando `totalDeuda >= $25`. Por debajo de ese umbral solo se ofrece cobro total.

### Distribución FIFO

Cuando hay múltiples ventas pendientes, el pago se distribuye automáticamente
de la más antigua a la más nueva:

```typescript
get distribucion(): DistribucionItem[] {
    let resto = this.montoACobrar;
    return this.ventas.map(v => {
        const pago = Math.min(resto, v.saldo_pendiente);
        resto = Math.max(0, resto - pago);
        return { venta: v, pago, completa: pago >= v.saldo_pendiente };
    });
}
```

El preview solo se muestra si `modoAbono && ventas.length > 1 && montoACobrar > 0`.

### Flujo de guardado

1. Filtra items con `pago > 0`
2. Loop secuencial `for...of` (cada pago es una llamada RPC independiente)
3. Cada llamada usa `silencioso = true` (sin toast individual)
4. Progreso visual: "Procesando X de Y..."
5. Toast final: "Deuda cobrada" o "X abonos registrados"
6. Dismiss con `{ pagado: true }` → la página recarga datos

### Método de pago

- Arranca sin selección ("Seleccionar método de pago")
- Botón confirmar deshabilitado hasta que se elija uno
- Abre `OptionsModalComponent` con: Efectivo, Transferencia, Tarjeta/DeUna

### Formulario

Un solo `<form [formGroup]="form">` envuelve todo el contenido.
Campos:
- `monto` — solo visible en modo abono (`Validators.required, min(0.01), max(totalDeuda)`)
- `observaciones` — siempre visible, opcional

---

## Compartir estado de cuenta (`share-estado-cuenta.service.ts`)

### Flujo

```
1. Genera HTML vanilla (sin ion-*) con CSS inline
2. Inyecta en div oculto (position: absolute; left: -9999px)
3. setTimeout(100ms) para que el loading spinner se anime
4. html2canvas captura → canvas
5. canvas.toDataURL('image/png') → base64
6. @capacitor/filesystem → guarda PNG en Directory.Cache
7. @capacitor/share → abre menú nativo del OS
8. finally: limpia div + elimina archivo temporal
```

### Fallback

Si `Share.canShare()` retorna false (ej: browser), copia la imagen al clipboard
y muestra toast "Imagen copiada al portapapeles".

### Diseño del ticket

- Ancho fijo: 380px
- Font: `-apple-system, Roboto, sans-serif`
- Secciones:
  1. Header: `negocio_nombre` (leído de `ConfigService`) + "Estado de cuenta"
  2. Datos cliente: nombre + cédula/RUC
  3. Por cada venta:
     - Tipo + número + fecha
     - Tabla grid 4 columnas: Descripción | Cant. | P.Unit. | Subtotal
     - Descuento (solo si `descuento > 0`): subtotal + `Descuento (X%)` en verde
     - Desglose IVA (solo facturas, filas con valor $0 se ocultan): Base 0%, Base 15%, IVA 15%
     - Total venta + Abonado (si aplica) + Pendiente (rojo)
  4. Total pendiente general (solo si >1 venta)
  5. Footer: fecha generación + disclaimer fiscal

### Dependencias

```
html2canvas          ^1.4.1   (importación dinámica, no infla bundle inicial)
@capacitor/share     ^8.0.1
@capacitor/filesystem ^8.1.0
```

---

## Funciones SQL

Ubicación: `docs/cuentas-cobrar/sql/functions/`

### `fn_listar_cuentas_cobrar(p_busqueda, p_page, p_page_size)`

- JOIN ventas → clientes, LEFT JOIN cuentas_cobrar (pagos)
- Filtra: `metodo_pago = 'FIADO'`, `estado = 'COMPLETADA'`, `estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')`
- Búsqueda: ILIKE en nombre, identificación
- Orden: mayor deuda primero
- Paginación: LIMIT/OFFSET

### `fn_resumir_cuentas_cobrar(p_busqueda)`

- Mismos filtros que la lista
- Retorna: total_clientes + total_deuda (1 fila siempre, COALESCE 0)

### `fn_registrar_pago_fiado(p_venta_id, p_monto, p_metodo_pago, p_observaciones)`

1. Obtiene usuario autenticado (JWT)
2. Valida venta: existe, es FIADO, no está totalmente pagada (`FOR UPDATE` lock)
3. Verifica monto ≤ saldo_pendiente
4. INSERT en `cuentas_cobrar`
5. UPDATE `ventas.estado_pago` → `PAGADO_PARCIAL` o `PAGADO`
6. Si `EFECTIVO` → INSERT en `operaciones_cajas` + UPDATE `cajas.saldo_actual` (CAJA_CHICA)

**Seguridad:**
- `SECURITY DEFINER` + `SET search_path = public`
- `REVOKE` de `anon`, `GRANT` a `authenticated`
- Row lock (`FOR UPDATE`) previene pagos duplicados concurrentes

---

## Tablas de BD involucradas

| Tabla | Rol |
|-------|-----|
| `ventas` | Ventas con `metodo_pago = 'FIADO'` + `estado_pago` |
| `ventas_detalles` | Ítems de cada venta (productos) |
| `clientes` | Datos del cliente |
| `cuentas_cobrar` | Pagos registrados contra ventas fiadas |
| `cajas` | Actualización de saldo CAJA_CHICA (solo pagos en efectivo) |
| `operaciones_cajas` | Log de la operación de ingreso |

### Estados de pago (`ventas.estado_pago`)

```
PENDIENTE → registrar pago parcial → PAGADO_PARCIAL
PENDIENTE → registrar pago total   → PAGADO
PAGADO_PARCIAL → pago que cubre el resto → PAGADO
```

`NO_APLICA` = ventas con método de pago distinto a FIADO.

---

## Routing

```typescript
// cuentas-cobrar.routes.ts
{ path: '',            component: CuentasCobrarPage }
{ path: ':clienteId',  component: DetalleClientePage }

// layout.routes.ts
{ path: 'cuentas-cobrar', loadChildren: () => CUENTAS_COBRAR_ROUTES }
```

Menú sidebar: "Cuentas por Cobrar" con icono `hand-right-outline`.

---

## Gotchas para mantenimiento

1. **html2canvas no renderiza `ion-*`** — el ticket HTML usa solo elementos vanilla con CSS inline. Nunca agregar componentes Ionic al template del ticket.

2. **Spinner se pausa durante captura** — `html2canvas` bloquea el hilo principal. El `setTimeout(100ms)` mitiga pero no elimina la pausa. Es el comportamiento esperado.

3. **Share cancelado no es error** — `@capacitor/share` lanza excepción al cancelar. El catch filtra por "cancel"/"dismiss"/"abort" en el message.

4. **Saldo se calcula en TypeScript** — `obtenerVentasFiadas()` no usa una columna `saldo_pendiente` en BD. Lo calcula: `total - SUM(pagos)`. Si se agregan pagos fuera de la app, los datos se mantienen consistentes.

5. **FIFO no es configurable** — la distribución siempre va de la venta más antigua a la más nueva. No hay opción de elegir a qué venta aplicar el pago.

6. **Solo EFECTIVO ingresa a CAJA_CHICA** — transferencias y tarjeta/DeUna no generan movimiento de caja. Esto es intencional (el dinero no pasa por el cajón físico).

7. **`cuentas_cobrar` debe dropearse antes de `ventas` en el schema** — la tabla tiene FK a `ventas(id)`. Si se re-ejecuta el schema sin dropear `cuentas_cobrar` primero, el `DROP TABLE ventas CASCADE` no la elimina y la `CREATE TABLE cuentas_cobrar ... IF NOT EXISTS` no la recrea, quedando con la FK apuntando a la tabla `ventas` anterior (OID inválido). PostgREST no detecta la relación y lanza `PGRST200`. El orden correcto en `docs/schema.sql` es: `DROP cuentas_cobrar` → `DROP ventas` → ... → `CREATE ventas` → `CREATE cuentas_cobrar`.
