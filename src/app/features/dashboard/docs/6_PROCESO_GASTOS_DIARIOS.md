# Guía Completa: Sistema de Gastos Diarios

**Fecha:** 2026-02-09
**Versión:** 2.1 (v4.4 - Categorización simplificada)
**Autor:** Claude Code

---

## 📋 Resumen

Sistema para registro de gastos operativos diarios de la tienda con:

### ✅ Características
- **Acceso rápido** desde FAB (Floating Action Button) en cualquier página
- **Flujo ultra-simplificado** de 2 pasos: Modal → Guardar
- **Categorización obligatoria** con 7 categorías predefinidas
- **Observaciones opcionales** para detalles adicionales
- **Comprobantes opcionales** con optimización automática de imágenes
- **No afecta saldos de cajas** (gastos operativos, no transacciones de caja)
- **Trazabilidad completa** con empleado, fecha, categoría y observaciones

### 🎯 Diferencia con Operaciones de Caja

| Característica | Gastos Diarios | Operaciones de Caja (Egresos) |
|----------------|----------------|-------------------------------|
| **Propósito** | Gastos operativos de la tienda (luz, agua, transporte, etc.) | Retiros/depósitos de efectivo de las cajas |
| **Afecta saldos** | ❌ NO | ✅ SÍ |
| **Comprobante** | Opcional | Obligatorio |
| **Categoría** | ✅ Obligatoria (7 categorías específicas de gastos) | ✅ Obligatoria (12 categorías contables) |
| **Observaciones** | ✅ Opcional (detalles adicionales) | N/A |
| **Frecuencia** | Múltiples veces al día | Ocasional |
| **Acceso** | FAB flotante (siempre visible) | Menú de cada caja |

---

## 🎯 Funcionalidad

### Desde la perspectiva del usuario:

1. Usuario hace clic en **botón FAB** (icono de recibo) desde cualquier página
2. Se despliega menú con opciones → selecciona **"Gasto"**
3. Se abre modal de gastos
4. Usuario **selecciona categoría** del dropdown (obligatorio):
   - Servicios Públicos
   - Transporte
   - Mantenimiento
   - Limpieza
   - Papelería
   - Alimentación
   - Otros
5. Usuario ingresa **monto** (obligatorio)
6. Usuario **captura foto** del comprobante (opcional)
7. Usuario agrega **observaciones** (opcional, ej: "Taxi al banco para depósito")
8. Usuario confirma
9. Sistema sube foto a Supabase Storage (si hay)
10. Sistema registra gasto en BD con empleado, fecha y categoría
11. ✅ Gasto registrado (NO afecta saldos de cajas)

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

---

## 📁 Estructura de Archivos

```
src/app/
├── core/
│   └── services/
│       ├── supabase.service.ts        # Cliente de Supabase
│       └── storage.service.ts         # Servicio de Storage (subida de imágenes)
│
├── features/
│   ├── auth/
│   │   └── services/
│   │       └── auth.service.ts        # Obtener empleado actual
│   │
│   ├── dashboard/
│   │   ├── components/
│   │   │   └── gasto-modal/
│   │   │       ├── gasto-modal.component.ts       # 🆕 Modal de gastos
│   │   │       ├── gasto-modal.component.html     # 🆕 UI de captura
│   │   │       └── gasto-modal.component.scss     # 🆕 Estilos
│   │   │
│   │   ├── models/
│   │   │   └── gasto-diario.model.ts              # 🆕 Interfaces
│   │   │
│   │   └── services/
│   │       └── gastos-diarios.service.ts          # 🆕 Lógica de negocio
│   │
│   └── layout/
│       └── pages/
│           └── main/
│               ├── main-layout.page.ts            # 🔄 FAB con menú de gastos
│               ├── main-layout.page.html          # 🔄 FAB UI
│               └── main-layout.page.scss          # 🔄 Estilos FAB
```

---

## 🗄️ Base de Datos

### Tabla: `categorias_gastos` (v4.4 - NUEVA)

```sql
CREATE TABLE IF NOT EXISTS categorias_gastos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7 categorías predefinidas
INSERT INTO categorias_gastos (nombre, codigo, descripcion) VALUES
('Servicios Públicos', 'GS-001', 'Luz, agua, internet, teléfono y otros servicios básicos'),
('Transporte', 'GS-002', 'Gastos de transporte, combustible y estacionamiento'),
('Mantenimiento', 'GS-003', 'Reparaciones y mantenimiento del local, equipos y mobiliario'),
('Limpieza', 'GS-004', 'Productos de limpieza y servicios de limpieza'),
('Papelería', 'GS-005', 'Papelería, útiles de oficina y suministros'),
('Alimentación', 'GS-006', 'Alimentación y bebidas para el personal'),
('Otros', 'GS-007', 'Otros gastos operativos no clasificados');
```

### Tabla: `gastos_diarios` (v4.4 - ACTUALIZADA)

```sql
CREATE TABLE IF NOT EXISTS gastos_diarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha DATE NOT NULL,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  categoria_gasto_id INTEGER NOT NULL REFERENCES categorias_gastos(id),
  monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
  observaciones TEXT,  -- Detalles adicionales del gasto
  comprobante_url TEXT,  -- Path en Storage (opcional)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX idx_gastos_diarios_fecha ON gastos_diarios(fecha DESC);
CREATE INDEX idx_gastos_diarios_empleado ON gastos_diarios(empleado_id);
CREATE INDEX idx_gastos_diarios_categoria ON gastos_diarios(categoria_gasto_id);
```

### Campos de `gastos_diarios`:

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `id` | UUID | ✅ Auto | Identificador único |
| `fecha` | DATE | ✅ Auto | Fecha del gasto (local, no UTC) |
| `empleado_id` | INTEGER | ✅ Auto | Empleado que registra el gasto |
| `categoria_gasto_id` | INTEGER | ✅ | Categoría del gasto (FK a categorias_gastos) |
| `monto` | DECIMAL(10,2) | ✅ | Monto del gasto |
| `observaciones` | TEXT | ❌ | Detalles adicionales del gasto |
| `comprobante_url` | TEXT | ❌ | Path de la foto en Storage |
| `created_at` | TIMESTAMP | ✅ Auto | Timestamp de creación |

---

## 🔧 Implementación Técnica

### 1. Modelo de Datos

**Archivo:** `src/app/features/dashboard/models/gasto-diario.model.ts`

```typescript
// 🆕 Categoría de Gasto
export interface CategoriaGasto {
  id: number;
  nombre: string;
  codigo: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}

// Gasto Diario
export interface GastoDiario {
  id: string;
  fecha: string;
  empleado_id: number;
  categoria_gasto_id: number;
  monto: number;
  observaciones: string | null;
  comprobante_url: string | null;
  created_at: string;

  // Relaciones (joins)
  empleado_nombre?: string;
  categoria_nombre?: string;
}

// Input para crear gasto
export interface GastoDiarioInput {
  categoria_gasto_id: number;
  monto: number;
  observaciones?: string;
  fotoComprobante?: string | null;      // Base64
}

// Resultado del modal
export interface GastoModalResult {
  categoria_gasto_id: number;
  monto: number;
  observaciones: string;
  fotoComprobante: string | null;
}
```

---

### 2. Servicio de Gastos

**Archivo:** `src/app/features/dashboard/services/gastos-diarios.service.ts`

#### 🆕 Método: `getCategorias()` - Obtener categorías activas

```typescript
async getCategorias(): Promise<CategoriaGasto[]> {
  const { data, error } = await this.supabase.client
    .from('categorias_gastos')
    .select('*')
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (error) {
    console.error('Error al obtener categorías:', error);
    return [];
  }

  return data || [];
}
```

#### 🔄 Método principal: `registrarGasto()` (actualizado)

```typescript
async registrarGasto(gasto: GastoDiarioInput): Promise<boolean> {
  // 1. Subir foto a Storage (si hay)
  let pathImagen: string | null = null;
  if (gasto.fotoComprobante) {
    pathImagen = await this.storageService.uploadImage(
      gasto.fotoComprobante,
      'comprobantes'
    );
    if (!pathImagen) return false;
  }

  // 2. Obtener empleado actual
  const empleado = await this.authService.getEmpleadoActual();
  if (!empleado) {
    await this.ui.showError('No se pudo obtener el empleado actual');
    return false;
  }

  // 3. Obtener fecha local
  const fecha = this.getFechaLocal();

  // 4. Insertar en BD
  const { error } = await this.supabase.client
    .from('gastos_diarios')
    .insert({
      fecha,
      empleado_id: empleado.id,
      categoria_gasto_id: gasto.categoria_gasto_id,
      monto: gasto.monto,
      observaciones: gasto.observaciones || null,
      comprobante_url: pathImagen
    });

  if (error) {
    await this.ui.showError('Error al registrar el gasto');
    return false;
  }

  await this.ui.showSuccess('Gasto registrado correctamente');
  return true;
}
```

#### 🔄 Método: `getGastos()` - Con JOIN a categorías

```typescript
async getGastos(fechaInicio: string, fechaFin: string): Promise<GastoDiario[]> {
  const { data, error } = await this.supabase.client
    .from('gastos_diarios')
    .select(`
      *,
      empleados!inner (id, nombre),
      categorias_gastos!inner (id, nombre, codigo)
    `)
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin)
    .order('fecha', { ascending: false });

  if (error) {
    console.error('Error al obtener gastos:', error);
    return [];
  }

  return (data || []).map((gasto: any) => ({
    ...gasto,
    empleado_nombre: gasto.empleados?.nombre || 'Sin nombre',
    categoria_nombre: gasto.categorias_gastos?.nombre || 'Sin categoría'
  })) as any;
}
```

#### Manejo de fechas locales:

```typescript
private getFechaLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

**⚠️ IMPORTANTE:** NUNCA usar `new Date().toISOString()` porque retorna UTC, no la fecha local del negocio.

---

### 3. Modal de Gastos

**Archivo:** `src/app/features/dashboard/components/gasto-modal/gasto-modal.component.ts`

#### 🆕 Carga de categorías en `ngOnInit()`:

```typescript
async ngOnInit() {
  await this.cargarCategorias();
}

async cargarCategorias() {
  this.cargandoCategorias = true;
  this.categorias = await this.gastosService.getCategorias();
  this.cargandoCategorias = false;
}
```

#### Formulario:

```typescript
this.form = this.fb.group({
  categoria_gasto_id: [null, Validators.required],
  monto: [null, [Validators.required, Validators.min(0.01)]],
  observaciones: ['']
});
```

#### Captura de foto con optimización:

```typescript
async tomarFoto() {
  try {
    const photo = await Camera.getPhoto({
      quality: 80,              // 80% quality
      width: 1200,              // Max 1200px ancho
      height: 1600,             // Max 1600px alto
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,  // Cámara o galería
      correctOrientation: true       // Corrige rotación EXIF
    });

    this.fotoBase64 = `data:image/${photo.format};base64,${photo.base64String}`;
  } catch (error) {
    console.error('Error al tomar foto:', error);
  }
}
```

**Optimización:** Las fotos se reducen a ~200-500 KB (en vez de 3-10 MB).

---

### 4. Integración en Main Layout (FAB)

**Archivo:** `src/app/features/layout/pages/main/main-layout.page.ts`

```typescript
async irAGasto() {
  // 1. Cerrar menú FAB
  this.fabAbierto = false;

  // 2. Abrir modal
  const modal = await this.modalCtrl.create({
    component: GastoModalComponent
  });

  await modal.present();
  const { data, role } = await modal.onDidDismiss<GastoModalResult>();

  // 3. Guardar si confirma
  if (role === 'confirm' && data) {
    await this.gastosService.registrarGasto({
      categoria_gasto_id: data.categoria_gasto_id,
      monto: data.monto,
      observaciones: data.observaciones,
      fotoComprobante: data.fotoComprobante
    });
  }
}
```

---

## 🎨 Diseño del Modal

### Campos del Formulario:

1. **Categoría** (select dropdown)
   - Label: "Categoría"
   - Badge: "Obligatorio"
   - Options: 7 categorías predefinidas
     - Servicios Públicos
     - Transporte
     - Mantenimiento
     - Limpieza
     - Papelería
     - Alimentación
     - Otros
   - Validación: requerido

2. **Monto** (input number)
   - Label: "Monto"
   - Badge: "Requerido"
   - Formato: $0.00
   - Validación: requerido, min 0.01

3. **Comprobante** (foto)
   - Label: "Comprobante"
   - Badge: "Opcional"
   - Botón: "Tomar foto o seleccionar de galería"
   - Preview con botón de eliminar

4. **Observaciones** (textarea)
   - Label: "Observaciones"
   - Badge: "Opcional"
   - Placeholder: "Detalles adicionales..."
   - Máximo: ilimitado (TEXT)

### Botón de Confirmación:

```html
<button
  type="submit"
  class="submit-btn"
  [disabled]="form.invalid"
>
  Registrar Gasto
</button>
```

---

## 📊 Flujo Completo

```
Usuario
  ↓
[Click en FAB] → [Menú se abre]
  ↓
[Click en "Gasto"] → [Modal se abre]
  ↓
[Modal carga categorías] → getCategorias()
  ↓
[Llena formulario]
  ├─ Categoría (requerido) → Dropdown con 7 opciones
  ├─ Monto (requerido)
  ├─ Foto comprobante (opcional) → [Camera.getPhoto()]
  └─ Observaciones (opcional)
  ↓
[Click "Registrar Gasto"]
  ↓
GastosDiariosService.registrarGasto()
  ↓
  ├─ ¿Hay foto? → SÍ → [StorageService.uploadImage()]
  │                       ↓
  │                   [Supabase Storage]
  │                       ↓
  │                   pathImagen
  │
  ├─ [authService.getEmpleadoActual()] → empleado_id
  ├─ [getFechaLocal()] → fecha
  │
  └─ [INSERT en gastos_diarios]
       ↓
       {
         fecha,
         empleado_id,
         categoria_gasto_id,
         monto,
         observaciones,
         comprobante_url
       }
       ↓
  [Supabase PostgreSQL]
       ↓
  ✅ Gasto registrado
       ↓
  [Toast: "Gasto registrado correctamente"]
       ↓
  [Modal se cierra]
```

---

## 🔐 Seguridad

### Row Level Security (RLS):

```sql
-- Solo empleados autenticados pueden insertar
CREATE POLICY "Empleados pueden insertar gastos"
ON gastos_diarios FOR INSERT
TO authenticated
USING (true);

-- Solo pueden ver sus propios gastos (opcional, según reglas de negocio)
CREATE POLICY "Empleados pueden ver gastos"
ON gastos_diarios FOR SELECT
TO authenticated
USING (true);  -- O: USING (empleado_id = auth.uid())
```

### Storage Policy:

```sql
-- Bucket: comprobantes
-- Policy: Solo empleados autenticados pueden subir
CREATE POLICY "Empleados pueden subir comprobantes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'comprobantes');
```

---

## 📝 Ejemplos de Uso

### Ejemplo 1: Gasto solo con categoría (sin observaciones)

```typescript
const gasto = {
  categoria_gasto_id: 6,  // Alimentación (GS-006)
  monto: 12.00,
  observaciones: '',
  fotoComprobante: null
};

const success = await gastosService.registrarGasto(gasto);
// ✅ Muestra solo "Alimentación" como título
```

### Ejemplo 2: Gasto con observaciones detalladas

```typescript
const gasto = {
  categoria_gasto_id: 2,  // Transporte (GS-002)
  monto: 5.50,
  observaciones: 'Taxi al banco para depósito diario',
  fotoComprobante: null
};

const success = await gastosService.registrarGasto(gasto);
// ✅ Muestra "Transporte" como título y observaciones debajo
```

### Ejemplo 3: Gasto con comprobante fotográfico

```typescript
// 1. Usuario captura foto
const photo = await Camera.getPhoto({...});

// 2. Registra gasto
const gasto = {
  categoria_gasto_id: 1,  // Servicios Públicos (GS-001)
  monto: 45.00,
  observaciones: 'Factura de electricidad - Enero 2026',
  fotoComprobante: `data:image/jpeg;base64,${photo.base64String}`
};

const success = await gastosService.registrarGasto(gasto);
// ✅ Foto subida a Storage y gasto registrado con comprobante
```

---

## ⚠️ Consideraciones Importantes

### 1. Fechas en Zona Local

❌ **NO HACER:**
```typescript
const fecha = new Date().toISOString();  // Retorna UTC!
```

✅ **HACER:**
```typescript
const fecha = this.getFechaLocal();  // Retorna YYYY-MM-DD local
```

### 2. Optimización de Imágenes

**Siempre usar límites en Camera.getPhoto():**
```typescript
Camera.getPhoto({
  quality: 80,    // ✅ 80% calidad
  width: 1200,    // ✅ Max 1200px
  height: 1600,   // ✅ Max 1600px
  correctOrientation: true  // ✅ Corrige rotación
});
```

**Resultado:** Imágenes de ~200-500 KB en vez de 3-10 MB (90% reducción).

### 3. Validación de Empleado

Siempre verificar que haya empleado antes de guardar:
```typescript
const empleado = await this.authService.getEmpleadoActual();
if (!empleado) {
  await this.ui.showError('No se pudo obtener el empleado actual');
  return false;
}
```

### 4. Manejo de Errores

Usar el patrón de retorno booleano:
```typescript
const success = await gastosService.registrarGasto(gasto);
if (success) {
  // ✅ Gasto registrado
} else {
  // ❌ Falló (el servicio ya mostró el error)
}
```

---

## 🧪 Testing

### Casos de Prueba:

1. ✅ Registrar gasto sin foto
2. ✅ Registrar gasto con foto desde cámara
3. ✅ Registrar gasto con foto desde galería
4. ✅ Validación: concepto vacío → error
5. ✅ Validación: monto = 0 → error
6. ✅ Validación: monto negativo → error
7. ✅ Sin internet: debe fallar con mensaje claro
8. ✅ Foto muy grande: debe optimizarse automáticamente

---

## 📚 Referencias

- **Capacitor Camera:** https://capacitorjs.com/docs/apis/camera
- **Supabase Storage:** https://supabase.com/docs/guides/storage
- **Design Tokens:** Ver `/docs/DESIGN.md`
- **Operaciones de Caja:** Ver `PROCESO_INGRESO_EGRESO.md`

---

## 🔄 Historial de Versiones

### v2.1 (2026-02-09) - Simplificación (Schema v4.4 final)
- ❌ **Eliminado campo `concepto`** - era redundante con categoría + observaciones
- ✅ **Formulario ultra-simplificado** - solo 4 campos (categoría, monto, comprobante, observaciones)
- ✅ **Observaciones suficiente** para detalles adicionales
- ✅ **Menos confusión** para el usuario sobre dónde poner qué información
- ✅ **UI más limpia** y rápida de completar

### v2.0 (2026-02-09) - Categorización de gastos (Schema v4.4)
- 🆕 **Nueva tabla `categorias_gastos`** con 7 categorías predefinidas
- 🆕 **Campo obligatorio `categoria_gasto_id`** en gastos_diarios
- 🆕 **Dropdown de categorías** en el modal (primer campo, obligatorio)
- 🆕 **Método `getCategorias()`** en servicio
- 🔄 **Queries con JOIN** para traer nombre de categoría
- 🔄 **Listado muestra categoría** como título principal
- ✅ Mejor clasificación y reportería de gastos operativos

### v1.0 (2026-02-09) - Implementación inicial
- ✅ Implementación inicial del sistema de gastos diarios
- ✅ Modal con campos: concepto, monto, comprobante (opcional), observaciones
- ✅ Integración con FAB en main-layout
- ✅ Optimización automática de imágenes
- ✅ Almacenamiento en tabla `gastos_diarios` v4.3
- ✅ NO afecta saldos de cajas (solo registro operativo)
