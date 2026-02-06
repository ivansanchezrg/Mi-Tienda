# Operaciones de Caja

Módulo para visualizar el historial de movimientos de cada caja del sistema.

## Descripción General

La página de operaciones de caja permite:
- Ver el historial de movimientos de una caja específica
- Filtrar por período (Hoy, Semana, Mes, Todo)
- Ver el saldo disponible y resumen de entradas/salidas
- Scroll infinito para cargar más registros
- Diseño híbrido (Home pattern + estilo empresarial/bancario)

## Ubicación de Archivos

```
dashboard/
├── pages/
│   └── operaciones-caja/
│       ├── operaciones-caja.page.ts
│       ├── operaciones-caja.page.html
│       └── operaciones-caja.page.scss
├── services/
│   ├── operaciones-caja.service.ts
│   └── cajas.service.ts
└── models/
    └── operacion-caja.model.ts
```

## Estructura de la Página

### 1. Header con Saldo Dinámico

```html
<ion-header>
  <ion-toolbar>
    <ion-title>{{ cajaNombre }}</ion-title>
    <!-- Saldo aparece al hacer scroll (>150px) -->
    @if (showHeaderBalance) {
      <span class="header-balance">${{ cajaSaldo }}</span>
    }
  </ion-toolbar>
</ion-header>
```

**Comportamiento:**
- Al hacer scroll, cuando el balance-card desaparece (~150px), el saldo aparece en el header
- Utiliza `[scrollEvents]="true"` y `(ionScroll)="onScroll($event)"`

### 2. Balance Card

Tarjeta principal con:
- **Saldo disponible** - Monto principal centrado, color primary
- **Resumen de período** - Entradas (verde) y Salidas (rojo)
- **Fondo sutil** - `rgba(var(--ion-color-primary-rgb), 0.06)`

### 3. Barra de Filtros (Sticky)

```html
<div class="filter-bar">
  <span class="filter-label">Movimientos</span>
  <div class="filter-tabs">
    @for (f of ['hoy', 'semana', 'mes', 'todas']; track f) {
      <button class="filter-tab" [class.active]="filtro === f">
        {{ f | titlecase }}
      </button>
    }
  </div>
</div>
```

**Características:**
- `position: sticky` - Se mantiene fijo al hacer scroll
- Estilo bancario con botones tipo tabs
- Tab activo: fondo oscuro (#334155), texto blanco

### 4. Lista de Operaciones

Agrupadas por fecha con:
- **Header de fecha** - "Hoy", "Ayer", o fecha completa
- **Totales del día** - +$X.XX (verde) / -$X.XX (rojo)
- **Cards de operaciones** - border-radius 20px (patrón Home)

### 5. Item de Operación

```
┌─────────────────────────────────────────────┐
│ 🔽  Ingreso                      +$500.00   │
│     Venta de productos                      │
│     10:30 · Juan · Saldo: $1,500.00         │
├─────────────────────────────────────────────┤
│ 🔼  Egreso                       -$200.00   │
│     Compra de insumos                       │
│     11:15 · Ana · Saldo: $1,300.00          │
└─────────────────────────────────────────────┘
```

**Elementos:**
- **Icono** - Con fondo semitransparente del color correspondiente
- **Título** - Tipo de operación
- **Monto** - Centrado verticalmente, color según tipo
- **Descripción** - Opcional, texto secundario
- **Footer** - Hora, empleado, saldo después de operación
- **Divider** - Línea horizontal entre registros

## Modelo de Datos

### `operacion-caja.model.ts`

```typescript
export interface OperacionCaja {
  id: number;
  caja_id: number;
  tipo_operacion: TipoOperacion;
  monto: number;
  descripcion?: string;
  fecha: string;
  saldo_actual: number | null;
  empleado?: {
    id: number;
    nombre: string;
  };
}

export type TipoOperacion =
  | 'INGRESO'
  | 'EGRESO'
  | 'TRANSFERENCIA_ENTRANTE'
  | 'TRANSFERENCIA_SALIENTE'
  | 'APERTURA'
  | 'CIERRE'
  | 'AJUSTE';

export type FiltroFecha = 'hoy' | 'semana' | 'mes' | 'todas';

export interface ResultadoOperaciones {
  operaciones: OperacionCaja[];
  total: number;
  hasMore: boolean;
}
```

## Servicios

### `operaciones-caja.service.ts`

```typescript
async obtenerOperacionesCaja(
  cajaId: number,
  filtro: FiltroFecha,
  page: number = 0
): Promise<ResultadoOperaciones>
```

**Filtros implementados:**
| Filtro | Rango |
|--------|-------|
| `hoy` | Desde las 00:00 de hoy |
| `semana` | Últimos 7 días |
| `mes` | Últimos 30 días |
| `todas` | Sin filtro de fecha |

**Paginación:**
- 20 registros por página
- Ordenados por fecha descendente (más recientes primero)

### `cajas.service.ts`

```typescript
async obtenerCajas(): Promise<Caja[]>
```

Se usa para obtener el saldo actual de la caja.

## Estilos y Diseño

### Patrón Híbrido

Combina dos enfoques de diseño:

**Del patrón Home:**
- Cards con `border-radius: 20px`
- Box-shadow suave `0 4px 20px rgba(0, 0, 0, 0.05)`
- Variables CSS de Ionic para dark/light mode
- Tipografía limpia

**Toque empresarial/bancario:**
- Balance card prominente con saldo centrado
- Filtros estilo tabs bancarios
- Información compacta y profesional
- Header sticky con saldo dinámico

### Colores por Tipo de Operación

| Tipo | Color | Uso |
|------|-------|-----|
| INGRESO | `success` (verde) | Entradas de dinero |
| EGRESO | `danger` (rojo) | Salidas de dinero |
| TRANSFERENCIA_ENTRANTE | `success` | Recibido de otra caja |
| TRANSFERENCIA_SALIENTE | `danger` | Enviado a otra caja |
| APERTURA | `primary` | Apertura de caja |
| CIERRE | `medium` | Cierre de caja |
| AJUSTE | `warning` | Ajustes manuales |

### Compatibilidad Dark/Light Mode

Todos los estilos usan variables CSS de Ionic:
- `--ion-color-primary`
- `--ion-color-success`
- `--ion-color-danger`
- `--ion-text-color`
- `--ion-background-color`
- `--ion-color-step-*`

## Flujo de Navegación

```
HomePage
    │
    ├── Click en tarjeta de caja
    │         │
    │         ▼
    │   OperacionesCajaPage
    │   (con state: { cajaId, cajaNombre })
    │         │
    │         ├── Cambiar filtro → Recargar operaciones
    │         ├── Scroll → Cargar más (infinite scroll)
    │         └── Botón volver → HomePage
    │
```

### Pasar datos via Navigation State

```typescript
// Desde HomePage
this.router.navigate(['/home/operaciones-caja'], {
  state: {
    cajaId: caja.id,
    cajaNombre: caja.nombre
  }
});

// En OperacionesCajaPage (constructor)
const navigation = this.router.getCurrentNavigation();
if (navigation?.extras?.state) {
  this.cajaId = navigation.extras.state['cajaId'];
  this.cajaNombre = navigation.extras.state['cajaNombre'];
}
```

## Lifecycle Hooks

```typescript
// Ocultar tabs al entrar
ionViewWillEnter() {
  this.ui.hideTabs();
  await this.cargarSaldoCaja();
  await this.cargarOperaciones(true);
}

// Mostrar tabs al salir
ionViewWillLeave() {
  this.ui.showTabs();
}
```

## Agrupación por Fecha

Las operaciones se agrupan por día para mejor visualización:

```typescript
interface OperacionAgrupada {
  fecha: string;           // '2026-02-04'
  fechaDisplay: string;    // 'Hoy', 'Ayer', 'lunes, 3 feb'
  operaciones: OperacionCaja[];
  totalIngresos: number;
  totalEgresos: number;
}
```

**Formato de fecha:**
- Hoy → "Hoy"
- Ayer → "Ayer"
- Otros → "lunes, 3 feb" (capitalizado)

## Mejoras Futuras

- [ ] Búsqueda por descripción
- [ ] Exportar a PDF/Excel (en desktop)
- [ ] Filtro por tipo de operación
- [ ] Vista de tabla para desktop (AG-Grid)
- [ ] Detalle de operación al hacer tap

## Dependencias

| Archivo | Uso |
|---------|-----|
| `CommonModule` | Pipes (number, titlecase) |
| `IonInfiniteScroll` | Paginación infinita |
| `UiService` | hideTabs(), showTabs(), showError() |
| `CajasService` | obtenerCajas() |
| `OperacionesCajaService` | obtenerOperacionesCaja() |
