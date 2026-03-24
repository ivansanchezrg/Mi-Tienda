# POS — Documentación del módulo

## Estructura de archivos

```
features/pos/
├── pages/pos/
│   ├── pos.page.ts        # Lógica principal (carrito, búsqueda, escáner, cobro)
│   ├── pos.page.html       # Template con modo normal + modo escáner
│   └── pos.page.scss       # Estilos (carrito, escáner, search, footer)
├── services/
│   └── pos.service.ts      # Procesa venta via RPC (transacción atómica)
├── models/
│   ├── cart-item.model.ts   # CartItem extends Producto + cantidad + subtotal
│   └── tipo-comprobante.enum.ts  # TICKET | NOTA_VENTA | FACTURA
└── pos.routes.ts            # Lazy-load de PosPage
```

---

## Flujo de venta

1. Empleado busca productos (por nombre o código) o escanea con cámara/pistola
2. Productos se agregan al carrito local (array en memoria)
3. Empleado presiona "Cobrar" → ActionSheet con método de pago
4. `PosService.procesarVenta()` llama a `registrar_venta_pos` (RPC PostgreSQL)
5. La función SQL hace todo en una transacción atómica:
   - INSERT en `ventas`
   - INSERT en `ventas_detalles`
   - Trigger descuenta stock + graba kardex
   - Trigger actualiza saldo CAJA_CHICA si es EFECTIVO

---

## Modos de entrada de productos

### 1. Búsqueda por nombre
- Debounce de 450ms
- Muestra lista de sugerencias (slot="fixed", no scrollea con el carrito)
- Click en sugerencia agrega al carrito

### 2. Búsqueda por código
- Código simple (≥8 chars): busca automáticamente sin Enter
- Patrón bulk `cantidad.codigo` (ej: `10.7891234`): agrega N unidades de golpe
- Enter manual también dispara búsqueda (para pistolas lectoras)

### 3. Escáner de cámara (MLKit)
- Plugin: `@capacitor-mlkit/barcode-scanning`
- La cámara se renderiza en capa nativa debajo del WebView
- Anti-duplicados: `procesandoEscaneo` flag + debounce 1.5s por código
- Feedback: vibración (40ms) + beep (Web Audio API) + preview efímero (2.5s)

### 4. Pistola lectora USB/Bluetooth
- `@HostListener('document:keypress')` captura teclas rápidas
- Buffer de 100ms distingue pistola (rápida) de tipeo humano (lento)
- Enter al final del buffer dispara búsqueda
- Ignora eventos si hay un input enfocado (evita duplicados)

---

## Escáner de cámara — Setup Android

### Problema conocido
MLKit renderiza la cámara debajo del WebView. Sin configuración, el WebView es opaco y la cámara no se ve.

### Solución (2 cambios obligatorios)

**1. CSS** — `src/global.scss`:
```scss
body.scanner-active {
  visibility: hidden;
  --background: transparent;
  --ion-background-color: transparent;
}
body.scanner-active .scanner-overlay,
body.scanner-active .scanner-overlay * {
  visibility: visible;
}
```

**2. Android** — `android/app/src/main/res/values/styles.xml`:
```xml
<item name="android:background">@android:color/transparent</item>
<item name="android:windowIsTranslucent">true</item>
```

---

## Comprobantes fiscales

| Tipo | Desglose IVA | Cliente requerido |
|------|-------------|-------------------|
| TICKET | No muestra | Consumidor Final (default) |
| NOTA_VENTA | No muestra | Consumidor Final (default) |
| FACTURA | Muestra base 0%, base 15%, IVA | Cliente con RUC/cédula |

**Cálculo IVA**: `precio_venta` YA incluye IVA. Para factura se extrae: `base15 = totalConIva / 1.15`.

---

## Manejo de errores en cobro

`ejecutarCobro()` captura errores de dos formas:

1. **`response.success === false`** → toast "No se pudo registrar la venta"
2. **Excepción (throw)** → muestra `error.message` directamente al usuario (ej: "No hay un turno de caja abierto")

La validación de turno activo vive en `PosService.procesarVenta()` (no en la página). Si falla, lanza `throw new Error(...)` que la página captura y muestra como toast rojo.

> **Importante**: todo error en `catch` se loguea con `LoggerService`, nunca con `console.error`.

---

## Protecciones implementadas

| Protección | Ubicación | Mecanismo |
|-----------|-----------|-----------|
| Anti-duplicado escáner cámara | `abrirEscanerCamara()` | Flag `procesandoEscaneo` + debounce 1.5s por código |
| Anti-duplicado pistola | `handleKeyboardEvent()` | Buffer 100ms + ignore si input enfocado |
| Stock insuficiente | `agregarAlCarrito()` | Valida `cantidad < stock_actual` antes de agregar |
| Sin conexión | `procesarCodigoRapido()`, `buscarPorCodigo()`, `buscarPorNombre()` | `NetworkService.isConnected()` antes de query |
| Error de red en escáner | `procesarCodigoRapido()` | try/catch con toast "Error de conexión" |
| Doble cobro | `ejecutarCobro()` | Loading overlay bloquea UI inmediatamente |
| Turno inactivo | `PosService.procesarVenta()` | Valida turno activo antes del RPC, lanza excepción |
| Factura sin cliente válido | `cobrar()` | Bloquea si `es_consumidor_final` |
| Fallo silencioso en cobro | `ejecutarCobro()` | Toast rojo si `response.success === false` o si hay excepción |
| Idempotencia de cobro | `ejecutarCobro()` + `fn_registrar_venta_pos` | UUID persistido en localStorage antes del RPC + `UNIQUE` constraint en BD |

---

## Idempotencia del cobro

Protege contra ventas duplicadas cuando la red falla después de que la BD ya procesó la venta (el cliente no recibe respuesta y reintenta).

### Flujo

1. `ejecutarCobro()` genera `crypto.randomUUID()` y lo guarda en `localStorage` **antes** de llamar al RPC
2. El UUID viaja como `p_idempotency_key` al RPC `registrar_venta_pos`
3. La función SQL verifica si ya existe una venta con esa key:
   - **Sí existe** → retorna la venta previa con `duplicado: true` (sin efectos secundarios)
   - **No existe** → INSERT normal. Si hay race condition (`unique_violation`), captura la excepción y retorna la venta existente
4. Si la respuesta llega OK → `localStorage.removeItem()` limpia la key
5. Si la app se cerró antes de limpiar → `ionViewWillEnter` llama a `recuperarVentaPendiente()`:
   - Consulta BD por la key pendiente
   - Si la venta existe → limpia carrito + key + toast de confirmación
   - Si no existe → limpia solo la key (el usuario puede reintentar)

### Columna en BD

```sql
ALTER TABLE ventas ADD COLUMN idempotency_key UUID UNIQUE;
```

Migración: `docs/pos/sql/migrations/001_add_idempotency_key.sql`

---

## Cleanup de recursos

| Recurso | Limpieza en `ionViewDidLeave` | Limpieza en `ngOnDestroy` |
|---------|------------------------------|--------------------------|
| Escáner cámara | `cerrarEscaner()` | `cerrarEscaner()` |
| Buffer pistola | `clearTimeout(barcodeTimeout)` | `clearTimeout(barcodeTimeout)` |
| Debounce búsqueda | `clearTimeout(searchDebounce)` | `clearTimeout(searchDebounce)` |
| Preview escáner | — | `clearTimeout(scanPreviewTimeout)` |
| AudioContext | — | `audioCtx.close()` |

> Ionic cachea páginas: `ionViewDidLeave` se ejecuta al navegar, `ngOnDestroy` solo al destruir.

---

## Dependencias clave

- `InventarioService` — queries de productos (por nombre, por código)
- `PosService` — RPC `registrar_venta_pos`
- `ClientesService` — consumidor final default + selector de cliente
- `NetworkService` — verificación de conectividad antes de queries
- `CurrencyService` — formateo de precios (nunca formatear manual)
- `LoggerService` — errores en producción (nunca console.log)
