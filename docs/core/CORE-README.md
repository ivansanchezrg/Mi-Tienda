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
`supabase.call()` no muestra spinner por defecto. Habilítalo explícitamente pasando `{ showLoading: true }` en el tercer parámetro.

Firma: `call<T>(promise, successMessage?, options?)`

```typescript
// Con mensaje de éxito + spinner
await this.supabase.call(
  this.supabase.client.from('gastos').insert(payload),
  'Gasto registrado correctamente',
  { showLoading: true }
);

// Sin mensaje de éxito, con spinner
const data = await this.supabase.call<Employee>(
  this.supabase.client.from('usuarios').insert({...}).select().single(),
  undefined,
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
  this.productos = await this.supabase.call<Producto[]>(
     this.supabase.client.from('productos').select('*')
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


### BarcodeScannerService (`core/services/barcode-scanner.service.ts`)

Centraliza toda la lógica de escaneo de códigos de barras via `@capacitor-mlkit/barcode-scanning`. Elimina la duplicación que existía antes en `InventarioPage`, `ProductoFormPage` y `PosPage`.

#### Formatos soportados (`FORMATOS_DEFAULT`)

```typescript
const FORMATOS_DEFAULT: BarcodeFormat[] = [
    BarcodeFormat.Ean13,   // EAN-13 (productos estándar)
    BarcodeFormat.Ean8,    // EAN-8
    BarcodeFormat.Code128, // Code 128 (logística)
    BarcodeFormat.UpcA,    // UPC-A
    BarcodeFormat.UpcE,    // UPC-E
    BarcodeFormat.Code39,  // Code 39
    BarcodeFormat.QrCode,  // QR (proveedores, transferencias)
];
```

#### API pública

| Método | Descripción | Uso |
|--------|-------------|-----|
| `scan()` | Abre cámara, escanea 1 código y cierra. Retorna `string \| null` | Inventario, formulario de producto, modal de presentación |
| `startContinuous(onScan)` | Abre cámara y llama `onScan(codigo)` por cada lectura. Retorna `boolean` (permiso concedido) | POS — queda abierto para múltiples productos |
| `stop()` | Cierra la cámara si está abierta | Botón ✕ del escáner en POS; `ionViewDidLeave`; `ngOnDestroy` |
| `feedback()` | Vibración (40ms) + beep (Web Audio API) | `scan()` lo llama internamente. En POS el caller lo llama explícitamente después de su lógica anti-duplicado |

#### Flujo de `scan()` (one-shot)

```typescript
// En cualquier componente/página
private barcodeScanner = inject(BarcodeScannerService);

async escanearCodigo() {
    const codigo = await this.barcodeScanner.scan();
    if (!codigo) return;  // usuario canceló
    this.form.patchValue({ codigo_barras: codigo });
}
```

#### Flujo de `startContinuous()` (POS)

```typescript
async abrirEscanerCamara() {
    this.escaneando = true;
    const iniciado = await this.barcodeScanner.startContinuous((codigo) => {
        // anti-duplicado: flag + debounce 1.5s por código
        if (this.procesandoEscaneo) return;
        this.barcodeScanner.feedback();  // startContinuous NO llama feedback internamente — el POS lo llama aquí
        // ... procesar código
    });
    if (!iniciado) this.escaneando = false;  // permiso denegado
}
```

#### Setup Android (obligatorio)

MLKit renderiza la cámara debajo del WebView. Sin estos cambios, el WebView es opaco y la cámara no se ve.

**CSS** (`src/global.scss`):
```scss
body.scanner-active {
  visibility: hidden;
  --background: transparent;
  --ion-background-color: transparent;
}
body.scanner-active .scanner-overlay,
body.scanner-active .scanner-overlay * {
  visibility: visible;
}
```

**Android** (`android/app/src/main/res/values/styles.xml`):
```xml
<item name="android:background">@android:color/transparent</item>
<item name="android:windowIsTranslucent">true</item>
```

#### Cleanup

| Recurso | Dónde limpiar |
|---------|---------------|
| Cámara continua (POS) | `ionViewDidLeave` + `ngOnDestroy` → `barcodeScanner.stop()` |
| Cámara one-shot (inventario) | Se cierra automáticamente — no requiere cleanup manual |
| AudioContext (beep) | Gestionado internamente por el servicio (singleton) |

---

### StorageService (`core/services/storage.service.ts`)

Punto único para captura de fotos, compresión y subida a Supabase Storage. Cualquier módulo que necesite fotografiar o subir imágenes debe usar este servicio — nunca llamar a `Camera.getPhoto` directamente.

#### API pública

| Método | Descripción |
|--------|-------------|
| `capturarFoto(source)` | Abre cámara o galería. Retorna `{ previewUrl: SafeUrl, rawUrl: string } \| null`. `previewUrl` va directo al `<img [src]>`; `rawUrl` se pasa a `uploadImage()`. Null si el usuario canceló. |
| `uploadImage(imageUrl, bucket, subfolder, useDatePrefix?)` | Comprime a WebP y sube a Storage. Acepta URL nativa o dataUrl. Retorna `path \| null` |
| `getSignedUrl(path, bucket?, expiresIn?)` | URL firmada temporal (default: 1h). Para buckets privados |
| `getPublicUrl(path, bucket?)` | URL pública directa. Solo para buckets públicos (ej: `productos`) |
| `deleteFile(path, bucket?)` | Elimina un archivo. Usar para rollback si el RPC falla después de subir |

#### Captura de fotos

```typescript
import { CameraSource } from '@capacitor/camera';
import { SafeUrl } from '@angular/platform-browser';
private storageService = inject(StorageService);

// En el componente: dos propiedades separadas
fotoPreviewUrl: SafeUrl | null = null;  // para <img [src]>
fotoRawUrl: string | null = null;       // para uploadImage()

// Abrir cámara
const result = await this.storageService.capturarFoto(CameraSource.Camera);
if (!result) return; // usuario canceló

this.fotoPreviewUrl = result.previewUrl; // SafeUrl — Angular no bloquea capacitor://
this.fotoRawUrl = result.rawUrl;         // string — para el upload posterior
```

```html
<img [src]="fotoPreviewUrl" alt="Preview" />
```

Parámetros internos (definidos una sola vez en el servicio): `quality: 70`, `width/height: 1280`, `correctOrientation: true`, `saveToGallery: false`, `resultType: Uri`.

`capturarFoto` usa `CameraResultType.Uri` + `Capacitor.convertFileSrc()` para evitar serializar la imagen por el bridge de Capacitor. La conversión a WebP ocurre solo al momento del upload, no al previsualizar.

#### Compresión automática en `uploadImage`

1. Si `imageUrl` no es base64: hace `fetch()` local para obtener el blob
2. **Redimensiona** al lado más largo a máx 1200px (mantiene proporción)
3. **WebP primero** (calidad 0.8), fallback automático a JPEG si el dispositivo no lo soporta
4. **Nombre generado**: `YYYY/MM/{subfolder}/{uuid}.webp` (o `.jpg` si fallback)

#### Estructura en Storage

```
comprobantes/  (bucket privado — requiere signed URL)
  2026/05/operaciones/{uuid}.webp   ← comprobantes de operaciones manuales de caja

productos/  (bucket público)
  {subfolder-categoria}/{uuid}.webp  ← fotos de productos (useDatePrefix=false)
```

#### Patrón rollback

```typescript
const path = await this.storageService.uploadImage(rawUrl, 'comprobantes', 'operaciones');
if (!path) return; // error ya mostrado por el servicio

const { error } = await supabase.rpc('fn_mi_operacion', { p_comprobante_url: path });
if (error) {
  await this.storageService.deleteFile(path); // rollback: no dejar huérfanos en Storage
}
```

---

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
this.router.navigate(['/caja'], { queryParams: { refresh: Date.now() } });
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
