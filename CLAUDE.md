# CLAUDE.md — Mi Tienda

Contexto rápido del proyecto para IAs. Lee esto antes de cualquier tarea.

---

## Qué es este proyecto

App móvil Android (APK) para gestión de una tienda minorista. Maneja caja (sistema de **5 cajas** físicas/virtuales: CAJA, CAJA_CHICA, VARIOS, CAJA_CELULAR, CAJA_BUS), ventas POS, recargas de saldo celular/bus e inventario.

**No es un e-commerce ni una web app.** Es una herramienta interna de administración para una sola tienda.

---

## Stack

| Componente   | Versión | Notas                          |
| ------------ | ------- | ------------------------------ |
| Angular      | 20.x    | Standalone components SIEMPRE  |
| Ionic        | 8.x     | Componentes nativos Android    |
| Capacitor    | 8.x     | Empaquetado APK                |
| Supabase JS  | 2.x     | Auth + DB + Storage            |
| Node.js      | 22.x    |                                |

---

## Módulos (`src/app/features/`)

| Módulo              | Estado           |
| ------------------- | ---------------- |
| `auth`              | ✅ Completo                                  |
| `dashboard`         | ✅ Completo (v5 — 5 cajas, cierre wizard 2p) |
| `recargas-virtuales`| ✅ Completo                                  |
| `usuarios`          | ✅ Completo                                  |
| `inventario`        | ✅ Completo                                  |
| `pos`               | ✅ Completo (descuentos, idempotencia, escáner) |
| `cuentas-cobrar`    | ✅ Completo                                  |
| `clientes`          | ✅ Completo                                  |
| `configuracion`     | ✅ Completo (parámetros negocio, categorías)  |
| `movimientos-empleados` | 🚧 Frontend nuevo (cuenta corriente empleados, nomina). No requiere turno abierto. |
| ~~`reportes`~~      | ❌ Eliminado (2026-03-26) — el resumen diario se integró como panel colapsable en `ventas` |
| ~~`gastos-diarios`~~| ❌ Eliminado en v5 (2026-03-06) — los gastos van como EGRESO en `operacion-modal` |

---

## Estructura de carpetas

```
src/app/
├── core/
│   ├── services/          # Servicios globales (ver abajo)
│   ├── config/            # pagination.config.ts — PAGINATION_CONFIG (pageSize por módulo)
│   │                      # routes.config.ts — ROUTES (todas las rutas de la app)
│   ├── guards/            # auth, public, role, pending-changes
│   └── utils/             # date.util.ts, cedula.util.ts
├── features/              # Módulos (cada uno tiene pages/, services/, models/, components/)
├── shared/
│   ├── components/        # sidebar, under-construction, options-menu, options-modal, empty-state
│   ├── directives/        # currency-input, numbers-only, scroll-reset
│   └── pages/             # paginated-list.page.ts (clase base listas paginadas)
└── environments/
    ├── environment.example.ts   # Plantilla (en git)
    └── environment.ts           # Credenciales reales (en .gitignore)
```

---

## Servicios core — cuándo usar cada uno

| Servicio                  | Uso                                                         |
| ------------------------- | ----------------------------------------------------------- |
| `SupabaseService`         | Todas las queries y auth. Usar siempre `.call()` o `.rpc()`. Tiene listener global de auth (TOKEN_REFRESHED, SIGNED_OUT), detección de JWT expirado en `call()`, refresh proactivo al volver del background (`refreshSessionOnResume()`), y `handleExpiredSession()` como punto centralizado de limpieza de sesión |
| `UiService`               | Loading, toasts, alertas, confirmaciones, `hideTabs()`/`showTabs()` para ocultar tabs en páginas de detalle |
| `ConfigService`           | Lee tabla `configuraciones` (clave/valor con prefijo por módulo: `negocio_`, `caja_`, `bus_`, `pos_`, `nomina_`) con cache en memoria. Métodos: `get()`, `getNombreNegocio()`, `invalidar()` |
| `CurrencyService`         | Formateo de moneda: `format(value)` y `parse(value)`. No formatear manualmente |
| `StorageService`          | Sube imágenes a Supabase Storage con compresión automática. `uploadImage(dataUrl, bucket, subfolder)` |
| `GananciasService`        | Lógica de comisiones recargas virtuales (liquidación BUS mensual) |
| `RecargasVirtualesService`| Operaciones de saldo celular/bus                            |
| `LoggerService`           | Logs estructurados a filesystem con rotación (no usar console.log directo) |
| `NetworkService`          | Estado de conectividad: `isOnline$: BehaviorSubject<boolean>` |

---

## Patrones Angular/Ionic — OBLIGATORIOS

### Standalone components siempre
```typescript
@Component({
  standalone: true,
  imports: [CommonModule, IonHeader, IonToolbar, IonContent, ...]
})
```

### inject() en lugar de constructor
```typescript
private supabase = inject(SupabaseService);
private ui = inject(UiService);
private fb = inject(FormBuilder);
```

### Registrar iconos en constructor
```typescript
import { IonIcon } from '@ionic/angular/standalone';
import { closeOutline, addOutline } from 'ionicons/icons';

@Component({
  standalone: true,
  imports: [IonIcon, ...] // IonIcon DEBE estar en imports
})
export class MiComponent {
  constructor() {
    addIcons({ closeOutline, addOutline }); // registrar en constructor
  }
}
```

**Reglas críticas para iconos en Android (tree-shaking):**

1. **`IonIcon` debe estar en `imports[]` del componente** — incluyendo modales. La web "perdona" si está en otro componente padre; Android no.

2. **Nunca usar binding dinámico con ternario** — Android elimina los iconos que no puede detectar en compile-time:
```html
<!-- ❌ Android no puede detectar qué iconos se usan → los elimina -->
<ion-icon [name]="esIngreso ? 'arrow-down-outline' : 'arrow-up-outline'"></ion-icon>

<!-- ✅ Nombres estáticos en cada rama — Angular los detecta en compile-time -->
@if (esIngreso) {
  <ion-icon name="arrow-down-outline"></ion-icon>
} @else {
  <ion-icon name="arrow-up-outline"></ion-icon>
}
```

3. **Ser explícito con el sufijo** (`-outline`, `-sharp`) — en Android Ionic usa modo `md` y busca el SVG exacto registrado. Si registraste `closeOutline`, usar siempre `name="close-outline"`, nunca `name="close"`.

> **Importante:** antes de borrar un icono de `addIcons()`, buscar su nombre string en los `.html` del componente. Los bindings `[name]="variable"` no aparecen en análisis estático.

### Rutas — SIEMPRE usar `ROUTES` de `core/config/routes.config.ts`

Todas las rutas de la app están centralizadas en `src/app/core/config/routes.config.ts`.
**Nunca escribir strings de ruta directamente** en `navigate()`, `navigateForward()`, `navigateBack()` ni `routerLink`.

```typescript
// ❌ Incorrecto — string hardcodeado
this.navCtrl.navigateBack('/inventario');
this.router.navigate(['/home']);
[routerLink]="'/configuracion'"

// ✅ Correcto — siempre via ROUTES
import { ROUTES } from '@core/config/routes.config';
this.navCtrl.navigateBack(ROUTES.inventario.root);
this.router.navigate([ROUTES.home]);
[routerLink]="configuracionRoute"  // propiedad del componente = ROUTES.configuracion.root
```

**Al agregar una ruta nueva** (nueva página, nueva feature, nueva subruta):
1. Agregar la constante en `routes.config.ts` bajo la clave del módulo correspondiente
2. Si es una función con parámetro (detalle con `:id`), usar la forma `(id: string) => \`/ruta/${id}\``
3. Usar `ROUTES` en todos los archivos que naveguen a esa ruta

```typescript
// routes.config.ts — estructura para un módulo nuevo
miFeature: {
  root:    '/mi-feature',
  detalle: (id: string) => `/mi-feature/${id}`,
  nuevo:   '/mi-feature/nuevo',
},
```

**Módulo `@core/config`** — el alias `@core` apunta a `src/app/core/`. Usar siempre el alias en features y shared, ruta relativa solo en core mismo.

---

### Modales — NUNCA usar sheet modals (`breakpoints`)
Los sheet modals (`breakpoints + initialBreakpoint`) bloquean el scroll interno en Android: Ionic interpreta el swipe como gesto de cierre hasta llegar al tope. Sin `breakpoints`, el modal es full-height por defecto en Android (md mode) y el scroll funciona nativamente.

> **Nota:** `presentationStyle` no existe en `ModalOptions` de `@ionic/angular` 8.x — no usar.

```typescript
// ✅ Correcto — full-height por defecto en Android, scroll nativo sin conflicto
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  componentProps: { dato: valor }
  // sin breakpoints, sin initialBreakpoint
});
await modal.present();

// ❌ Incorrecto — bloquea scroll en Android
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
```

- No usar `breakpoints`, `initialBreakpoint` ni `handleBehavior` en modales con scroll interno → bloquea scroll en Android.
  - **Excepción:** Modales sin scroll interno (listas cortas de acciones) SÍ pueden usar `breakpoints: [0, 1]` + `initialBreakpoint: 1` + `--height: auto` para bottom sheet nativo con swipe-to-dismiss. Ejemplo: `OptionsModalComponent`.
- No usar `cssClass: 'modal-fullscreen-mobile'` → ya no es necesario sin breakpoints
- El usuario cierra con el botón ✕ del header (modales fullscreen) o swipe down (bottom sheets)
- **NUNCA usar `ion-select`, `ActionSheetController` ni `PopoverController`** → bug de Ionic 8 + Capacitor en Android con standalone components: estos overlay controllers no se inicializan hasta que otra página los cargue primero. Afecta **tanto modales como pages** en primera carga.
  - **Selects y Action Sheets**: usar `OptionsModalComponent` (`shared/components/options-modal/`). Se abre como bottom sheet con swipe-to-dismiss.
  - **Confirmaciones simples (texto plano)**: usar `AlertController`. Los alerts NO renderizan HTML custom en Android — Ionic sanitiza el `message` y muestra las etiquetas como texto. `IonicSafeString` tampoco funciona de forma confiable. **Si necesitas UI custom (estilos, layout, tipografía grande), usar un `ModalController` con componente dedicado.**
  - **Overlays que SÍ funcionan**: `AlertController`, `ModalController`, `LoadingController`, `ToastController`.

### `bottom-sheet-modal` — patrón para modales compactos sin scroll

Para modales compactos (formularios cortos, confirmaciones con UI custom) que deben abrirse desde abajo y ajustarse al contenido:

```typescript
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  cssClass: 'bottom-sheet-modal',   // ← clase global en theme/custom/modals.scss
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
```

**Template del componente** — `div` directo, sin `ion-content`:
```html
<div class="modal-wrapper">
  <div class="modal-header">
    <div class="modal-header-icon">  <!-- color en SCSS local del componente -->
      <ion-icon name="mi-icono"></ion-icon>
    </div>
    <span class="modal-header-title">Título</span>
    <button class="modal-close-btn" (click)="cerrar()">
      <ion-icon name="close-outline"></ion-icon>
    </button>
  </div>
  <!-- contenido -->
  <div class="modal-actions">
    <ion-button expand="block" fill="outline" color="medium" (click)="cerrar()">Cancelar</ion-button>
    <ion-button expand="block" color="primary" (click)="confirmar()">Confirmar</ion-button>
  </div>
</div>
```

**SCSS local** — solo el color del icono, todo lo demás viene de `modals.scss`:
```scss
.modal-header-icon {
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  ion-icon { color: var(--ion-color-primary); }
}
```

> **NO usar** en modales con scroll largo — bloquea el swipe en Android (misma regla de `breakpoints`).
> Ejemplos actuales: `NuevaNotaModalComponent`, `CuadreCajaPage`.

### `OptionsModalComponent` — componente estándar para selects y action sheets

Ubicación: `shared/components/options-modal/`. Reemplaza `<select>` nativo, `ion-select`, `ActionSheetController` y `PopoverController`.

Soporta **dos modos** según los `@Input()` que reciba:

**Modo acción** (action sheet) — opciones con iconos, sin selección previa:
```typescript
// Ejemplo: selección de método de pago en POS
const groups: ModalOptionGroup[] = [{
  options: [
    { label: 'Efectivo', icon: 'cash-outline', value: 'EFECTIVO' },
    { label: 'Transferencia', icon: 'phone-portrait-outline', value: 'TRANSFERENCIA' },
    { label: 'Fiado', icon: 'hand-right-outline', value: 'FIADO', color: 'danger' },
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
if (data) { /* data = 'EFECTIVO' | 'TRANSFERENCIA' | etc. */ }
```

**Modo selección** (select) — sin iconos, con checkmark en la opción activa:
```typescript
// Ejemplo: filtro de categoría en inventario
const groups: ModalOptionGroup[] = [
  { options: [{ label: 'Todas', value: 'todas' }] },
  { title: 'Categorías', options: categorias.map(c => ({ label: c.nombre, value: `cat-${c.id}` })) }
];

const modal = await this.modalCtrl.create({
  component: OptionsModalComponent,
  componentProps: { title: 'Filtrar', groups, selectedValue: this.filtroActual },
  cssClass: 'options-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
await modal.present();
const { data } = await modal.onDidDismiss();
if (data) { this.onFiltroChange(data); }
```

**Patrón del botón que abre el modal** (reemplaza `<select>`):
```html
<button class="filter-selector" (click)="abrirSelector()">
  <span class="filter-selector-label">{{ labelActual }}</span>
  <ion-icon name="chevron-down-outline" class="filter-selector-arrow"></ion-icon>
</button>
```

**API del componente:**

| `@Input()`      | Tipo               | Descripción |
| --------------- | ------------------ | ----------- |
| `title`         | `string`           | Título del modal |
| `subtitle`      | `string?`          | Subtítulo opcional |
| `groups`        | `ModalOptionGroup[]` | Grupos de opciones |
| `selectedValue` | `string?`          | Valor seleccionado actual (activa modo selección con checkmark) |

| `ModalOption`   | Campo     | Obligatorio | Descripción |
| --------------- | --------- | ----------- | ----------- |
|                 | `label`   | ✅ | Texto de la opción |
|                 | `value`   | ✅ | Valor retornado al seleccionar |
|                 | `icon`    | ❌ | Icono a la izquierda (modo acción) |
|                 | `subtitle`| ❌ | Texto secundario debajo del label |
|                 | `color`   | ❌ | `'danger'` para opciones destructivas |

```typescript
// ❌ Incorrecto — no funciona en Android primera carga
const actionSheet = await this.actionSheetCtrl.create({ ... });
<ion-select formControlName="campo">...</ion-select>

// ✅ Correcto — OptionsModalComponent funciona siempre
const modal = await this.modalCtrl.create({
  component: OptionsModalComponent,
  componentProps: { title, groups, selectedValue },
  cssClass: 'options-modal',
  breakpoints: [0, 1], initialBreakpoint: 1
});
```

> **Excepción**: `<select>` nativo de HTML sigue siendo válido **dentro de formularios** (`FormGroup`) donde se necesita binding directo con `formControlName` y no justifica abrir un modal (ej: campo de categoría en formulario de producto). En estos casos usar `<select>` con estilos custom.

### `EmptyStateComponent` — estado vacío de listas

Ubicación: `shared/components/empty-state/`. Usar siempre que una lista no tenga ítems que mostrar.

```html
<app-empty-state
  icon="cart-outline"
  title="Sin ventas"
  hint="Las ventas del día aparecerán aquí.">
</app-empty-state>
```

| `@Input()`  | Tipo     | Descripción |
| ----------- | -------- | ----------- |
| `icon`      | `string` | Nombre del icono Ionicons (requerido) |
| `title`     | `string?` | Título principal (opcional) |
| `hint`      | `string?` | Texto descriptivo secundario (opcional) |

- Estilos encapsulados en el componente — **no agregar `.empty-state` en el SCSS de la página**
- Para estados vacíos dentro de modales o contenedores pequeños: `style="min-height: auto"` inline
- Los iconos usados frecuentemente ya están registrados en el componente. Si necesitas uno nuevo, agrégalo en `empty-state.component.ts`

### Loading + Pull-to-Refresh sin doble spinner
```typescript
async handleRefresh(event: CustomEvent) {
  await this.cargarDatos(true);  // silencioso=true: no muestra spinner de página
  (event.target as HTMLIonRefresherElement).complete();
}

async cargarDatos(silencioso = false) {
  if (!silencioso) this.loading = true;
  try { /* queries */ } finally { this.loading = false; }
}
```

### Listas paginadas con infinite scroll — `PaginatedListPage<T>`

Clase base abstracta en `src/app/shared/pages/paginated-list.page.ts`.
**Usar siempre que una página muestre una lista paginada con `ion-infinite-scroll`.**

Qué provee (ya no hay que declararlo en cada página):
- `items: T[]` — array acumulado de todas las páginas
- `loading: boolean` — skeleton en primera carga
- `hasMore: boolean` — controla el infinite scroll
- `showScrollTop: boolean` — muestra FAB "subir al inicio" al hacer scroll >600px
- `cargar()` — resetea a página 0 y recarga
- `cargarMas(event)` — handler de `(ionInfinite)`
- `handleRefresh(event)` — handler de `(ionRefresh)` (sin doble spinner)
- `onContentScroll(event)` — handler de `(ionScroll)` para scroll-to-top
- `scrollToTop()` — sube al inicio con animación
- `loadingMoreText` — texto contextual del spinner de infinite scroll (abstracto, cada subclase lo define)
- `ui` — instancia de `UiService` (heredada, no re-inyectar)
- `content` — `@ViewChild` del `<ion-content #content>` (heredado, no re-declarar)

Page sizes centralizados en `PAGINATION_CONFIG` (`src/app/core/config/pagination.config.ts`).

Qué implementa cada subclase:
```typescript
export class MiListaPage extends PaginatedListPage<MiItem> implements OnInit {
    private miServicio = inject(MiServicio);

    protected readonly pageSize = PAGINATION_CONFIG.miModulo.pageSize;
    readonly loadingMoreText = 'Cargando más items...';  // contextual a la sección

    protected async fetchPage(page: number): Promise<MiItem[]> {
        return this.miServicio.listar(page, this.pageSize);
    }

    async ngOnInit() {
        await this.cargar();
    }
}
```

Template mínimo:
```html
<ion-content #content [scrollEvents]="true" (ionScroll)="onContentScroll($event)">

  @if (loading) { <!-- skeleton --> }
  @else if (items.length === 0) { <!-- empty state --> }
  @else {
    @for (item of items; track item.id) { <!-- tarjeta --> }
  }

  <ion-infinite-scroll [disabled]="!hasMore" (ionInfinite)="cargarMas($event)">
    <ion-infinite-scroll-content loadingSpinner="crescent" [loadingText]="loadingMoreText"></ion-infinite-scroll-content>
  </ion-infinite-scroll>

  @if (showScrollTop) {
  <ion-fab vertical="bottom" horizontal="end" slot="fixed" class="scroll-top-fab">
    <ion-fab-button size="small" color="primary" (click)="scrollToTop()">
      <ion-icon name="arrow-up-outline"></ion-icon>
    </ion-fab-button>
  </ion-fab>
  }
</ion-content>
```

Estilo SCSS (en cada página, ajustar margin según si hay footer):
```scss
.scroll-top-fab {
    margin-bottom: env(safe-area-inset-bottom);
}
```

Ejemplo real: `VentasListadoPage`, `InventarioPage`

### Tabs internas en un módulo — patrón obligatorio

Cuando un módulo necesita tabs internas (ej: Ventas tiene Lista y Resumen):

1. **Componente de tabs** en `components/` (NO en `pages/`). Detecta la ruta activa con `NavigationEnd`, no con `@Input()`.
2. **Cada página incluye su propio `ion-header`** con el componente de tabs — NO usar layout wrapper con `router-outlet` hijo (causa conflictos con `ion-content` en Ionic).
3. **Rutas planas** en el routes file, sin children wrapper.
4. **Carpetas de pages** nombradas por función: `pages/listado/`, `pages/resumen/`, etc.

```typescript
// ventas.routes.ts — rutas planas, sin layout wrapper
export const VENTAS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./pages/listado/ventas-listado.page').then(m => m.VentasListadoPage) },
  { path: 'resumen', loadComponent: () => import('./pages/resumen/ventas-resumen.page').then(m => m.VentasResumenPage) }
];
```

```typescript
// ventas-tabs.component.ts — detecta ruta activa automáticamente
private router = inject(Router);
activeTab: 'lista' | 'resumen' = 'lista';
constructor() {
    this.syncTab(this.router.url);
    this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(e => this.syncTab(e.urlAfterRedirects));
}
```

Ejemplo real: módulo `ventas` (`VentasTabsComponent` + `VentasListadoPage` + `VentasResumenPage`)

### Animación de tabs — `.tab-animate`

Clase global en `global.scss`. Aplica fade + leve subida (8px → 0) al entrar un elemento al DOM.

**Cuándo usarla:** Solo en tabs **state-driven** (contenido controlado con `@if` dentro de una misma página). El `@if` destruye y recrea el DOM al cambiar tab, disparando la animación automáticamente.

```html
@if (tabActivo === 'CELULAR') {
  <div class="tab-animate">
    <!-- contenido del tab -->
  </div>
}
@if (tabActivo === 'BUS') {
  <div class="tab-animate">
    <!-- contenido del tab -->
  </div>
}
```

**Cuándo NO usarla:** Tabs **router-driven** (rutas separadas como `ventas`). Ionic ya aplica su propia animación nativa de transición de página en `ion-router-outlet` — agregar `.tab-animate` duplicaría la animación.

| Tipo de tabs | Animación |
|---|---|
| State-driven (`@if` en misma página) | `.tab-animate` en el div contenedor |
| Router-driven (rutas separadas) | Animación nativa de Ionic — no agregar nada |

Ejemplo real: `recargas-virtuales.page.html`

---

## Patrones Supabase — OBLIGATORIOS

### Todas las queries van por `supabase.call()`
```typescript
// Lectura
const data = await this.supabase.call<Producto[]>(
  this.supabase.client.from('productos').select('*'),
);

// Mutación con toast de éxito
await this.supabase.call(
  this.supabase.client.from('gastos').insert(payload),
  'Gasto registrado correctamente',
  { showLoading: true }
);
```

### Operaciones multi-tabla → siempre función PostgreSQL
```typescript
// ✅ Correcto: todo en una transacción atómica
const resultado = await this.supabase.call<ResultadoCierre>(
  this.supabase.client.rpc('fn_ejecutar_cierre_diario', { p_empleado_id: id, p_efectivo: monto })
);

// ❌ Incorrecto: múltiples .insert() sueltos desde el servicio
```

### Verificar éxito de INSERT/UPDATE
```typescript
// Supabase devuelve data: null en mutaciones sin .select()
// Verificar así:
const result = await this.supabase.call(...);
if (result !== null) { /* éxito — result puede ser [] o null */ }
// O mejor: agregar .select() al final para obtener el registro creado
```

---

## Eficiencia de API — evitar abuso de requests

### Búsquedas: debounce + distinctUntilChanged
Toda búsqueda que dispare queries debe usar `debounceTime(500)` + `distinctUntilChanged()` para no bombardear Supabase:
```typescript
private search$ = new Subject<string>();
private searchSub!: Subscription;

ngOnInit() {
    this.searchSub = this.search$
        .pipe(debounceTime(500), distinctUntilChanged())
        .subscribe(() => this.cargar());
}

ngOnDestroy() { this.searchSub?.unsubscribe(); }
```

### Queries independientes: siempre en paralelo
```typescript
// ✅ Paralelo — 1 round-trip
const [ventas, resumen] = await Promise.all([
    this.servicio.listar(page),
    this.servicio.obtenerResumen(),
]);

// ❌ Secuencial — 2 round-trips innecesarios
const ventas = await this.servicio.listar(page);
const resumen = await this.servicio.obtenerResumen();
```

### Botones de acción: deshabilitar durante operación
Evita double-submit y requests duplicados:
```typescript
guardando = false;

async guardar() {
    if (this.guardando) return;
    this.guardando = true;
    try { /* ... */ } finally { this.guardando = false; }
}
```
```html
<button [disabled]="guardando" (click)="guardar()">Guardar</button>
```

### Datos que no cambian frecuentemente: cache en servicio
`ConfigService` ya implementa este patrón (cache en memoria, `invalidar()` manual).
Usar el mismo patrón si se necesita cache para otros datos de baja frecuencia de cambio.

---

## Funciones PostgreSQL — convenciones

- Nombre con prefijo `fn_`: `fn_ejecutar_cierre_diario`, `fn_registrar_operacion_manual`
- Retornan `JSON` con resultado detallado
- `SECURITY DEFINER` + `SET search_path = public` (obligatorio para evitar caída de permisos)
- `REVOKE EXECUTE ... FROM anon; GRANT EXECUTE ... TO authenticated;` (las funciones financieras nunca se exponen a `anon`)
- Finalizar con `NOTIFY pgrst, 'reload schema';`
- Documentar las funciones en `docs/<modulo>/sql/functions/`
- Templates completos y criterios de decisión en `docs/ESTRUCTURA-PROYECTO.md`

### Asignación de variables en plpgsql — NUNCA `SELECT ... INTO`

En Supabase, **cualquier** `SELECT ... INTO variable` causa el error `relation "variable" does not exist` porque el parser interpreta la variable como una tabla. Esto aplica a todos los casos: columna única, agregados, EXISTS, múltiples variables.

```sql
-- ❌ Rompe en Supabase — parser interpreta v_caja_id como tabla
SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA';

-- ❌ También rompe — mismo bug con agregados
SELECT COUNT(*) + 1 INTO v_numero_turno FROM turnos_caja WHERE ...;

-- ❌ También rompe — mismo bug con EXISTS
SELECT EXISTS (...) INTO v_existe;

-- ❌ También rompe — mismo bug con múltiples variables
SELECT id, nombre INTO v_id, v_nombre FROM cajas WHERE ...;

-- ✅ Correcto — siempre usar := (SELECT ...)
v_caja_id      := (SELECT id FROM cajas WHERE codigo = 'CAJA');
v_numero_turno := (SELECT COUNT(*) + 1 FROM turnos_caja WHERE ...);
v_existe       := EXISTS (SELECT 1 FROM tabla WHERE ...);

-- ✅ Para FOR UPDATE (lock de fila): PERFORM + := separados
PERFORM id FROM cajas WHERE id = v_id FOR UPDATE;
v_saldo := (SELECT saldo_actual FROM cajas WHERE id = v_id);
```

**Regla absoluta:** Usar `:= (SELECT ...)` para toda asignación de variable en plpgsql. `SELECT ... INTO` no funciona en Supabase en ningún caso.

### Cuándo usar cada enfoque

| Caso | Usar | Por qué |
|------|------|---------|
| CRUD de 1 tabla (con JOINs simples) | **Query directa** `supabase.client.from()` | No justifica una función SQL |
| Operación que toca 2+ tablas | **Función RPC** `supabase.rpc()` | Atomicidad transaccional |
| Query compleja (GROUP BY, agregaciones, paginación) | **Función RPC** que retorna `TABLE` | Imposible con el query builder |
| Efecto automático al insertar/modificar fila | **Trigger** | No depende del frontend |

---

## Reglas críticas

### Fechas — NUNCA `toISOString()`
```typescript
// ❌ Da fecha UTC (puede ser el día anterior en América)
new Date().toISOString().split('T')[0]

// ✅ Siempre usar las utilidades de core/utils/date.util.ts:
getFechaLocal()                        // → '2026-03-10'  (fecha local hoy)
getInicioDiaSiguienteISO()             // → ISO del inicio del día siguiente (para .lt() en queries)
getInicioDiaSiguienteDeISO(fechaLocal) // → ISO del día siguiente de una fecha dada

// Rango de fechas — NUNCA T23:59:59 + .lte():
// ❌ Pierde operaciones en el último segundo del día
.lte('fecha', `${hoy}T23:59:59`)

// ✅ Exclusivo del día siguiente:
.lt('fecha', getInicioDiaSiguienteISO())
```

### Imágenes — NUNCA foto a resolución completa
```typescript
// ✅ Siempre con límites (reduce de 5MB a ~300KB)
Camera.getPhoto({ quality: 80, width: 1200, height: 1600, correctOrientation: true });
```

### Configuración — NUNCA hardcodear valores de negocio
Los valores de negocio viven en la tabla `configuraciones` (clave/valor). Leerlos con `ConfigService.get()`, no hardcodearlos.
Convención de claves: prefijo por módulo (`negocio_nombre`, `caja_fondo_fijo_diario`, `bus_alerta_saldo_bajo`, `pos_descuentos_habilitados`, `nomina_sueldo_base`).

---

## Principios de UX del proyecto

- **Mínimo input del usuario**: si el sistema puede calcular algo, lo calcula. El usuario ingresa el mínimo posible.
- **Guías visuales para acciones físicas**: cuando hay que hacer algo con dinero físico (sobres, fondos), mostrar tarjetas visuales explicativas.
- **Wizards multi-paso**: indicador "Paso X de Y" + barra de progreso + paso de resumen antes de confirmar.
- **Campo principal**: clase `.destacado` (border primary + box-shadow).

### FAB central — menú de acciones rápidas (`main-layout`)

El FAB del centro del tab bar abre un menú de opciones tipo cards flotantes (`fab-options` en `main-layout.page.scss`).

**Regla de orden**: la opción con el **nombre más largo va primero** (más arriba). Las cards se ajustan al tamaño de su contenido — la más larga queda más ancha y la más corta más angosta, creando un efecto pirámide visual natural.

```
  ┌──────────────────────┐  ← opción nombre largo (arriba)
  ┌───────────────┐         ← opción nombre corto (abajo)
        [ + ]
```

Cada opción usa `.fab-option` con `.fab-option-icon.<color>` para el círculo del icono. Colores actuales: `secondary` (notas), `tertiary` (cuadre). Al agregar una nueva opción, respetar el orden por longitud de nombre.

---

## Safe area en Android — patrón obligatorio

Todo elemento que tenga **fondo propio y toque el borde inferior de la pantalla** debe compensar la barra de navegación de Android (botones físicos o gesto swipe).

**Regla**: se aplica a `ion-footer`, FABs, tabs y cualquier panel anclado al fondo.

```scss
// Si el elemento ya tiene padding-bottom:
padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));

// Si no tiene padding propio:
padding-bottom: env(safe-area-inset-bottom);
```

`env(safe-area-inset-bottom)` vale `0` en dispositivos sin barra → no rompe el layout.

**Excepción — páginas dentro de tabs:** `ion-tab-bar` ya compensa el safe area internamente. Los footers de páginas que viven dentro de tabs **NO deben sumar** `env(safe-area-inset-bottom)` — se duplica el espacio. Solo usar `padding-bottom` normal. Los elementos `position: fixed` (overlays, scanners) sí lo necesitan porque están fuera del flujo del tab bar.

```scss
// ❌ Footer dentro de tabs — duplica safe area
padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));

// ✅ Footer dentro de tabs — tab bar ya lo maneja
padding-bottom: var(--spacing-md);

// ✅ Elemento position: fixed (overlay/scanner) — sí necesita safe area
bottom: calc(var(--spacing-lg) + env(safe-area-inset-bottom));
```

**Estado actual del proyecto:**

| Elemento | Archivo | Estado |
| -------- | ------- | ------ |
| Footer totalizador ventas | `ventas.page.scss` | ✅ |
| Footer cobro POS | `pos.page.scss` | ✅ |
| Tab bar principal | `main-layout.page.scss` | ✅ |
| Sidebar footer | `sidebar.component.scss` | ✅ |
| FAB global | `global.scss` | ✅ |

---

## Nombres de cajas (UI vs BD) — 5 cajas en v5

| Código BD      | Nombre en UI | Subtítulo       | Rol                                      |
| -------------- | ------------ | --------------- | ---------------------------------------- |
| `CAJA`         | Tienda       | Efectivo        | Vault de depósitos acumulados            |
| `CAJA_CHICA`   | Cajón        | Cajón diario    | Efectivo del día (ventas POS + recargas) |
| `VARIOS`       | Varios       | Fondo emergencia| Ex-CAJA_CHICA. Fondo fijo de gastos.    |
| `CAJA_CELULAR` | Celular      | Saldo digital   | Efectivo recargas celular                |
| `CAJA_BUS`     | Bus          | Saldo digital   | Efectivo recargas bus                    |

> No renombrar los códigos de BD. Solo los labels de UI difieren.
> **v5 (2026-03-06):** `CAJA_CHICA` es ahora el cajón físico diario. `VARIOS` es el fondo de emergencia (antes era `CAJA_CHICA` en BD).

---

## No hacer

- No hardcodear strings de rutas en `navigate()`, `navigateForward()`, `navigateBack()` ni `routerLink` — usar siempre `ROUTES` de `core/config/routes.config.ts`
- No usar `new Date().toISOString()` para fechas locales
- No subir fotos a resolución completa
- No hardcodear valores de negocio en código
- No hacer múltiples INSERT/UPDATE sueltos para operaciones relacionadas → usar función SQL
- No usar constructor para inyección de dependencias → usar `inject()`
- No crear componentes sin `standalone: true`
- No formatear moneda manualmente → usar `CurrencyService`
- No mostrar `console.log` en producción → usar `LoggerService`
- No dejar footers/paneles inferiores sin `env(safe-area-inset-bottom)` → ver sección "Safe area en Android"
- No usar `ActionSheetController`, `PopoverController` ni `ion-select` → usar `OptionsModalComponent` (modo acción o modo selección). `<select>` nativo solo dentro de formularios con `formControlName`
- No dejar botones de acción habilitados durante operaciones async → usar flag `guardando`/`procesando` + `[disabled]`
- No crear subscriptions (`.subscribe()`) sin cleanup en `ngOnDestroy()` → evitar memory leaks
- No usar `console.error()` en servicios → usar `LoggerService.error()` para que quede en los logs del dispositivo

---

## Documentación por módulo

| Módulo              | Doc principal                                              |
| ------------------- | ---------------------------------------------------------- |
| Dashboard           | `docs/dashboard/DASHBOARD-README.md`                       |
| Auth                | `docs/auth/AUTH-README.md`                                 |
| Recargas Virtuales  | `docs/recargas-virtuales/RECARGAS-VIRTUALES-README.md`     |
| Inventario          | `docs/inventario/INVENTARIO-README.md`                     |
| POS                 | `docs/pos/POS-README.md`                                   |
| Ventas              | `docs/ventas/VENTAS-README.md`                             |
| Cuentas por Cobrar  | `docs/cuentas-cobrar/CUENTAS-COBRAR-README.md`             |
| Clientes            | `docs/clientes/CLIENTES-README.md`                         |
| Core/Servicios      | `docs/core/CORE-README.md`                                 |
| Sistema de diseño   | `docs/DESIGN.md`                                           |
| Shared              | `docs/shared/SHARED-README.md`                             |
| Estructura/Patrones | `docs/ESTRUCTURA-PROYECTO.md`                              |
| Schema BD           | `docs/schema.sql`                                          |
| Configuracion       | `docs/configuracion/CONFIGURACION-README.md`               |
| Arquitectura cajas  | `docs/ARQUITECTURA.md`                                     |
| Mov. Empleados      | `docs/movimientos-empleados/PLAN-IMPLEMENTACION.md`        |
| App icon & splash   | `docs/assets/ASSETS-README.md`                             |
