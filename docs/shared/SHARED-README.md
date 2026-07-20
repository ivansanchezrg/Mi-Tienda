# Shared — Componentes y Directivas Reutilizables

Ubicación: `src/app/shared/`

Todo lo que está aquí es **standalone** — se importa directamente en el componente que lo necesite, sin módulos intermedios.

---

## Utils

### `crearScrollToTop()` — Patrón scroll-to-top

**Archivo:** `utils/scroll-to-top.util.ts`

Controller reutilizable por **composición** (no herencia) de "subir al inicio" para páginas con listas/grids largos dentro de un `ion-content`. Encapsula `showScrollTop`, `onContentScroll()`, `scrollToTop()` y `reset()`.

**Por qué composición y no una clase base única:** algunas páginas ya extienden `PaginatedListPage<T>` (herencia de paginación), pero otras no pueden — `PosPage` implementa 4 interfaces de ciclo de vida y su catálogo no está paginado (carga completo y filtra en memoria para funcionar offline). TypeScript no permite heredar de 2 clases. `crearScrollToTop()` se usa por composición en ambos casos: `PaginatedListPage` lo usa internamente, y `PosPage`, `HistorialTurnosPage`, `OperacionesCajaPage` lo instancian directo.

```typescript
@ViewChild(IonContent) content!: IonContent;   // o { read: ElementRef } — ambos son compatibles
readonly scrollTop = crearScrollToTop(() => this.content);
```

```html
<ion-content [scrollEvents]="true" (ionScroll)="scrollTop.onContentScroll($event)">
  ...
  @if (scrollTop.showScrollTop) {
  <ion-fab vertical="bottom" horizontal="end" slot="fixed" class="scroll-top-fab">
    <ion-fab-button size="small" color="primary" (pointerdown)="scrollTop.scrollToTop()">
      <ion-icon name="arrow-up-outline"></ion-icon>
    </ion-fab-button>
  </ion-fab>
  }
</ion-content>
```

**`(pointerdown)` y no `(click)` — obligatorio:** con la lista aún deslizándose por inercia (momentum scroll), el WebView consume el primer toque solo para detener el scroll y no dispara `click` — el usuario tenía que tocar el FAB 2 veces. `pointerdown` llega antes de ese ciclo, así el primer toque ya frena el scroll y navega. Bug real, corregido 2026-07-12.

**`reset()`** oculta el FAB sin animar — usarlo cuando la página cambia de sub-vista o categoría y el nuevo contenido arranca desde arriba (ej. `PosPage` al cambiar de categoría del catálogo o salir a la vista lista).

**Parámetros opcionales** de `crearScrollToTop(obtenerContent, umbralPx = 600, duracionMs = 400)` — umbral de scroll para mostrar el FAB y duración de la animación.

> Posicionamiento CSS de `.scroll-top-fab` (bottom/right, safe area, apilado sobre otros FABs como el escáner del POS) es específico de cada página — no hay una clase compartida, cada `*.page.scss` lo define según su layout. Ver ejemplo real en `pos.page.scss`.

#### `crearScrollToTopElemento()` — variante para modales bottom-sheet

Mismo archivo, mismo `ScrollToTopController` público. Los modales `bs-*` (`bottom-sheet-modal`) usan `div.bs-content` con `overflow-y: auto`, no `ion-content` (ver sección "Modales" más abajo — `ion-content` colapsa con `--height: auto`). `div.bs-content` no expone `scrollToTop(ms)` ni emite `(ionScroll)`, así que necesita su propia función:

```typescript
@ViewChild('bsContent') private bsContentRef!: ElementRef<HTMLElement>;
readonly scrollTop = crearScrollToTopElemento(() => this.bsContentRef?.nativeElement);
```

```html
<div class="bs-content" #bsContent (scroll)="scrollTop.onContentScroll($event)">
  <div class="bs-body">...</div>
</div>

@if (scrollTop.showScrollTop) {
<button class="bs-scroll-top-fab" (pointerdown)="scrollTop.scrollToTop()" aria-label="Subir al inicio">
  <ion-icon name="arrow-up-outline"></ion-icon>
</button>
}
```

El botón va **hermano** de `.bs-content` (no hijo), dentro de `.bs-root`, para poder posicionarlo `position: absolute` sobre el bottom sheet completo sin que el propio scroll del contenido lo arrastre. `.bs-root` no trae `position: relative` por defecto — agregarlo en el SCSS local del modal (no en `theme/custom/modals.scss`, afectaría a todos los modales `bs-*`). Umbral por defecto más bajo que el de listas: `300px` (vs `600px`) — el contenido de un modal es acotado, no un listado de cientos de ítems. Ejemplo real: `cierre-turno-detalle-modal.component.*`.

---

## Componentes

### `app-options-menu` — Menú ⋮ (Popover)

**Archivo:** `components/options-menu/`

Botón de tres puntos que despliega un popover con lista de opciones genéricas. Soporta íconos, checkmark de selección activa y colores personalizados.

#### API

| Propiedad | Tipo | Default | Descripción |
|---|---|---|---|
| `[options]` | `MenuOption[]` | `[]` | Lista de opciones a mostrar |
| `[triggerId]` | `string` | `'options-menu-trigger'` | ID único del botón (necesario si hay varios en la misma página) |
| `[triggerColor]` | `string` | `'medium'` | Color Ionic del botón ⋮ |
| `(optionSelected)` | `MenuOption` | — | Emite la opción seleccionada |

#### Interfaz `MenuOption`

```typescript
export interface MenuOption {
  label: string;       // Texto visible
  icon: string;        // Nombre de ionicon (ej: 'trash-outline')
  value: any;          // Valor que se emite al seleccionar
  active?: boolean;    // Muestra ✓ a la derecha
  color?: string;      // Color Ionic: 'danger', 'primary', etc.
  separator?: boolean; // Inserta una línea divisora antes de esta opción
}
```

> **Estilos globales del popover:** `IonPopover` escapa el shadow DOM — su ancho y apariencia se controlan en `src/theme/custom/popovers.scss`, no en el SCSS del componente.

#### Ejemplo de uso

```typescript
// 1. Importar en el componente
import { OptionsMenuComponent, MenuOption } from '@shared/components/options-menu/...';

// 2. Definir opciones
myOptions: MenuOption[] = [
  { label: 'Editar',   icon: 'pencil-outline', value: 'edit',   active: false },
  { label: 'Eliminar', icon: 'trash-outline',  value: 'delete', color: 'danger' },
];

// 3. Manejar selección
onMenuOption(opt: MenuOption) {
  console.log(opt.value); // 'edit' | 'delete'
}
```

```html
<!-- 4. Usar en el template -->
<app-options-menu
  triggerId="mi-menu"
  [options]="myOptions"
  (optionSelected)="onMenuOption($event)">
</app-options-menu>
```

> **Caso real en el POS:** El `tipoComprobante` (Ticket / Nota de Venta / Factura) se selecciona desde este menú en el header de la página POS. Ver `pos.page.ts` → `comprobanteOptions` y `onComprobanteOption()`.
>
> **Caso real en Inventario:** menú por producto en el grid (Ajustar stock / Ver kárdex / Editar / Desactivar). Ver `inventario.page.ts` → `menuOpcionesProducto()`.
>
> **Caso real en Notas (2026-07-16):** reemplazó el swipe-to-delete (`ion-item-sliding`) del listado — cada nota tiene Editar (todos) y Eliminar (solo ADMIN, condicional con `if (this.esAdmin)`). Ver `notas-list.page.ts` → `menuOpciones()`/`onMenuOpcion()`. `<ion-popover>` va inline en el HTML, no `PopoverController.create()` — por eso no cae en la prohibición de popovers/action sheets en Android que sí aplica a los *Controllers* instanciados dinámicamente (ver sección "No hacer" de `CLAUDE.md`).

---

### `app-feedback-overlay` — Overlay de confirmación centrado

**Archivo:** `components/feedback-overlay/`

Overlay `fixed` a todo el viewport (blur de fondo, `z-index: 30000` — por encima de cualquier overlay de Ionic, incluido un modal abierto), con un ícono trazado animado (check/X/!/i según el tipo) + título + dato destacado opcional + subtítulo opcional. Se monta **una única vez** en `AppComponent` (mismo patrón que `app-offline-banner`/`app-suscripcion-banner`) — las páginas nunca lo declaran, solo inyectan `FeedbackOverlayService` y llaman sus métodos.

No reemplaza a `UiService.showToast()`/`showSuccess()`/`showError()`: sigue siendo el default para la mayoría de los mensajes. Este overlay es solo para momentos "de ley" — ver criterio completo de cuándo usar cada uno en `CLAUDE.md` § "Feedback de acciones — toast vs overlay".

#### API — `FeedbackOverlayService` (`core/services/feedback-overlay.service.ts`)

```typescript
private feedback = inject(FeedbackOverlayService);

this.feedback.success({ titulo: '¡Venta registrada!', destacado: '$45.00', subtitulo: 'Comprobante #142' });
this.feedback.error({ titulo: 'No se pudo registrar la venta', subtitulo: 'Intenta de nuevo' });
this.feedback.warning({ titulo: 'Stock insuficiente' });
this.feedback.info({ titulo: 'Catálogo actualizado' });
```

| Campo (`FeedbackOverlayData`) | Tipo | Descripción |
|---|---|---|
| `tipo` | `'success' \| 'error' \| 'warning' \| 'info'` | Asignado automáticamente por el método usado |
| `titulo` | `string` | Obligatorio — lo primero que lee el usuario |
| `destacado` | `string?` | Dato grande (monto, cantidad, código) |
| `subtitulo` | `string?` | Línea secundaria (comprobante, aclaración, motivo del error) |
| `icono` | `string?` | Nombre de ionicon en vez del ícono trazado default del tipo |
| `duracionMs` | `number?` | Auto-cierre. Si se omite, usa el default por tipo (ver abajo) |

| Tipo | Auto-dismiss default | Por qué |
|---|---|---|
| `success` / `info` | 3000ms | Notifica un estado que ya ocurrió, no requiere acción — el usuario solo necesita percibirlo |
| `warning` / `error` | Sin auto-dismiss (requiere tap en "Entendido" o tocar fuera) | Casi siempre requieren LEER la causa o decidir algo; auto-ocultarlos arriesga que el usuario pierda el motivo del problema |

`FeedbackOverlayService.cerrar()` lo oculta manualmente (p. ej. al navegar fuera de la página que lo disparó, si aplica).

#### Ejemplos reales en el proyecto

- **POS** (`pos.page.ts`): venta registrada (`success`, con el total en `destacado`), venta fallida online/offline (`error`), stock insuficiente detectado en servidor al cobrar (`warning`).
- **Caja** (`operaciones-caja.service.ts`): registrar ingreso/egreso — `success` con el monto en `destacado`, `error` con el mensaje real (distingue sin-conexión vía `SupabaseService.esErrorDeTransporte()` del error de negocio).
- **Inventario** (`producto-crear.page.ts`, `producto-editar.page.ts`, `template-editar.page.ts`): crear/editar producto o plantilla — `success` justo **antes** de `navigateBack()` (un toast ahí competiría con la transición de página y se perdería).
- **Notas** (`notas-list.page.ts`): `error` si falla eliminar o editar una nota (en éxito no hay aviso — el cambio ya se ve en la lista).

---

### `app-empty-state` — Estado vacío de listas

**Archivo:** `components/empty-state/`

Placeholder estándar para cuando una lista no tiene ítems. Centraliza el diseño (ícono + título + hint) en un solo lugar.

#### API

| Propiedad | Tipo | Requerido | Descripción |
|---|---|---|---|
| `[icon]` | `string` | ✅ | Nombre del icono Ionicons |
| `[title]` | `string` | — | Título principal |
| `[hint]` | `string` | — | Texto descriptivo secundario |

#### Ejemplo de uso

```html
<app-empty-state
  icon="cart-outline"
  title="Sin ventas"
  hint="Las ventas del día aparecerán aquí.">
</app-empty-state>

<!-- Con valores dinámicos -->
<app-empty-state
  icon="person-outline"
  [title]="busqueda ? 'Sin resultados' : 'No hay clientes'"
  [hint]="busqueda ? 'Intenta con otro término.' : 'Agrega el primero con el botón +'">
</app-empty-state>

<!-- Dentro de modal o contenedor pequeño -->
<app-empty-state icon="document-text-outline" hint="Sin movimientos" style="min-height: auto">
</app-empty-state>
```

> **Regla:** No agregar `.empty-state` en el SCSS de la página — los estilos están encapsulados en el componente.

---

### `app-under-construction` — Módulo en construcción

**Archivo:** `components/under-construction/`

Tarjeta visual para páginas que aún no están implementadas. Muestra título, descripción y lista de features próximas.

#### API

| Propiedad | Tipo | Default | Descripción |
|---|---|---|---|
| `[title]` | `string` | `'Módulo'` | Nombre del módulo |
| `[description]` | `string` | `'...'` | Texto descriptivo |
| `[features]` | `Feature[]` | `[]` | Lista de features próximas |

#### Ejemplo de uso

```typescript
import { UnderConstructionComponent } from '@shared/components/under-construction/...';

features = [
  { label: 'Reportes por fecha' },
  { label: 'Exportar a PDF' },
];
```

```html
<app-under-construction
  title="Reportes"
  description="Próximamente podrás ver tus reportes aquí."
  [features]="features">
</app-under-construction>
```

---

### `app-options-modal` — Selector/Action sheet personalizado

**Archivo:** `components/options-modal/`

Reemplaza `ion-select`, `ActionSheetController` y `PopoverController` (todos con bugs en Android + Ionic 8 standalone). Se abre como bottom sheet con swipe-to-dismiss.

Soporta dos modos según los `@Input()` que reciba:
- **Modo acción** — opciones con iconos, sin selección previa (reemplaza `ActionSheet`)
- **Modo selección** — sin iconos, con checkmark en la opción activa (reemplaza `ion-select`)

#### API

| `@Input()` | Tipo | Descripción |
|---|---|---|
| `title` | `string` | Título del modal |
| `subtitle` | `string?` | Subtítulo opcional |
| `groups` | `ModalOptionGroup[]` | Grupos de opciones |
| `selectedValue` | `string?` | Activa modo selección con checkmark |

```typescript
export interface ModalOptionGroup {
  title?: string;       // Encabezado del grupo (opcional)
  options: ModalOption[];
}

export interface ModalOption {
  label: string;        // Texto visible
  value: string;        // Valor retornado al seleccionar
  icon?: string;        // Icono (modo acción)
  subtitle?: string;    // Texto secundario debajo del label
  color?: string;       // 'danger' para opciones destructivas
}
```

#### Ejemplo modo acción

```typescript
const groups: ModalOptionGroup[] = [{
  options: [
    { label: 'Efectivo', icon: 'cash-outline', value: 'EFECTIVO' },
    { label: 'Transferencia', icon: 'phone-portrait-outline', value: 'TRANSFERENCIA' },
    { label: 'Eliminar', icon: 'trash-outline', value: 'delete', color: 'danger' },
  ]
}];

const modal = await this.modalCtrl.create({
  component: OptionsModalComponent,
  componentProps: { title: 'Método de pago', groups },
  cssClass: 'options-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
await modal.present();
const { data } = await modal.onDidDismiss();
if (data) { /* data = valor seleccionado */ }
```

#### Ejemplo modo selección

```typescript
const groups: ModalOptionGroup[] = [
  { options: [{ label: 'Todas', value: 'todas' }] },
  { title: 'Categorías', options: categorias.map(c => ({ label: c.nombre, value: c.id })) }
];

const modal = await this.modalCtrl.create({
  component: OptionsModalComponent,
  componentProps: { title: 'Filtrar por', groups, selectedValue: this.filtroActual },
  cssClass: 'options-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
```

> **Excepción:** `<select>` nativo de HTML sigue siendo válido dentro de formularios con `formControlName` donde no justifica abrir un modal.

---

### `app-image-cropper-modal` — Recortador de imágenes

**Archivo:** `components/image-cropper-modal/`

Modal fullscreen para recortar imágenes con `ngx-image-cropper` v9. Permite al usuario ajustar el encuadre antes de subir la foto a Storage. Diseñado para catálogo de productos donde la calidad y el encuadre importan.

**No se invoca directamente** — el flujo correcto pasa por `StorageService.elegirFuenteFoto()` o `StorageService.recortarImagen()` que abren el cropper internamente. Esto garantiza el manejo consistente de blob URLs, status bar y memoria entre todos los módulos.

#### Características

- **Output blob** — el recorte se emite como `Blob` (no base64), evitando strings gigantes en memoria. Una imagen 1600×1600 PNG ocupa ~600 KB en vez de ~6 MB.
- **Ratio libre por defecto** — el recuadro arranca sin restricción de proporción. El selector de ratios está oculto (`lockRatio: true` por defecto).
- **Controles de rotación** — slider de `-45°` a `+45°` en pasos de `0.5°` + botón de 90° acumulable + reset. Tab "Rotar" en la barra inferior.
- **Controles de escala** — slider de `50%` a `300%`. Tab "Escalar" en la barra inferior.
- **Solo esquinas activas** — los handles de los lados (top/right/bottom/left) están ocultos para evitar conflicto con los gestos de navegación de Android. Solo las 4 esquinas redimensionan el recuadro.
- **Resize 1600×1600 máx** — el cropper redimensiona con `onlyScaleDown: true` para no escalar hacia arriba imágenes pequeñas.
- **Status bar inteligente** — en Android, `StatusBar.getInfo()` guarda el estilo original al abrir y lo restaura tal cual al cerrar. No hardcodea colores.
- **Memory-safe** — todas las `blob:` URLs creadas por `URL.createObjectURL` se revocan en `ngOnDestroy`.
- **PNG durante el crop** — el cropper emite PNG lossless. La compresión real (WebP 0.92) ocurre en `StorageService.uploadImage()`, evitando doble compresión lossy.
- **Recorte imperativo al confirmar (`[autoCrop]="false"`)** — el blob se genera en `confirmar()` llamando `cropperCmp.crop('blob')`, no vía el output `(imageCropped)` de la librería. **No reactivar `autoCrop`**: con autoCrop la librería regenera el blob de forma asíncrona tras cada gesto (canvas + encode PNG, 0.5–1.5s en Android); si el usuario confirma antes de que termine el encode del último resize, se despacha un blob desactualizado y la foto se guarda sin el recorte esperado. El botón ✓ muestra spinner (`procesando`) mientras genera el blob final.

#### API (`@Input()`)

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `imageUrl` | `string` | — (requerido) | URL de la imagen a recortar. Acepta `capacitor://`, `blob:`, `data:` o `http(s)://`. Se descarga y convierte a `blob:` URL local si es necesario (el cropper no entiende `capacitor://`). |
| `initialRatio` | `AspectRatioPreset` | `'libre'` | Ratio inicial del recuadro. Valores: `'libre' \| 'cuadrado' \| '4:3' \| '16:9' \| '3:4'` |
| `lockRatio` | `boolean` | `true` | Si true, oculta el selector de ratios y fija el inicial. Por defecto activado. |

#### Resultado (`onDidDismiss`)

```typescript
export interface ImageCropperResult {
  croppedBlob: Blob;  // PNG sin pérdida — pasar a StorageService.uploadImage()
}
```

#### Flujo típico (no usar directamente — usar StorageService)

```typescript
// ❌ NO hacer esto directamente
const modal = await this.modalCtrl.create({
  component: ImageCropperModalComponent,
  componentProps: { imageUrl, initialRatio: 'libre', lockRatio: true }
});

// ✅ Usar el StorageService que ya maneja todo
const result = await this.storageService.elegirFuenteFoto();
// → abre cámara/galería → abre cropper → devuelve { previewUrl, rawUrl } listo para uploadImage()
```

Ver [CORE-README → StorageService](../core/CORE-README.md) para los métodos públicos del flujo completo de fotos.

#### CSS class

Se abre con `cssClass: 'image-cropper-modal'` (definida en [modals.scss](../../src/theme/custom/modals.scss)). Fullscreen 100vw/100vh en móvil, 540×720px centrado en tablet/desktop.

#### Dependencia

`ngx-image-cropper@9.x` — requiere Angular 17.3+. Standalone component (sin módulos).

---

### `app-disabled-tab` — Tab deshabilitada

**Archivo:** `components/disabled-tab/`

Reemplaza un `<ion-tab-button>` cuando la feature está deshabilitada por estado del sistema. Muestra el icono con un candado superpuesto y al hacer click muestra un toast explicativo en lugar de navegar.

#### API

| `@Input()` | Tipo | Descripción |
|---|---|---|
| `icon` | `unknown` | Objeto ionicon (**no string** — por tree-shaking en Android) |
| `label` | `string` | Texto del tab |
| `disabledMessage` | `string` | Toast al hacer click. Default: mensaje del POS |

```html
<!-- En lugar de ion-tab-button cuando la feature está OFF -->
<app-disabled-tab [icon]="posIcon" label="POS"></app-disabled-tab>
<app-disabled-tab [icon]="posIcon" label="POS" disabledMessage="Abre la caja primero"></app-disabled-tab>
```

> Actualmente usado solo para el tab POS cuando no hay turno de caja abierto.

---

### `app-scanner-overlay` — Overlay visual del escáner

**Archivo:** `components/scanner-overlay/`

Overlay de cámara con marco animado, línea verde de escaneo y botón de cerrar. **Siempre se usa junto a `BarcodeScannerService`** — el servicio activa la cámara, este componente provee el diseño visual encima.

#### API

| `@Input()` | Tipo | Descripción |
|---|---|---|
| `visible` | `boolean` | Muestra/oculta el overlay |

| `@Output()` | Tipo | Descripción |
|---|---|---|
| `cerrar` | `EventEmitter<void>` | El usuario pulsó el botón ✕ |

#### Patrón de uso (con `BarcodeScannerService.scan()`)

```typescript
escaneando = false;

async escanear() {
  this.escaneando = true;
  try {
    const codigo = await this.scanner.scan();
    if (codigo) { /* procesar */ }
  } finally {
    this.escaneando = false;
  }
}

cerrarEscaner() {
  this.scanner.stop();
  this.escaneando = false;
}
```

```html
<!-- Al inicio del template, antes del ion-header -->
<app-scanner-overlay [visible]="escaneando" (cerrar)="cerrarEscaner()"></app-scanner-overlay>
```

> Ejemplos actuales: `inventario.page`, `producto-form.page`, `presentacion-modal`, `producto-variantes.page`, `consulta-precio-modal`.

---

### `app-calculadora-margen` — Calculadora de margen

**Archivo:** `components/calculadora-margen/`

Modal de utilidad para calcular el margen de ganancia en tiempo real. El usuario ingresa costo y precio de venta (o viceversa) y ve el margen resultante con indicador de color (rojo < 15%, amarillo < 30%, verde ≥ 30%).

Se abre exclusivamente desde el FAB central del `main-layout` como `bottom-sheet-modal`. No recibe `@Input()`.

```typescript
const modal = await this.modalCtrl.create({
  component: CalculadoraMargenComponent,
  cssClass: 'bottom-sheet-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1,
  keyboardClose: false
});
await modal.present();
```

---

### `app-consulta-precio-modal` — Consulta de precio por escáner

**Archivo:** `components/consulta-precio-modal/`

Modal que permite consultar el precio y stock de un producto escaneando su código de barras. Resuelve tanto productos simples como presentaciones (`producto_presentaciones`). Activa el escáner automáticamente al abrirse.

Se abre exclusivamente desde el FAB central del `main-layout`. No recibe `@Input()`.

```typescript
const modal = await this.modalCtrl.create({
  component: ConsultaPrecioModalComponent,
});
await modal.present();
```

**Muestra:**
- Nombre del producto e imagen (si tiene)
- Badge azul "Presentación: X" si el código corresponde a una presentación
- Precio de venta (de la presentación si aplica, del producto base si no)
- Stock actual con alerta roja si `stock_actual <= stock_minimo`
- Botón "Consultar otro" para reactivar el escáner sin cerrar el modal

---

### `app-period-filter` — Selector de período

**Archivo:** `components/period-filter/`

Barra de tabs pill para seleccionar un período de filtro (Hoy / Semana / Mes / Todo). Reemplaza el patrón de botones de período hardcodeados dentro de cada página.

#### API

| `@Input()` | Tipo | Descripción |
|---|---|---|
| `options` | `PeriodOption[]` | Lista de opciones `{ value: string; label: string }` |
| `selected` | `string` | Valor activo (pill resaltado) |
| `label` | `string?` | Etiqueta opcional a la izquierda de las tabs |

| `@Output()` | Tipo | Descripción |
|---|---|---|
| `selectionChange` | `EventEmitter<string>` | Emite el `value` de la opción seleccionada |

#### Ejemplo de uso

```typescript
import { PeriodFilterComponent, PeriodOption } from '@shared/components/period-filter/period-filter.component';

readonly periodos: PeriodOption[] = [
  { value: 'hoy',    label: 'Hoy' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes',    label: 'Mes' },
  { value: 'todo',   label: 'Todo' },
];
filtro = 'hoy';
```

```html
<app-period-filter
  [options]="periodos"
  [selected]="filtro"
  (selectionChange)="cambiarFiltro($event)">
</app-period-filter>
```

> Actualmente usado en `VentasResumenPage`. El componente no emite si el valor seleccionado ya es el activo.

---

### `app-sidebar` — Menú lateral

**Archivo:** `components/sidebar/`

Menú de navegación lateral de la app. Se gestiona automáticamente con `IonMenu`. Incluye accesos rápidos a las acciones del FAB para desktop (donde el FAB no se muestra). Contiene el sub-componente `selector-negocio-modal` (`components/sidebar/selector-negocio-modal/`) para cambiar de negocio desde el sidebar sin recargar la página de selección.

| `@Output()` | Tipo | Descripción |
|---|---|---|
| `accionRapida` | `EventEmitter<'nueva-nota' \| 'cuadre' \| 'calculadora'>` | Acción rápida seleccionada desde el sidebar |

```html
<!-- Incluido en main-layout.page.html -->
<app-sidebar (accionRapida)="onAccionRapida($event)"></app-sidebar>
```

---

## Directivas

### `appCurrencyInput` — Formato de moneda automático

**Archivo:** `directives/currency-input.directive.ts`

Formatea un `ion-input` como campo de moneda: al perder el foco muestra `1,250.00`, al ganar el foco limpia el formato para edición.

**Requiere:** `ReactiveFormsModule` y `CurrencyService`.

```html
<ion-input
  appCurrencyInput
  formControlName="precio_venta"
  inputmode="decimal">
</ion-input>
```

> El valor que llega al formulario puede tener comas — usar `currencyService.parse(value)` antes de enviar a la BD.

---

### `appNumbersOnly` — Solo números

**Archivo:** `directives/numbers-only.directive.ts`

Restringe un `ion-input` para aceptar únicamente `0-9`, `.` y `,`. Bloquea letras y símbolos tanto en teclado como en paste.

```html
<ion-input
  appNumbersOnly
  formControlName="stock_actual"
  inputmode="numeric">
</ion-input>
```

> Se combina frecuentemente con `appCurrencyInput` en campos de precio.

---

### `appScrollReset` — Reset de scroll

**Archivo:** `directives/scroll-reset.directive.ts`

Hace scroll al top de un `ion-content` automáticamente cuando el valor vinculado cambia. Útil en wizards o secciones dinámicas dentro de la misma página.

```html
<!-- Scroll al top cuando cambia pasoActual -->
<ion-content [appScrollReset]="pasoActual">

<!-- Con duración personalizada (0 = sin animación) -->
<ion-content [appScrollReset]="seccion" [scrollResetDuration]="0">
```

### `appUppercaseInput` — Mayúsculas automáticas

**Archivo:** `directives/uppercase-input.directive.ts`

Convierte automáticamente el valor de un `ion-input` a mayúsculas mientras el usuario escribe. Útil para campos como códigos, identificaciones o nombres normalizados.

---

### `appHorizontalScroll` — Scroll horizontal con wheel + hint de overflow

**Archivo:** `directives/horizontal-scroll.directive.ts`

Mejora el UX de cualquier contenedor con `overflow-x: auto` en desktop:

1. **Redirige el wheel vertical al scroll horizontal** — en mouse sin trackpad 2D, la rueda solo hace scroll vertical. Esta directiva intercepta el evento `wheel` y lo convierte en `scrollLeft` cuando el contenedor tiene overflow horizontal.
2. **Agrega la clase `has-h-overflow` al padre** cuando el contenido desborda — permite mostrar un hint visual `← →` en CSS solo cuando hay algo que desplazar. La clase se actualiza en tiempo real con `ResizeObserver`.

#### Uso

```html
<div class="mi-scroll-wrapper">
  <div class="mi-contenedor-horizontal" appHorizontalScroll>
    <!-- items que desbordan el ancho -->
  </div>
</div>
```

```scss
// El padre recibe has-h-overflow cuando hay overflow
.mi-scroll-wrapper.has-h-overflow::after {
  content: '← →';
  // hint visual para el usuario
}
```

#### Importar

```typescript
import { HorizontalScrollDirective } from '@shared/directives/horizontal-scroll.directive';

@Component({
  standalone: true,
  imports: [HorizontalScrollDirective, ...]
})
```

#### Comportamiento detallado

- **Trackpad 2D**: si `Math.abs(deltaX) > Math.abs(deltaY)` el usuario ya está scrolleando horizontal con dos dedos — la directiva no interfiere.
- **Mouse con rueda**: `deltaX === 0` siempre → la directiva redirige `deltaY` a `scrollLeft`.
- **`ResizeObserver`**: se desconecta en `ngOnDestroy` para evitar memory leaks.
- La directiva actúa sobre el **elemento donde se aplica** (`[appHorizontalScroll]`), y añade/quita la clase en su **padre inmediato**.

> Actualmente usado en el grid de cajas del home (`cuentas-grid`) para permitir scroll horizontal con mouse en desktop cuando hay muchas cajas.

---

---

## Estilos globales — `src/theme/custom/`

Los estilos globales reutilizables (que escapan el encapsulamiento de componentes) viven en `src/theme/custom/`.

### Estructura

```
src/theme/custom/
├── index.scss    → re-exporta todo con @forward (punto de entrada)
└── modals.scss   → estilos de modales reutilizables
```

### Cómo se importa

```scss
// global.scss — único punto de entrada
@use './theme/custom/index';

// index.scss — re-exporta con @forward
@forward './modals';
```

> **Convención Sass:** `@forward` en `index.scss` para agrupar, `@use` en `global.scss` para consumir. No usar `@import` (deprecated en Dart Sass 3.0).

### `bottom-sheet-modal` — clase estándar para todos los modales bottom sheet

Única clase para todos los modales que se abren desde abajo. Se adapta al contenido (`--height: auto`) y activa scroll automáticamente cuando el contenido supera el 90% de la pantalla.

#### Apertura (TS)

```typescript
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  cssClass: 'bottom-sheet-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1,
  // componentProps: { ... }
});
await modal.present();
```

Agregar `backdropDismiss: false` solo cuando el modal tiene operaciones destructivas que no deben cancelarse por accidente.

#### Template HTML obligatorio

```html
<div class="bs-root">

  <div class="bs-header">
    <div class="bs-header__icon">
      <ion-icon name="mi-icono"></ion-icon>
    </div>
    <span class="bs-header__title">Título del modal</span>
    <button class="bs-header__close" (click)="cerrar()">
      <ion-icon name="close-outline"></ion-icon>
    </button>
  </div>

  <div class="bs-content">
    <div class="bs-body">
      <!-- campos del formulario, listas, etc. -->
    </div>
  </div>

  <div class="bs-actions bs-actions--row">
    <ion-button expand="block" fill="outline" color="medium" (click)="cerrar()">Cancelar</ion-button>
    <ion-button expand="block" color="primary" (click)="confirmar()">Confirmar</ion-button>
  </div>

</div>
```

**Reglas críticas del template:**
- **Nunca usar `ion-content`** dentro del modal — colapsa a 0px con `--height: auto` porque no tiene referencia de altura. Usar `div.bs-content` con `overflow-y: auto` (ya definido en `modals.scss`).
- **No importar `IonContent`** en el componente (ni en el `import` TS ni en `imports[]` del decorador).
- `div.bs-content` es el área scrollable. `div.bs-body` es el wrapper de padding interno.

#### SCSS local — solo el color del icono

```scss
// Solo esto en el .scss del componente. Todo lo demás viene de modals.scss.
.bs-header__icon {
  background: rgba(var(--ion-color-primary-rgb), 0.10);
  ion-icon { color: var(--ion-color-primary); }
}
```

#### Variantes de `.bs-actions`

| Clase | Layout | Cuándo usar |
|---|---|---|
| `bs-actions` | Columna (apilados) | 3+ botones o textos largos |
| `bs-actions bs-actions--row` | Fila lado a lado | **Default para 2 botones** (Cancelar/Confirmar) |
| `bs-actions bs-actions--compact` | Fila centrada, botones chicos | Modales de herramienta (calculadora, cuadre) |

#### Comportamiento en desktop (≥768px)

El modal se centra en pantalla con `max-width: 520px` y `border-radius: 16px` en las 4 esquinas (flotante). En móvil se ancla al fondo con esquinas redondeadas solo arriba.

#### Modales actuales con este patrón

`OperacionModalComponent`, `NuevaCajaModalComponent`, `TraspasoModalComponent`, `VerificarFondoModalComponent`, `NuevaNotaModalComponent`, `CuadreCajaPage`, `CalculadoraMargenComponent`, `ConsultaPrecioModalComponent`, `ModulosNegocioModalComponent`, `AjusteStockModalComponent`, `CantidadModalComponent`, `VarianteSelectorModalComponent`, `PresentacionModalComponent`.

---

---

## Pipes

### `OperacionLabelPipe` — Display de operaciones de caja

**Archivo:** `src/app/shared/pipes/operacion-label.pipe.ts`

Pipe standalone centralizado para mostrar registros de `operaciones_cajas` de forma legible. Reemplaza todos los métodos duplicados que antes vivían en `home.page.ts` y `operaciones-caja.page.ts` (`getMovLabel`, `getMovColor`, `esMovIngreso`, `getOperacionLabel`, `getOperacionColor`, `esIngreso` visual, etc.).

#### Importar

```typescript
import { OperacionLabelPipe } from '@shared/pipes/operacion-label.pipe';

@Component({
  standalone: true,
  imports: [OperacionLabelPipe, ...],
})
```

#### Modos (segundo argumento)

| Modo | Expresión en template | Retorna | Ejemplo |
|---|---|---|---|
| **Label** (default) | `(tipo \| operacionLabel:descripcion)` | Texto legible del tipo, con contraparte en traspasos | `"Traspaso hacia Cajón"` |
| **`'motivo'`** | `(descripcion \| operacionLabel:'motivo')` | Texto tras el `·` en la descripción, o `''` si no hay | `"pago proveedores"` |
| **`'color'`** | `(tipo \| operacionLabel:'color')` | Color Ionic del tipo | `"success"`, `"danger"` |
| **`'signo'`** | `(tipo \| operacionLabel:'signo')` | `"+"`, `"-"`, o `""` | `"+"` para INGRESO |

#### Tabla de valores por tipo

| `tipo_operacion` | Label default | Color | Signo |
|---|---|---|---|
| `INGRESO` | Ingreso | `success` | `+` |
| `EGRESO` | Egreso | `danger` | `-` |
| `APERTURA` | Apertura de turno | `primary` | — |
| `CIERRE` | Cierre de turno | `success` | `+` |
| `AJUSTE` | Ajuste | `warning` | — |
| `TRANSFERENCIA_SALIENTE` | Traspaso enviado *(o "Traspaso hacia X" si hay descripción)* | `danger` | `-` |
| `TRANSFERENCIA_ENTRANTE` | Traspaso recibido *(o "Traspaso desde X" si hay descripción)* | `success` | `+` |

#### Uso completo en template

```html
<!-- Ícono — @switch con nombres estáticos (requerido para Android tree-shaking) -->
<div class="op-icon-wrap" [attr.data-type]="op.tipo_operacion | operacionLabel:'color'">
  @switch (op.tipo_operacion) {
    @case ('INGRESO')                { <ion-icon name="arrow-down-outline"></ion-icon> }
    @case ('TRANSFERENCIA_ENTRANTE') { <ion-icon name="arrow-down-outline"></ion-icon> }
    @case ('EGRESO')                 { <ion-icon name="arrow-up-outline"></ion-icon> }
    @case ('TRANSFERENCIA_SALIENTE') { <ion-icon name="arrow-up-outline"></ion-icon> }
    @case ('APERTURA')               { <ion-icon name="lock-open-outline"></ion-icon> }
    @case ('CIERRE')                 { <ion-icon name="lock-closed-outline"></ion-icon> }
    @case ('AJUSTE')                 { <ion-icon name="create-outline"></ion-icon> }
    @default                         { <ion-icon name="cash-outline"></ion-icon> }
  }
</div>

<!-- Título: categoría si existe, label contextual si no -->
<span class="op-title">
  {{ op.categoria?.nombre || (op.tipo_operacion | operacionLabel:op.descripcion) }}
</span>

<!-- Motivo: solo muestra si hay texto tras el "·" -->
@if (op.descripcion | operacionLabel:'motivo') {
  <p class="op-desc">{{ op.descripcion | operacionLabel:'motivo' }}</p>
}

<!-- Monto con signo y color -->
<span class="op-amount" [attr.data-type]="op.tipo_operacion | operacionLabel:'color'">
  {{ op.tipo_operacion | operacionLabel:'signo' }}${{ op.monto | number:'1.2-2' }}
</span>
```

#### Cómo funciona el label contextual de traspasos

`fn_crear_transferencia` escribe la descripción con el formato `"hacia Cajón · motivo"` (SALIENTE) y `"desde Tienda · motivo"` (ENTRANTE). El pipe detecta este formato y construye el label completo:

```
tipo = 'TRANSFERENCIA_SALIENTE', descripcion = 'hacia Cajón · pago proveedores'
→ label:  "Traspaso hacia Cajón"   (split por '·', toma parte 0 → "hacia Cajón")
→ motivo: "pago proveedores"        (split por '·', toma parte 1 → "pago proveedores")
```

Registros históricos sin descripción (o con formato antiguo sin `·`) retornan los labels genéricos `"Traspaso enviado"` / `"Traspaso recibido"` sin error.

#### Patrón obligatorio para descripciones en funciones SQL

Al generar el campo `descripcion` en un INSERT de `operaciones_cajas`, respetar este patrón según el tipo de operación:

| Tipo | Patrón | Ejemplo |
|---|---|---|
| `TRANSFERENCIA_SALIENTE` | `'hacia [nombre destino] · [motivo]'` | `'hacia Cajón · Fondo de emergencia'` |
| `TRANSFERENCIA_ENTRANTE` | `'desde [nombre origen] · [motivo]'` | `'desde Cajón · Fondo de emergencia'` |
| `INGRESO` / `EGRESO` / `CIERRE` / `APERTURA` / `AJUSTE` | Texto libre sin `·` | `'Venta celular del turno 2026-06-04'` |

**Regla:** el separador `·` **solo** se usa en transferencias para separar la contraparte del motivo. En otros tipos, el texto libre se muestra completo como descripción — el pipe no lo fragmenta.

**Patrón SQL para transferencias con motivo opcional:**
```sql
-- Con motivo fijo:
'desde Cajón · Fondo de emergencia'

-- Con motivo dinámico (como en fn_crear_transferencia):
'hacia ' || v_destino.nombre
  || CASE WHEN TRIM(COALESCE(p_descripcion, '')) <> ''
          THEN ' · ' || p_descripcion
          ELSE ''
     END
```

#### Páginas que lo usan

`home.page.html` (caja dashboard), `operaciones-caja.page.html` (historial de operaciones por caja).

---

## Convenciones

- Todos los elementos son **standalone** — importar directamente en el `imports[]` del componente.
- Los **enums** de dominio específico de un feature van en `features/<feature>/models/` con sufijo `.enum.ts` (ej: `tipo-comprobante.enum.ts`).
- Los **enums compartidos** entre múltiples features irían en `shared/models/` (aún no hay ninguno).
- Los **pipes standalone** van en `shared/pipes/` — importar directamente en el `imports[]` del componente que los use.
