# Mi Tienda

Aplicación móvil híbrida para gestión de tienda, desarrollada con Ionic Angular y Supabase.

## 📋 Documentación

### General

- **[Configuración Inicial](doc/configuracion-inicial.md)** - Guía paso a paso para configurar el proyecto desde cero
- **[Estructura del Proyecto](doc/estructura-proyecto.md)** - Organización de carpetas y convenciones
- **[Google OAuth Setup](doc/GOOGLE_OAUTH_SETUP.md)** - Configuración de Supabase con Google Cloud para OAuth

### Por Módulo

- **[Auth](src/app/features/auth/docs/AUTH-README.md)** - Autenticación con Google OAuth (Supabase + Deep Links)
- **[Dashboard](src/app/features/dashboard/docs/DASHBOARD-README.md)** - Home, Cierre Diario, Cuadre de Caja

## 🚀 Stack Tecnológico

| Componente    | Versión |
| ------------- | ------- |
| Ionic Angular | 8.x     |
| Angular       | 20.x    |
| Capacitor     | 8.x     |
| Node.js       | 22.x    |
| Supabase JS   | 2.x     |

## 🎯 Patrones y Convenciones

### Sistema de Diseño - Fondos y Cards

El fondo principal de la app es un **gris sutil**, lo que permite que los cards y elementos con fondo blanco resalten visualmente, creando profundidad y jerarquía.

**Variables clave** (`src/theme/variables.scss`):

| Variable | Light Mode | Dark Mode | Uso |
|----------|------------|-----------|-----|
| `--ion-background-color` | `#f4f5f8` | `#121212` | Fondo de páginas |
| `--ion-item-background` | `#ffffff` | `#1e1e1e` | Cards, items, elementos destacados |

**Uso en componentes:**

```scss
// Para cards, modales, tab bar, o cualquier elemento que deba resaltar
.mi-card {
  background: var(--ion-item-background);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
```

**Ejemplo visual:**

```
┌─────────────────────────────────────┐
│  Fondo gris (#f4f5f8)              │
│  ┌───────────────────────────────┐  │
│  │  Card blanco (#ffffff)        │  │ ← Resalta sobre el fondo
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

> **Importante:** Al crear nuevos componentes, usar `--ion-item-background` para fondos que deban contrastar con el fondo principal.

---

### Consultas a Supabase

**IMPORTANTE:** Todas las consultas a Supabase deben usar el patrón centralizado de servicios.

#### UiService (`core/services/ui.service.ts`)

Maneja loading y toast con conteo inteligente y oculta tabs de navegacion:

```typescript
// Mostrar loading
await this.ui.showLoading('Cargando...');

// Ocultar loading
await this.ui.hideLoading();

// Toast genérico (color configurable)
await this.ui.showToast('Mensaje', 'success');  // success | danger | primary | warning
await this.ui.showToast('Error al guardar', 'danger');

// Shortcuts
await this.ui.showError('Mensaje de error');
await this.ui.showSuccess('Operación exitosa');

// Ocultar/mostrar tabs (para wizards o páginas fullscreen)
this.ui.hideTabs();
this.ui.showTabs();
```

Para ocultar tabs en una página específica, usar los lifecycle hooks de Ionic:

```typescript
private ui = inject(UiService);

ionViewWillEnter() { this.ui.hideTabs(); }
ionViewWillLeave() { this.ui.showTabs(); }
```

#### LoggerService (`core/services/logger.service.ts`)

Sistema de logs persistente para debugging:

```typescript
private logger = inject(LoggerService);

// Niveles de log
this.logger.debug('MiComponente', 'Mensaje de debug');
this.logger.info('MiComponente', 'Información general');
this.logger.warn('MiComponente', 'Advertencia');
this.logger.error('MiComponente', 'Error crítico', errorObj);

// Obtener logs (para mostrar en UI)
const logs = await this.logger.getLogs();

// Limpiar logs
await this.logger.clearLogs();
```

**Características:**

- Logs guardados en archivos (solo en dispositivo nativo)
- Rotación automática (máx 3 archivos de 1MB)
- Formato: `2026-01-30 10:15:23 [ERROR] AuthGuard: Mensaje`
- Ver/limpiar logs desde Configuración en la app

---

#### SupabaseService (`core/services/supabase.service.ts`)

Método maestro para consultas que maneja automáticamente loading, errores y data:

```typescript
// Ejemplo de uso
const data = await this.supabase.call<Employee[]>(
  this.supabase.client.from('employees').select('*'),
  'Empleados cargados exitosamente' // Toast opcional
);

if (data) {
  // Usar data - ya es tipado y limpio
  console.log(data);
}
// Si hay error, automáticamente muestra toast y retorna null
```

**Ventajas:**

- Loading automático
- Manejo de errores centralizado
- Toast de error/éxito automático
- Data limpia y tipada
- Código DRY (Don't Repeat Yourself)

### Path Aliases

El proyecto usa aliases en `tsconfig.json` para imports limpios:

```typescript
// En lugar de rutas relativas largas:
import { UiService } from '../../../../core/services/ui.service';

// Usar aliases:
import { UiService } from '@core/services/ui.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
```

| Alias       | Ruta real          |
| ----------- | ------------------ |
| `@core/*`   | `src/app/core/*`   |
| `@shared/*` | `src/app/shared/*` |

---

### ScrollablePage (`core/pages/scrollable.page.ts`)

Clase base para páginas que necesitan resetear el scroll al entrar (tabs cachean la posición anterior):

```typescript
export class HomePage extends ScrollablePage {
  constructor() {
    super();
  }
}
```

Si la subclase necesita lógica adicional en `ionViewWillEnter`:

```typescript
override ionViewWillEnter(): void {
  super.ionViewWillEnter();
  // lógica adicional...
}
```

---

### CurrencyService (`core/services/currency.service.ts`)

Servicio para formateo y parseo de moneda USD. Detecta inteligentemente si el usuario usó coma como decimal:

```typescript
private currencyService = inject(CurrencyService);

// Parsear entrada de usuario a número
this.currencyService.parse('1,250.50');  // → 1250.5
this.currencyService.parse('200,80');    // → 200.8 (detecta coma como decimal)

// Formatear a string USD
this.currencyService.format(1250.5);     // → "1,250.50"
```

Se usa junto con `CurrencyInputDirective` en inputs de moneda.

---

### CurrencyInputDirective (`shared/directives/currency-input.directive.ts`)

Directiva para `<ion-input>` que formatea automáticamente al perder foco y limpia al ganar foco:

```html
<ion-input appCurrencyInput formControlName="monto" type="text" inputmode="decimal"></ion-input>
```

- **ionBlur**: formatea a `1,250.00`
- **ionFocus**: limpia a `1250.00` para edición

---

### NumbersOnlyDirective (`shared/directives/numbers-only.directive.ts`)

Directiva que valida entrada permitiendo solo números, punto y coma (ideal para campos numéricos y moneda):

```html
<ion-input
  appNumbersOnly
  appCurrencyInput
  formControlName="monto"
  inputmode="decimal">
</ion-input>
```

**Caracteres permitidos:**
- Números: `0-9`
- Punto: `.`
- Coma: `,`

**Previene:**
- Letras (a-z, A-Z)
- Espacios
- Caracteres especiales (@, #, $, etc.)

**Características:**
- Valida en tiempo real (keydown + input)
- Limpia texto pegado automáticamente
- Mantiene posición del cursor
- Permite teclas de navegación (Backspace, Tab, flechas, etc.)
- Permite atajos de teclado (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X)

**Uso combinado:** Se recomienda usar junto con `appCurrencyInput` para validación de entrada + formato automático.

---

### ScrollResetDirective (`shared/directives/scroll-reset.directive.ts`)

Directiva para resetear scroll al top cuando un valor cambia. Ideal para wizards multi-paso:

```html
<ion-content [appScrollReset]="pasoActual">
```

Cada vez que `pasoActual` cambia, el contenido hace scroll al top.

---

### PendingChangesGuard (`core/guards/pending-changes.guard.ts`)

Guard `canDeactivate` que previene salir de una página con cambios sin guardar:

```typescript
// 1. La página implementa la interfaz
export class MiPage implements HasPendingChanges {
  hasPendingChanges(): boolean {
    return this.form.dirty;
  }
  resetState(): void {
    this.form.reset();
  }
}

// 2. Se registra en la ruta
{
  path: 'mi-ruta',
  loadComponent: () => import('./mi.page').then(m => m.MiPage),
  canDeactivate: [pendingChangesGuard]
}
```

Muestra alerta de confirmación si hay cambios pendientes.

---

### Manejo de Teclado (Android)

Para evitar que el teclado oculte el header o empuje la app fuera de pantalla:

**`capacitor.config.ts`** — Plugin Keyboard:

```typescript
Keyboard: {
  resize: 'body',
  style: 'dark',
  resizeOnFullScreen: true
}
```

- `resize: 'body'` — Reduce el `<body>` para dar espacio al teclado, manteniendo el header visible
- `style: 'dark'` — Barra del teclado con tema oscuro
- `resizeOnFullScreen: true` — Aplica el resize incluso en pantalla completa

**`AndroidManifest.xml`** — En la activity principal:

```xml
android:windowSoftInputMode="adjustResize"
```

Despues de modificar `capacitor.config.ts` ejecutar `npx cap sync android`.

---

### Uso de Iconos en Ionic Standalone

**IMPORTANTE:** En Ionic Standalone, los iconos deben importarse como objetos, NO como strings.

#### ❌ Incorrecto (NO usar):

```typescript
// Esto causa error "Invalid base URL" en Standalone
const toast = await this.toastCtrl.create({
  icon: 'alert-circle-outline', // ❌ String no funciona
});
```

#### ✅ Correcto:

```typescript
// 1. Importar el icono como objeto
import { alertCircleOutline, checkmarkCircleOutline } from 'ionicons/icons';

// 2. Usar la variable directamente
const toast = await this.toastCtrl.create({
  icon: alertCircleOutline, // ✅ Objeto funciona
});
```

**¿Por qué?**

- **Con strings**: El navegador intenta descargar el .svg con una petición HTTP (falla)
- **Con imports**: El código SVG se empaqueta en el JavaScript (más rápido y seguro)

**Ejemplo completo en `ui.service.ts`:**

```typescript
import { alertCircleOutline, checkmarkCircleOutline } from 'ionicons/icons';

async showError(message: string) {
  const toast = await this.toastCtrl.create({
    message,
    icon: alertCircleOutline, // ✅ Importado
    color: 'danger'
  });
  await toast.present();
}
```

## 📱 Comandos Principales

```bash
# Desarrollo (navegador)
npm start

# Compilar proyecto
npm run build

# Build + sync + run en Android (todo en uno)
npm run android

# Linting
npm run lint
```

> **Nota:** El script `android` está definido en `package.json > scripts` y ejecuta secuencialmente: `build` → `cap sync android` → `cap run android`.

## 🏗️ Estructura del Proyecto

Ver documentación completa en [doc/estructura-proyecto.md](doc/estructura-proyecto.md)

```
src/app/
├── core/          # Servicios y utilidades centrales
├── features/      # Funcionalidades organizadas por módulo
└── shared/        # Componentes y utilidades compartidas
```

## 📝 Commits

Formato de commits usando Conventional Commits. Para PowerShell usar múltiples `-m`:

```bash
git commit -m "tipo(scope): descripción corta" -m "- Detalle 1
- Detalle 2
- Detalle 3"
```

**Tipos comunes:**

- `feat` - Nueva funcionalidad
- `fix` - Corrección de bug
- `docs` - Documentación
- `refactor` - Refactorización sin cambio de funcionalidad
- `style` - Formato, espacios, etc.

---

## 👥 Contribución

Al agregar nuevas funcionalidades:

1. Seguir la estructura de carpetas definida en `doc/estructura-proyecto.md`
2. Usar el patrón de servicios (UiService + SupabaseService)
3. Actualizar la documentación si es necesario

### Documentación por Módulo

Cada feature puede tener su propia documentación dentro de `features/{modulo}/docs/`.

**Convención de nombres:**

```
features/{modulo}/docs/MODULO-README.md
```

- El nombre del archivo es **NOMBRE_DEL_MODULO + README** todo en **MAYÚSCULAS**
- Ejemplo: `features/auth/docs/AUTH-README.md`
- Ejemplo: `features/employees/docs/EMPLOYEES-README.md`
- Referenciar desde el README principal en la sección "Documentación > Por Módulo"
