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

### `app-sidebar` — Menú lateral

**Archivo:** `components/sidebar/`

Menú de navegación lateral de la app. Se gestiona automáticamente con `IonMenu`. No recibe `@Input` propios — consume la configuración de rutas interna.

```html
<!-- Ya incluido en app.component.html, no requiere uso adicional -->
<app-sidebar></app-sidebar>
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
