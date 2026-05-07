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

Menú de navegación lateral de la app. Se gestiona automáticamente con `IonMenu`. Incluye accesos rápidos a las acciones del FAB para desktop (donde el FAB no se muestra).

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

### `bottom-sheet-modal` — clase genérica para modales compactos

Usar en cualquier modal sin scroll interno que deba abrirse desde abajo:

```typescript
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  cssClass: 'bottom-sheet-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
```

**Estructura HTML obligatoria** (sin `ion-content` — div directo):

```html
<div class="modal-wrapper">

  <div class="modal-header">
    <div class="modal-header-icon">   <!-- color específico en SCSS local -->
      <ion-icon name="mi-icono"></ion-icon>
    </div>
    <span class="modal-header-title">Título</span>
    <button class="modal-close-btn" (click)="cerrar()">
      <ion-icon name="close-outline"></ion-icon>
    </button>
  </div>

  <!-- contenido específico del modal -->

  <div class="modal-actions">
    <ion-button expand="block" fill="outline" color="medium" (click)="cerrar()">Cancelar</ion-button>
    <ion-button expand="block" color="primary" (click)="confirmar()">Confirmar</ion-button>
  </div>

</div>
```

**SCSS local** — solo el color del icono (todo lo demás viene de `modals.scss`):

```scss
.modal-header-icon {
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  ion-icon { color: var(--ion-color-primary); }
}
```

> **NO usar** `breakpoints` en modales con scroll interno largo → bloquea el swipe en Android.
> Ejemplos actuales: `NuevaNotaModalComponent`, `CuadreCajaPage`.

---

## Convenciones

- Todos los elementos son **standalone** — importar directamente en el `imports[]` del componente.
- Los **enums** de dominio específico de un feature van en `features/<feature>/models/` con sufijo `.enum.ts` (ej: `tipo-comprobante.enum.ts`).
- Los **enums compartidos** entre múltiples features irían en `shared/models/` (aún no hay ninguno).
