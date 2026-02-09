# Estructura del Proyecto

Este documento describe la organización de carpetas y archivos del proyecto.

## Arquitectura General

El proyecto sigue una arquitectura **basada en features** (feature-based) con componentes standalone de Angular 20 e Ionic 7+.

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
├── doc/                       # Documentación
└── capacitor.config.ts        # Configuración de Capacitor
```

---

## Detalle de Carpetas

### `src/app/core/` - Servicios y Utilidades Centrales

Contiene servicios singleton y funcionalidades core usadas en toda la app.

```
core/
├── guards/                    # Guards de Angular
│   ├── auth.guard.ts         # Protege rutas privadas (requiere login)
│   └── public.guard.ts       # Protege rutas públicas (redirige si ya autenticado)
│
└── services/                  # Servicios centrales
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
│   │   └── *.md              # Documentación del módulo
│   ├── models/
│   │   └── auth.model.ts     # Interfaces de autenticación
│   ├── pages/
│   │   ├── login/            # Página de inicio de sesión
│   │   └── callback/         # Callback de OAuth
│   ├── services/
│   │   └── auth.service.ts   # Lógica de autenticación con Supabase
│   └── auth.routes.ts
│
├── dashboard/                 # Feature principal (home y operaciones de caja)
│   ├── docs/
│   │   ├── DASHBOARD-README.md
│   │   ├── GANANCIAS-MENSUALES.md
│   │   ├── funcion_cierre_diario.md
│   │   └── proceso_cierre_cajas.md
│   ├── models/
│   │   ├── operacion-caja.model.ts    # Tipos de operaciones, filtros
│   │   └── saldos-anteriores.model.ts # Modelo de saldos
│   ├── pages/
│   │   ├── home/                      # Página principal del dashboard
│   │   ├── operaciones-caja/          # Historial de movimientos por caja
│   │   ├── transferir-ganancias/      # Transferencia de ganancias mensuales
│   │   └── cierre-diario/             # Proceso de cierre de cajas
│   ├── services/
│   │   ├── cajas.service.ts           # CRUD de cajas y transferencias
│   │   ├── operaciones-caja.service.ts # Consulta de operaciones
│   │   ├── ganancias.service.ts       # Cálculo de ganancias mensuales
│   │   └── recargas.service.ts        # Servicios de recargas
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
│   ├── operacion-caja.model.ts
│   │   ├── OperacionCaja          # Interface de operación
│   │   ├── FiltroFecha            # 'hoy' | 'semana' | 'mes' | 'todas'
│   │   └── ResultadoOperaciones   # Paginación de resultados
│   └── saldos-anteriores.model.ts
│
├── services/
│   ├── cajas.service.ts           # obtenerCajas(), crearTransferencia()
│   ├── operaciones-caja.service.ts # obtenerOperacionesCaja()
│   ├── ganancias.service.ts       # calcularGananciasPendientes()
│   └── recargas.service.ts        # servicios de recargas
│
└── pages/
    ├── home/                      # Dashboard principal
    ├── operaciones-caja/          # Lista de movimientos (filtros, scroll infinito)
    ├── transferir-ganancias/      # Confirmar transferencia de ganancias
    └── cierre-diario/             # Proceso de cierre de cajas
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
├── pipes/                    # Pipes personalizados
└── directives/               # Directivas personalizadas
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

| Tipo        | Convención              | Ejemplo                    |
| ----------- | ----------------------- | -------------------------- |
| Componentes | `{nombre}.component.ts` | `sidebar.component.ts`     |
| Páginas     | `{nombre}.page.ts`      | `home.page.ts`             |
| Servicios   | `{nombre}.service.ts`   | `cajas.service.ts`         |
| Guards      | `{nombre}.guard.ts`     | `auth.guard.ts`            |
| Modelos     | `{nombre}.model.ts`     | `operacion-caja.model.ts`  |
| Rutas       | `{feature}.routes.ts`   | `dashboard.routes.ts`      |

---

## Dónde Colocar Nuevos Archivos

| Quiero agregar...                      | Ubicación                           |
| -------------------------------------- | ----------------------------------- |
| Nueva página de operaciones            | `features/dashboard/pages/`         |
| Servicio de cajas                      | `features/dashboard/services/`      |
| Modelo de operación                    | `features/dashboard/models/`        |
| Componente modal reutilizable          | `shared/components/`                |
| Guard de roles                         | `core/guards/`                      |
| Servicio de notificaciones global      | `core/services/`                    |
| Nueva feature (ej: productos)          | `features/productos/`               |

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

*Última actualización: Febrero 2026*
