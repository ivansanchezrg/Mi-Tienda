# Guía Completa: Sistema de Operaciones con Comprobantes y Categorías

**Fecha:** 2026-02-09 (actualizado)
**Versión:** 2.0
**Autor:** Claude Code

---

## 📋 Resumen

Sistema completo para registro de operaciones de ingreso y egreso con:

### ✅ Comprobantes Fotográficos (v1.0)
- **Obligatorios** para egresos
- **Opcionales** para ingresos
- Optimización automática de imágenes (1200x1600px, ~90% reducción)
- Almacenamiento en Supabase Storage (bucket privado)

### ✅ Categorías Contables (v2.0)
- **Obligatorias** para todas las operaciones
- 12 categorías predefinidas (9 egresos + 3 ingresos)
- Clasificación contable para reportes
- Trazabilidad completa de gastos e ingresos

---

## 🎯 Funcionalidad

### Desde la perspectiva del usuario:

1. Usuario hace clic en **3 puntos** de una caja → **"Ingreso"** o **"Egreso"**
2. Se abre modal con formulario
3. **Usuario selecciona categoría contable** (obligatorio)
4. Usuario ingresa monto
5. Usuario captura/selecciona foto del comprobante (obligatorio para egresos)
6. Usuario completa descripción (opcional para ingresos, obligatorio para egresos)
7. Usuario confirma
8. Sistema sube foto a Supabase Storage (si hay)
9. Sistema registra operación en BD con categoría y comprobante
10. Sistema actualiza saldo de la caja

---

## 📦 Dependencias

### NPM Packages:

```json
{
  "@capacitor/camera": "^8.0.0"
}
```

### Instalación:

```bash
npm install @capacitor/camera
npx cap sync android
```

### ⚠️ Nota para Web:

En **web** la cámara requiere PWA Elements (opcional). Para desarrollo, usa **"Seleccionar de galería"** o prueba en Android.

### Permisos Android (`android/app/src/main/AndroidManifest.xml`):

```xml
<!-- Camera Permissions -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
                 android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
                 android:maxSdkVersion="29" />

<uses-feature android:name="android.hardware.camera" android:required="false" />
```

---

## 📁 Estructura de Archivos

```
src/app/
├── core/
│   └── services/
│       ├── supabase.service.ts        # Cliente de Supabase
│       └── storage.service.ts         # 🆕 Servicio de Storage (subida de imágenes)
│
├── features/
│   ├── auth/
│   │   └── services/
│   │       └── auth.service.ts        # Obtener empleado actual
│   │
│   └── dashboard/
│       ├── components/
│       │   └── operacion-modal/
│       │       ├── operacion-modal.component.ts       # 🔄 Modal con cámara
│       │       ├── operacion-modal.component.html     # 🔄 UI de captura
│       │       └── operacion-modal.component.scss     # 🔄 Estilos
│       │
│       ├── models/
│       │   └── operacion-caja.model.ts               # 🔄 +comprobante_url
│       │
│       ├── pages/
│       │   └── home/
│       │       ├── home.page.ts                      # 🔄 Coordinador principal
│       │       ├── home.page.html                    # UI con menú 3 puntos
│       │       └── home.page.scss                    # Estilos
│       │
│       ├── services/
│       │   └── operaciones-caja.service.ts           # 🔄 Lógica de negocio
│       │
│       └── docs/
│           └── COMPROBANTES-OPERACIONES.md           # 📄 Este documento
```

**Leyenda:**

- 🆕 Archivo nuevo
- 🔄 Archivo modificado
- 📄 Documentación

---

## 🔄 Flujo Completo (Step by Step)

### **PASO 1: Usuario abre modal**

**Archivo:** `home.page.ts` (línea ~257)

```typescript
async mostrarMenuCaja(event: Event, tipo: string) {
  const actionSheet = await this.actionSheetCtrl.create({
    buttons: [
      {
        text: 'Ingreso',
        handler: () => this.onOperacion('ingreso', tipo)  // ← Llama a onOperacion
      },
      // ...
    ]
  });
  await actionSheet.present();
}
```

---

### **PASO 2: Home abre OperacionModal**

**Archivo:** `home.page.ts` (línea ~257-293)

```typescript
async onOperacion(tipo: string, tipoCaja?: string) {
  const tipoOperacion = tipo.toUpperCase() as 'INGRESO' | 'EGRESO';

  // Obtener ID de caja pre-seleccionada
  let cajaIdPreseleccionada: number | undefined;
  if (tipoCaja) {
    const cajas = { 'caja': 1, 'cajaChica': 2, 'celular': 3, 'bus': 4 };
    cajaIdPreseleccionada = cajas[tipoCaja as keyof typeof cajas];
  }

  // Crear modal
  const modal = await this.modalCtrl.create({
    component: OperacionModalComponent,
    componentProps: {
      tipo: tipoOperacion,
      cajas: this.cajas,
      cajaIdPreseleccionada  // ← Pre-selecciona la caja
    }
  });

  await modal.present();
  const { data, role } = await modal.onDidDismiss<OperacionModalResult>();

  // Si confirma, ejecutar operación
  if (role === 'confirm' && data) {
    await this.ejecutarOperacion(tipoOperacion, data);  // ← Pasa al PASO 7
  }
}
```

**Interface del resultado:**

```typescript
export interface OperacionModalResult {
  cajaId: number;
  categoriaId: number;             // ← Categoría contable seleccionada
  monto: number;
  descripcion: string;
  fotoComprobante: string | null;  // ← DataURL de la imagen
}
```

---

### **PASO 3: Usuario captura/selecciona foto**

**Archivo:** `operacion-modal.component.ts` (línea ~131-148)

```typescript
async seleccionarFoto() {
  // Mostrar action sheet con opciones
  const actionSheet = await this.actionSheetCtrl.create({
    header: 'Seleccionar comprobante',
    buttons: [
      {
        text: 'Tomar foto',
        icon: 'camera-outline',
        handler: () => this.tomarFoto(CameraSource.Camera)  // ← Cámara
      },
      {
        text: 'Seleccionar de galería',
        icon: 'images-outline',
        handler: () => this.tomarFoto(CameraSource.Photos)  // ← Galería
      },
      // ...
    ]
  });
  await actionSheet.present();
}
```

---

### **PASO 4: Capturar imagen con Capacitor Camera**

**Archivo:** `operacion-modal.component.ts` (línea ~150-164)

```typescript
async tomarFoto(source: CameraSource) {
  try {
    const image = await Camera.getPhoto({
      quality: 80,              // Calidad 80% (balance calidad/tamaño)
      allowEditing: false,      // Sin edición
      resultType: CameraResultType.DataUrl,  // ← Retorna base64
      source: source,           // Camera o Photos
      width: 1200,              // ⚡ Limitar ancho máximo a 1200px
      height: 1600,             // ⚡ Limitar alto máximo a 1600px
      correctOrientation: true  // ⚡ Corregir orientación EXIF
    });

    this.fotoComprobante = image.dataUrl || null;  // ← Guardar DataURL
    this.cdr.detectChanges();  // ← Forzar detección de cambios (para web)
  } catch (error) {
    console.error('Error al tomar/seleccionar foto:', error);
  }
}
```

**⚡ Optimización de Tamaño:**

- **Sin optimización**: Fotos de 4000x3000px = 3-10 MB
- **Con optimización**: Fotos de 1200x900px = 200-500 KB
- **Reducción**: ~90% menos tamaño sin pérdida visible de calidad
- **Beneficios**: Carga más rápida, menos storage usado, mejor UX

**Formato de DataURL:**

```
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCE...
```

---

### **PASO 5: Usuario confirma**

**Archivo:** `operacion-modal.component.ts` (línea ~166-186)

```typescript
confirmar() {
  if (this.form.invalid) {
    this.form.markAllAsTouched();
    return;
  }

  if (this.montoExcedeSaldo) {
    return;
  }

  // Validar comprobante obligatorio para egresos
  if (!this.esIngreso && !this.fotoComprobante) {
    return;  // ← Bloquea si es egreso sin foto
  }

  const result: OperacionModalResult = {
    cajaId: this.form.value.cajaId,
    monto: this.form.value.monto,
    descripcion: this.form.value.descripcion || '',
    fotoComprobante: this.fotoComprobante  // ← Incluye la foto
  };

  this.modalCtrl.dismiss(result, 'confirm');  // ← Retorna al home
}
```

---

### **PASO 6: Validación en UI**

**Archivo:** `operacion-modal.component.html` (línea ~69-78)

```html
<button
  class="submit-btn"
  [class.ingreso]="esIngreso"
  [class.egreso]="!esIngreso"
  [disabled]="form.invalid || montoExcedeSaldo || (!esIngreso && !fotoComprobante)"
  (click)="confirmar()">
  <span>{{ esIngreso ? 'Confirmar Ingreso' : 'Confirmar Egreso' }}</span>
</button>
```

**Condiciones de deshabilitación:**

- ✅ Formulario inválido
- ✅ Monto excede saldo (solo egresos)
- ✅ Es egreso Y no hay foto

---

### **PASO 7: Home ejecuta operación**

**Archivo:** `home.page.ts` (línea ~295-305)

```typescript
private async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
  // El servicio maneja loading, empleado, subida de foto y guardado
  const success = await this.operacionesCajaService.registrarOperacion(
    data.cajaId,
    tipo,
    data.categoriaId,     // ← Categoría contable seleccionada
    data.monto,
    data.descripcion,
    data.fotoComprobante  // ← Pasa la foto al servicio
  );

  if (success) {
    await this.cargarDatos();  // ← Recargar datos para actualizar UI
  }
}
```

---

### **PASO 8: Servicio sube foto a Storage**

**Archivo:** `operaciones-caja.service.ts` (línea ~91-150)

```typescript
async registrarOperacion(
  cajaId: number,
  tipo: 'INGRESO' | 'EGRESO',
  categoriaId: number,         // ← Categoría contable (obligatorio)
  monto: number,
  descripcion: string,
  fotoComprobante: string | null
): Promise<boolean> {
  try {
    let pathImagen: string | null = null;

    // 1️⃣ Si hay foto, subirla primero a Storage
    if (fotoComprobante) {
      await this.ui.showLoading('Subiendo comprobante...');

      pathImagen = await this.storageService.uploadImage(fotoComprobante);
      //                  ↑ Llama a StorageService

      if (!pathImagen) {
        await this.ui.hideLoading();
        await this.ui.showError('Error al subir el comprobante.');
        return false;
      }

      await this.ui.hideLoading();
    }

    // 2️⃣ Obtener empleado actual
    const empleado = await this.authService.getEmpleadoActual();
    if (!empleado) {
      await this.ui.showError('No se pudo obtener información del empleado');
      return false;
    }

    // 3️⃣ Llamar a función PostgreSQL
    await this.ui.showLoading(`Registrando ${tipo.toLowerCase()}...`);

    // ⚠️ IMPORTANTE: Guardamos el PATH, no la URL
    // Esto permite generar signed URLs cuando se necesiten
    const { data, error } = await this.supabase.client.rpc('registrar_operacion_manual', {
      p_caja_id: cajaId,
      p_empleado_id: empleado.id,
      p_tipo_operacion: tipo,
      p_categoria_id: categoriaId,       // ← Categoría contable (obligatorio)
      p_monto: monto,
      p_descripcion: descripcion || null,
      p_comprobante_url: pathImagen      // ← PATH de la imagen, no URL
    });

    await this.ui.hideLoading();

    // 4️⃣ Verificar errores
    if (error || !data || !data.success) {
      // Si falla, eliminar imagen huérfana
      if (pathImagen) {
        await this.storageService.deleteFile(pathImagen);
      }
      await this.ui.showError(data?.error || 'Error al registrar la operación');
      return false;
    }

    await this.ui.showSuccess(`${tipo} registrado correctamente`);
    return true;

  } catch (error) {
    console.error('Error en registrarOperacion:', error);
    await this.ui.hideLoading();
    await this.ui.showError('Error inesperado');
    return false;
  }
}
```

---

### **PASO 9: StorageService sube a Supabase**

**Archivo:** `storage.service.ts` (línea ~16-43)

```typescript
async uploadImage(dataUrl: string, bucket: string = 'comprobantes'): Promise<string | null> {
  try {
    // 1. Convertir DataURL a Blob
    const blob = this.dataURLtoBlob(dataUrl);

    // 2. Generar nombre único con estructura de carpetas por fecha
    const fileName = this.generateFileName();
    // Ejemplo: "2026/02/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg"

    // 3. Subir a Supabase Storage
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .upload(fileName, blob, {
        contentType: 'image/jpeg',
        upsert: false  // No sobrescribir
      });

    if (error) {
      console.error('Error al subir imagen:', error);
      return null;
    }

    // 4. Retornar el path del archivo
    return data.path;
  } catch (error) {
    console.error('Error en uploadImage:', error);
    return null;
  }
}
```

**Métodos auxiliares:**

```typescript
// Convierte DataURL (base64) a Blob
private dataURLtoBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);  // Decodificar base64
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Genera nombre único: YYYY/MM/{uuid}.jpg
private generateFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uuid = crypto.randomUUID();

  return `${year}/${month}/${uuid}.jpg`;
}
```

**Obtener URL firmada (signed URL) para buckets privados:**

```typescript
async getSignedUrl(path: string, bucket: string = 'comprobantes', expiresIn: number = 3600): Promise<string | null> {
  try {
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);  // Expira en 1 hora por defecto

    if (error) {
      console.error('Error al crear URL firmada:', error);
      return null;
    }

    return data.signedUrl;
  } catch (error) {
    console.error('Error en getSignedUrl:', error);
    return null;
  }
}
```

**Obtener URL pública (solo para buckets públicos):**

```typescript
getPublicUrl(path: string, bucket: string = 'comprobantes'): string | null {
  try {
    const { data } = this.supabase.client.storage
      .from(bucket)
      .getPublicUrl(path);

    return data.publicUrl;
  } catch (error) {
    console.error('Error al obtener URL pública:', error);
    return null;
  }
}
```

**⚠️ Nota:** Como el bucket `comprobantes` es **privado**, usamos `getSignedUrl()` que genera URLs temporales con token de autenticación.

---

### **PASO 10: Función PostgreSQL guarda todo**

**Archivo:** Función en Supabase (ver sección SQL al final)

**¿Qué hace la función?**

1. **Obtiene saldo anterior** de la caja (con `FOR UPDATE` para lock)
2. **Calcula nuevo saldo** según tipo de operación
3. **Valida saldo insuficiente** (solo egresos)
4. **Actualiza saldo** de la caja
5. **Inserta operación** con todos los campos:
   - `saldo_anterior`
   - `saldo_actual`
   - `comprobante_url` (PATH, no URL)
6. **Retorna JSON** con resultado

**Todo en una transacción atómica:** Si algo falla, rollback completo.

---

## 🔍 Visualización de Comprobantes

### **Mostrar comprobantes en lista de operaciones**

**Archivo:** `operaciones-caja.page.html`

```html
<span class="op-amount">+$50.00</span>

<!-- Icono si tiene comprobante -->
@if (op.comprobante_url) {
  <button class="comprobante-btn" (click)="verComprobante(op.comprobante_url)">
    <ion-icon name="document-attach-outline"></ion-icon>
  </button>
}
```

### **Generar signed URL y abrir modal**

**Archivo:** `operaciones-caja.page.ts`

```typescript
async verComprobante(path: string) {
  // Generar URL firmada desde el path guardado en BD
  await this.ui.showLoading('Cargando comprobante...');

  const signedUrl = await this.storageService.getSignedUrl(path);

  await this.ui.hideLoading();

  if (!signedUrl) {
    await this.ui.showError('No se pudo cargar el comprobante');
    return;
  }

  // Abrir modal con la imagen
  const modal = await this.modalCtrl.create({
    component: ComprobanteModalComponent,
    componentProps: { url: signedUrl },
    cssClass: 'comprobante-modal'
  });
  await modal.present();
}
```

**¿Por qué generar la URL al momento de mostrar?**

- ✅ El PATH nunca expira, la URL sí
- ✅ Más flexible (podemos cambiar tiempo de expiración)
- ✅ Más seguro (URLs temporales)

---

## ⚡ Optimización de Imágenes

### ¿Por qué optimizar?

**Problema sin optimización:**

- Cámaras modernas: 12-48 megapíxeles
- Resoluciones típicas: 4000x3000 px o más
- Tamaño de archivos: 3-10 MB por foto
- Para 100 comprobantes: ~500 MB - 1 GB

**Problema real:**

- ❌ Storage caro en Supabase
- ❌ Carga lenta en conexiones malas
- ❌ Desperdicio de ancho de banda
- ❌ Experiencia de usuario deficiente

### ¿Supabase comprime automáticamente?

**NO.** Supabase Storage guarda **exactamente** lo que le mandas. No hay compresión automática, no hay redimensionamiento.

### Nuestra Solución

**Optimización en el cliente (antes de subir):**

```typescript
Camera.getPhoto({
  quality: 80,              // JPEG quality 80% (excelente balance)
  width: 1200,              // Máximo 1200px de ancho
  height: 1600,             // Máximo 1600px de alto
  correctOrientation: true  // Corregir rotación EXIF
});
```

**Parámetros explicados:**

1. **`quality: 80`**
   
   - Rango: 0-100
   - 80 = excelente calidad con buen tamaño
   - 100 = sin compresión (archivos gigantes)
   - 60 = calidad aceptable (más compresión)

2. **`width: 1200`**
   
   - Limita ancho máximo
   - Mantiene aspect ratio (proporción)
   - Para comprobantes, 1200px es más que suficiente

3. **`height: 1600`**
   
   - Limita alto máximo
   - Fotos verticales quedan bien

4. **`correctOrientation: true`**
   
   - ⚠️ **MUY IMPORTANTE**
   - Corrige rotación según datos EXIF de la cámara
   - Sin esto, fotos aparecen rotadas

### Resultados

**Antes (sin optimización):**

- Resolución: 4000x3000 px
- Tamaño: 3-8 MB
- Tiempo de carga: 5-15 segundos

**Después (con optimización):**

- Resolución: 1200x900 px (aprox)
- Tamaño: 200-500 KB
- Tiempo de carga: 1-2 segundos

**Reducción:** ~90% menos tamaño, sin pérdida visible de calidad para comprobantes.

### ¿Es suficiente 1200px para comprobantes?

**SÍ.** Para referencia:

- Pantalla Full HD: 1920x1080 px
- Pantalla de celular: ~400-500 px de ancho
- Impresión A4 a 150 DPI: 1240x1754 px
- **1200px es más que suficiente** para ver detalles de un ticket/factura

### Alternativas avanzadas

Si necesitas más control, puedes:

1. **Usar un plugin de compresión**
   
   - `capacitor-image-compressor`
   - `@capacitor-community/image-compressor`

2. **Comprimir en backend**
   
   - Edge Function en Supabase
   - Sharp.js para Node.js
   - Pero agrega latencia y costo

3. **Usar un CDN con transformación**
   
   - Cloudinary
   - Imgix
   - Mucho más caro

**Conclusión:** La optimización en cliente con Camera API es la más simple, eficiente y gratuita.

---

## 🗄️ Base de Datos

### Tabla: `operaciones_cajas`

```sql
CREATE TABLE operaciones_cajas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  empleado_id INTEGER REFERENCES empleados(id),
  tipo_operacion tipo_operacion_caja_enum NOT NULL,
  categoria_id INTEGER REFERENCES categorias_operaciones(id),  -- ← NUEVO (v2.0): Categoría contable
  monto DECIMAL(12,2) NOT NULL,
  saldo_anterior DECIMAL(12,2),
  saldo_actual DECIMAL(12,2),
  tipo_referencia_id INTEGER REFERENCES tipos_referencia(id),
  referencia_id UUID,
  descripcion TEXT,
  comprobante_url TEXT,  -- ← PATH del archivo (v1.0): Ej "2026/02/uuid.jpg", NO URL completa
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**⚠️ Importante:**
- El campo `comprobante_url` guarda el **PATH** del archivo en Storage (ejemplo: `2026/02/a1b2c3d4.jpg`), **NO la URL completa**. Esto permite generar signed URLs dinámicamente cuando se necesiten.
- El campo `categoria_id` es **obligatorio** para operaciones INGRESO/EGRESO manuales, permite clasificación contable y reportes por tipo de gasto.

### Tabla: `categorias_operaciones` (v2.0)

```sql
CREATE TABLE categorias_operaciones (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO')),
  nombre VARCHAR(100) NOT NULL,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Categorías predefinidas:**

**Egresos (9):**
- `EGR_PAGOS` - Pago a Proveedores
- `EGR_SERVICIOS` - Servicios Básicos (luz, agua, internet)
- `EGR_SALARIOS` - Nómina y Salarios
- `EGR_ALQUILER` - Alquiler de Local
- `EGR_SUMINISTROS` - Suministros de Oficina
- `EGR_TRANSPORTE` - Transporte y Combustible
- `EGR_MANTENIMIENTO` - Mantenimiento y Reparaciones
- `EGR_IMPUESTOS` - Impuestos y Tasas
- `EGR_OTROS` - Otros Gastos

**Ingresos (3):**
- `ING_VENTAS` - Ventas de Productos/Servicios
- `ING_SERVICIOS` - Cobro por Servicios
- `ING_OTROS` - Otros Ingresos

### Bucket de Storage: `comprobantes`

**Configuración:**

- **Público:** No (privado)
- **Tamaño máximo:** 5 MB
- **Tipos permitidos:** `image/jpeg`, `image/png`, `image/jpg`

**Estructura de carpetas:**

```
comprobantes/
├── 2026/
│   ├── 01/
│   │   ├── uuid1.jpg
│   │   └── uuid2.jpg
│   ├── 02/
│   │   ├── uuid3.jpg
│   │   └── uuid4.jpg
│   └── ...
└── ...
```

**Políticas RLS:**

```sql
-- Permitir subir archivos
CREATE POLICY "Empleados autenticados pueden subir comprobantes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comprobantes' AND
  auth.uid() IS NOT NULL
);

-- Permitir ver archivos
CREATE POLICY "Empleados autenticados pueden ver comprobantes"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'comprobantes' AND
  auth.uid() IS NOT NULL
);

-- Permitir eliminar archivos
CREATE POLICY "Empleados autenticados pueden eliminar comprobantes"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'comprobantes' AND
  auth.uid() IS NOT NULL
);
```

---

## 📊 Diagrama de Flujo

```
┌──────────────────────────────────────────────────────────────────┐
│  USUARIO                                                         │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 1. Clic en 3 puntos → Ingreso/Egreso
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  HOME.PAGE.TS                                                    │
│  - mostrarMenuCaja()                                             │
│  - onOperacion()  ← Abre modal                                   │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 2. Abre OperacionModalComponent
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  OPERACION-MODAL.COMPONENT.TS                                    │
│  - seleccionarFoto()  ← Muestra opciones                         │
│  - tomarFoto()  ← Usa Capacitor Camera                           │
│  - confirmar()  ← Retorna datos + foto al home                   │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 3. Retorna { cajaId, monto, descripcion, fotoComprobante }
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  HOME.PAGE.TS                                                    │
│  - ejecutarOperacion()  ← Llama al servicio                      │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 4. Llama a operacionesCajaService.registrarOperacion()
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  OPERACIONES-CAJA.SERVICE.TS                                     │
│  - registrarOperacion()                                          │
│    1. Sube foto a Storage (si hay)                               │
│    2. Obtiene empleado actual                                    │
│    3. Llama a función PostgreSQL                                 │
│    4. Maneja errores y limpieza                                  │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 5. storageService.uploadImage()
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  STORAGE.SERVICE.TS                                              │
│  - uploadImage()  ← Convierte DataURL → Blob                     │
│  - Genera nombre único (YYYY/MM/uuid.jpg)                        │
│  - Sube a Supabase Storage bucket 'comprobantes'                 │
│  - Retorna path de la imagen                                     │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 6. Retorna path → Genera URL pública
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  OPERACIONES-CAJA.SERVICE.TS                                     │
│  - Llama RPC: registrar_operacion_manual()                       │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 7. RPC call a PostgreSQL
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  POSTGRESQL (Supabase)                                           │
│  - Función: registrar_operacion_manual()                         │
│    1. Obtiene saldo_anterior (con lock)                          │
│    2. Calcula saldo_nuevo                                        │
│    3. Valida saldo insuficiente                                  │
│    4. Actualiza cajas.saldo_actual                               │
│    5. Inserta operaciones_cajas (con comprobante_url)            │
│    6. Retorna JSON { success, operacion_id, saldos }             │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 8. Retorna resultado al servicio
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  OPERACIONES-CAJA.SERVICE.TS                                     │
│  - Muestra success/error al usuario                              │
│  - Retorna true/false al home                                    │
└──────────────────────────────────────────────────────────────────┘
        │
        │ 9. Si success, recargar datos
        ↓
┌──────────────────────────────────────────────────────────────────┐
│  HOME.PAGE.TS                                                    │
│  - cargarDatos()  ← Actualiza UI                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Seguridad

### 1. **Autenticación**

- Solo usuarios autenticados pueden subir comprobantes
- Políticas RLS en Storage verifican `auth.uid() IS NOT NULL`

### 2. **Validación de Archivos**

- Tamaño máximo: 5 MB
- Tipos permitidos: JPG, PNG
- Validación en cliente (Capacitor Camera)

### 3. **Transacciones Atómicas**

- Función PostgreSQL garantiza atomicidad
- Si falla guardado, rollback completo
- Si falla subida, no se guarda operación

### 4. **Limpieza de Imágenes Huérfanas**

- Si falla la operación después de subir la imagen
- El servicio elimina automáticamente la imagen
- Evita basura en Storage

### 5. **Lock de Concurrencia**

- `SELECT ... FOR UPDATE` en la función PostgreSQL
- Evita race conditions al actualizar saldos
- Garantiza consistencia de datos

---

## 🐛 Troubleshooting

### Problema: "Error al subir comprobante"

**Posibles causas:**

1. Políticas RLS mal configuradas
2. Bucket no existe
3. Usuario no autenticado
4. Archivo excede 5 MB

**Solución:**

```sql
-- Verificar que el bucket existe
SELECT * FROM storage.buckets WHERE name = 'comprobantes';

-- Verificar políticas
SELECT * FROM pg_policies WHERE tablename = 'objects';
```

---

### Problema: "Could not find function registrar_operacion_manual"

**Causa:** Función no creada o cache no actualizado

**Solución:**

```sql
-- Verificar que existe
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'registrar_operacion_manual';

-- Refrescar cache
NOTIFY pgrst, 'reload schema';
```

---

### Problema: "Saldo insuficiente" pero hay saldo

**Causa:** Saldo en BD no está actualizado

**Solución:**

```sql
-- Verificar saldo actual
SELECT id, nombre, saldo_actual FROM cajas WHERE id = 1;

-- Revisar última operación
SELECT * FROM operaciones_cajas
WHERE caja_id = 1
ORDER BY fecha DESC
LIMIT 1;
```

---

### Problema: Imagen no se muestra en preview (web)

**Causa:** Angular no detecta el cambio

**Solución:** Ya implementado con `ChangeDetectorRef`

```typescript
this.fotoComprobante = image.dataUrl || null;
this.cdr.detectChanges();  // ← Forzar detección
```

---

## 📝 Función PostgreSQL Completa

**Versión:** 2.0 (con categorías contables)

```sql
-- ==========================================
-- ELIMINAR Y RECREAR FUNCIÓN
-- ==========================================

-- 1. Eliminar todas las versiones anteriores
DROP FUNCTION IF EXISTS public.registrar_operacion_manual(INTEGER, INTEGER, tipo_operacion_caja_enum, INTEGER, DECIMAL, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.registrar_operacion_manual;

-- 2. Crear la función con soporte para categorías
CREATE FUNCTION public.registrar_operacion_manual(
  p_caja_id INTEGER,
  p_empleado_id INTEGER,
  p_tipo_operacion tipo_operacion_caja_enum,
  p_categoria_id INTEGER,                    -- ← NUEVO: Categoría contable
  p_monto DECIMAL(12,2),
  p_descripcion TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_saldo_anterior DECIMAL(12,2);
  v_saldo_nuevo DECIMAL(12,2);
  v_operacion_id UUID;
BEGIN
  -- 1. Obtener saldo actual de la caja (con lock para evitar race conditions)
  SELECT saldo_actual INTO v_saldo_anterior
  FROM cajas
  WHERE id = p_caja_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada con ID: %', p_caja_id;
  END IF;

  -- 2. Calcular nuevo saldo según tipo de operación
  IF p_tipo_operacion = 'INGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior + p_monto;
  ELSIF p_tipo_operacion = 'EGRESO' THEN
    v_saldo_nuevo := v_saldo_anterior - p_monto;
    -- Validar saldo insuficiente
    IF v_saldo_nuevo < 0 THEN
      RAISE EXCEPTION 'Saldo insuficiente. Saldo actual: %, monto a retirar: %',
        v_saldo_anterior, p_monto;
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de operación no válido: %. Use INGRESO o EGRESO', p_tipo_operacion;
  END IF;

  -- 3. Actualizar saldo de la caja
  UPDATE cajas
  SET saldo_actual = v_saldo_nuevo,
      updated_at = NOW()
  WHERE id = p_caja_id;

  -- 4. Insertar operación con categoría
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, categoria_id, monto,
    saldo_anterior, saldo_actual, descripcion, comprobante_url, created_at
  ) VALUES (
    uuid_generate_v4(), p_caja_id, p_empleado_id, p_tipo_operacion, p_categoria_id, p_monto,
    v_saldo_anterior, v_saldo_nuevo, p_descripcion, p_comprobante_url, NOW()
  ) RETURNING id INTO v_operacion_id;

  -- 5. Retornar resultado exitoso
  RETURN json_build_object(
    'success', true,
    'operacion_id', v_operacion_id,
    'saldo_anterior', v_saldo_anterior,
    'saldo_nuevo', v_saldo_nuevo
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error en operación: %', SQLERRM;
END;
$$;
```

### Parámetros de la función:

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `p_caja_id` | INTEGER | ID de la caja (1=CAJA, 2=CAJA_CHICA, etc.) |
| `p_empleado_id` | INTEGER | ID del empleado que registra la operación |
| `p_tipo_operacion` | ENUM | 'INGRESO' o 'EGRESO' |
| `p_categoria_id` | INTEGER | **NUEVO:** ID de la categoría contable (obligatorio) |
| `p_monto` | DECIMAL | Monto de la operación |
| `p_descripcion` | TEXT | Descripción adicional (opcional, más detalle que la categoría) |
| `p_comprobante_url` | TEXT | Path del comprobante en Storage (opcional para ingresos, obligatorio para egresos) |

### Cambios en Versión 2.0:

- ✅ Agregado parámetro `p_categoria_id` (obligatorio)
- ✅ INSERT ahora incluye `categoria_id` en operaciones_cajas
- ✅ Permite clasificación contable de operaciones
- ✅ Facilita reportes por tipo de gasto/ingreso
- ✅ Mantiene compatibilidad con comprobantes fotográficos

---

## ✅ Checklist de Implementación

### Versión 1.0 (Comprobantes fotográficos)
- [x] Instalar @capacitor/camera
- [x] Configurar permisos en AndroidManifest.xml
- [x] Crear StorageService
- [x] Modificar OperacionModalComponent (UI + lógica)
- [x] Actualizar OperacionModalResult con fotoComprobante
- [x] Modificar OperacionesCajaService
- [x] Actualizar HomePage para usar nuevo servicio
- [x] Crear bucket 'comprobantes' en Supabase
- [x] Configurar políticas RLS
- [x] Crear función PostgreSQL registrar_operacion_manual
- [x] Agregar campo comprobante_url a operaciones_cajas
- [x] Actualizar modelo TypeScript OperacionCaja
- [x] Documentar en PROCESO_INGRESO_EGRESO.md

### Versión 2.0 (Categorías contables)
- [x] Crear tabla categorias_operaciones
- [x] Agregar campo categoria_id a operaciones_cajas
- [x] Insertar 12 categorías predefinidas (9 egresos + 3 ingresos)
- [x] Crear modelo CategoriaOperacion
- [x] Actualizar modelo OperacionCaja con categoria
- [x] Agregar método obtenerCategorias() al servicio
- [x] Actualizar registrarOperacion() para aceptar categoriaId
- [x] Agregar dropdown de categorías en modal
- [x] Actualizar función PostgreSQL con p_categoria_id
- [x] Actualizar documentación con versión 2.0

---

## 📚 Referencias

- [Capacitor Camera API](https://capacitorjs.com/docs/apis/camera)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Supabase RPC Functions](https://supabase.com/docs/guides/database/functions)
- [PostgreSQL Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html)

---

## 📊 Novedades Versión 2.0

### ¿Qué cambió?

**Versión 1.0** solo guardaba:
- Monto
- Descripción libre (texto)
- Comprobante (foto)

**Versión 2.0** agrega:
- ✅ **Categoría contable obligatoria** (selección de lista)
- ✅ **12 categorías predefinidas** para clasificación
- ✅ **Descripción ahora es complementaria** (más detalle que la categoría)
- ✅ **Base para reportes contables** por tipo de gasto/ingreso

### Beneficios:

1. **Contabilidad estructurada**: Gastos clasificados, no solo descripciones libres
2. **Reportes precisos**: "¿Cuánto gastamos en servicios básicos este mes?"
3. **Análisis de tendencias**: Comparar gastos mes a mes por categoría
4. **Auditoría mejorada**: Trazabilidad completa con categoría + comprobante + descripción
5. **Flexibilidad**: Descripción adicional para casos específicos

### Ejemplo de uso:

**Antes (v1.0):**
```
Monto: $50
Descripción: "Pago de luz"
```

**Ahora (v2.0):**
```
Categoría: EGR_SERVICIOS - Servicios Básicos
Monto: $50
Descripción: "Recibo de luz - Factura #12345 - Mes de Enero"
Comprobante: [Foto del recibo]
```

**Ventaja:** El sistema ahora puede generar reportes como:
- "Total en Servicios Básicos: $250/mes"
- "Comparativa: Enero ($250) vs Febrero ($280)"
- "Desglose: Luz ($50) + Internet ($30) + Agua ($20)"

---

**Fin del documento**
