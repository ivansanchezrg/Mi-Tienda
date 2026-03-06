# Mi Tienda

Aplicación móvil híbrida para gestión de tienda minorista. Desarrollada con **Ionic Angular** y **Supabase** como backend, empaquetada como APK Android con Capacitor.

Incluye gestión de caja (sistema de 4 cajas), ventas, recargas virtuales (celular/bus), inventario, gastos operativos con comprobantes fotográficos y control de usuarios.

---

## Tabla de Contenidos

- [Stack Tecnológico](#stack-tecnológico)
- [Módulos](#módulos)
- [Requisitos Previos](#requisitos-previos)
- [Instalación](#instalación)
- [Configurar Credenciales](#configurar-credenciales)
- [Desarrollo Local](#desarrollo-local)
- [Build para Android](#build-para-android)
- [Documentación](#documentación)
- [Estructura del Proyecto](#estructura-del-proyecto)

---

## Stack Tecnológico

| Componente    | Versión |
| ------------- | ------- |
| Ionic Angular | 8.x     |
| Angular       | 20.x    |
| Capacitor     | 8.x     |
| Node.js       | 22.x    |
| Supabase JS   | 2.x     |

---

## Módulos

| Módulo               | Estado             | Descripción                                                              |
| -------------------- | ------------------ | ------------------------------------------------------------------------ |
| Auth                 | ✅ Completo        | Autenticación con Google OAuth via Supabase + Deep Links                 |
| Dashboard            | ✅ Completo        | Home, apertura/cierre de caja, cuadre y operaciones (sistema de 4 cajas) |
| Recargas Virtuales   | ✅ Completo        | Gestión de saldo CELULAR/BUS, deudas, liquidaciones y comisiones         |
| Gastos Diarios       | ✅ Completo        | Registro de gastos operativos con FAB y comprobantes fotográficos        |
| Inventario           | 🚧 En desarrollo   | Control de stock de productos                                            |
| POS                  | 🚧 En desarrollo   | Punto de venta para registro de ventas                                   |
| Reportes             | 🚧 En desarrollo   | Reportes e historial de movimientos                                      |
| Usuarios             | ✅ Completo        | Gestión de usuarios y permisos                                           |

---

## Requisitos Previos

Asegúrate de tener instalado:

- **Node.js 22+** — [nodejs.org](https://nodejs.org)
- **Angular CLI** — `npm install -g @angular/cli`
- **Ionic CLI** — `npm install -g @ionic/cli`
- **Android Studio** (para build APK) — [developer.android.com/studio](https://developer.android.com/studio)
- Una cuenta y proyecto creado en **[Supabase](https://supabase.com)**

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/mi-tienda.git
cd mi-tienda

# 2. Instalar dependencias
npm install
```

---

## Configurar Credenciales

Las credenciales de Supabase **no están incluidas** en el repositorio por seguridad.

```bash
# Copiar el archivo de ejemplo
cp src/environments/environment.example.ts src/environments/environment.ts
```

Luego edita `src/environments/environment.ts` con tus credenciales reales:

```typescript
export const environment = {
  production: false,
  supabaseUrl: 'https://TU_PROYECTO.supabase.co',
  supabaseKey: 'TU_ANON_KEY_AQUI'
};
```

> Obtén estas credenciales en tu [Supabase Dashboard](https://supabase.com/dashboard) → Project Settings → API.
>
> El `anon key` es seguro para usar en el cliente. La seguridad de los datos se gestiona mediante **Row Level Security (RLS)** en Supabase.

Haz lo mismo para producción:

```bash
cp src/environments/environment.example.ts src/environments/environment.prod.ts
# Edita environment.prod.ts y establece production: true
```

---

## Desarrollo Local

```bash
# Iniciar servidor de desarrollo en el navegador
npm start
# → http://localhost:4200
```

> Algunas funcionalidades (cámara, notificaciones) solo están disponibles en el dispositivo nativo.

---

## Build para Android

Conecta un dispositivo Android con **Depuración USB** habilitada, luego ejecuta:

```bash
# Build completo + sincronizar + instalar en dispositivo
npm run android
```

Ese script equivale a:

```bash
npm run build          # Compila Angular → /www
npx cap sync android   # Sincroniza con el proyecto Android
npx cap run android    # Instala el APK en el dispositivo conectado
```

> **Primer uso:** Si ves el error `SDK location not found`, crea el archivo `android/local.properties`:
> ```properties
> sdk.dir=C\:\\Users\\TU_USUARIO\\AppData\\Local\\Android\\Sdk
> ```
> Reemplaza `TU_USUARIO` con tu nombre de usuario de Windows.

---

## Documentación

### General

| Documento | Descripción |
| --------- | ----------- |
| [Configuración Inicial](docs/CONFIGURACION-INICIAL.md) | Guía paso a paso para configurar el proyecto desde cero |
| [Estructura del Proyecto](docs/ESTRUCTURA-PROYECTO.md) | Organización de carpetas y convenciones de código |
| [Sistema de Diseño](docs/DESIGN.md) | Design tokens, patrones UI y guía de componentes Ionic |
| [Google OAuth Setup](docs/GOOGLE_OAUTH_SETUP.md) | Configuración de Supabase + Google Cloud para OAuth |
| [Schema SQL](docs/schema.sql) | Estructura completa de la base de datos (tablas, tipos, funciones) |
| [Core y Utilidades](docs/core/CORE-README.md) | UiService, manejo de loading, formateo de moneda y utilidades compartidas |

### Por Módulo

| Módulo | Documento |
| ------ | --------- |
| Auth | [AUTH-README.md](docs/auth/AUTH-README.md) |
| Dashboard | [DASHBOARD-README.md](docs/dashboard/DASHBOARD-README.md) |
| Gastos Diarios | [GASTOS-DIARIOS-README.md](docs/gastos-diarios/GASTOS-DIARIOS-README.md) |
| Recargas Virtuales | [RECARGAS-VIRTUALES-README.md](docs/recargas-virtuales/RECARGAS-VIRTUALES-README.md) |

---

## Estructura del Proyecto

```
mi-tienda/
├── src/
│   ├── app/
│   │   ├── core/               # Servicios globales (Supabase, UI, Auth)
│   │   ├── features/           # Módulos de la aplicación
│   │   │   ├── auth/
│   │   │   ├── dashboard/
│   │   │   ├── gastos-diarios/
│   │   │   ├── recargas-virtuales/
│   │   │   ├── inventario/
│   │   │   ├── pos/
│   │   │   └── ...
│   │   └── shared/             # Componentes y directivas reutilizables
│   └── environments/
│       ├── environment.example.ts   # Plantilla de credenciales (incluida en git)
│       ├── environment.ts           # Credenciales desarrollo (NO en git)
│       └── environment.prod.ts      # Credenciales producción (NO en git)
├── docs/                       # Documentación por módulo
├── android/                    # Proyecto Android nativo (Capacitor)
└── capacitor.config.ts
```

---

## Seguridad

- Los archivos `environment.ts` y `environment.prod.ts` están en `.gitignore` y **nunca deben subirse al repositorio**.
- El acceso a los datos está protegido mediante **Row Level Security (RLS)** en Supabase.
- La autenticación utiliza **Google OAuth** gestionado por Supabase.
- Ver [Google OAuth Setup](docs/GOOGLE_OAUTH_SETUP.md) para la configuración completa.
