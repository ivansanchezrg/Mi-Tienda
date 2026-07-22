# POS — Documentación del módulo

## Estructura de archivos

```
features/pos/
├── pages/pos/
│   ├── pos.page.ts        # Lógica principal (carrito, búsqueda, escáner, cobro)
│   ├── pos.page.html       # Template con modo catálogo + modo lista
│   └── pos.page.scss       # Estilos (carrito, escáner, search, footer)
├── components/
│   ├── cobrar-modal/       # Modal unificado de cobro (selección método + monto + vuelto)
│   ├── cantidad-modal/     # Modal para editar cantidad de un ítem (unidades o peso)
│   └── variante-selector-modal/  # Modal para elegir variante/presentación de un template
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
2. Productos se agregan al carrito local (signal en memoria)
3. Empleado presiona "Cobrar efectivo" u "Otros métodos" → abre `CobrarModalComponent` inmediatamente (sin query previa)
4. `CobrarModalComponent` (bottom-sheet-modal, patrón `bs-*`):
   - **Paso 1**: selección de método de pago (Efectivo, DeUna, Transferencia, Fiado)
   - **Paso 2** (solo Efectivo): ingreso de monto recibido + cálculo de vuelto en tiempo real
   - **Paso FIADO con Consumidor Final**: muestra `AlertController` explicativo con botón "Seleccionar cliente" que abre el modal de clientes apilado encima. Al seleccionar un cliente real, re-intenta confirmar FIADO automáticamente
   - **Paso confirmar-fiado** (FIADO con descuento activo): aviso de que el descuento no aplica + confirmación explícita
5. `PosService.procesarVenta()` llama a `fn_registrar_venta_pos` (RPC PostgreSQL)
6. La función SQL hace todo en una transacción atómica:
   - INSERT en `ventas`
   - INSERT en `ventas_detalles` (con snapshot de `precio_costo` al momento de la venta)
   - Trigger descuenta stock + graba kardex
   - Trigger actualiza saldo CAJA_CHICA si es EFECTIVO
7. Tras venta exitosa → `limpiarCarrito()` llama `refrescarCatalogo()` en background para actualizar el stock visible

---

## Vista catálogo vs vista lista

El POS tiene dos modos de visualización que el empleado alterna con un botón de tab en la toolbar.

### Vista catálogo

Grid de cards de productos. Es el modo principal de entrada de productos.

- Cards de producto simple muestran badge de cantidad en la esquina superior derecha cuando el producto ya está en el carrito. Tocar el badge abre `CantidadModalComponent` directamente. Mientras dura la consulta de stock fresco, el badge muestra un micro-spinner (flag `editandoItemKey`).
- Cards de template (producto con variantes) muestran un badge visual `catalogo-card-badge--template` — no es clickeable para editar cantidad.
- Al agregar un producto desde catálogo se dispara la animación "fly to pill": se clona visualmente el card y vuela hacia el pill flotante del carrito (mobile) o hacia el total del panel lateral `.panel-total-monto` (desktop). El destino se resuelve dinámicamente verificando cuál elemento es visible (`getBoundingClientRect().width > 0`).
- **Animaciones de carrito consistentes mobile ↔ desktop** (2026-07-21): las mismas animaciones se disparan en la vista lista mobile Y en el panel lateral desktop, por cualquier vía de agregado (pistola, código, click): línea nueva → `cartItemEnter` (mobile `.cart-item-enter`, desktop `.panel-item--enter`); incremento de cantidad → `qty-bump` en el badge/`.pis-val`; total → `total-amount--bump`. Los flags que las disparan (`lastAddedKey`, `lastIncrementedKey`, `totalAmountAnimando`) se setean sin guard de plataforma. El total se anima desde `animarTotal()` (único punto), llamado en `actualizarCantidad` y `agregarLineaNueva`.
- **Auto-scroll del panel desktop** al agregar (`dispararAnimacionPanel(key, esNuevo)`): línea nueva → scroll al fondo (`scrollTo scrollHeight`) para ver el último ítem completo; incremento de un ítem existente → `scrollIntoView(block:'nearest')` al ítem que cambió (no arrastra al fondo). El `scale` de la animación no afecta `scrollHeight` (es transform), así que basta un tick para el DOM.
- **Botón del escáner de cámara (`.scanner-corner-btn`) solo en catálogo** — en la vista lista/carrito no aplica (el escaneo es una acción del catálogo). El preview del escaneo (`.catalogo-scan-preview`) es **solo mobile** (en desktop el panel lateral ya muestra los ítems en vivo → redundante).
- La franja inferior de cada card muestra precio + stock disponible (`stockLibre = stock_actual - carritoUnidadesBaseMap[productoId]`). El stock libre se calcula en **unidades base** (cantidad × `factor_conversion`) — así 2 cajetillas de x10 comprometen 20 unidades, no 2. Etiqueta: `"sin stock"` (rojo) si `stockLibre <= 0`, `"¡último!"` (rojo) si `stockLibre === 1`, `"N und"` (naranja) si `≤ 10`, gris si más. **"sin stock" y "¡último!" son estados distintos a propósito** — el primero ya no se puede vender, el segundo sí (es la última unidad disponible).
- **Card agotada (`stock_actual = 0`)**: se atenúa visualmente (`.catalogo-card--agotado`, `opacity: 0.55` + `grayscale(0.4)` en la imagen) para que el cajero la descarte de un vistazo sin necesidad de leer el badge de texto. El tap sigue funcionando igual (dispara el toast "Producto sin stock" si se intenta agregar).
- La barra de búsqueda por texto solo existe en el modo catálogo. El filtro de categorías también es exclusivo de este modo.
- `carritoCountMap` (cantidades por línea) y `carritoUnidadesBaseMap` (unidades base comprometidas, para el stock libre) son `computed()` signals — se recalculan solo cuando el carrito cambia.
- `itemsCatalogo` es un `computed<CatalogoItem[]>()` — filtra y agrupa productos solo cuando cambia `productosCatalogo` o `buscarTexto`.
- Las imágenes usan fade-in (`img-fade` + `img-loaded`) — el contenedor gris actúa como placeholder hasta que carga.
- **Sin foto**: el nombre del producto se muestra centrado sobre uno de **5 tonos deterministas** (`colorPlaceholder(nombre)` en `pos.page.ts` — hash del nombre, clases `.ph-color-0` a `.ph-color-4`: neutro, azul acero, verde oliva, terracota, violáceo; todos verificados ≥4.5:1 de contraste WCAG AA contra el texto blanco), 15px, truncado a 3 líneas con ellipsis (`-webkit-line-clamp`). El hash usa el nombre (no el id) a propósito: el color acompaña la etiqueta que el cajero lee. Antes era un único gris fijo — con catálogos donde la mayoría de productos no tiene foto, todas las cards se veían idénticas y obligaban a leer en vez de reconocer.
- **Nombre del producto en la franja info** (cuando SÍ hay foto): 13px, 2 líneas con `line-clamp` (antes 11px, 1 línea truncada con `...`) — el nombre es la pista principal para distinguir variantes de talla/color, y es el dato que menos debe truncarse.
- **FAB "subir al inicio"**: aparece tras 600px de scroll en el catálogo (mobile only — oculto en desktop, donde `.pos-col-main` tiene su propio scroll interno). Se apila justo arriba del botón del escáner (misma esquina, alineado). Usa el controller compartido `crearScrollToTop()` — ver `docs/shared/SHARED-README.md` → "Patrón scroll-to-top".

**Columnas del grid (`.catalogo-grid`):** `auto-fill, minmax(110px, 1fr)` en mobile; 5 columnas fijas en tablet (600–991px); en desktop **4 columnas** (992–1439px) y **5 columnas** (≥1440px) — no `auto-fill`. Decisión deliberada: reducir de 6 a 4/5 prioriza legibilidad sobre densidad (estándar de POS profesionales como Square/Shopify POS) — con 6 columnas fijas el ancho de card variaba mucho entre laptop y monitor grande, y en laptops pequeños quedaba casi tan apretado como en mobile.

#### Favoritos (2026-07-16)

Tab fijo "Favoritos" (solo ícono ⭐, sin texto) junto a "Todos" en la barra de categorías —
filtra el catálogo a los productos marcados como favoritos, para acceso rápido a los más
vendidos. Favorito es un campo por **SKU** (`productos.favorito`), no por template.

- **Sentinel `FAVORITOS_ID = '__favoritos__'`** en `categoriaActivaId` — nunca es un UUID
  real y **nunca** baja al RPC `fn_catalogo_productos_pos` (su parámetro es `UUID`) ni al
  cache offline (`categoria_id` no calzaría). Cuando el tab activo es el sentinel, siempre
  se trae el catálogo completo y se filtra en memoria (`filtrarPorCategoria`), igual que el
  filtro por categoría — cero roundtrips extra.
- **Marcar/desmarcar favorito — productos simples: long-press en la card**: long-press
  (≥450ms) sobre la card del catálogo togglea el favorito con vibración de feedback. El
  gesto está restringido a productos simples: las cards de variantes (template) y los
  productos con presentaciones abren un modal al soltar, y mezclar "hold = favorito" con
  "hold = abre modal" resultaba confuso.
- **Marcar/desmarcar favorito — variantes/presentaciones: estrella en el modal** (2026-07-21):
  como su card abre el modal de selección, el favorito se marca con una **estrella en el
  header del modal** (`VarianteSelectorModalComponent`, `.vsm-fav-btn`, junto al título antes
  de la ✕). **All-or-nothing**: para variantes marca TODO el template (`toggleFavoritoTemplate`);
  para presentaciones marca ese producto único (`toggleFavorito`). El POS pasa `esFavorito`
  (derivado: `variantes.every(v => v.favorito)`) y un callback `onToggleFavorito` que persiste
  y actualiza el catálogo en memoria (`mutarFavoritoGrupoEnMemoria` — conserva imágenes firmadas
  de ambos niveles). Toggle optimista, sin toast. Así **todos** los tipos de producto pueden
  marcarse favorito desde el POS. También se puede desde Inventario (estrella en la lista) y
  desde el switch de crear/editar (ver `docs/inventario/INVENTARIO-README.md` → "Favorito").
- Diseño del gesto (robusto contra taps rápidos): todo se decide en `pointerup` según la
  duración del MISMO `pointerId` — no se usa el evento `(click)` sintético del navegador.
  Un único timer (el del favorito) se cancela en toda salida (`up`/`cancel`/nuevo `down`).
  No se escucha `pointermove` a propósito (dispararía change detection en cada píxel bajo
  `OnPush`); el scroll vertical se resuelve solo con `touch-action: pan-y` + `pointercancel`.
- Toggle optimista + revert si falla la persistencia (`ProductoService.toggleFavorito()`),
  sin loading ni toast — el ícono cambiando es el feedback (mismo criterio que ajustar stock).
- Indicador visual: estrella semi-transparente en la esquina superior izquierda de la card
  cuando `favorito = true` (`pointer-events: none`, no interfiere con el gesto).
- Badges de "abre selector" en la esquina inferior derecha (mismo lenguaje visual que
  Inventario): ícono `pricetag-outline` verde para presentaciones, `color-palette-outline`
  primary para variantes — así el cajero sabe de un vistazo que esa card no agrega directo.

### Vista lista (carrito)

Muestra los ítems ya agregados al carrito. No tiene barra de búsqueda.

- Cada ítem es completamente tappable (toda la fila): abre `CantidadModalComponent` directamente.
- Cada fila muestra: thumbnail cuadrado | nombre + precio unitario + stock inline | subtotal + badge `x2` (cantidad).
- El stock inline usa el mismo lenguaje de color que el catálogo: gris `· X disp.`, naranja `quedan X`, rojo `¡último!`.
- Al tocar un ítem, antes de abrir el modal se consulta el stock fresco de BD (`obtenerStockActual`). Durante esa consulta el ítem queda deshabilitado y el badge muestra un micro-spinner.
- Swipe-left en un ítem es el atajo rápido para eliminarlo.
- Los steppers `+/-` inline ya no existen en la vista lista — la edición de cantidad siempre va por `CantidadModalComponent`.

---

## Layout desktop (≥992px)

En pantallas grandes el POS usa un layout de dos columnas (`pos-layout` con `display: flex`):

| Columna | Clase | Contenido |
|---------|-------|-----------|
| Izquierda | `.pos-col-main` | Catálogo completo (siempre visible — `vistaActual` queda en `'catalogo'`) |
| Derecha | `.pos-panel` | Panel fijo de carrito + cliente + totales + botones de cobro |

**Elementos exclusivos de mobile ocultos en desktop** (con `display: none !important`):
- `.catalogo-cart-pill` — pill flotante "Ver carrito"
- `.volver-catalogo-btn` — botón de volver al catálogo
- `.pos-footer-mobile` — footer con totales y botones de cobro

**Panel lateral (`.pos-panel`):**
- Header con icono de carrito + contador de ítems
- Selector de cliente (mismo que la toolbar de mobile)
- Lista scrollable de ítems (`.panel-items`) con stepper `+/-` inline por ítem
- Footer fijo con desglose fiscal (FACTURA), descuento, upselling, total y botones de cobro
- Auto-scroll: al agregar o incrementar cualquier producto, `.panel-items` hace scroll suave (`scrollIntoView`) al ítem afectado usando el atributo `[data-item-key]`

**Animación fly-to-pill en desktop:** el clon vuela al `.panel-total-monto` (total visible en el panel derecho). En mobile vuela al `.catalogo-cart-pill`. La función `flyToPillFromClone()` elige el destino verificando cuál tiene dimensiones reales.

---

## Modos de entrada de productos

### 1. Búsqueda por nombre (solo modo catálogo)
- Debounce de 450ms
- Filtra el catálogo visible en tiempo real
- **Navegación por teclado** (desktop/pistola con teclado): `↓`/`↑` navegan la lista, `Enter` agrega el ítem resaltado (o el primero si ninguno está resaltado). En Android no tiene efecto (el teclado virtual no emite flechas)

### 2. Búsqueda por código
- Código simple (≥8 chars): busca automáticamente sin Enter
- Patrón bulk `cantidad.codigo` (ej: `10.7891234`): agrega N unidades de golpe
- Enter manual también dispara búsqueda (para pistolas lectoras)

### 3. Escáner de cámara (MLKit)
- Plugin: `@capacitor-mlkit/barcode-scanning`
- La cámara se renderiza en capa nativa debajo del WebView
- Toda la lógica de scanner (permisos, overlay, listeners, beep, vibración) vive en `BarcodeScannerService` (`core/services/`)
- El POS usa `barcodeScanner.startContinuous(onScan)` — queda abierto escaneando múltiples productos
- Anti-duplicados: `procesandoEscaneo` flag + debounce 1.5s por código (propio del POS, no del servicio)
- Feedback: `barcodeScanner.feedback()` → vibración (40ms) + beep (Web Audio API) + banner del producto escaneado
- **Banner del producto escaneado (modo cámara) — persistente y tocable** (2026-07-22): en modo cámara fullscreen el banner (`.scanner-preview`) **NO se auto-oculta** — queda estático mostrando el último producto y cada escaneo nuevo lo reemplaza (el `itemKey` del `scanPreview` se actualiza). Es **tocable**: al tocarlo, `corregirDesdeBanner()` cierra el escáner y abre directo el modal de cantidad de ese ítem (`editarCantidad`) — corrección en 1 tap si se escaneó de más, sin buscar el producto ni ir al carrito. `cerrarEscaner()` lo limpia. En **modo pistola sobre el catálogo** sigue siendo efímero (2.5s, ver §4): ahí el panel de ítems en vivo ya muestra el carrito. La distinción es `this.escaneando` (true = cámara fullscreen → persistente)

### 4. Pistola lectora USB/Bluetooth (HID)
- `@HostListener('document:keydown')` captura teclas rápidas (NO `keypress` — está deprecado y Chrome/Edge no lo disparan de forma confiable para todas las teclas)
- Buffer de 100ms distingue pistola (rápida) de tipeo humano (lento)
- Enter al final del buffer dispara búsqueda (`procesarCodigoRapido`)
- **Resolución del código: memoria primero, red como fallback** (2026-07-21) — `resolverCodigo(codigo)` busca el EAN en `catalogoCompleto` (RAM, ya cargado en el POS) vía `buscarCodigoEnMemoria` (lookup dual: producto + presentaciones anidadas, instantáneo). Solo si no está en memoria cae a `inventarioService.buscarPorCodigoBarras` (red online / SQLite offline). **Antes** cada escaneo online hacía un round-trip a Supabase → "atranque" perceptible antes de agregar el producto y disparar las animaciones. Ahora el 99% de los escaneos (productos del catálogo) se resuelven en 0ms. Mismo patrón en las 3 rutas: listener global + input código exacto + patrón `cantidad.codigo`. Aplica igual en web y APK (la RAM es más rápida que SQLite; SQLite es solo el fallback offline)
- **Ignora el escaneo si hay un overlay abierto** (`hayOverlayAbierto()` — chequeo síncrono del DOM por `:not(.overlay-hidden)`): con un modal de variantes/cantidad abierto la pistola no debe operar el catálogo por detrás (apilaba otro modal)
- **`preventDefault()` + `blur()` en el Enter**: las cards del catálogo son `<button>`; si una tiene el foco (p.ej. la que abrió un modal y lo recuperó al cerrarlo), el Enter de la pistola dispararía un click sintético en Android → reabría el modal. El blur neutraliza esa activación fantasma. `mostrarSelectorVariantes` también hace blur preventivo tras `onDidDismiss()`
- Ignora eventos si hay un input enfocado (el input maneja el escaneo por su cuenta vía `onSearchKeyup`)
- **Preview efímero en el catálogo** (Opción C): al escanear con pistola/código desde el catálogo, aparece una card flotante sobre el pill (`.catalogo-scan-preview`, 2.5s) con ✓ + nombre + precio unit + subtotal + cantidad. El flag `origenEscaneoFisico` distingue el agregado por escaneo (muestra preview) del agregado por click de mouse (no lo muestra — la card ya se anima). Sin beep de la app: la pistola beepea por hardware. Patrón validado contra Shopify/Loyverse (quedarse en la pantalla de escaneo + confirmación visual del ítem leído)

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

## Menú ⋮

El botón ⋮ del header abre un `OptionsMenuComponent` con una sola opción:

| Opción | Acción |
|--------|--------|
| Limpiar carrito | Pide confirmación (`AlertController`) y vacía el carrito + resetea cliente a default |

---

## Comprobantes fiscales

| Tipo | Desglose IVA | Cliente requerido |
|------|-------------|-------------------|
| TICKET | No muestra | Consumidor Final (default) |
| NOTA_VENTA | No muestra | Consumidor Final (default) |
| FACTURA | Muestra base 0%, base 15%, IVA desglosado | Cliente con RUC/cédula |

**Cálculo IVA**: `precio_venta` YA incluye IVA. Para factura se extrae: `base15 = totalConIva / _ivaDivisor`.

> **Tarifa dinámica**: el divisor se calcula desde `appConfig.pos_iva_porcentaje` (tabla `configuraciones`, clave `pos_iva_porcentaje`, default `15`). Si el SRI cambia la tasa, el admin la actualiza en Parámetros sin redeploy.

**Tipo de comprobante**: se configura por el administrador en Parámetros del Negocio (`pos_tipo_comprobante` en tabla `configuraciones`). El cajero no lo cambia desde el header — el header solo muestra el chip de descuento `-X%` si hay descuentos activos.

**Indicador visual en carrito**: cuando el comprobante es FACTURA, los productos con `tiene_iva = false` muestran un badge gris `IVA 0%` junto al precio unitario, para que el cajero detecte productos mal configurados antes de emitir.

---

## Manejo de errores en cobro

El resultado del cobro (éxito o fallo) se comunica con `FeedbackOverlayService` — no con un toast. El empleado ya "cerró mentalmente" la venta al confirmar el método de pago en el modal; un toast en la esquina se puede perder y el usuario sigue con el carrito lleno creyendo que ya cobró. Ver criterio completo en `CLAUDE.md` § "Feedback de acciones — toast vs overlay".

`ejecutarCobro()` → `mostrarExitoVenta()` privado centraliza el overlay de éxito (captura `this.totalPagar()` **antes** de `limpiarCarrito()`, que vacía el carrito):

| Caso | Overlay | Contenido |
|---|---|---|
| Venta OK, online | `success` | `destacado`: total cobrado. `subtitulo`: `"Comprobante #N"` |
| Venta OK, cayó la red durante el cobro (`response.encolada`) | `success` | `subtitulo`: `"Se sincronizará al volver la conexión"` |
| Venta OK, cobro offline directo | `success` | Igual que el caso anterior |
| `response.success === false` | `error` (sin auto-dismiss) | `"No se pudo registrar la venta"` |
| Excepción con `/stock insuficiente/i` en el mensaje | `warning` (sin auto-dismiss) | `"Stock insuficiente — el catálogo se actualizó con los valores reales"` + `refrescarCatalogo()` en paralelo |
| Excepción genérica | `error` (sin auto-dismiss) | `error.message` real |
| `error.message === 'SIN_TURNO'` | — | No usa el overlay: `mostrarAlertSinTurno()` (Alert con acción "Ir a Inicio") |

La validación de turno activo vive en `PosService.procesarVenta()` (no en la página). Si falla, lanza `throw new Error('SIN_TURNO')` que la página captura.

**Vaciar carrito manualmente** (menú ⋮ → Limpiar carrito): Alert de confirmación previo + overlay `success` `'Carrito vaciado'` con subtítulo del conteo descartado (`N artículos descartados`, capturado antes de vaciar). Descartar todo el carrito es una acción destructiva "de ley" — el overlay da un cierre visual inequívoco, más contundente que un toast (decidido 2026-07-20; antes era toast neutro). `limpiarCarrito(ventaRealizada)` usa ese flag para decidir: `true` (post-venta) omite el overlay porque el de éxito de venta ya es la señal; `false` (manual) muestra el overlay de vaciado.

> **Importante**: todo error en `catch` se loguea con `LoggerService`, nunca con `console.error`.

---

## Protecciones implementadas

| Protección | Ubicación | Mecanismo |
|-----------|-----------|-----------|
| Anti-duplicado escáner cámara | `abrirEscanerCamara()` | Flag `procesandoEscaneo` + debounce 1.5s por código |
| Anti-duplicado pistola | `handleKeyboardEvent()` (keydown) | Buffer 100ms + ignore si input enfocado / overlay abierto + `preventDefault`+`blur` en Enter |
| Stock insuficiente | `agregarAlCarrito()` | Valida `cantidad < stock_actual` antes de agregar |
| Stock bajo visual | `pos.page.html` carrito | Badge warning `"Quedan X"` si `stock_actual - cantidad <= stock_minimo`; badge danger `"¡Último!"` si `stock_actual <= cantidad` |
| Sin conexión (búsqueda) | `procesarCodigoRapido()`, `buscarPorCodigo()` | Busca contra el **catálogo cacheado** (`CatalogoLocalService`) en vez de abortar — el POS funciona offline |
| Doble cobro | `ejecutarCobro()` | Loading overlay bloquea UI inmediatamente (online) / flag `cobroEnProceso` |
| Turno inactivo | `PosService.resolverTurno()` | Online: consulta el servidor. Offline: lee `turno_activo_local`. Lanza `SIN_TURNO` si ninguno tiene turno |
| FIADO con Consumidor Final | `CobrarModalComponent.confirmarMetodo()` | Alert con opción de seleccionar cliente — el modal de clientes se apila encima sin cerrar el modal de cobro |
| Factura sin cliente válido | `abrirModalCobro()` | Bloquea con toast si `es_consumidor_final` antes de abrir el modal |
| Fallo silencioso en cobro | `ejecutarCobro()` | `FeedbackOverlayService.error()` si `response.success === false` o si hay excepción — ver "Manejo de errores en cobro" |
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
   - Si la venta existe → limpia carrito + key + **toast** `'Venta pendiente confirmada exitosamente'` (no overlay: es una recuperación silenciosa en segundo plano al re-entrar a la página, no el resultado de un cobro que el usuario acaba de confirmar activamente)
   - Si no existe → limpia solo la key (el usuario puede reintentar)

### Columna en BD

```sql
ALTER TABLE ventas ADD COLUMN idempotency_key UUID UNIQUE;
```

Migración: `docs/pos/sql/migrations/001_add_idempotency_key.sql`

---

## Cobro offline (modo offline POS)

`ejecutarCobro()` es **híbrido** según `NetworkService.isConnected()`:

- **Online** → `procesarVenta()` directo contra `fn_registrar_venta_pos`. Muestra el número de comprobante real.
- **Offline** → `cobrarOffline()` encola la venta en el outbox local (`OutboxService`) y responde al instante con
  overlay `success` (`subtitulo: "Se sincronizará al volver la conexión"`). El `SyncService` la sube al reconectar.
  La misma `idempotency_key` que ya existía hace el reenvío 100% seguro — el outbox es la generalización de "1
  venta pendiente en localStorage" a "cola de N en SQLite/IndexedDB".

**Restricciones offline:** FIADO y FACTURA no se pueden encolar (requieren el servidor — saldo de crédito /
secuencias SRI). El POS las bloquea con toast sin encolar. El catálogo, las búsquedas y el Consumidor Final se
sirven del cache local. Stock offline es optimista (se permite negativo al sincronizar — ver §5/§6 del plan).

**Fecha real de la venta (fix 2026-07-21):** el `VentaPayload` captura `fechaVenta = new Date().toISOString()`
en el instante del cobro (`ejecutarCobro`), viaja en el outbox y se pasa a `fn_registrar_venta_pos` como
`p_fecha` (v3.3). El INSERT usa `COALESCE(p_fecha, NOW())`. Sin esto, la venta encolada caía en `DEFAULT NOW()`
= momento de **sincronización**: una venta hecha a las 23:00 y sincronizada al día siguiente quedaba con la
fecha equivocada (descuadraba el resumen del día, el cierre del turno y el historial). Se manda UTC (instante
absoluto en `TIMESTAMPTZ`); las queries que agrupan por día lo derivan a `America/Guayaquil` correctamente.
En el camino online `p_fecha ≈ NOW()`, sin diferencia práctica. **Requiere re-ejecutar `fn_registrar_venta_pos`
v3.3 en Supabase.**

> Arquitectura completa: `docs/guides/PLAN-OFFLINE-POS-2026-06-08.md`. Servicios involucrados en
> `docs/core/CORE-README.md` → "Servicios del modo offline".

---

## Cleanup de recursos

| Recurso | Limpieza en `ionViewDidLeave` | Limpieza en `ngOnDestroy` |
|---------|------------------------------|--------------------------|
| Escáner cámara | `cerrarEscaner()` → `barcodeScanner.stop()` | `cerrarEscaner()` |
| Buffer pistola | `clearTimeout(barcodeTimeout)` | `clearTimeout(barcodeTimeout)` |
| Debounce búsqueda | `clearTimeout(searchDebounce)` | `clearTimeout(searchDebounce)` |
| Preview escáner | — | `clearTimeout(scanPreviewTimeout)` |
| AudioContext | — | Gestionado internamente por `BarcodeScannerService` (singleton) |

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
- Función SQL: `fn_registrar_venta_pos` v3.0 — `p_descuento` + `p_descuento_pct` + snapshot `precio_costo`, validación multi-tenant de turno/cliente/empleado/productos del JSONB de items, INSERT batch (sin N+1)

**Indicadores visuales:**
- **Header**: chip verde `-X%` junto al título "POS" (solo si descuentos habilitados)
- **Footer (upselling)**: mensaje `"$X más para -Y%"` cuando el subtotal está entre 70-100% del umbral — herramienta de upselling para el empleado
- **Footer (aplicado)**: fila verde `"Descuento (X%) -$Y"` cuando el subtotal supera el umbral
- **Cobrar modal**: subtotal tachado + descuento verde antes del total (excepto FIADO)
- El admin habilita/configura desde Parámetros del Negocio (`configuracion/parametros`)

**Pull-to-refresh**: el empleado puede refrescar la config de descuentos sin perder el carrito (ej: admin activa descuentos desde otro dispositivo)

---

## `CantidadModalComponent`

Modal bottom-sheet para editar la cantidad de un ítem del carrito (o asignarla al agregar desde catálogo).

### Header

Muestra un thumbnail cuadrado con `border-radius: var(--radius-md)`. Si `imagenUrl` tiene valor la muestra; si no, muestra un ícono sobre fondo gris:
- `scale-outline` para productos de tipo PESO
- `cube-outline` para productos de tipo UNIDAD

```typescript
@Input() imagenUrl?: string;  // signed URL ya resuelta — se pasa desde pos.page.ts
```

### Modo unidades

Número gigante en el centro tappable. Al tocarlo activa el modo de edición directa (input inline). Botón `-` circular rojo a la izquierda; botón `+` circular azul a la derecha.

- No hay input visible por defecto — se evita que el teclado virtual aparezca al abrir el sheet en mobile.
- `modoEdicionDirecta: boolean` controla si se muestra el número o el input inline.
- Al tocar `-` o `+` mientras el input está activo: vuelve automáticamente al número grande.
- `activarEdicionDirecta()` activa el modo input con `select()` + `focus()`.

### Modo peso

Input decimal visible desde el inicio, con focus automático al abrir el modal.

---

## `VarianteSelectorModalComponent`

Modal para elegir variante (producto con atributos) o presentación de un producto template.

### Stock en el modal

Cada fila muestra el stock libre disponible para esa variante/presentación en tiempo real:
- `stockLibre(variante, presentacion?)` — método público que considera todas las unidades comprometidas en el carrito (incluyendo factor de conversión de presentaciones)
- Color: gris `X disp.` si > 10, naranja `quedan X` si ≤ 10, rojo `sin stock` si agotado
- Se actualiza reactivamente al agregar/quitar unidades dentro del mismo modal (lee de `_contadores` signal)

### Control de stock

`sinStock(variante, presentacion?)` delega en `stockLibre()`:

- Si sin stock y contador = 0: muestra badge "Sin stock" en lugar del botón `+`. La fila completa tiene `vsm-row--sin-stock` (opacity 0.55).
- Si sin stock y contador > 0: el botón `+` del stepper queda deshabilitado.

### Loading al editar cantidad

Al tocar el número del stepper (`vsm-stepper-val`), el modal muestra un micro-spinner mientras consulta el stock fresco de BD antes de abrir `CantidadModalComponent`. Solo se bloquea la fila tocada — las demás siguen interactuables. Flag: `editandoKey` por ítem.

### Callbacks asíncronas

`onAgregar` y `onIncrementar` retornan `Promise<boolean>`. Si retornan `false` (stock insuficiente detectado por el carrito), el contador del modal no se actualiza y no se dispara la animación fly-to-pill.

**Animación unificada al sumar (2026-07-22):** agregar (tocar la fila / botón `+` en 0) e incrementar (botón `+` del stepper) disparan **el mismo feedback** — bump del footer + vuelo del thumbnail al botón. Centralizado en `animarAgregado(thumbClone, thumbRect)`; `incrementarItem` recibe el `$event` para capturar el thumbnail de su fila (igual que `agregar`), así el `+` del stepper vuela desde la misma fila. Antes solo agregar animaba; incrementar sumaba en silencio (inconsistente).

### Ventana anti click-fantasma al bajar a 0 (2026-07-22)

Bug: al tocar `−` con la cantidad en **1**, la fila baja a 0 → el stepper `[−] 1 [+]` se destruye y el botón `+` (`vsm-add-btn`) se monta en la **misma posición** donde estaba el `−`. Al soltar el dedo, el navegador sintetiza un `click` en ese punto que cae sobre el `+` recién montado (o la fila) → disparaba `agregar()` y su animación (fly-to-pill + bump del footer) sin que el usuario lo pidiera.

Fix: `decrementarItem` registra `supresionAgregarHasta = now + GHOST_MS` (350ms) cuando la cantidad llega a 0; `agregar()` descarta cualquier llamada dentro de esa ventana (`if (Date.now() < supresionAgregarHasta) return`). El guard está en `agregar()` — el punto común de todas las rutas de agregado (fila, botón `+`, unidad suelta, presentación) —, así que las cubre todas. El ghost click ocurre en <100ms; 350ms lo mata sin estorbar un re-tap humano real (que es más lento).

### Imágenes de presentaciones

Las imágenes de presentaciones (`producto_presentaciones.imagen_url`) se muestran condicionalmente:

```html
@if (p.imagen_url) {
  <img [src]="p.imagen_url" [alt]="p.nombre" class="vsm-row-img" loading="lazy">
} @else {
  <ion-icon name="cube-outline" class="vsm-row-img-placeholder"></ion-icon>
}
```

---

## Imágenes en el POS

`resolverImagen()` en `pos.page.ts` resuelve en paralelo:
- Imagen del SKU (producto individual)
- Imagen del template (producto padre con variantes)
- Imágenes de todas las presentaciones activas

**Fallback chain por ítem**: `presentacion.imagen_url → producto.imagen_url → producto_template.imagen_url`

**Agregar al carrito NO espera la imagen** (2026-07-21): `agregarLineaNueva` mete el ítem al carrito de inmediato con la imagen provisional **solo si ya es renderizable** (`esUrlRenderizable` — firmada/blob/data; un path crudo se deja `undefined` → placeholder, para no pedir `localhost/{path}` → 404). Si no hay imagen renderizable, `resolverImagenLinea(key, ...)` la firma **en background** y rellena esa línea por su clave cuando llega. **Antes** `agregarLineaNueva` hacía `await resolverImagen()` antes de agregar → el "Agregar" se sentía lento de forma intermitente (según si la signed URL estaba cacheada o había que firmarla por red). Ahora agregar es siempre instantáneo; la miniatura aparece un instante después.

Las URLs resueltas son signed URLs obtenidas via `StorageService`. `templateImagenUrl` en `CatalogoItem` se resuelve correctamente a signed URL antes de mostrarse en las cards del catálogo.

> **Cache de signed URLs:** `StorageService.resolveImageUrl()` cachea la URL firmada por su path crudo. Una
> imagen firmada una vez se reutiliza al filtrar, buscar o perder la red — no se re-firma. Offline no firma
> (devuelve null → placeholder) para no colgarse contra Storage. Ver `PLAN-OFFLINE-POS-2026-06-08.md` §4.5/§13.

> **Binarios completos para offline (2026-07-13):** cada carga online del catálogo
> (`cargarCatalogoDesdeServidor()` — carga inicial, `ionViewWillEnter` y pull-to-refresh) dispara
> `SyncService.precalentarImagenes(catalogo)`: descarga a disco los binarios de **todas** las imágenes del
> catálogo (SKU + templates + presentaciones), no solo las que llegan a renderizarse. Antes, un producto recién
> creado en Inventario quedaba en el cache SQLite del catálogo pero sin binario si su card no se pintó en
> pantalla — y en el próximo arranque offline aparecía sin foto. Best-effort, en tandas de 5, no-op offline/web,
> y casi gratis cuando no hay imágenes nuevas (compara contra el índice en disco y solo baja faltantes).

---

## Rendimiento de carga del catálogo

El catálogo aparece al instante mediante dos técnicas combinadas (un único método de pintado,
`publicarCatalogoConImagenesProgresivas()`, reutilizado por `cargarCatalogo`, el filtro de categoría y `refrescarCatalogo`):

1. **Pintado en dos pasos (imágenes progresivas):** se pinta la cuadrícula **de inmediato** reutilizando las
   imágenes ya resueltas del catálogo actual (0 llamadas a Storage), y las URLs nuevas se firman en background
   sin bloquear el render. Evita el N+1 de firmar N imágenes antes de mostrar nada.
2. **Stale-while-revalidate (arranque):** `cargarCatalogo()` pinta primero desde el **cache local**
   (`pintarDesdeCacheSiExiste()`) sin spinner, y refresca contra el servidor en segundo plano. Si ya se entró al
   POS antes, la cuadrícula aparece instantánea. Sin cache, muestra el skeleton normal.

> El filtro de categoría no muestra skeleton cuando el resultado es instantáneo (cache RAM offline). Las
> categorías ya cargadas se pasan a `obtenerProductosCatalogoPOS(categoriaId, categorias)` para evitar una
> query extra al refrescar el cache.

---

## Signals y performance

`pos.page.ts` usa signals de Angular para minimizar recálculos:

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `buscarTexto` | `signal('')` | Texto de búsqueda del catálogo |
| `productosCatalogo` | `signal<ProductoPOS[]>([])` | Catálogo completo cargado desde BD |
| `itemsCatalogo` | `computed<CatalogoItem[]>()` | Filtra y agrupa solo cuando cambia catálogo o búsqueda |
| `carritoCountMap` | `computed()` | Mapa `productoId → cantidad` para badges de simples |
| `carritoUnidadesBaseMap` | `computed()` | Mapa `productoId → unidades base` (cantidad × factor_conversion) para el stock libre real de badges/franjas |
| `templateCountMap` | `computed()` | Mapa `templateId → cantidad total` para badges de templates |
| `_brutosDesglose` | `computed()` | Único reduce para calcular IVA 0% e IVA 15% simultáneamente |

---

## Dependencias clave

- `InventarioService` — queries de productos:
  - `obtenerProductosCatalogoPOS(categoriaId?)` → RPC `fn_catalogo_productos_pos` (v1.2 — catálogo completo del grid, sin paginar; filtro de categoría que incluye variantes vía `COALESCE(template.categoria_id, producto.categoria_id)`; incluye `favorito` en el JSON). La búsqueda por texto (`fn_buscar_productos_pos`) se eliminó 2026-07-11 — el POS filtra el grid client-side desde entonces.
  - `buscarPorCodigoBarras(codigo)` → query directa (lookup dual producto + presentación, incluye `favorito`)
- `PosService` — RPC `fn_registrar_venta_pos`
- `BarcodeScannerService` — escáner de cámara centralizado (permisos, overlay, beep, vibración, formatos QR + lineales)
- `CobrarModalComponent` — modal unificado de cobro (reemplaza OptionsModal + VueltoModal)
- `CantidadModalComponent` — modal para editar cantidad de un ítem (unidades o peso)
- `VarianteSelectorModalComponent` — modal para elegir variante o presentación de un template
- `ClientesService` — consumidor final default + selector de cliente
- `ConfigService` — configuración de descuentos automáticos y tarifa IVA (`pos_iva_porcentaje`) — cache en memoria
- `NetworkService` — verificación de conectividad antes de queries
- `CurrencyService` — formateo de precios (nunca formatear manual)
- `LoggerService` — errores en producción (nunca console.log)

---

## Sincronización de stock

El stock se mantiene actualizado en tres momentos automáticos:

| Momento | Mecanismo |
|---|---|
| Al volver al POS (`ionViewWillEnter`) | `refrescarCatalogo()` — actualiza `productosCatalogo` signal y sincroniza `stock_disponible` del carrito |
| Tras venta exitosa | `limpiarCarrito()` llama `refrescarCatalogo()` en background |
| Al abrir `CantidadModal` de un ítem | `obtenerStockActual(id)` — consulta BD puntual, actualiza el ítem del carrito antes de abrir el modal |
| Pull-to-refresh manual | `refrescarConfig()` + `refrescarCatalogo()` en paralelo |
| Error de stock en BD al cobrar | Toast informativo + `refrescarCatalogo()` automático |

`refrescarCatalogo()` opera en dos pasos: primero publica el stock fresco reutilizando imágenes ya cacheadas (evita parpadeo), luego resuelve URLs nuevas en background. El carrito nunca se pierde durante el refresh.

> El stock del carrito (`stock_disponible`) es un campo sincronizado — no un snapshot congelado. `sincronizarStockCarrito()` lo actualiza con cada refresh comparando contra el catálogo fresco.

