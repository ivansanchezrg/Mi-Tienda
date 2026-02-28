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
├── docs/                      # Toda la documentación centralizada
│   ├── schema.sql             # Esquema completo de la base de datos
│   ├── ESTRUCTURA-PROYECTO.md
│   ├── SCHEMA-CHANGELOG.md
│   ├── CONFIGURACION-INICIAL.md
│   ├── DESIGN.md
│   ├── GOOGLE_OAUTH_SETUP.md
│   ├── auth/
│   │   └── AUTH-README.md
│   ├── dashboard/
│   │   ├── DASHBOARD-README.md
│   │   ├── 1_OPERACIONES-CAJA.md
│   │   ├── 2_PROCESO_INGRESO_EGRESO.md
│   │   ├── 3_PROCESO_CIERRE_CAJA.md
│   │   ├── 4_PROCESO_CUADRE_RECARGAS.md
│   │   ├── 5_ACTUALIZACION-UI-SIN-RECARGA.md
│   │   ├── 8_PROCESO_ABRIR_CAJA.md
│   │   └── sql/
│   │       ├── functions/
│   │       │   ├── ejecutar_cierre_diario.sql
│   │       │   ├── registrar_operacion_manual.sql
│   │       │   ├── reparar_deficit_turno.sql
│   │       │   ├── crear_transferencia.sql
│   │       │   └── verificar_transferencia_caja_chica_hoy.sql
│   │       └── queries/
│   │           ├── agregar_categorias_deficit.sql
│   │           └── insertar_datos_reales_recargas.sql
│   ├── gastos-diarios/
│   │   └── GASTOS-DIARIOS-README.md
│   └── recargas-virtuales/
│       ├── RECARGAS-VIRTUALES-README.md
│       └── sql/
│           └── functions/
│               ├── registrar_recarga_proveedor_celular_completo.sql
│               ├── registrar_pago_proveedor_celular.sql
│               └── registrar_compra_saldo_bus.sql
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
    ├── currency.service.ts           # Formateo de moneda
    ├── ganancias.service.ts          # Cálculo de ganancia BUS mensual + badge Home
    ├── logger.service.ts             # Logging centralizado
    ├── network.service.ts            # Estado de conectividad
    ├── recargas-virtuales.service.ts # Saldo virtual, deudas, RPCs CELULAR/BUS
    ├── storage.service.ts            # Almacenamiento local
    ├── supabase.service.ts           # Manejo centralizado de consultas a Supabase
    └── ui.service.ts                 # Manejo de loading, toast y tabs
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
│   ├── models/
│   │   ├── categoria-operacion.model.ts  # Tipos/categorías de operación
│   │   ├── operacion-caja.model.ts       # Operaciones, filtros, paginación
│   │   ├── saldos-anteriores.model.ts    # Modelo de saldos
│   │   └── turno-caja.model.ts           # Interface del turno/caja
│   ├── pages/
│   │   ├── home/                         # Dashboard principal
│   │   ├── cierre-diario/                # Proceso de cierre de cajas
│   │   ├── cuadre-caja/                  # Cuadre y verificación de caja
│   │   ├── historial-recargas/           # Historial de recargas (cierres + virtuales)
│   │   └── operaciones-caja/             # Movimientos por caja (filtros, scroll infinito)
│   ├── components/
│   │   └── operacion-modal/              # Modal ingreso/egreso de caja
│   ├── services/
│   │   ├── cajas.service.ts              # CRUD de cajas y saldos
│   │   ├── operaciones-caja.service.ts   # Consulta de operaciones con filtros
│   │   ├── recargas.service.ts           # Snapshots de saldo virtual (tabla recargas)
│   │   └── turnos-caja.service.ts        # Gestión de turnos/apertura de caja
│   └── dashboard.routes.ts
│
├── gastos-diarios/            # Feature de gastos operativos
│   ├── models/
│   │   └── gasto-diario.model.ts         # Interface de gastos
│   ├── pages/
│   │   └── gastos-diarios/               # Lista + FAB para registrar gastos
│   ├── components/
│   │   └── gasto-modal/                  # Modal para registrar gasto con comprobante
│   └── services/
│       └── gastos-diarios.service.ts     # CRUD de gastos del día
│
├── recargas-virtuales/        # Feature de saldo virtual CELULAR/BUS
│   ├── pages/
│   │   ├── recargas-virtuales/           # Panel principal con tabs CELULAR/BUS
│   │   └── pagar-deudas/                 # Wizard de pago de deudas CELULAR
│   └── components/
│       ├── registrar-recarga-modal/      # Modal para nueva carga CELULAR o compra BUS
│       ├── pagar-deudas-modal/           # Modal para pago de deudas
│       ├── liquidacion-bus-modal/        # Modal de liquidación mensual BUS
│       └── historial-modal/              # Modal de historial de recargas
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

> `gastos-diarios` y `recargas-virtuales` fueron extraídos a features independientes porque tienen servicios/modelos exclusivos y flujos suficientemente complejos para justificarlo. Sus rutas siguen siendo registradas en `dashboard.routes.ts`.

```
dashboard/
├── models/
│   ├── operacion-caja.model.ts       # OperacionCaja, FiltroFecha, ResultadoOperaciones
│   ├── saldos-anteriores.model.ts    # SaldosAnteriores, DatosCierreDiario
│   ├── categoria-operacion.model.ts  # CategoriaOperacion
│   └── turno-caja.model.ts           # TurnoCaja
│
├── services/
│   ├── cajas.service.ts              # obtenerCajas(), crearTransferencia()
│   ├── operaciones-caja.service.ts   # obtenerOperacionesCaja() con filtros
│   ├── recargas.service.ts           # snapshots de saldo virtual, cierre diario
│   └── turnos-caja.service.ts        # abrirTurno(), cerrarTurno()
│
├── components/
│   └── operacion-modal/              # Modal ingreso/egreso de caja
│
└── pages/
    ├── home/                         # Dashboard principal
    ├── cierre-diario/                # Cierre de cajas (v4.0 - 1 campo)
    ├── cuadre-caja/                  # Cuadre y verificación
    ├── historial-recargas/           # Historial de recargas (cierres + virtuales)
    └── operaciones-caja/             # Movimientos (filtros, scroll infinito)
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

*Última actualización: 2026-02-25*
