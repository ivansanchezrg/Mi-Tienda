# Shared — Componentes y Directivas Reutilizables

Ubicación: `src/app/shared/`

Todo lo que está aquí es **standalone** — se importa directamente en el componente que lo necesite, sin módulos intermedios.

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
  label: string;      // Texto visible
  icon: string;       // Nombre de ionicon (ej: 'trash-outline')
  value: any;         // Valor que se emite al seleccionar
  active?: boolean;   // Muestra ✓ a la derecha
  color?: string;     // Color Ionic: 'danger', 'primary', etc.
}
```

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

#### Páginas que lo usan

`home.page.html` (caja dashboard), `operaciones-caja.page.html` (historial de operaciones por caja).

---

## Convenciones

- Todos los elementos son **standalone** — importar directamente en el `imports[]` del componente.
- Los **enums** de dominio específico de un feature van en `features/<feature>/models/` con sufijo `.enum.ts` (ej: `tipo-comprobante.enum.ts`).
- Los **enums compartidos** entre múltiples features irían en `shared/models/` (aún no hay ninguno).
- Los **pipes standalone** van en `shared/pipes/` — importar directamente en el `imports[]` del componente que los use.
