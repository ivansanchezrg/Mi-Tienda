# POS — Documentación del módulo

## Estructura de archivos

```
features/pos/
├── pages/pos/
│   ├── pos.page.ts        # Lógica principal (carrito, búsqueda, escáner, cobro)
│   ├── pos.page.html       # Template con modo normal + modo escáner
│   └── pos.page.scss       # Estilos (carrito, escáner, search, footer)
├── components/
│   └── cobrar-modal/       # Modal unificado de cobro (selección método + monto + vuelto)
├── services/
│   └── pos.service.ts      # Procesa venta via RPC (transacción atómica)
├── models/
│   ├── cart-item.model.ts   # CartItem extends ProductoPOS + cantidad + subtotal
│   └── tipo-comprobante.enum.ts  # TICKET | NOTA_VENTA | FACTURA
└── pos.routes.ts            # Lazy-load de PosPage
```

---

## Flujo de venta

1. Empleado busca productos (por nombre o código) o escanea con cámara/pistola
2. Productos se agregan al carrito local (array en memoria)
3. Empleado presiona "Cobrar":
   - Si el cliente es **Consumidor Final** → se abre el selector de cliente **antes** del modal de cobro. Si cancela sin elegir, el flujo se corta
   - Una vez con cliente real seleccionado → abre `CobrarModalComponent`
4. `CobrarModalComponent` (flujo unificado en 2 pasos internos):
   - **Paso 1**: selección de método de pago (Efectivo, DeUna, Transferencia, Fiado)
   - **Paso 2** (solo Efectivo): ingreso de monto recibido + cálculo de vuelto en tiempo real
5. `PosService.procesarVenta()` llama a `fn_registrar_venta_pos` (RPC PostgreSQL)
6. La función SQL hace todo en una transacción atómica:
   - INSERT en `ventas`
   - INSERT en `ventas_detalles` (con snapshot de `precio_costo` al momento de la venta)
   - Trigger descuenta stock + graba kardex
   - Trigger actualiza saldo CAJA_CHICA si es EFECTIVO

---

## Modos de entrada de productos

### 1. Búsqueda por nombre
- Debounce de 450ms
- Muestra lista de sugerencias (slot="fixed", no scrollea con el carrito)
- Click en sugerencia agrega al carrito
- **Navegación por teclado** (desktop/pistola con teclado): `↓`/`↑` navegan la lista, `Enter` agrega el ítem resaltado (o el primero si ninguno está resaltado). En Android no tiene efecto (el teclado virtual no emite flechas)

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

## Menú ⋮ (opciones de comprobante)

El botón ⋮ del header abre un `OptionsMenuComponent` con las siguientes opciones:

| Opción | Acción |
|--------|--------|
| Ticket | Cambia tipo de comprobante a TICKET |
| Nota de Venta | Cambia tipo de comprobante a NOTA_VENTA |
| Factura | Cambia tipo de comprobante a FACTURA |
| *(separador)* | `<hr>` visual — no clickeable |
| Limpiar carrito | Pide confirmación (`AlertController`) y vacía el carrito + resetea cliente y comprobante a defaults |

El handler unificado `onComprobanteOption()` distingue la acción por `option.value`:
- `__LIMPIAR__` → llama `confirmarLimpiarCarrito()`
- Cualquier `TipoComprobante` → actualiza `tipoComprobante` y el checkmark activo en el menú

---

## Comprobantes fiscales

| Tipo | Desglose IVA | Cliente requerido |
|------|-------------|-------------------|
| TICKET | No muestra | Consumidor Final (default) |
| NOTA_VENTA | No muestra | Consumidor Final (default) |
| FACTURA | Muestra base 0%, base 15%, IVA desglosado | Cliente con RUC/cédula |

**Cálculo IVA**: `precio_venta` YA incluye IVA. Para factura se extrae: `base15 = totalConIva / _ivaDivisor`.

> **Tarifa dinámica**: el divisor se calcula desde `appConfig.pos_iva_porcentaje` (tabla `configuraciones`, clave `pos_iva_porcentaje`, default `15`). Si el SRI cambia la tasa, el admin la actualiza en Parámetros sin redeploy.

**Indicador visual en carrito**: cuando el comprobante es FACTURA, los productos con `tiene_iva = false` muestran un badge gris `IVA 0%` junto al precio unitario, para que el cajero detecte productos mal configurados antes de emitir.

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
| Stock bajo visual | `pos.page.html` carrito | Badge warning `"Quedan X"` si `stock_actual - cantidad <= stock_minimo`; badge danger `"¡Último!"` si `stock_actual <= cantidad` |
| Sin conexión | `procesarCodigoRapido()`, `buscarPorCodigo()`, `buscarPorNombre()` | `NetworkService.isConnected()` antes de query |
| Error de red en escáner | `procesarCodigoRapido()` | try/catch con toast "Error de conexión" |
| Doble cobro | `ejecutarCobro()` | Loading overlay bloquea UI inmediatamente |
| Turno inactivo | `PosService.procesarVenta()` | Valida turno activo antes del RPC, lanza excepción |
| Cliente requerido para FIADO/DEUNA/TRANSFERENCIA | `cobrar()` | Si es Consumidor Final, abre selector de cliente antes del modal. Si cancela, corta el flujo |
| Factura sin cliente válido | `cobrar()` **y** `cobrarEfectivo()` | Bloquea si `es_consumidor_final` en ambas rutas de cobro |
| Fallo silencioso en cobro | `ejecutarCobro()` | Toast rojo si `response.success === false` o si hay excepción |
| Idempotencia de cobro | `ejecutarCobro()` + `fn_registrar_venta_pos` | UUID persistido en localStorage antes del RPC + `UNIQUE` constraint en BD |

---

## Idempotencia del cobro

Protege contra ventas duplicadas cuando la red falla después de que la BD ya procesó la venta (el cliente no recibe respuesta y reintenta).

### Flujo

1. `ejecutarCobro()` genera `crypto.randomUUID()` y lo guarda en `localStorage` **antes** de llamar al RPC
2. El UUID viaja como `p_idempotency_key` al RPC `fn_registrar_venta_pos`
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

## Descuentos automáticos

El POS aplica descuentos automáticos sobre el subtotal bruto si se cumplen las condiciones configuradas en `configuraciones`:

| Clave | Descripción | Default |
|---|---|---|
| `pos_descuentos_habilitados` | Activa/desactiva descuentos | `false` |
| `pos_descuento_maximo_pct` | Porcentaje de descuento | `10` |
| `pos_umbral_monto_descuento` | Monto mínimo para aplicar | `50.00` |

**Lógica:**
- Se calcula en `pos.page.ts` (getter `descuentoAplicado`)
- Si `subtotalBruto >= umbral` y descuentos habilitados → `descuento = subtotal * (pct / 100)`
- **FIADO no lleva descuento** — son beneficios mutuamente excluyentes. Al elegir FIADO en el cobrar-modal, se muestra paso de confirmación con total sin descuento + aviso "El descuento no aplica para ventas fiadas"
- Se persiste en BD: `ventas.descuento` (monto) + `ventas.descuento_pct` (porcentaje) para trazabilidad histórica independiente de configuración futura
- Función SQL: `fn_registrar_venta_pos` v1.7 (parámetros `p_descuento` + `p_descuento_pct` + snapshot `precio_costo`)

**Indicadores visuales:**
- **Header**: chip verde `-X%` junto al chip de comprobante (solo si descuentos habilitados)
- **Footer (upselling)**: mensaje `"$X más para -Y%"` cuando el subtotal está entre 70-100% del umbral — herramienta de upselling para el empleado
- **Footer (aplicado)**: fila verde `"Descuento (X%) -$Y"` cuando el subtotal supera el umbral
- **Cobrar modal**: subtotal tachado + descuento verde antes del total (excepto FIADO)
- El admin habilita/configura desde Parámetros del Negocio (`configuracion/parametros`)

**Pull-to-refresh**: el empleado puede refrescar la config de descuentos sin perder el carrito (ej: admin activa descuentos desde otro dispositivo)

---

## Dependencias clave

- `InventarioService` — queries de productos (por nombre, por código). `ProductoPOS` incluye `stock_minimo` para badges visuales en carrito
- `PosService` — RPC `fn_registrar_venta_pos`
- `CobrarModalComponent` — modal unificado de cobro (reemplaza OptionsModal + VueltoModal)
- `ClientesService` — consumidor final default + selector de cliente
- `ConfigService` — configuración de descuentos automáticos y tarifa IVA (`pos_iva_porcentaje`) — cache en memoria
- `NetworkService` — verificación de conectividad antes de queries
- `CurrencyService` — formateo de precios (nunca formatear manual)
- `LoggerService` — errores en producción (nunca console.log)

---

## Notas de stock en carrito

El stock del carrito es una "foto" del momento en que se agregó el producto. Si otro usuario ajusta el stock desde otro dispositivo mientras hay una venta en curso, el carrito no se actualiza automáticamente. **Protocolo interno**: si el empleado detecta discrepancia, debe eliminar el producto del carrito y volver a buscarlo para refrescar el stock.
