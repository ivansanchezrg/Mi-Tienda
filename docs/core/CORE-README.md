# Módulo Core - Servicios y Utilidades Centrales

Esta documentación cubre los servicios singleton, utilidades y convenciones transversales que se utilizan a lo largo de toda la aplicación Mi Tienda.

- Para la arquitectura del proyecto, consultar [ESTRUCTURA-PROYECTO.md](../ESTRUCTURA-PROYECTO.md).
- Para componentes visuales y principios, consultar [DESIGN.md](../DESIGN.md).

---

## Servicios Centrales

### UiService (`core/services/ui.service.ts`)

Maneja loading y toast con conteo inteligente para evitar bloqueos y colisiones de animaciones (overlays).

```typescript
// Mostrar loading (con timeout de seguridad de 30s)
await this.ui.showLoading('Cargando...');

// Ocultar loading
await this.ui.hideLoading();

// Toasts de retroalimentación
await this.ui.showSuccess('Operación exitosa');
await this.ui.showError('Ocurrió un error inesperado');
await this.ui.showToast('Atención requerida', 'warning');
```

**⚠️ Manejo de Errores y Sincronización:**
Ionic encola los "Overlays" (`LoadingController`, `ToastController`). Si existe latencia de red, es posible que la orden asíncrona de ocultar un Loader choque con la orden de mostrar un Toast de Error devuelto por Supabase. 

Para evitar lag visual o "Toasts fantasma", es **obligatorio** invocar `await this.ui.hideLoading()` *antes* de invocar una alerta o toast, especialmente dentro de bloques `catch()`.


### SupabaseService (`core/services/supabase.service.ts`)

Manejo centralizado de consultas a la base de datos PostgreSQL. Existen dos patrones válidos según el caso de uso:

#### Patrón A: Mutaciones (Insert / Update / Delete)
`supabase.call()` no muestra spinner por defecto. Habilítalo explícitamente pasando `{ showLoading: true }` para acciones que modifican datos y deben bloquear la UI temporalmente.

```typescript
const data = await this.supabase.call<Employee>(
  this.supabase.client.from('empleados').insert({...}).select().single(),
  { showLoading: true }
);
```

#### Patrón B: Consultas de Lectura (Get / List / Dashboard)
Úsalo para recuperar listas o datos iniciales. Controla la carga localmente con una variable `loading = true` renderizando *Skeletons* en el HTML en vez de bloquear toda la pantalla.

```typescript
// En el componente de página
loading = true;
async cargarDatos() {
  this.loading = true;
  this.gastos = await this.supabase.call<GastoDiario[]>(
     this.supabase.client.from('gastos_diarios').select('*'),
     { showLoading: false }
  ) ?? [];
  this.loading = false;
}
```

#### Consultas en Paralelo
Para reducir el tiempo de carga, usa `Promise.all()` en lugar de múltiples `await` secuenciales:

```typescript
// ✅ 1 loading para 3 peticiones concurrentes
const [usuarios, productos, ventas] = await Promise.all([
  this.service.getUsuarios(),
  this.service.getProductos(),
  this.service.getVentas()
]);
```


### LoggerService (`core/services/logger.service.ts`)

Sistema de logs persistente para debugging en producción.

```typescript
private logger = inject(LoggerService);

this.logger.debug('MiComponente', 'Valores cargados', obj);
this.logger.error('MiComponente', 'Falla de conexión', error);
```

- Guarda archivos `.log` en el dispositivo físico usando Capacitor.
- Retiene los últimos 3 archivos rotativos de 1MB.


### CurrencyService (`core/services/currency.service.ts`)

Formateo estricto de valores monetarios. Detecta automáticmente el uso accidental de coma como separador decimal.

```typescript
this.currencyService.parse('1,250.50');  // → 1250.5
this.currencyService.parse('200,80');    // → 200.8 (detecta la coma final humana como decimal)
this.currencyService.format(1250.5);     // → "1,250.50"
```

---

## Directivas y Utilidades Compartidas

### Number/Currency Input Directives
Previenen la entrada de texto inválido y auto-formatean los campos de precio en tiempo real.

```html
<ion-input 
    appNumbersOnly       <!-- Solo permite num, coma y punto -->
    appCurrencyInput     <!-- Auto-formatea a $ 1,000.00 en onBlur -->
    formControlName="monto">
</ion-input>
```

### ScrollResetDirective
Devuelve el view al top de la página cuando el estado cambia. Útil en paginaciones o wizards.

```html
<ion-content [appScrollReset]="pasoAvanzado">
```


### Fecha Local: `getFechaLocal()`
Debido al uso horario del comercio (UTC-5), el uso nativo de JavaScript puede registrar ventas en "días del futuro" a partir de las 7:00 PM locales.

```typescript
// ❌ INCORRECTO: A las 8PM UTC-5 devolverá el día de mañana (UTC+0)
new Date().toISOString().split('T')[0];

// ✅ CORRECTO: Asegura el día correcto en curso en base a la ubicación local
import { getFechaLocal } from '@core/utils/date.util';
const fechaHoy = getFechaLocal(); 
```

---

## Refrescar Contexto de Tabs

Las Tabs en Ionic, por naturaleza, **cachean las páginas**. Si en una Sub-página ejecutas un proceso (Ej: Cobro exitoso, Cierre Diario) y saltas de nuevo a la Tab Principal (Dashboard / Home), esta mostrará los datos oxidados sin el nuevo cobro.

Para refrescarlos de manera silente ("Soft Refresh"):

**1. Despachar Evento:** Envíale al router un Query Param de tiempo (`refresh`) desde la página hija.
```typescript
this.router.navigate(['/home'], { queryParams: { refresh: Date.now() } });
```

**2. Recepción:** En `ionViewWillEnter()` de la Tab Principal, interceptar y recargar:
```typescript
override async ionViewWillEnter(): Promise<void> {
  const isRefresh = this.route.snapshot.queryParams['refresh'];
  if (isRefresh) {
    // 1. Limpiar la URL para evitar recargas fantasma repetitivas luego
    await this.router.navigate([], { relativeTo: this.route, replaceUrl: true });
    
    // 2. Silenciosamente actualizar
    await this.cargarDatos(); 
  }
}
```
