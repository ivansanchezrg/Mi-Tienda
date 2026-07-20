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

### FeedbackOverlayService (`core/services/feedback-overlay.service.ts`)

Overlay centrado (blur de fondo, `z-index: 30000` — por encima de cualquier overlay de Ionic, incluido un modal abierto) reservado para resultados "de ley" que necesitan un cierre visual inequívoco. **No reemplaza a `UiService`** — sigue siendo el default para el 95% de los mensajes. Criterio completo de cuándo usar cada uno: `CLAUDE.md` § "Feedback de acciones — toast vs overlay".

```typescript
private feedback = inject(FeedbackOverlayService);

this.feedback.success({ titulo: '¡Venta registrada!', destacado: '$45.00', subtitulo: 'Comprobante #142' });
this.feedback.error({ titulo: 'No se pudo registrar la venta' });   // sin auto-dismiss
this.feedback.warning({ titulo: 'Stock insuficiente' });
this.feedback.info({ titulo: 'Catálogo actualizado' });
```

`success`/`info` se auto-cierran a los 3000ms; `warning`/`error` requieren tap en "Entendido" o tocar fuera (default, configurable con `duracionMs`). El componente visual (`shared/components/feedback-overlay/`) se monta **una única vez** en `AppComponent`, mismo patrón que `app-offline-banner` — nunca se declara en una página.

Para servicios que necesitan disparar el overlay de error ellos mismos (en vez del toast automático de `SupabaseService.call()`), usar `this.supabase.esErrorDeTransporte(error)` para distinguir "sin conexión" de un error de negocio real y dar el mensaje correcto. Ver `OperacionesCajaService.registrarOperacion()` y `NotasService.eliminar()` como referencia.

### SyncBannerService (`core/services/sync-banner.service.ts`)

Banner efímero "Conexión restablecida" (franja verde, ~2.5s) que confirma al usuario que la red volvió tras haber estado offline. **No requiere que ningún componente lo llame** — el propio servicio se suscribe a `NetworkService.getNetworkStatus()` desde su constructor y detecta el flanco offline→online por su cuenta (rastrea `ultimoEstado`, empieza en `undefined` para no disparar en el arranque en frío).

```typescript
// No hay API pública para dispararlo manualmente — es 100% automático.
// El componente visual solo lee el signal:
readonly visible = inject(SyncBannerService).visible;
```

**Por qué banner y no overlay:** la reconexión puede repetirse varias veces por turno de trabajo (red parpadeante) — un overlay centrado sería la "fatiga de interrupción" que `CLAUDE.md` § toast vs overlay busca evitar. El banner es una franja que no bloquea nada y se auto-oculta sola.

**Por qué la detección vive en el servicio (`root`) y no en una página:** una primera versión disparaba el banner desde `HomePage.reactivarTrasReconexion()` — pero el banner es global (montado en `AppComponent`) y ese trigger solo corría si el usuario estaba mirando el Home en el instante exacto de la reconexión. Centralizar la detección en el servicio (que se instancia desde el arranque vía `SyncBannerComponent` en `app.component.html`) hace que funcione sin importar qué pantalla esté activa.

Componente visual: `core/components/sync-banner/`, montado una única vez en `AppComponent` (mismo patrón que `app-offline-banner` y `app-suscripcion-banner`) — togglea la clase `sync-banner-visible` en `<body>`, sumada al selector compartido de `global.scss` que anula el safe-area duplicado de los headers de página.

### SupabaseService (`core/services/supabase.service.ts`)

Manejo centralizado de consultas a la base de datos PostgreSQL. Existen dos patrones válidos según el caso de uso:

> **`lock` override (Capacitor):** El cliente Supabase se inicializa con `auth.lock` sobrescrito para saltear el `Navigator LockManager` del browser. En un WebView de Capacitor (single-tab, sin pestañas) el LockManager no tiene sentido y genera errores `CHANNEL_ERROR` en Logcat. El override es un no-op que ejecuta `fn()` directamente:
> ```typescript
> lock: (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn()
> ```
> No eliminar — sin este override, `@supabase/auth-js` intenta adquirir un lock que nunca se libera correctamente en Capacitor.

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

#### Patrón C: Mutaciones críticas con timeout + feedback propio (2026-07-18)

Para mutaciones de peso donde una red "conectada pero rota" no puede dejar un spinner eterno, y el caller necesita distinguir "sin red" / "timeout" / "error de negocio" para dar su propio feedback (overlay, mensaje inline en un modal, etc.) — usar `timeoutMs` + `silentError`:

```typescript
try {
  const response = await this.supabase.call(
    this.supabase.client.rpc('fn_operacion_critica', params),
    undefined,
    { timeoutMs: 20_000, silentError: true }
  );
  if (response === null) { /* sin red — el banner global ya avisa, no mostrar nada */ }
  // ... procesar response.success / response.error normalmente
} catch (error: any) {
  // silentError RELANZA (nunca traga) tanto el TimeoutError como una excepción de
  // negocio real (RAISE EXCEPTION del RPC) — el caller decide el feedback exacto:
  if (this.supabase.debeSilenciarErrorOffline(error)) return;               // sin red
  const esFalloDeRed = error instanceof TimeoutError || this.supabase.esErrorDeTransporte(error);
  // esFalloDeRed → overlay "El servidor no respondió..."
  // !esFalloDeRed → error.message es el motivo real del RPC (mostrar tal cual)
}
```

| Opción | Efecto |
| --- | --- |
| `timeoutMs` | Envuelve la promesa con `conTimeout()` (`core/utils/timeout.util.ts`, exporta también `TimeoutError`). Al vencer, `call()` **relanza** `TimeoutError` — nunca lo convierte en `null`. El `finally` de `call()` sigue garantizando `hideLoading()`. |
| `silentError` | `call()` no muestra su toast automático; **relanza** el error (negocio o transporte) para que el caller decida. Excepciones que se mantienen igual: "sin red" retorna `null` (no lanza — el banner global ya avisa) y JWT expirado limpia sesión igual (es seguridad, no UX). |

Implementado por `TurnosCajaService.abrirTurno()` / `.repararDeficit()` y `RecargasService.ejecutarCierreDiario()` — ver `docs/caja/8_PROCESO_ABRIR_CAJA.md` §11 para el contrato `TurnoMutacionResult` completo (clasificación centralizada `'silenciar' | 'red' | 'mensaje'`). Úsalo como referencia si necesitas el mismo patrón en otra mutación crítica — no reinventar la clasificación en cada feature.

#### Errores offline — no mostrar toast (el banner global ya avisa)

El `<app-offline-banner>` es la **única** señal de offline en toda la app. Mostrar además un toast
"Error al cargar..." al entrar a una sección sin red es redundante. Hay dos casos:

**Caso 1 — la query pasa por `call()` (lo normal):** ya está resuelto en la fuente. `call()` detecta el error
de transporte estando offline y devuelve `null` **sin** mostrar toast. No hay que hacer nada en el componente.

**Caso 2 — el servicio usa `this.supabase.client` directo y hace `throw` (con catch propio en la página):**
el componente guarda su `showError` detrás del helper público `debeSilenciarErrorOffline()`:

```typescript
private supabase = inject(SupabaseService);

async cargarHistorial() {
  try {
    this.items = await this.miServicio.obtenerHistorial(); // usa .client directo, hace throw
  } catch (error) {
    // Sin red → no mostrar toast (el banner ya avisa). Errores reales del servidor sí se muestran.
    if (!this.supabase.debeSilenciarErrorOffline(error)) {
      await this.ui.showError('Error al cargar el historial');
    }
  }
}
```

`debeSilenciarErrorOffline(error)` = `!isConnected() && esErrorDeTransporte(error)`. Evalúa el **objeto error
original** (ausencia de `code` de PostgREST + mensaje de fetch = la request no llegó al servidor), no el texto
del mensaje — más robusto que adivinar palabras. Las validaciones (mensajes de formulario) NO son errores de
transporte → se siguen mostrando aunque no haya red.

> **Regla de qué toast se muestra offline:** errores de **carga** de datos por red → silenciar. Errores de
> **acción/validación** ("Ingresa el monto", saldo insuficiente) → mostrar siempre. Ver `PLAN-OFFLINE-POS-2026-06-08.md` §13.2.

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

Punto único para captura, recorte, compresión y subida de imágenes a Supabase Storage. Cualquier módulo que necesite fotografiar o subir imágenes debe usar este servicio — **nunca** llamar a `Camera.getPhoto` directamente.

#### API pública — flujo recomendado

| Método | Cuándo usar |
|--------|-------------|
| `elegirFuenteFoto(initialRatio?, lockRatio?, withCrop?)` | **Flujo principal para fotos del catálogo.** Elige fuente (cámara/galería) → abre el cropper → devuelve el recorte listo. Defaults: `initialRatio: 'libre'`, `lockRatio: true`. `withCrop: false` salta el cropper (para comprobantes que no requieren recorte). |
| `recortarImagen(imageUrl, initialRatio?, lockRatio?)` | Re-cropea una imagen existente sin retomar la foto. Útil para "Recortar de nuevo" sobre una foto ya capturada o una signed URL del bucket. Defaults: `initialRatio: 'libre'`, `lockRatio: true`. |
| `mostrarOpcionesImagen()` | Abre el menú estándar con "Recortar de nuevo / Cambiar imagen / Quitar imagen". Devuelve la acción elegida (`'recortar' \| 'cambiar' \| 'quitar' \| null`) para que el caller decida. |
| `uploadImage(imageUrl, subfolder, useDatePrefix?)` | Comprime a WebP y sube a Storage. Acepta `data:`, `blob:`, `capacitor://` o `http(s)://`. Retorna `path \| null`. El bucket es fijo (`mi-tienda`), el caller solo pasa el `subfolder`. |
| `replaceImage(newImageUrl, subfolder, oldPath, useDatePrefix?)` | Sube nueva + elimina anterior atómicamente. Si el upload falla retorna null y no toca `oldPath`. |
| `getSignedUrl(path, expiresIn?)` | URL firmada temporal (default: 1h). Para buckets privados como `comprobantes`. |
| `getPublicUrl(path)` | URL pública directa. Solo para buckets/subfolders públicos. |
| `resolveImageUrl(path)` / `resolveImageUrls(paths[])` | Resuelve path → URL mostrable por `<img>`. Si ya es una URL renderizable la retorna tal cual **sin intentar firmarla** — reconoce los prefijos `http(s):`, `blob:` (object URL de un binario local, `ImagenLocalService`/IndexedDB en web), `data:` (base64) y `capacitor:` (convertFileSrc en iOS). Antes solo reconocía `http:` — un `blob:`/`data:` heredado (ej. la imagen del template que hereda una variante sin foto propia) se enviaba a `getSignedUrl()` y fallaba con 400 "Object not found" (fix 2026-07-17). Orden de resolución si es un path crudo de Storage: **(1) binario local en disco** (`ImagenLocalService` — se ve offline y sobrevive cold start) → (2) signed URL en cache RAM → (3) online: firmar + descargar el binario en background → (4) offline sin binario: `null` (placeholder). Versión plural usa `Promise.all`. |
| `deleteFile(path)` | Elimina un archivo. Usar para rollback si el RPC falla después de subir. |
| `deleteNegocioFolder(negocioId)` | **Uso exclusivo del flujo de purga de negocios** (`docs/suscripcion/SUSCRIPCION-README.md`, sección "Purga automática de negocios vencidos"). Borra recursivamente TODO el contenido de `{negocioId}/` en el bucket, sin hardcodear nombres de subcarpeta. No llamar desde ningún flujo normal de la app ni exponer en menús de usuario — es irreversible y borra absolutamente todo lo del negocio. |
| `capturarFoto(source)` | **Bajo nivel** — solo abre cámara/galería sin cropper. Prefiere `elegirFuenteFoto()` que incluye el flujo completo. |

#### Flujo principal — selección + recorte + upload

```typescript
import { SafeUrl } from '@angular/platform-browser';
private storageService = inject(StorageService);

fotoPreviewUrl: SafeUrl | null = null;
fotoRawUrl: string | null = null;

async seleccionarFoto() {
  // default: ratio libre, selector de ratios oculto (lockRatio: true)
  const result = await this.storageService.elegirFuenteFoto();
  if (!result) return;
  this.fotoPreviewUrl = result.previewUrl;
  this.fotoRawUrl     = result.rawUrl;  // blob: URL del recorte
}

async guardar() {
  if (!this.fotoRawUrl) return;
  const path = await this.storageService.uploadImage(this.fotoRawUrl, 'productos/bebidas', false);
  // path queda como '{negocio_id}/productos/bebidas/{uuid}.webp'
}
```

```html
<img [src]="fotoPreviewUrl" alt="Preview" />
```

#### Patrón menú "Recortar / Cambiar / Quitar"

Cuando ya hay una imagen en el formulario, ofrecer al usuario las 3 opciones en un solo menú:

```typescript
async abrirOpcionesImagen() {
  const accion = await this.storageService.mostrarOpcionesImagen();
  if (!accion) return;

  if (accion === 'quitar') { this.fotoPreviewUrl = null; this.fotoRawUrl = null; return; }
  if (accion === 'cambiar') return this.seleccionarFoto();

  // 'recortar' — re-cropea sin retomar la foto
  const url = this.fotoRawUrl ?? this.imagenUrlExistente;
  if (!url) return this.seleccionarFoto();

  const result = await this.storageService.recortarImagen(url);
  if (!result) return;
  this.fotoPreviewUrl = result.previewUrl;
  this.fotoRawUrl     = result.rawUrl;
}
```

> Patrón implementado en [producto-info-form](../../src/app/features/inventario/components/producto-info-form/) y [presentacion-modal](../../src/app/features/inventario/components/presentacion-modal/). Ambos usan un flag `procesandoImagen` para evitar aperturas concurrentes por doble-tap.

#### Saltar el cropper (comprobantes)

Para comprobantes de caja que no necesitan recorte, pasar `withCrop: false`:

```typescript
// Comprobante de operación manual — la foto se sube tal cual
const result = await this.storageService.elegirFuenteFoto('libre', false, false);
```

#### Calidad del pipeline

Los parámetros están afinados para mantener calidad sin inflar el tamaño:

| Etapa | Parámetro | Valor |
|-------|-----------|-------|
| Captura cámara | `quality` | `92` |
| Captura cámara | `width × height` | `1920 × 1920` |
| Cropper output | `format` | `png` (lossless durante el crop) |
| Cropper output | `resizeToWidth/Height` | `1600` con `onlyScaleDown: true` |
| Compresión final | Formato | WebP (fallback JPEG) |
| Compresión final | Calidad | `0.92` |
| Compresión final | `MAX_SIDE` | `1600px` |
| Compresión final | `imageSmoothingQuality` | `'high'` |

**Por qué PNG en el cropper:** evita la doble compresión lossy. El recorte se entrega sin pérdida y la única compresión real ocurre en `uploadImage` al subir.

#### Manejo de memoria (blob URLs)

Toda la cadena trabaja con `Blob` y `blob:` URLs en lugar de strings base64. Beneficios:
- Una imagen 1600×1600 ocupa ~600 KB de blob en vez de ~6 MB de base64
- El cropper emite blobs ligeros en cada movimiento del recuadro
- `compressImage` decodifica blob URLs vía `<img src>` sin pasar por data URL gigante
- `ImageCropperModalComponent` revoca sus blob URLs en `ngOnDestroy`

#### Estructura en Storage

Bucket único `mi-tienda` con aislamiento por `negocio_id`:

```
mi-tienda/{negocio_id}/
  comprobantes/YYYY/MM/operaciones/{uuid}.webp  ← bucket privado (signed URL)
  productos/{subfolder}/{uuid}.webp             ← acceso vía signed URL (useDatePrefix=false)
```

Ver [CLAUDE.md → Storage multi-tenant](../../CLAUDE.md) para reglas RLS y conventions.

#### Patrón rollback

```typescript
const path = await this.storageService.uploadImage(rawUrl, 'comprobantes/operaciones');
if (!path) return; // error ya mostrado por el servicio

const { error } = await supabase.rpc('fn_mi_operacion', { p_comprobante_url: path });
if (error) {
  await this.storageService.deleteFile(path); // rollback: no dejar huérfanos en Storage
}
```

Para actualizar imagen + borrar anterior atómicamente, preferir `replaceImage()`:

```typescript
const newPath = await this.storageService.replaceImage(rawUrl, 'productos/bebidas', oldPath, false);
// Si el upload falla, oldPath queda intacto
```

#### Cropper modal

El recortador vive en `shared/components/image-cropper-modal/`. No se invoca directamente — se accede vía `elegirFuenteFoto()` o `recortarImagen()`. Ver [SHARED-README → app-image-cropper-modal](../shared/SHARED-README.md) para detalles del componente.

---

### WhatsAppService (`core/services/whatsapp.service.ts`)

Centraliza la apertura de chats de WhatsApp con mensaje precargado. Gestiona la normalización del teléfono al formato internacional Ecuador (`593...`) que exige `api.whatsapp.com`. Cualquier feature que necesite enviar un mensaje por WhatsApp debe usar este servicio — nunca construir la URL directamente.

```typescript
private whatsapp = inject(WhatsAppService);

// Abrir WhatsApp con mensaje precargado (retorna false si el teléfono está vacío)
const ok = this.whatsapp.abrir('0991234567', [
  'Hola, línea 1',
  'Línea 2 del mensaje',
]);
if (!ok) this.ui.showToast('No hay teléfono configurado', 'warning');

// Normalizar un teléfono sin abrir WhatsApp (ej: para validar antes)
const tel = this.whatsapp.normalizarTelefono('0991234567'); // → '593991234567'
```

Acepta cualquier formato de entrada (`0XXXXXXXXX`, `+593...`, `593...`) y lo convierte al formato `593XXXXXXXXX`. Si el número está vacío o es inválido, `abrir()` devuelve `false` sin abrir nada. Usado en: `SuscripcionPage`, `ShareCierreService`, `ShareEstadoCuentaService`, `AdminNegociosPage`.

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

## Servicios del modo offline (POS + calle)

Capa de datos local que permite cobrar y operar sin internet. Planes completos:
`docs/guides/PLAN-OFFLINE-POS-2026-06-08.md` (POS: cobrar sin red) y
`docs/guides/PLAN-OFFLINE-CALLE-2026-07-03.md` (calle: catálogo/clientes/ventas/fotos offline).

### LocalDbService (`core/services/local-db.service.ts`)

Abstracción de almacenamiento local con patrón adaptador. **Android/iOS** → SQLite nativo
(`@capacitor-community/sqlite`); **Web** → IndexedDB nativo del browser (sin jeep-sqlite, por su bug de wasm).
API uniforme `run()`/`query()`/`execute()`. Una DB por `negocio_id` (`mi_tienda_<id>`). Tablas:
`outbox_ventas`, `outbox_clientes`, `turno_activo_local`, `cache_catalogo`, `cache_clientes`, `cache_ventas_dia`.

> **Versionado dual:** `SCHEMA_VERSION` (parámetro del plugin SQLite nativo) **no se sube** al agregar
> tablas — `CREATE TABLE IF NOT EXISTS` en `_open()` ya las crea. `IDB_VERSION` (IndexedDB web) **sí se
> sube** por cada tabla nueva (los object stores solo se crean en `onupgradeneeded`) — y hay que agregar
> la tabla al mapa `primaryKeys`. Actualmente `IDB_VERSION = 3`.

### CatalogoLocalService (`core/services/catalogo-local.service.ts`)

Cache de solo lectura del catálogo aplanado (`ProductoPOS[]`) + categorías. Doble nivel: SQLite/IndexedDB +
**cache RAM** (evita re-leer la DB y re-parsear JSON en cada filtro offline → filtros instantáneos). Replica
offline `fn_catalogo_productos_pos`, `fn_buscar_productos_pos` y el lookup por código de barras, en memoria.
Stock cacheado es **optimista** — la verdad la define el servidor al sincronizar.

### ClientesLocalService (`core/services/clientes-local.service.ts`)

Espejo de `CatalogoLocalService` para clientes registrados (`cache_clientes`, cap 5000). Réplica de solo
lectura para el selector del POS y la sección Clientes offline. Métodos: `guardar`, `buscarPorTexto`,
`buscarPorIdentificacion`, `obtenerTodos`, `agregarUno` (alta local instantánea de un cliente creado offline),
`obtenerTimestamp` (sello de frescura).

### VentasLocalService (`core/services/ventas-local.service.ts`)

Snapshot de la primera página del listado de ventas **del día actual** (`cache_ventas_dia`). Solo la vista
default (filtro `hoy`, página 0, sin búsqueda/estado/turno) escribe/lee este snapshot. Se invalida por fecha
local (un snapshot de ayer no se sirve). Métodos: `guardar`, `obtener`, `obtenerTimestamp`.

### ImagenLocalService (`core/services/imagen-local.service.ts`)

Persiste los **binarios** de las fotos del catálogo localmente para que se vean offline tras un cold start /
recarga de pestaña (el `signedUrlCache` de `StorageService` es solo RAM y muere con el proceso; una signed URL
además expira a 60 min). Se alimenta desde el priming de Fase P (`SyncService`). Métodos públicos: `obtenerLocal`
(path → URL local), `descargar` (un path), `precargarCatalogo` (lote + poda de huérfanos). `StorageService.resolveImageUrl`
lo prioriza sobre la firma.

**Multiplataforma vía adaptador por backend (`ImagenStore`, desde 2026-07-14)** — antes era solo nativo (web
era no-op y las fotos NO se veían offline en modo web). El servicio elige el store una vez en el constructor
según `Capacitor.isNativePlatform()`:
- **Nativo** → `FilesystemStore` (`Directory.Data/catalogo-img/{hash}.ext`, lectura vía `convertFileSrc`).
- **Web** → `IndexedDbStore` (DB `mi-tienda-img`, object store `binarios`, guarda `Blob`, lectura vía `URL.createObjectURL` cacheado en RAM y revocado al podar).

No se apoya en `LocalDbService` (el motor SQL-like de `cache_catalogo`/outbox) a propósito: ese motor es para
filas de texto/JSON; los blobs binarios pesados van en su propia DB, separada del catálogo.

### TurnoLocalService (`core/services/turno-local.service.ts`)

Snapshot del turno YA ABIERTO (`turno_activo_local`). Destraba el cobro offline: `PosService` y
`cajaAbiertaGuard` leían el turno del servidor (null sin red → POS bloqueado). CRUD `guardar`/`obtener`/`borrar`.
Lo sincroniza `TurnosCajaService.sincronizarSnapshotLocal()` **solo con red** (offline un null puede ser "query
falló", no "no hay turno" → no se borra el snapshot válido).

### OutboxService (`core/services/outbox.service.ts`)

Cola durable de ventas pendientes en `outbox_ventas` (estados `PENDING`/`SYNCING`/`SYNCED`/`ERROR`). Guarda el
**payload crudo** del RPC (no recalcula nada local). Expone `pendientes$` (contador reactivo) que alimenta el
badge del banner y la tab Pendientes. Métodos: `encolar`, `obtenerPendientes`, `marcarEstado`, `eliminar`,
`refrescarContador`, `remapearClienteId` (reescribe el `clienteId` de ventas encoladas tras el upsert de un
cliente creado offline — ver Fase D del plan de calle).

### OutboxClientesService (`core/services/outbox-clientes.service.ts`)

Cola durable de clientes creados offline (`outbox_clientes`), espejo de `OutboxService`. El cliente recibe un
UUID generado en el dispositivo (válido como PK real) y se drena **antes** que las ventas que lo referencian.
Métodos: `encolar`, `obtenerPendientes`, `marcarEstado`, `eliminar`. No alimenta ningún badge (se drena
silenciosamente antes de las ventas).

### SyncService (`core/services/sync.service.ts`)

Dos responsabilidades:
1. **Drenado del outbox** contra `fn_registrar_venta_pos` al volver la red. **FIFO estricto** con corte al
   primer error para preservar el orden del ledger. Distingue error de red (deja `PENDING`, reintenta) de error
   de datos (`ERROR`/dead-letter). La `idempotency_key UNIQUE` hace el reenvío 100% seguro. **Orden entre colas:**
   drena `outbox_clientes` a completitud **antes** de `outbox_ventas` (una venta puede referenciar un cliente
   que también es offline; su UUID debe existir en el servidor antes de subir la venta).
2. **Priming offline (Fase P)** — `precalentarOffline()`: descarga catálogo + categorías + clientes + CF + los
   **binarios de las fotos** a disco, en los momentos con red garantizada (arranque con sesión, reconexión,
   apertura de turno). Reentrante-seguro (`primingEnCurso`), salta si el snapshot es fresco (`< 12 min`), y en
   el arranque se difiere unos segundos para no competir con la RPC del Home. Best-effort, nunca muestra toast.

> **Errores offline:** el silenciado de toasts de red está centralizado en `SupabaseService.call()` (y el helper
> público `debeSilenciarErrorOffline()` para las queries con `.client` directo). El `<app-offline-banner>` global
> es la única señal de offline. Los toasts de acción concreta (ej: "Venta guardada") sí se muestran. Ver la
> subsección "Errores offline" arriba (SupabaseService) y §13.2 del plan.

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
