# Estructura del Proyecto

Organización de carpetas, convenciones y **patrón para crear nuevos features**.

*Última actualización: 2026-03-25*

---

## Arquitectura General

Arquitectura **feature-based** con standalone components (Angular 20 + Ionic 8).

```
mi-tienda/
├── src/
│   ├── app/
│   │   ├── core/              # Servicios, guards, utils globales
│   │   ├── features/          # Módulos funcionales (autocontenidos)
│   │   └── shared/            # Componentes y directivas reutilizables
│   ├── assets/
│   ├── environments/
│   │   ├── environment.example.ts   # Plantilla con instrucciones (en git)
│   │   ├── environment.ts           # Credenciales reales (en .gitignore)
│   │   └── environment.prod.ts      # Producción (en .gitignore)
│   ├── global.scss                  # Imports Ionic + dark mode + scanner + options-modal + safe-area FABs
│   └── theme/
│       ├── variables.scss           # Design tokens: spacing, radius, shadows, fonts, opacities, step colors, dark mode
│       └── custom/index.scss        # Entry point de SCSS custom compartidos (overlays, etc.)
├── android/                   # Proyecto nativo (Capacitor)
├── docs/                      # Documentación centralizada
└── capacitor.config.ts
```

---

## `src/app/core/`

```
core/
├── components/
│   └── offline-banner/              # Banner de estado offline
├── config/
│   └── pagination.config.ts         # PAGINATION_CONFIG (pageSize por módulo)
├── guards/
│   ├── auth.guard.ts                # Requiere login
│   ├── public.guard.ts              # Redirige si ya autenticado
│   ├── role.guard.ts                # Requiere rol (ej: ADMIN)
│   └── pending-changes.guard.ts     # Previene salida con cambios sin guardar
├── pages/
│   └── scrollable.page.ts           # Clase base para páginas con scroll
├── services/
│   ├── supabase.service.ts          # Queries y auth centralizados (.call(), .rpc())
│   ├── ui.service.ts                # Loading, toasts, alertas, hideTabs()/showTabs()
│   ├── config.service.ts            # Tabla configuraciones con cache: get(), getNombreNegocio(), invalidar()
│   ├── currency.service.ts          # Formateo de moneda: format(value), parse(value)
│   ├── storage.service.ts           # Captura de fotos (capturarFoto), compresión WebP y upload a Supabase Storage
│   ├── logger.service.ts            # Logs a filesystem con rotación (max 3 archivos)
│   ├── network.service.ts           # Estado de conectividad: isOnline$ (BehaviorSubject)
│   ├── ganancias.service.ts         # Comisiones recargas virtuales (liquidación BUS mensual)
│   └── recargas-virtuales.service.ts # Operaciones de saldo celular/bus
└── utils/
    ├── date.util.ts                 # getFechaLocal(), formatFechaEC(), etc.
    └── cedula.util.ts               # Validación de cédula ecuatoriana
```

---

## `src/app/shared/`

```
shared/
├── components/
│   ├── sidebar/                     # Menú lateral (links a features, user info, logout)
│   ├── options-modal/               # Reemplazo de ion-select y ActionSheet (modo acción + modo selección)
│   ├── options-menu/                # Menú popover con opciones (icon + label). Input: options[], Output: (select)
│   └── under-construction/          # Placeholder para features en desarrollo. Input: title, icon, description, features[]
├── directives/
│   ├── currency-input.directive.ts  # [appCurrencyInput] — auto-formatea moneda en blur, limpia en focus
│   ├── numbers-only.directive.ts    # [appNumbersOnly] — restringe input a números, puntos, comas
│   └── scroll-reset.directive.ts    # [appScrollReset] — resetea scroll de ion-content al cambiar valor (útil en wizards)
└── pages/
    └── paginated-list.page.ts       # Clase base abstracta: items[], loading, hasMore, cargar(), cargarMas(), handleRefresh(), scrollToTop()
```

---

## `src/app/features/`

Cada feature es **autocontenido**: tiene sus propias páginas, servicios, modelos y componentes.

```
features/
├── layout/                    # Navegación principal (tabs + sidebar)
├── auth/                      # Login, OAuth callback
├── caja/                      # Home, operaciones de caja, cierre, cuadre
├── pos/                       # Punto de venta (scanner + carrito)
├── ventas/                    # Historial de ventas
├── inventario/                # Productos, kardex, categorías
├── clientes/                  # Clientes + créditos/fiados (listado, detalle, pagos, compartir)
├── recargas-virtuales/        # Saldo celular/bus, liquidaciones
├── historial-recargas/        # Historial de recargas (página standalone)
├── usuarios/                  # CRUD de empleados (solo ADMIN)
├── movimientos-empleados/     # Cuenta corriente empleados (solo ADMIN)
└── configuracion/             # Parámetros, categorías, logs (solo ADMIN)
```

### Detalle de cada feature

#### auth/
```
auth/
├── auth.routes.ts
├── models/
│   └── usuario-actual.model.ts
├── pages/
│   ├── login/                       # Login con Google OAuth
│   └── callback/                    # Callback de OAuth
└── services/
    └── auth.service.ts
```

#### caja/ (feature más complejo)
```
caja/
├── caja.routes.ts
├── models/
│   ├── categoria-operacion.model.ts
│   ├── operacion-caja.model.ts
│   ├── saldos-anteriores.model.ts
│   └── turno-caja.model.ts
├── pages/
│   ├── home/                        # Caja principal
│   ├── cierre-diario/               # Wizard cierre 2 pasos
│   ├── cuadre-caja/                 # Cuadre y verificación
│   └── operaciones-caja/            # Movimientos por caja (filtros, scroll infinito)
├── components/
│   ├── operacion-modal/             # Modal ingreso/egreso
│   ├── notificaciones-modal/
│   └── verificar-fondo-modal/
└── services/
    ├── cajas.service.ts
    ├── categorias-operaciones.service.ts
    ├── operaciones-caja.service.ts
    ├── recargas.service.ts
    └── turnos-caja.service.ts
```

#### pos/
```
pos/
├── pos.routes.ts
├── models/
│   ├── cart-item.model.ts
│   └── tipo-comprobante.enum.ts
├── pages/
│   └── pos/                         # Pantalla POS (scanner + carrito + cobro)
└── services/
    └── pos.service.ts
```

#### ventas/
```
ventas/
├── ventas.routes.ts
├── models/
│   └── venta.model.ts
├── pages/
│   ├── listado/                     # Lista paginada con filtros
│   └── resumen/                     # Resumen diario (KPIs, métodos, comprobantes)
├── components/
│   ├── ventas-tabs/                 # Tabs internas (Lista / Resumen)
│   └── venta-detalle-modal/         # Modal detalle/ticket de venta
└── services/
    └── ventas.service.ts
```

#### inventario/
```
inventario/
├── inventario.routes.ts
├── models/
│   ├── producto.model.ts
│   ├── categoria-producto.model.ts
│   └── kardex.model.ts
├── pages/
│   ├── main/                        # Lista de productos (paginado + filtros)
│   ├── producto-form/               # Crear/editar producto
│   └── kardex/                      # Historial de movimientos de stock
└── services/
    └── inventario.service.ts
```

#### clientes/
```
clientes/
├── clientes.routes.ts                  # Rutas: '' | ':clienteId'
├── models/
│   ├── cliente.model.ts
│   └── cuenta-cobrar.model.ts          # Interfaces de créditos y pagos
├── pages/
│   ├── listado/                        # Listado unificado (clientes + saldo de deuda)
│   └── detalle/                        # Detalle de cuenta + abonos por cliente
├── components/
│   ├── seleccionar-cliente-modal/      # Modal selector/creación (usado por POS y listado)
│   ├── editar-cliente-modal/           # Modal edición de cliente
│   └── pago-fiado-modal/              # Modal para registrar abono
└── services/
    ├── clientes.service.ts             # CRUD completo + listado paginado
    ├── cuentas-cobrar.service.ts       # Queries de deuda + registro de pagos
    └── share-estado-cuenta.service.ts  # Generar/compartir comprobantes
```

#### recargas-virtuales/
```
recargas-virtuales/
├── pages/
│   ├── recargas-virtuales/          # Panel principal (tabs CELULAR/BUS)
│   └── pagar-deudas/                # Wizard de pago deudas CELULAR
└── components/
    ├── registrar-recarga-modal/
    ├── pagar-deudas-modal/
    ├── liquidacion-bus-modal/
    └── historial-modal/
```

#### usuarios/
```
usuarios/
├── usuarios.routes.ts
├── models/
│   └── usuario.model.ts
├── pages/
│   └── list/                        # Lista de empleados
├── components/
│   ├── registrar-usuario-modal/
│   └── editar-usuario-modal/
└── services/
    └── usuario.service.ts
```

#### configuracion/
```
configuracion/
├── configuracion.routes.ts
├── models/
│   └── configuracion.model.ts
├── pages/
│   ├── main/                        # Menú principal de configuración
│   ├── parametros/                  # Parámetros del negocio
│   └── categorias-operaciones/      # CRUD categorías ingreso/egreso
├── components/
│   ├── categoria-operacion-modal/
│   └── logs-modal/
└── services/
    └── configuracion.service.ts
```

#### movimientos-empleados/
```
movimientos-empleados/
├── movimientos-empleados.routes.ts
├── models/
│   └── movimiento-empleado.model.ts
├── pages/
│   ├── lista/                         # Lista empleados con saldo
│   └── detalle/                       # Historial + acciones por empleado
├── components/
│   ├── adelanto-modal/                # Fullscreen con instrucciones fisicas
│   └── pagar-nomina-modal/            # Wizard 3 pasos con preview descuentos
└── services/
    └── movimientos-empleados.service.ts  # Queries + RPCs (adelanto, nomina)
```

---

## Convenciones de Nombres

| Tipo        | Patrón                  | Ejemplo                    |
| ----------- | ----------------------- | -------------------------- |
| Página      | `{nombre}.page.ts`      | `ventas.page.ts`           |
| Componente  | `{nombre}.component.ts` | `sidebar.component.ts`     |
| Modal       | `{nombre}-modal.component.ts` | `pago-fiado-modal.component.ts` |
| Servicio    | `{nombre}.service.ts`   | `cuentas-cobrar.service.ts`|
| Modelo      | `{nombre}.model.ts`     | `cuenta-cobrar.model.ts`   |
| Enum        | `{nombre}.enum.ts`      | `tipo-comprobante.enum.ts` |
| Rutas       | `{feature}.routes.ts`   | `cuentas-cobrar.routes.ts` |
| Guard       | `{nombre}.guard.ts`     | `role.guard.ts`            |
| Directiva   | `{nombre}.directive.ts` | `currency-input.directive.ts` |
| Utilidad    | `{nombre}.util.ts`      | `date.util.ts`             |

---

## Dónde Colocar Nuevos Archivos

| Quiero agregar...                    | Ubicación                            |
| ------------------------------------ | ------------------------------------ |
| Nueva feature completa               | `features/{nombre}/`                 |
| Página de una feature existente      | `features/{feature}/pages/{nombre}/` |
| Modal exclusivo de una feature       | `features/{feature}/components/{nombre}-modal/` |
| Servicio de una feature              | `features/{feature}/services/`       |
| Modelo/interface de una feature      | `features/{feature}/models/`         |
| Componente reutilizable              | `shared/components/`                 |
| Directiva reutilizable               | `shared/directives/`                 |
| Guard de rutas                       | `core/guards/`                       |
| Servicio global                      | `core/services/`                     |
| Constante de configuración           | `core/config/`                       |
| Función utilitaria                   | `core/utils/`                        |
| CRUD de catálogo admin               | `features/configuracion/pages/`      |
| Documentación de feature             | `docs/{feature}/`                    |
| Función SQL documentada              | `docs/{feature}/sql/functions/`      |

---

## Templates HTML — Patrones de UI

### Página con lista paginada (template completo)

```html
<ion-header class="ion-no-border">
  <ion-toolbar>
    <ion-buttons slot="start">
      <ion-menu-button></ion-menu-button>
    </ion-buttons>
    <ion-title>Mi Feature</ion-title>
  </ion-toolbar>
</ion-header>

<ion-content #content [scrollEvents]="true" (ionScroll)="onContentScroll($event)">

  <!-- Pull to refresh -->
  <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
    <ion-refresher-content pullingIcon="chevron-down-circle-outline"
      refreshingSpinner="crescent" refreshingText="Cargando...">
    </ion-refresher-content>
  </ion-refresher>

  <!-- Skeleton Loading -->
  @if (loading) {
  <div class="p-sm">
    <ion-list lines="none">
      @for (i of [1, 2, 3, 4, 5]; track i) {
      <ion-item detail="false">
        <ion-label>
          <ion-skeleton-text animated style="width: 60%; height: 16px; border-radius: 4px;"></ion-skeleton-text>
          <div style="margin-top: 6px;">
            <ion-skeleton-text animated style="width: 40%; height: 13px; border-radius: 4px;"></ion-skeleton-text>
          </div>
        </ion-label>
      </ion-item>
      }
    </ion-list>
  </div>
  }

  <!-- Empty state -->
  @else if (items.length === 0) {
  <div class="empty-state">
    <ion-icon name="mi-icono-outline" class="empty-icon"></ion-icon>
    <p class="empty-title">Sin registros</p>
    <p class="empty-hint">Descripción contextual del estado vacío</p>
  </div>
  }

  <!-- Lista de items -->
  @else {
  <div class="p-sm">
    <ion-list lines="none">
      @for (item of items; track item.id) {
      <ion-item button (click)="abrirDetalle(item)" detail="false">
        <ion-label>
          <h3>{{ item.nombre }}</h3>
          <p>{{ item.descripcion }}</p>
        </ion-label>
        <div slot="end">
          <span>${{ currencyService.format(item.monto) }}</span>
        </div>
      </ion-item>
      }
    </ion-list>
  </div>
  }

  <!-- Infinite scroll -->
  <ion-infinite-scroll [disabled]="!hasMore" (ionInfinite)="cargarMas($event)">
    <ion-infinite-scroll-content loadingSpinner="crescent"
      [loadingText]="loadingMoreText">
    </ion-infinite-scroll-content>
  </ion-infinite-scroll>

  <!-- FAB scroll to top -->
  @if (showScrollTop) {
  <ion-fab vertical="bottom" horizontal="end" slot="fixed" class="scroll-top-fab">
    <ion-fab-button size="small" color="primary" (click)="scrollToTop()">
      <ion-icon name="arrow-up-outline"></ion-icon>
    </ion-fab-button>
  </ion-fab>
  }
</ion-content>

<!-- Footer totalizador (opcional) -->
@if (!loading && items.length > 0) {
<ion-footer class="ion-no-border">
  <div class="footer-content">
    <span class="footer-label">{{ items.length }} registros</span>
    <span class="footer-amount">${{ currencyService.format(total) }}</span>
  </div>
</ion-footer>
}
```

### Página de detalle (con back button)

```html
<ion-header class="ion-no-border">
  <ion-toolbar>
    <ion-buttons slot="start">
      <ion-back-button defaultHref="/mi-feature"></ion-back-button>
    </ion-buttons>
    <ion-title>Detalle</ion-title>
    <!-- Acciones opcionales en el header -->
    <ion-buttons slot="end">
      <ion-button (click)="accion()">
        <ion-icon slot="icon-only" name="share-outline"></ion-icon>
      </ion-button>
    </ion-buttons>
  </ion-toolbar>
</ion-header>

<ion-content>
  <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
    <ion-refresher-content pullingIcon="chevron-down-circle-outline"
      refreshingSpinner="crescent">
    </ion-refresher-content>
  </ion-refresher>

  @if (loading) {
    <!-- Skeleton del detalle -->
  } @else if (!entidad) {
    <!-- Not found state -->
  } @else {
    <!-- Contenido del detalle -->
  }
</ion-content>
```

### Modal fullscreen (con scroll)

Los modales con scroll interno **NO** deben usar `breakpoints`. Abren fullscreen en Android por defecto.

```html
<!-- Header con botón cerrar a la IZQUIERDA (slot="start") -->
<ion-header class="ion-no-border">
  <ion-toolbar>
    <ion-buttons slot="start">
      <ion-button (click)="cerrar()">
        <ion-icon slot="icon-only" name="close-outline"></ion-icon>
      </ion-button>
    </ion-buttons>
    <ion-title>Título del Modal</ion-title>
  </ion-toolbar>
</ion-header>

<ion-content class="ion-padding">
  <!-- Contenido con scroll libre -->
</ion-content>

<!-- Footer con acción principal -->
<ion-footer class="ion-no-border">
  <div class="modal-footer">
    <button class="btn-confirmar" [disabled]="!formValido || guardando" (click)="guardar()">
      <ion-icon name="checkmark-outline"></ion-icon>
      Confirmar
    </button>
  </div>
</ion-footer>
```

**En TypeScript — sin breakpoints:**
```typescript
const modal = await this.modalCtrl.create({
    component: MiModalComponent,
    componentProps: { dato: valor }
    // SIN breakpoints, SIN initialBreakpoint
});
```

### Modal bottom sheet (sin scroll — listas cortas de acciones)

Solo para modales con contenido corto que no necesita scroll (ej: `OptionsModalComponent`).

```typescript
const modal = await this.modalCtrl.create({
    component: OptionsModalComponent,
    componentProps: { title, groups },
    cssClass: 'options-modal',
    breakpoints: [0, 1],      // SÍ — permite swipe-to-dismiss
    initialBreakpoint: 1       // SÍ — abre al 100%
});
```

### Notas clave de UI

- **`ion-no-border`** en todos los `<ion-header>` y `<ion-footer>`
- **Skeleton**: 5 items placeholder con `ion-skeleton-text animated`
- **Empty state**: icono grande + título + hint
- **Pull-to-refresh**: siempre con `silencioso=true` para no duplicar spinner
- **Botón cerrar modales**: `slot="start"` (izquierda) con `close-outline`
- **Moneda**: siempre `${{ currencyService.format(monto) }}`, nunca manual
- **Control flow**: `@if`, `@else if`, `@else`, `@for` — nueva sintaxis Angular

---

## Patrón para Crear un Nuevo Feature

### Estructura de carpetas

```
features/{mi-feature}/
├── {mi-feature}.routes.ts           # OBLIGATORIO
├── models/
│   └── {mi-feature}.model.ts        # Interfaces, types, DTOs
├── pages/
│   └── main/                        # Página principal
│       ├── {mi-feature}.page.ts
│       ├── {mi-feature}.page.html
│       └── {mi-feature}.page.scss
├── services/
│   └── {mi-feature}.service.ts      # Queries Supabase
└── components/                      # Solo si hay modales u otros componentes
    └── {nombre}-modal/
        ├── {nombre}-modal.component.ts
        ├── {nombre}-modal.component.html
        └── {nombre}-modal.component.scss
```

### 1. Archivo de rutas (`{feature}.routes.ts`)

```typescript
import { Routes } from '@angular/router';

export const MI_FEATURE_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./pages/main/mi-feature.page').then(m => m.MiFeaturePage)
    },
    // Página de detalle con parámetro:
    // {
    //     path: ':id',
    //     loadComponent: () =>
    //         import('./pages/detalle/detalle.page').then(m => m.DetallePage)
    // }
];
```

### 2. Modelo (`models/{feature}.model.ts`)

```typescript
// ──────────────────────────────────────────────
// Modelo: MiEntidad
// ──────────────────────────────────────────────

// Tipos literales para columnas con valores fijos
export type EstadoType = 'ACTIVO' | 'INACTIVO';

// Interface principal (refleja la tabla de BD)
export interface MiEntidad {
    id: string;
    nombre: string;
    estado: EstadoType;
    monto: number;
    fecha: string;
    // JOINs opcionales
    categoria_nombre?: string;
}

// DTO para crear (solo campos que envía el frontend)
export interface CrearMiEntidadDto {
    nombre: string;
    monto: number;
}

// Resumen para la página principal
export interface MiEntidadResumen {
    total_registros: number;
    total_monto: number;
}
```

### 3. Servicio (`services/{feature}.service.ts`)

```typescript
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { MiEntidad, CrearMiEntidadDto, MiEntidadResumen } from '../models/mi-feature.model';

@Injectable({ providedIn: 'root' })
export class MiFeatureService {

    private supabase = inject(SupabaseService);

    /** Lista paginada */
    async listar(page: number, pageSize: number, busqueda?: string): Promise<MiEntidad[]> {
        const from = page * pageSize;
        let query = this.supabase.client
            .from('mi_tabla')
            .select('id, nombre, estado, monto, fecha')
            .order('fecha', { ascending: false })
            .range(from, from + pageSize - 1);

        if (busqueda) {
            query = query.ilike('nombre', `%${busqueda}%`);
        }

        return this.supabase.call<MiEntidad[]>(query);
    }

    /** Obtener uno por ID */
    async obtenerPorId(id: string): Promise<MiEntidad | null> {
        return this.supabase.call<MiEntidad | null>(
            this.supabase.client
                .from('mi_tabla')
                .select('*')
                .eq('id', id)
                .maybeSingle()
        );
    }

    /** Crear — operación simple */
    async crear(dto: CrearMiEntidadDto): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('mi_tabla').insert(dto),
            'Registro creado correctamente'
        );
    }

    /** Operación multi-tabla → siempre función SQL */
    async operacionCompleja(params: any): Promise<any> {
        return this.supabase.call(
            this.supabase.client.rpc('fn_mi_operacion', params),
            'Operación completada'
        );
    }
}
```

### 4. Página principal (`pages/main/{feature}.page.ts`)

**Página simple (sin paginación):**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonBackButton, IonIcon,
    IonRefresher, IonRefresherContent,
    IonSkeletonText,
    ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { MiFeatureService } from '../../services/mi-feature.service';
import { MiEntidad } from '../../models/mi-feature.model';
import { UiService } from '@core/services/ui.service';

@Component({
    selector: 'app-mi-feature',
    templateUrl: './mi-feature.page.html',
    styleUrls: ['./mi-feature.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonHeader, IonTitle, IonToolbar,
        IonButtons, IonBackButton, IonIcon,
        IonRefresher, IonRefresherContent,
        IonSkeletonText,
    ]
})
export class MiFeaturePage implements OnInit, ViewWillEnter {

    private servicio = inject(MiFeatureService);
    private ui = inject(UiService);

    items: MiEntidad[] = [];
    loading = true;

    constructor() {
        addIcons({ addOutline });
    }

    async ngOnInit() {
        await this.cargarDatos();
    }

    ionViewWillEnter() {
        if (this.items.length) this.cargarDatos(true);
    }

    async cargarDatos(silencioso = false) {
        if (!silencioso) this.loading = true;
        try {
            this.items = await this.servicio.listar(0, 50);
        } catch {
            this.ui.showToast('Error al cargar datos', 'danger');
        } finally {
            this.loading = false;
        }
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargarDatos(true);
        (event.target as HTMLIonRefresherElement).complete();
    }
}
```

**Página con paginación (extends `PaginatedListPage`):**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonMenuButton, IonIcon,
    IonRefresher, IonRefresherContent,
    IonList, IonItem, IonLabel,
    IonSkeletonText,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowUpOutline } from 'ionicons/icons';
import { MiFeatureService } from '../../services/mi-feature.service';
import { MiEntidad } from '../../models/mi-feature.model';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';

@Component({
    selector: 'app-mi-feature',
    templateUrl: './mi-feature.page.html',
    styleUrls: ['./mi-feature.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonHeader, IonTitle, IonToolbar,
        IonButtons, IonMenuButton, IonIcon,
        IonRefresher, IonRefresherContent,
        IonList, IonItem, IonLabel,
        IonSkeletonText,
        IonInfiniteScroll, IonInfiniteScrollContent,
        IonFab, IonFabButton
    ]
})
export class MiFeaturePage extends PaginatedListPage<MiEntidad> implements OnInit, ViewWillEnter {

    private servicio = inject(MiFeatureService);

    protected readonly pageSize = PAGINATION_CONFIG.miFeature.pageSize;
    readonly loadingMoreText = 'Cargando más registros...';

    constructor() {
        super();
        addIcons({ arrowUpOutline });
    }

    protected async fetchPage(page: number): Promise<MiEntidad[]> {
        return this.servicio.listar(page, this.pageSize);
    }

    async ngOnInit() {
        await this.cargar();
    }

    ionViewWillEnter() {
        if (this.items.length) this.cargar(true);
    }
}
```

### 5. Modal (`components/{nombre}-modal/{nombre}-modal.component.ts`)

```typescript
import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonButton, IonIcon,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, checkmarkOutline } from 'ionicons/icons';

@Component({
    selector: 'app-mi-modal',
    templateUrl: './mi-modal.component.html',
    styleUrls: ['./mi-modal.component.scss'],
    standalone: true,
    imports: [
        CommonModule, FormsModule,
        IonHeader, IonToolbar, IonTitle, IonContent,
        IonButtons, IonButton, IonIcon,
    ]
})
export class MiModalComponent {

    @Input() dato!: string;

    private modalCtrl = inject(ModalController);

    constructor() {
        addIcons({ closeOutline, checkmarkOutline });
    }

    cerrar() {
        this.modalCtrl.dismiss(null);
    }

    confirmar() {
        this.modalCtrl.dismiss({ resultado: 'ok' });
    }
}
```

---

## Checklist: Agregar un Nuevo Feature

### Crear archivos

- [ ] Carpeta `features/{nombre}/`
- [ ] `{nombre}.routes.ts` con lazy loading de páginas
- [ ] `models/{nombre}.model.ts` con interfaces y DTOs
- [ ] `services/{nombre}.service.ts` con queries Supabase
- [ ] `pages/main/` con `.page.ts`, `.page.html`, `.page.scss`
- [ ] `components/` solo si hay modales o sub-componentes

### Integrar al proyecto

- [ ] Registrar rutas en `features/layout/layout.routes.ts` (con `loadChildren`)
- [ ] Si requiere rol: agregar `canActivate: [roleGuard(['ADMIN'])]`
- [ ] Si es tab: agregar entrada en `main-layout.page.html`
- [ ] Si es sidebar: agregar link en `shared/components/sidebar/sidebar.component.html`
- [ ] Si tiene paginación: agregar `pageSize` en `core/config/pagination.config.ts`

### Verificar

- [ ] Todos los componentes son `standalone: true`
- [ ] Inyección con `inject()`, no en constructor
- [ ] Iconos registrados en `addIcons()` del constructor
- [ ] `IonIcon` en `imports[]` si el template usa `<ion-icon>`
- [ ] Footers con `env(safe-area-inset-bottom)`
- [ ] Pull-to-refresh con patrón `silencioso` (sin doble spinner)
- [ ] Moneda formateada con `CurrencyService`, no manual
- [ ] Fechas con `date.util.ts`, nunca `toISOString()`

### Documentar

- [ ] Crear `docs/{nombre}/{NOMBRE}-README.md` si el feature es complejo
- [ ] Documentar funciones SQL en `docs/{nombre}/sql/functions/`
- [ ] Actualizar `CLAUDE.md` (tabla de módulos)

---

## Templates SQL — Funciones y Triggers PostgreSQL

### Dónde documentar

```
docs/{modulo}/sql/
├── functions/               # Funciones RPC llamadas desde el frontend
│   └── fn_{nombre}.sql
├── triggers/                # Triggers automáticos (AFTER INSERT/UPDATE/DELETE)
│   └── trg_{nombre}.sql
├── migrations/              # Migraciones de esquema (ALTER TABLE, nuevas columnas)
│   └── {descripcion}.sql
└── queries/                 # Queries de datos iniciales o correcciones
    └── {descripcion}.sql
```

### Template: Función RPC (`fn_{nombre}.sql`)

Funciones llamadas desde el frontend con `supabase.rpc('fn_nombre', params)`.
Se usan para operaciones multi-tabla que deben ser atómicas.

```sql
-- ==========================================
-- fn_{nombre}
-- ==========================================
-- Descripción breve de qué hace.
--
-- Flujo:
--   1. Valida entrada
--   2. Operación principal
--   3. Efectos secundarios (actualizar saldos, etc.)
--
-- Retorna JSON: { success: true, dato: valor }
-- ==========================================

CREATE OR REPLACE FUNCTION fn_{nombre}(
    p_param1    UUID,
    p_param2    DECIMAL(12,2),
    p_opcional  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_variable    RECORD;
    v_empleado_id UUID;
BEGIN
    -- 0. Bloquear superadmin en funciones de mutacion
    PERFORM public.fn_assert_no_superadmin();

    -- 1. Validaciones

    -- 1. Validaciones
    -- ...

    -- 2. Operación principal
    -- ...

    -- 3. Retorno
    RETURN json_build_object('success', true);
END;
$$;

-- Permisos: solo usuarios autenticados
REVOKE EXECUTE ON FUNCTION fn_{nombre}(UUID, DECIMAL, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_{nombre}(UUID, DECIMAL, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

**Reglas obligatorias:**
- `SECURITY DEFINER` + `SET search_path = public` — evita caída de permisos
- `REVOKE ... FROM anon` — funciones financieras nunca expuestas a anónimos
- `NOTIFY pgrst` — refresca cache de PostgREST para que la función sea invocable
- `FOR UPDATE` en SELECTs que preceden UPDATEs — evita condiciones de carrera
- Validar con `RAISE EXCEPTION` antes de modificar datos
- Retornar `JSON` con resultado (el frontend lo recibe vía `supabase.rpc()`)

### Template: Trigger (`trg_{nombre}.sql`)

Triggers se ejecutan automáticamente por PostgreSQL. NO se llaman desde el frontend.

```sql
-- ==========================================
-- TRIGGER FUNCTION: fn_{accion}_{tabla}
-- ==========================================
-- Se dispara automáticamente AFTER INSERT en {tabla}.
-- Por cada fila:
--   1. Acción automática
--   2. Registro de auditoría
--
-- ⚠️  NO ejecutar manualmente. El trigger lo invoca PostgreSQL.
-- ⚠️  No borrar sin borrar también el trigger trg_{nombre}.
-- ==========================================
-- Usado por: trg_{nombre} (ON {tabla} AFTER INSERT)
-- ==========================================

CREATE OR REPLACE FUNCTION fn_{accion}_{tabla}()
RETURNS TRIGGER AS $$
DECLARE
    v_variable DECIMAL(12,2);
BEGIN
    -- Lógica del trigger
    -- NEW = fila insertada/actualizada
    -- OLD = fila anterior (solo en UPDATE/DELETE)

    RETURN NEW;  -- AFTER trigger: retorno ignorado pero obligatorio
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger
CREATE TRIGGER trg_{nombre}
    AFTER INSERT ON {tabla}
    FOR EACH ROW
    EXECUTE FUNCTION fn_{accion}_{tabla}();
```

**Reglas de triggers:**
- Nombre del trigger: `trg_{accion}_{tabla}` (ej: `trg_descontar_stock_venta`)
- Nombre de la función: `fn_{accion}_{tabla}` (ej: `fn_actualizar_stock_venta`)
- Siempre `FOR EACH ROW` (no `FOR EACH STATEMENT`)
- Documentar en header qué trigger usa esta función
- No necesitan `SECURITY DEFINER` ni `GRANT` (se ejecutan con permisos del owner de la tabla)
- No necesitan `NOTIFY pgrst` (no son invocables vía API)

### Cuándo usar query directa vs función RPC vs trigger

#### Query directa (`supabase.client.from().select()`)

Usar cuando **todo se resuelve en una sola tabla** (con JOINs simples de FK):

```typescript
// ✅ Query directa — lectura de 1 tabla + JOINs por FK
const data = await this.supabase.call<Venta[]>(
    this.supabase.client
        .from('ventas')
        .select('id, total, empleado:empleado_id(nombre)')
        .eq('cliente_id', clienteId)
);

// ✅ Query directa — INSERT/UPDATE de 1 sola tabla
await this.supabase.call(
    this.supabase.client.from('configuraciones').update(dto).eq('id', id)
);
```

**Criterio:** si solo tocas 1 tabla y no necesitas lógica condicional del lado del servidor, query directa es suficiente. No crear una función SQL para algo que el query builder de Supabase puede hacer.

#### Función RPC (`supabase.rpc('fn_nombre', params)`)

Usar cuando se cumple **al menos uno** de estos criterios:

| Criterio | Ejemplo real |
|----------|-------------|
| **Toca 2+ tablas** en una transacción atómica | `fn_registrar_pago_fiado` — inserta en `cuentas_cobrar`, actualiza `ventas`, inserta en `operaciones_cajas`, actualiza `cajas` |
| **Lógica condicional** que depende de datos del servidor | `fn_registrar_venta_pos` — si metodo_pago=FIADO no ingresa a caja, si es EFECTIVO sí |
| **Query compleja** imposible con el query builder | `fn_listar_cuentas_cobrar` — GROUP BY + SUM + COUNT + paginación + búsqueda |
| **Validaciones de negocio** que no pueden estar solo en el frontend | `fn_ejecutar_cierre_diario_v5` — valida saldos, transferencias, turnos |
| **Necesita `FOR UPDATE`** (lock de filas para evitar concurrencia) | `fn_registrar_pago_fiado` — lock en la venta para evitar pagos dobles |

```typescript
// ✅ Función RPC — operación multi-tabla
const resultado = await this.supabase.call(
    this.supabase.client.rpc('fn_registrar_pago_fiado', {
        p_venta_id: ventaId,
        p_monto: monto,
    })
);
```

#### Trigger

Usar cuando un efecto **debe ocurrir siempre** al insertar/modificar una fila, sin importar quién o qué lo haga:

| Criterio | Ejemplo real |
|----------|-------------|
| **Efecto automático** que no debe depender del frontend | `trg_descontar_stock_venta` — al insertar en `ventas_detalles`, descuenta stock y graba kardex |
| **Auditoría automática** | Registrar en kardex cada movimiento de stock |
| **Generar valores automáticos** | `trg_set_codigo_categoria_operacion` — auto-genera código al insertar |

```sql
-- El trigger se ejecuta solo, NO se llama desde el frontend
CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_stock_venta();
```

#### Resumen de decisión

```
¿Toca solo 1 tabla sin lógica condicional?
  └─ SÍ → Query directa (supabase.client.from())
  └─ NO → ¿Debe ocurrir automáticamente sin importar quién inserte?
            └─ SÍ → Trigger
            └─ NO → Función RPC (supabase.rpc())
```

---

## Patrones de Arquitectura

- **Feature-based**: cada módulo es autocontenido con sus propios pages/services/models/components
- **Lazy loading**: features se cargan bajo demanda vía `loadChildren`/`loadComponent`
- **Services singleton**: en `core/services/` → `providedIn: 'root'`
- **Services scoped**: en `features/{feature}/services/` → también `providedIn: 'root'` (Ionic los necesita para modales)
- **Operaciones multi-tabla**: siempre función SQL (`supabase.rpc()`)
- **Listas paginadas**: extender `PaginatedListPage<T>` + `PAGINATION_CONFIG`
- **Selects y action sheets**: usar `OptionsModalComponent` (nunca `ion-select` ni `ActionSheetController`)
