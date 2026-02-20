# Estructura del Proyecto

Este documento describe la organización de carpetas y archivos del proyecto.

## Arquitectura General

El proyecto sigue una arquitectura **basada en features** (feature-based) con componentes standalone de Angular 20 e Ionic 8.

```
mi-tienda/
├── src/
│   ├── app/
│   │   ├── core/              # Servicios y utilidades centrales
│   │   ├── features/          # Funcionalidades por módulo
│   │   └── shared/            # Componentes compartidos
│   ├── assets/                # Imágenes, iconos, etc.
│   ├── environments/          # Configuración de entornos
│   └── theme/                 # Estilos globales
├── android/                   # Proyecto nativo Android
├── docs/                      # Documentación del proyecto
└── capacitor.config.ts        # Configuración de Capacitor
```

---

## Detalle de Carpetas

### `src/app/core/` - Servicios y Utilidades Centrales

Contiene servicios singleton y funcionalidades core usadas en toda la app.

```
core/
├── components/                # Componentes core
│   └── offline-banner/       # Banner de estado offline
│
├── config/                    # Configuración global
│   └── pagination.config.ts  # Constantes de paginación
│
├── guards/                    # Guards de Angular
│   ├── auth.guard.ts         # Protege rutas privadas (requiere login)
│   ├── pending-changes.guard.ts # Previene salida con cambios sin guardar
│   └── public.guard.ts       # Protege rutas públicas (redirige si ya autenticado)
│
├── pages/                     # Páginas/clases base
│   └── scrollable.page.ts    # Clase base para páginas con scroll
│
└── services/                  # Servicios centrales
    ├── currency.service.ts   # Formateo de moneda
    ├── logger.service.ts     # Logging centralizado
    ├── network.service.ts    # Estado de conectividad
    ├── storage.service.ts    # Almacenamiento local
    ├── supabase.service.ts   # Manejo centralizado de consultas a Supabase
    └── ui.service.ts         # Manejo de loading, toast y tabs
```

**Convención:**

- Servicios en `core/services/` son **singleton** (providedIn: 'root')
- Guards protegen rutas según lógica de autenticación

---

### `src/app/features/` - Funcionalidades por Módulo

Cada feature tiene su propia carpeta con todo lo necesario (páginas, servicios, modelos, rutas).

#### Estructura de Features

```
features/
├── layout/                    # Feature de navegación principal
│   ├── pages/main/
│   │   ├── main-layout.page.ts
│   │   ├── main-layout.page.html
│   │   └── main-layout.page.scss
│   └── layout.routes.ts      # Rutas hijas del layout
│
├── auth/                      # Feature de autenticación
│   ├── docs/
│   │   └── AUTH-README.md
│   ├── models/
│   │   └── empleado_actual.model.ts  # Interface del empleado en sesión
│   ├── pages/
│   │   ├── login/            # Página de inicio de sesión
│   │   └── callback/         # Callback de OAuth (Google)
│   ├── services/
│   │   └── auth.service.ts   # Lógica de autenticación con Supabase
│   └── auth.routes.ts
│
├── dashboard/                 # Feature principal (home y operaciones de caja)
│   ├── docs/
│   │   ├── DASHBOARD-README.md
│   │   ├── 1_OPERACIONES-CAJA.md
│   │   ├── 2_PROCESO_INGRESO_EGRESO.md
│   │   ├── 3_PROCESO_CIERRE_CAJA.md
│   │   ├── 4_PROCESO_CUADRE_RECARGAS.md
│   │   ├── 5_ACTUALIZACION-UI-SIN-RECARGA.md
│   │   ├── 6_PROCESO_GASTOS_DIARIOS.md
│   │   └── 7_PROCESO_SALDO_VIRTUAL.md
│   ├── models/
│   │   ├── categoria-operacion.model.ts  # Tipos/categorías de operación
│   │   ├── gasto-diario.model.ts         # Interface de gastos
│   │   ├── operacion-caja.model.ts       # Operaciones, filtros, paginación
│   │   ├── saldos-anteriores.model.ts    # Modelo de saldos
│   │   └── turno-caja.model.ts           # Interface del turno/caja
│   ├── pages/
│   │   ├── home/                         # Dashboard principal
│   │   ├── cierre-diario/                # Proceso de cierre de cajas
│   │   ├── cuadre-caja/                  # Cuadre y verificación de caja
│   │   ├── gastos-diarios/               # Registro de gastos del día
│   │   ├── historial-recargas/           # Historial de recargas
│   │   ├── operaciones-caja/             # Movimientos por caja (filtros, scroll infinito)
│   │   ├── pagar-deudas/                 # Pago de deudas pendientes
│   │   └── recargas-virtuales/           # Gestión de recargas virtuales
│   ├── components/
│   │   ├── gasto-modal/                  # Modal para registrar gasto
│   │   ├── historial-modal/              # Modal de historial de operaciones
│   │   ├── liquidacion-bus-modal/        # Modal de liquidación bus
│   │   ├── operacion-modal/              # Modal ingreso/egreso de caja
│   │   ├── pagar-deudas-modal/           # Modal para pago de deudas
│   │   └── registrar-recarga-modal/      # Modal para nueva recarga
│   ├── services/
│   │   ├── cajas.service.ts              # CRUD de cajas y saldos
│   │   ├── ganancias.service.ts          # Cálculo de ganancias mensuales
│   │   ├── gastos-diarios.service.ts     # CRUD de gastos del día
│   │   ├── operaciones-caja.service.ts   # Consulta de operaciones con filtros
│   │   ├── recargas.service.ts           # Recargas celular y bus
│   │   ├── recargas-virtuales.service.ts # Saldo virtual de recargas
│   │   └── turnos-caja.service.ts        # Gestión de turnos/apertura de caja
│   └── dashboard.routes.ts
│
├── employees/                 # Feature de empleados
│   ├── models/
│   │   └── employee.model.ts
│   ├── pages/list/
│   │   ├── list.page.ts
│   │   ├── list.page.html
│   │   └── list.page.scss
│   ├── services/
│   │   └── employee.service.ts
│   └── employees.routes.ts
│
├── ventas/                    # Feature de ventas
│   ├── pages/main/
│   │   └── ventas.page.ts
│   └── ventas.routes.ts
│
├── inventario/                # Feature de inventario
│   ├── pages/main/
│   │   └── inventario.page.ts
│   └── inventario.routes.ts
│
├── reportes/                  # Feature de reportes
│   ├── pages/main/
│   │   └── reportes.page.ts
│   └── reportes.routes.ts
│
└── configuracion/             # Feature de configuración
    ├── components/
    │   └── logs-modal/       # Modal de logs del sistema
    ├── pages/main/
    │   ├── configuracion.page.ts
    │   ├── configuracion.page.html
    │   └── configuracion.page.scss
    └── configuracion.routes.ts
```

---

### Detalle del Feature `dashboard/`

Este es el módulo principal que agrupa funcionalidades relacionadas con el panel del usuario y operaciones de caja.

**Criterio de agrupación:** Todo lo relacionado con cajas, operaciones y el home del usuario está en `dashboard/` porque:

- Comparten servicios (CajasService, OperacionesCajaService)
- Comparten modelos (OperacionCaja, FiltroFecha)
- Son accedidos desde el mismo punto de entrada (home)

**Cuándo separar en módulo propio:**

- Si una subfuncionalidad crece a más de 4-5 pages propias
- Si necesita servicios/modelos exclusivos que no comparte
- Si se requiere lazy loading específico

```
dashboard/
├── models/
│   ├── operacion-caja.model.ts       # OperacionCaja, FiltroFecha, ResultadoOperaciones
│   ├── saldos-anteriores.model.ts    # SaldosAnteriores
│   ├── categoria-operacion.model.ts  # CategoriaOperacion
│   ├── gasto-diario.model.ts         # GastoDiario
│   └── turno-caja.model.ts           # TurnoCaja
│
├── services/
│   ├── cajas.service.ts              # obtenerCajas(), actualizarSaldo()
│   ├── operaciones-caja.service.ts   # obtenerOperacionesCaja() con filtros
│   ├── ganancias.service.ts          # calcularGananciasPendientes()
│   ├── gastos-diarios.service.ts     # CRUD gastos del día
│   ├── recargas.service.ts           # recargas celular y bus
│   ├── recargas-virtuales.service.ts # saldo virtual
│   └── turnos-caja.service.ts        # abrirTurno(), cerrarTurno()
│
├── components/
│   ├── gasto-modal/
│   ├── historial-modal/
│   ├── liquidacion-bus-modal/
│   ├── operacion-modal/
│   ├── pagar-deudas-modal/
│   └── registrar-recarga-modal/
│
└── pages/
    ├── home/                         # Dashboard principal
    ├── cierre-diario/                # Cierre de cajas (v4.0 - 1 campo)
    ├── cuadre-caja/                  # Cuadre y verificación
    ├── gastos-diarios/               # Gastos del día
    ├── historial-recargas/           # Historial de recargas
    ├── operaciones-caja/             # Movimientos (filtros, scroll infinito)
    ├── pagar-deudas/                 # Pago de deudas
    └── recargas-virtuales/           # Recargas virtuales
```

---

### `src/app/shared/` - Componentes Compartidos

Componentes, pipes y directivas reutilizables en múltiples features.

```
shared/
├── components/               # Componentes compartidos
│   ├── sidebar/             # Menú lateral de navegación
│   │   ├── sidebar.component.ts
│   │   ├── sidebar.component.html
│   │   └── sidebar.component.scss
│   └── under-construction/  # Placeholder para features pendientes
│       └── under-construction.component.ts
└── directives/               # Directivas personalizadas
    ├── currency-input.directive.ts  # Formato moneda en inputs
    ├── numbers-only.directive.ts    # Solo permite dígitos
    └── scroll-reset.directive.ts    # Resetea scroll al navegar
```

**Convención:**

- Solo componentes **verdaderamente reutilizables** van aquí
- Si es específico de un feature, va dentro de ese feature

---

### `src/environments/` - Configuración de Entornos

```
environments/
├── environment.ts            # Desarrollo
└── environment.prod.ts       # Producción
```

**Contenido:**

```typescript
export const environment = {
  production: false,
  supabaseUrl: 'https://tu-proyecto.supabase.co',
  supabaseKey: 'tu-anon-key'
};
```

---

### `android/` - Proyecto Nativo Android

Generado por Capacitor. Contiene el proyecto Android Studio.

**Archivos importantes:**

- `android/app/src/main/res/values/styles.xml` - Configuración de splash screen
- `android/local.properties` - Ruta del SDK de Android (no subir a Git)

---

## Convenciones de Nombres

| Tipo        | Convención              | Ejemplo                   |
| ----------- | ----------------------- | ------------------------- |
| Componentes | `{nombre}.component.ts` | `sidebar.component.ts`    |
| Páginas     | `{nombre}.page.ts`      | `home.page.ts`            |
| Servicios   | `{nombre}.service.ts`   | `cajas.service.ts`        |
| Guards      | `{nombre}.guard.ts`     | `auth.guard.ts`           |
| Modelos     | `{nombre}.model.ts`     | `operacion-caja.model.ts` |
| Rutas       | `{feature}.routes.ts`   | `dashboard.routes.ts`     |

---

## Dónde Colocar Nuevos Archivos

| Quiero agregar...                    | Ubicación                        |
| ------------------------------------ | -------------------------------- |
| Nueva página de operaciones          | `features/dashboard/pages/`      |
| Modal exclusivo del dashboard        | `features/dashboard/components/` |
| Servicio de cajas                    | `features/dashboard/services/`   |
| Modelo de operación                  | `features/dashboard/models/`     |
| Componente modal reutilizable        | `shared/components/`             |
| Directiva de input personalizada     | `shared/directives/`             |
| Guard de rutas                       | `core/guards/`                   |
| Servicio global (red, storage, etc.) | `core/services/`                 |
| Constante de configuración global    | `core/config/`                   |
| Nueva feature (ej: productos)        | `features/productos/`            |

---

## Checklist al Agregar un Nuevo Feature

1. Crear carpeta en `features/{nombre-feature}/`
2. Crear subcarpetas según necesidad:
   - `pages/` - Obligatorio
   - `services/` - Si tiene lógica de negocio
   - `models/` - Si tiene interfaces/tipos propios
   - `components/` - Si tiene componentes exclusivos
   - `docs/` - Si requiere documentación
3. Crear archivo de rutas: `{feature}.routes.ts`
4. Registrar rutas en `features/layout/layout.routes.ts`
5. Actualizar este documento si la estructura cambia

---

## Patrones de Diseño Utilizados

### UI/UX

- **Ionic CSS Variables** para compatibilidad dark/light mode
- **Diseño híbrido**: Patrón Home + toque empresarial/bancario
- **Componentes standalone** de Angular 20
- **Control flow** con `@if`, `@for` (nueva sintaxis Angular)

### Arquitectura

- **Feature-based**: Cada módulo es autocontenido
- **Lazy loading**: Features se cargan bajo demanda
- **Services singleton**: En `core/` para funcionalidad global
- **Services scoped**: En `features/{feature}/services/` para lógica específica

---

## Mantener Actualizado

**IMPORTANTE:** Este documento debe actualizarse cada vez que se agregue una nueva carpeta o feature importante al proyecto.

*Última actualización: 2026-02-11*
