# Estructura del Proyecto

Este documento describe la organización de carpetas y archivos del proyecto.

## 📁 Arquitectura General

El proyecto sigue una arquitectura **basada en features** (feature-based) con componentes standalone de Angular.

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

## 🗂️ Detalle de Carpetas

### `src/app/core/` - Servicios y Utilidades Centrales

Contiene servicios singleton y funcionalidades core usadas en toda la app.

```
core/
├── guards/                    # Guards de Angular
│   ├── auth.guard.ts         # Protege rutas privadas (requiere login) #Falta implentar
│   └── public.guard.ts       # Protege rutas públicas (redirige si ya autenticado) #Falta implenetar
│
└── services/                  # Servicios centrales
    ├── supabase.service.ts   # Manejo centralizado de consultas a Supabase
    └── ui.service.ts         # Manejo de loading y toast
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
│   │   ├── main-layout.page.ts    # Contiene sidebar + tabs + router-outlet
│   │   ├── main-layout.page.html
│   │   └── main-layout.page.scss
│   └── layout.routes.ts      # Rutas hijas (home, ventas, inventario, reportes, employees, configuracion)
│
├── dashboard/                 # Feature de inicio
│   ├── pages/home/
│   │   ├── home.page.ts
│   │   ├── home.page.html
│   │   └── home.page.scss
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
├── ventas/                    # Feature de ventas (placeholder)
│   ├── pages/main/
│   │   └── ventas.page.ts
│   └── ventas.routes.ts
│
├── inventario/                # Feature de inventario (placeholder)
│   ├── pages/main/
│   │   └── inventario.page.ts
│   └── inventario.routes.ts
│
├── reportes/                  # Feature de reportes (placeholder)
│   ├── pages/main/
│   │   └── reportes.page.ts
│   └── reportes.routes.ts
│
├── configuracion/             # Feature de configuración
│   ├── pages/main/
│   │   ├── configuracion.page.ts
│   │   ├── configuracion.page.html
│   │   └── configuracion.page.scss
│   └── configuracion.routes.ts
│
└── auth/                      # Feature de autenticación (pendiente)
    ├── pages/login/
    │   ├── login.page.ts
    │   ├── login.page.html
    │   └── login.page.scss
    ├── services
    │   ├── auth.service.ts
    └── auth.routes.ts
```

**Reglas del Layout:**

- `ion-tabs` y `ion-router-outlet` van **directo** en `main-layout.page.html` (NO extraer a componentes)
- **Sin** `ion-header` global (cada página hija tiene el suyo)
- El sidebar se delega al componente `<app-sidebar>` en `shared/components/`

**Convenciones:**

- Cada feature es **autocontenido** (tiene todo lo que necesita)
- Servicios en `features/{feature}/services/` son específicos del feature
- Modelos en `features/{feature}/models/` definen las interfaces TypeScript
- Rutas en `{feature}.routes.ts` definen las rutas lazy-loaded del feature

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

## 📝 Convenciones de Nombres

| Tipo        | Convención              | Ejemplo               |
| ----------- | ----------------------- | --------------------- |
| Componentes | `{nombre}.component.ts` | `header.component.ts` |
| Páginas     | `{nombre}.page.ts`      | `login.page.ts`       |
| Servicios   | `{nombre}.service.ts`   | `auth.service.ts`     |
| Guards      | `{nombre}.guard.ts`     | `auth.guard.ts`       |
| Modelos     | `{nombre}.model.ts`     | `employee.model.ts`   |
| Rutas       | `{feature}.routes.ts`   | `auth.routes.ts`      |

---

## 🎯 Dónde Colocar Nuevos Archivos

| Quiero agregar...                    | Ubicación                      |
| ------------------------------------ | ------------------------------ |
| Una nueva página de login            | `features/auth/pages/login/`   |
| Un servicio de empleados             | `features/employees/services/` |
| Un componente de botón reutilizable  | `shared/components/button/`    |
| Un guard de roles                    | `core/guards/`                 |
| Una interfaz de producto             | `features/products/models/`    |
| Un servicio de notificaciones global | `core/services/`               |

---

## ✅ Checklist al Agregar un Nuevo Feature

1. Crear carpeta en `features/{nombre-feature}/`
2. Crear subcarpetas: `pages/`, `services/` (si necesita), `models/` (si necesita)
3. Crear archivo de rutas: `{feature}.routes.ts`
4. Registrar rutas en `features/layout/layout.routes.ts`
5. Actualizar este documento si la estructura cambia

---

## 🔄 Mantener Actualizado

**IMPORTANTE:** Este documento debe actualizarse cada vez que se agregue una nueva carpeta o feature importante al proyecto.
