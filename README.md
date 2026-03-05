# Mi Tienda

Aplicación móvil híbrida para gestión de tienda, desarrollada con Ionic Angular y Supabase.

## 📋 Documentación

### General

- **[Configuración Inicial](docs/CONFIGURACION-INICIAL.md)** - Guía paso a paso para configurar el proyecto desde cero
- **[Estructura del Proyecto](docs/ESTRUCTURA-PROYECTO.md)** - Organización de carpetas y convenciones
- **[Google OAuth Setup](docs/GOOGLE_OAUTH_SETUP.md)** - Configuración de Supabase con Google Cloud para OAuth
- **[Schema SQL](docs/schema.sql)** - Estructura completa de la base de datos (tablas, relaciones, tipos)

### Por Módulo

- **[Auth](docs/auth/AUTH-README.md)** - Autenticación con Google OAuth (Supabase + Deep Links)
- **[Dashboard](docs/dashboard/DASHBOARD-README.md)** - Home, Cierre Diario, Cuadre, Apertura de caja (sistema de 4 cajas y trazabilidad completa)
- **[Gastos Diarios](docs/gastos-diarios/GASTOS-DIARIOS-README.md)** - Registro de gastos operativos con FAB y comprobantes fotográficos
- **[Recargas Virtuales](docs/recargas-virtuales/RECARGAS-VIRTUALES-README.md)** - Gestión de saldo virtual CELULAR/BUS, deudas, liquidaciones y comisiones

## 🚀 Stack Tecnológico

| Componente    | Versión |
| ------------- | ------- |
| Ionic Angular | 8.x     |
| Angular       | 20.x    |
| Capacitor     | 8.x     |
| Node.js       | 22.x    |
| Supabase JS   | 2.x     |

## 🎯 Patrones y Convenciones

### Sistema de Diseño

Este proyecto implementa un sistema de diseño consistente basado en **Flat Design Moderno** con design tokens para spacing, colores, sombras y radios.

📖 **[Ver Guía Completa de Diseño →](./docs/DESIGN.md)**

La guía incluye:

- Principios del patrón de diseño
- Tabla completa de design tokens (spacing, shadows, radius, etc.)
- Ejemplos de código DO/DON'T
- Componentes Ionic recomendados y a evitar
- Checklist de desarrollo
- Recursos y mejores prácticas

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

> ⚠️ **Regla crítica — `ion-tab-bar` NUNCA dentro de `@if`**
>
> `hideTabs`/`showTabs` funciona con una señal que muestra/oculta el tab-bar. Si usás `@if` para eso, el `ion-tab-bar` se elimina del DOM y cuando vuelve **pierde la tab seleccionada** (el ítem activo se deselecciona).
>
> ✅ **Correcto** — ocultar con CSS, siempre en el DOM:
> ```html
> <!-- main-layout.page.html -->
> <ion-tab-bar slot="bottom" [class.tabs-oculto]="!showTabs">
>   ...
> </ion-tab-bar>
> ```
> ```scss
> /* main-layout.page.scss */
> ion-tab-bar.tabs-oculto { display: none; }
> ```
>
> ❌ **Incorrecto** — elimina del DOM, rompe la selección activa:
> ```html
> @if (showTabs) {
>   <ion-tab-bar slot="bottom">...</ion-tab-bar>
> }
> ```

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

Existen dos patrones válidos según el caso de uso:

---

##### Patrón A: `supabase.call()` → Mutaciones (Insert / Update / Delete)

A partir de la estandarización "Opt-In", `supabase.call()` no muestra spinner por defecto. Habilitalo explícitamente pasando `{ showLoading: true }` para acciones que bloquean la UI.

```typescript
// ✅ Insert / Update / Delete con Loading Overlay
const data = await this.supabase.call<Employee>(
  this.supabase.client.from('empleados').insert({...}).select().single(),
  { showLoading: true }
);
```

**Ventajas:** Manejo automático de errores, loading bloqueante y toasts centralizados.

---

##### Patrón B: Consultas de Lectura (Get / List / Dashboard)

Usalo para recupoerar listas, dashboards o datos iniciales. Controlá la carga localmente con una variable `loading = true` renderizando *Skeleton Screens* en el HTML.

```typescript
// ✅ En el servicio: carga silenciosa implícita
async getGastos(fechaInicio: string, fechaFin: string): Promise<GastoDiario[]> {
  const data = await this.supabase.call<GastoDiario[]>(
     this.supabase.client.from('gastos_diarios').select('*'),
     { showLoading: false }
  );
  return data ?? [];
}
```

```typescript
// ✅ En la página: loading local
loading = true;
async cargarDatos(isRefresh = false) {
  if (!isRefresh) this.loading = true;
  // ... Promise.all([...])
  this.loading = false; // Finally
}
```

**Pull-to-refresh (`ion-refresher`):** Pasá `isRefresh=true` para actualizar el array silenciosamente sin disparar *Skeletons*. (Ver `DESIGN.md` para más información sobre Lineamientos de UX).

---

##### Cuándo usar cada patrón

| Operación | Patrón de Código |
|---|---|
| Mutaciones (Crear/Editar) | `supabase.call(..., { showLoading: true })` |
| Lecturas en Frío / Pantallas | `loading=true` + `supabase.call(..., { showLoading: false })` |
| Refresco Manual (Pull) | `<ion-refresher>` + `isRefresh=true` (silencioso) |

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

### `getFechaLocal()` (`core/utils/date.util.ts`)

Retorna la fecha actual en formato `YYYY-MM-DD` usando la zona horaria **local** del dispositivo.

```typescript
import { getFechaLocal } from '@core/utils/date.util';

const fecha = getFechaLocal(); // "2026-02-26"
```

#### ⚠️ NUNCA usar `new Date().toISOString()`

```typescript
// ❌ Incorrecto — devuelve fecha en UTC
new Date().toISOString().split('T')[0]; // Puede retornar mañana si son +7pm en Ecuador (UTC-5)

// ✅ Correcto
getFechaLocal(); // Siempre usa hora local
```

Se usa en **todas las operaciones de negocio** (gastos, cierres, recargas) porque el desfase UTC-5 de Ecuador hace que `toISOString()` pueda retornar la fecha de mañana a partir de las 7pm.

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

### Estructura de Storage (Comprobantes)

Los comprobantes se guardan en el bucket `comprobantes` de Supabase con esta estructura:

```
comprobantes/
  YYYY/
    MM/
      operaciones/   ← storageService.uploadImage(foto, 'comprobantes', 'operaciones')
      gastos/        ← storageService.uploadImage(foto, 'comprobantes', 'gastos')
```

**Subfolders registrados:**

| Subfolder | Usado por |
|---|---|
| `operaciones` | `operaciones-caja.service.ts` — ingresos y egresos de caja |
| `gastos` | `gastos-diarios.service.ts` — gastos diarios |

**Para agregar un nuevo tipo**, pasar el subfolder como tercer parámetro:
```typescript
await this.storageService.uploadImage(foto, 'comprobantes', 'mi-tipo');
```

> El path generado (`YYYY/MM/subfolder/uuid.jpg`) es lo que se guarda en la BD. Para visualizarlo se genera un signed URL de 1 hora con `storageService.getSignedUrl(path)`.

---

### Sistema de Notificaciones (Campana del Home)

Las notificaciones se muestran en la campana del header del Home. Para agregar un nuevo tipo:

**1. Agregar el tipo en `NotificacionesService` (`dashboard/services/notificaciones.service.ts`)**

```typescript
// 1. Ampliar el tipo
export interface Notificacion {
  tipo: 'DEUDA_CELULAR' | 'SALDO_BAJO_BUS' | 'MI_NUEVO_TIPO';
  titulo: string;
  descripcion: string;
  subtitulo?: string;
}

// 2. Agregar el chequeo en getNotificaciones()
if (condicion) {
  notifs.push({
    tipo: 'MI_NUEVO_TIPO',
    titulo: 'Título visible',
    descripcion: 'Descripción corta'
  });
}
```

**2. Actualizar el modal (`dashboard/components/notificaciones-modal/notificaciones-modal.component.ts`)**

Agregar el ícono y la navegación correspondiente en `navegar()`:

```typescript
async navegar(notif: Notificacion) {
  await this.modalCtrl.dismiss({ reload: false });
  const tab = notif.tipo === 'SALDO_BAJO_BUS' ? 'BUS'
            : notif.tipo === 'MI_NUEVO_TIPO'   ? 'CELULAR'
            : 'CELULAR';
  await this.router.navigate(['/home/mi-ruta'], { queryParams: { tab } });
}
```

Y en el template, agregar el ícono para el nuevo tipo en el binding `[name]`.

> El badge del home muestra automáticamente el total de notificaciones activas (`notificaciones.length`).

---

### Safe Area en Android (Barra de Navegación del Sistema)

En dispositivos Android con barra de navegación gestural (deslizar hacia arriba) o con botones de navegación por software, el contenido puede quedar tapado si no se respeta el **safe area inset**.

#### Requisito previo

El `viewport-fit=cover` ya está configurado en `src/index.html`, lo que habilita el uso de `env(safe-area-inset-bottom)`:

```html
<meta name="viewport" content="viewport-fit=cover, width=device-width, ..." />
```

#### Regla: Todo elemento fijo en la parte inferior debe usar `env(safe-area-inset-bottom)`

```scss
// ✅ Correcto — el tab-bar crece para no tapar los botones del sistema
ion-tab-bar {
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom); // Solo el safe area, sin padding extra
}

// ✅ Correcto — FABs o popups flotantes sobre el tab-bar también deben compensar
.fab-options {
  position: fixed;
  bottom: calc(80px + env(safe-area-inset-bottom));
}

// ❌ Incorrecto — altura fija que tapa los botones del sistema
ion-tab-bar {
  height: 56px;
  padding-bottom: 0;
}
```

**¿Por qué `calc()`?**

- En dispositivos **sin** barra de navegación visible: `env(safe-area-inset-bottom)` = `0` → no cambia nada
- En dispositivos **con** barra gestural o botones soft: devuelve ~20–40px → el elemento crece exactamente lo necesario

**Archivo de referencia:** `src/app/features/layout/pages/main/main-layout.page.scss`

---

### Detección de Conexión a Internet

Sistema automático que detecta pérdida de conexión y bloquea operaciones críticas.

**Componentes:**

- **NetworkService** (`core/services/network.service.ts`) - Monitoreo de conexión
- **OfflineBannerComponent** - Banner rojo que aparece al perder internet
- **Validación en operaciones** - Bloquea acciones sin conexión

**Uso en páginas:**

```typescript
private networkService = inject(NetworkService);
isOnline = true;

ngOnInit() {
  // Suscribirse a cambios de conexión
  this.networkService.getNetworkStatus().subscribe(isOnline => {
    this.isOnline = isOnline;
  });
}

async ejecutarOperacion() {
  // Verificar antes de operaciones críticas
  if (!this.isOnline) {
    await this.ui.showError('Sin conexión a internet');
    return;
  }
  // continuar...
}
```

**Banner automático:**

- Aparece en toda la app al perder internet
- Desaparece automáticamente al recuperar conexión
- No requiere configuración adicional

**Importante:** Las validaciones de error en servicios siguen siendo necesarias (complementarias) para detectar fallos durante la operación.

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

---

## 💡 Mejores Prácticas

### Loading y Navegación

**⚠️ Problema Común:** Al ejecutar operaciones con loading y luego navegar a otra página, el contador de loading puede desbalancearse, causando que el loading se quede trabado hasta el timeout (12-15 segundos).

**✅ Solución:** Siempre cerrar el loading ANTES de navegar.

**Ejemplo incorrecto:**

```typescript
async ejecutarOperacion() {
  await this.ui.showLoading('Procesando...');
  try {
    await this.service.operacion();
    await this.ui.showSuccess('Éxito');
    await this.router.navigate(['/home']); // ❌ Navega antes de cerrar loading
  } finally {
    await this.ui.hideLoading(); // ❌ Demasiado tarde
  }
}
```

**Ejemplo correcto:**

```typescript
async ejecutarOperacion() {
  await this.ui.showLoading('Procesando...');
  try {
    await this.service.operacion();

    // ✅ 1. Cerrar loading PRIMERO
    await this.ui.hideLoading();

    // ✅ 2. Mostrar toast de éxito
    await this.ui.showSuccess('Éxito');

    // ✅ 3. Pequeño delay para asegurar que UI procese el cierre
    await new Promise(resolve => setTimeout(resolve, 100));

    // ✅ 4. Navegar al final
    await this.router.navigate(['/home']);
  } catch (error) {
    await this.ui.hideLoading();
    await this.ui.showError('Error en la operación');
  }
}
```

### Consultas en Paralelo

**⚠️ Problema Común:** Hacer múltiples consultas secuencialmente causa loadings múltiples y es más lento.

**✅ Solución:** Usar `Promise.all()` para ejecutar consultas independientes en paralelo.

**Ejemplo incorrecto:**

```typescript
async cargarDatos() {
  const usuarios = await this.service.getUsuarios();    // Loading 1
  const productos = await this.service.getProductos();  // Loading 2
  const ventas = await this.service.getVentas();        // Loading 3
  // Total: 3 loadings seguidos, más lento
}
```

**Ejemplo correcto:**

```typescript
async cargarDatos() {
  // ✅ Una sola consulta paralela, un solo loading
  const [usuarios, productos, ventas] = await Promise.all([
    this.service.getUsuarios(),
    this.service.getProductos(),
    this.service.getVentas()
  ]);
  // Total: 1 loading, más rápido
}
```

**Ventajas:**

- ⚡ Más rápido (consultas simultáneas)
- 🎨 Mejor UX (un solo loading)
- 🧠 El UiService maneja el contador automáticamente

### Refrescar Tabs Condicionalmente

**⚠️ Problema Común:** Con tabs en Ionic, las páginas quedan en caché. Necesitas que una tab se refresque después de ciertos procesos (ej: cierre diario), pero NO en navegación normal (para no molestar al usuario).

**✅ Solución:** Usar query params para señalizar cuándo refrescar, combinado con pull-to-refresh para actualizaciones manuales.

**Paso 1: Navegar con query param desde la página del proceso**

```typescript
// En cierre-diario.page.ts (o cualquier proceso que requiera refresh)
async ejecutarCierre() {
  await this.ui.showLoading('Guardando cierre...');
  try {
    await this.recargasService.ejecutarCierreDiario({...});

    await this.ui.hideLoading();
    await this.ui.showSuccess('Cierre guardado correctamente');

    // ✅ Navegar con query param para señalizar refresh
    await this.router.navigate(['/home'], {
      queryParams: { refresh: Date.now() }
    });
  } catch (error) {
    await this.ui.hideLoading();
    await this.ui.showError('Error al guardar el cierre');
  }
}
```

**Paso 2: Detectar query param en la tab y refrescar**

```typescript
// En home.page.ts (la tab que debe refrescarse)
export class HomePage extends ScrollablePage implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  async ngOnInit() {
    // Carga inicial (solo una vez al crear el componente)
    await this.cargarDatos();
  }

  override async ionViewWillEnter(): Promise<void> {
    super.ionViewWillEnter();

    // ✅ Verificar si viene con señal de refresh
    const refresh = this.route.snapshot.queryParams['refresh'];
    if (refresh) {
      // 1. Limpiar query param PRIMERO (evita loops)
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true
      });

      // 2. Refrescar datos
      await this.cargarDatos();
    }
  }

  // Pull-to-refresh para actualizaciones manuales
  async handleRefresh(event: any) {
    await this.cargarDatos();
    event.target.complete();
  }
}
```

**Flujo resultante:**

- ✅ **Después de cierre**: Home se refresca automáticamente
- ✅ **Navegación normal** (Configuración → Home): NO refresca, evita molestias
- ✅ **Pull-to-refresh**: Siempre disponible para actualizaciones manuales

**¿Por qué funciona?**

- Ionic cachea las tabs, por eso `ngOnInit` solo se ejecuta una vez
- `ionViewWillEnter` se ejecuta cada vez que se activa la tab
- Query params permiten señalizar cuándo es necesario refrescar
- Limpiar el param primero evita que se refresque en la próxima navegación

---

#### Variante: Refresh selectivo desde páginas secundarias

Cuando el usuario abre una página secundaria (ej: `operaciones-caja`) y **solo a veces** hace cambios, no siempre tiene sentido recargar home al volver. Usar un flag `hayCambios`:

```typescript
// En operaciones-caja.page.ts (página secundaria)
hayCambios = false;

async ejecutarOperacion(tipo, data) {
  const success = await this.service.registrarOperacion(...);
  if (success) {
    this.hayCambios = true;   // ← marcar que hubo cambio
    await this.cargarOperaciones(true);
  }
}

volver() {
  if (this.hayCambios) {
    // Solo refresca home si hubo cambios reales
    this.router.navigate(['/home'], { queryParams: { refresh: true } });
  } else {
    // Vuelve limpio, home no recarga innecesariamente
    this.router.navigate(['/home']);
  }
}
```

| Caso | Comportamiento |
|---|---|
| Usuario abre página y vuelve sin hacer nada | Home NO recarga |
| Usuario hace ingreso/egreso y vuelve | Home SÍ recarga (saldos actualizados) |
| Cierre diario (siempre hay cambio) | Home siempre recarga |

---

## 🔧 Problemas Comunes y Soluciones

### NavigatorLockAcquireTimeoutError & Login en Android

**Problema:**

```
NavigatorLockAcquireTimeoutError: Acquiring an exclusive Navigator
LockManager lock "lock:sb-xxx-auth-token" immediately failed
```

Este warning aparece en consola durante desarrollo web cuando Supabase intenta usar el Navigator LockManager API para sincronizar sesiones entre pestañas/tabs.

**⚠️ ADVERTENCIA CRÍTICA:**

**NO intentes "arreglar" este warning modificando la configuración de Supabase.** Cualquier configuración custom en el objeto `auth` del cliente **ROMPE el login OAuth en Android**.

**❌ Esto ROMPE el login en Android:**

```typescript
// ❌ NO HACER - Rompe OAuth en Android
this.client = createClient(url, key, {
  auth: {
    storageKey: 'custom-key',
    detectSessionInUrl: !isNative,
    flowType: 'pkce',
    // ... cualquier configuración custom
  }
});
```

**✅ Configuración CORRECTA:**

```typescript
// ✅ CORRECTO - Usar configuración por defecto
public client: SupabaseClient = createClient(
  environment.supabaseUrl,
  environment.supabaseKey
);
```

**¿Por qué?**

- La configuración **por defecto** de Supabase funciona perfectamente con OAuth en Android
- Agregar opciones como `detectSessionInUrl`, `flowType: 'pkce'`, o `storageKey` custom interfiere con el flujo de deep links y procesamiento de callback
- El warning de NavigatorLock es **inofensivo** (solo aparece en desarrollo web, no en APK)

**✅ Solución Recomendada:**

**IGNORAR el warning.** No afecta la funcionalidad:

- ✅ Solo aparece en **desarrollo web** (navegador)
- ✅ **NO aparece** en producción (APK de Android)
- ✅ **NO afecta** el funcionamiento de la autenticación
- ✅ **NO afecta** el rendimiento

**Lección aprendida:** A veces, intentar "arreglar" un warning inofensivo puede romper funcionalidad crítica. **Simple es mejor.**

---

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

Ver documentación completa en [docs/ESTRUCTURA-PROYECTO.md](docs/ESTRUCTURA-PROYECTO.md)

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

1. Seguir la estructura de carpetas definida en `docs/ESTRUCTURA-PROYECTO.md`
2. **Seguir el sistema de diseño** definido en [`docs/DESIGN.md`](./docs/DESIGN.md) (design tokens, spacing, colores, step colors)
3. Usar el patrón de servicios (UiService + SupabaseService)
4. Actualizar la documentación si es necesario

### Documentación por Módulo

Toda la documentación está centralizada en `docs/`, organizada por feature.

**Estructura:**

```
docs/
├── schema.sql                  ← esquema completo de BD (tablas, índices, datos iniciales)
├── SCHEMA-CHANGELOG.md         ← historial de cambios al schema
├── ESTRUCTURA-PROYECTO.md      ← árbol de carpetas y convenciones
├── DESIGN.md                   ← sistema de diseño y design tokens
├── {feature}/                  ← una carpeta por feature
│   ├── {FEATURE}-README.md     ← doc principal del feature
│   └── sql/
│       ├── functions/          ← funciones PostgreSQL (CREATE OR REPLACE FUNCTION)
│       └── queries/            ← scripts SQL ad-hoc (migraciones, datos one-time)
```

**Al agregar un nuevo feature:**

1. Crear `docs/{nombre-feature}/{NOMBRE-FEATURE}-README.md`
2. Si tiene funciones SQL → `docs/{nombre-feature}/sql/functions/*.sql`
3. Si tiene scripts de datos → `docs/{nombre-feature}/sql/queries/*.sql`
4. Agregar el link en este README en la sección "Por Módulo"
5. Actualizar el árbol en `docs/ESTRUCTURA-PROYECTO.md`

**Convención de nombres:**
- Carpeta del feature: `kebab-case` (igual que en `src/app/features/`)
- README principal: `NOMBRE-FEATURE-README.md` en MAYÚSCULAS
- Funciones SQL: `nombre_funcion.sql` (snake_case, igual que el nombre de la función en PostgreSQL)
