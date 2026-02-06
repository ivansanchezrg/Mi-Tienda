# Plan de Implementación: Comprobantes en Operaciones de Caja

**Fecha:** 2026-02-06
**Versión:** 1.0
**Objetivo:** Permitir que los empleados carguen comprobantes fotográficos para ingresos (opcional) y egresos (obligatorio)

---

## 📋 Situación Actual

### ✅ Lo que ya tenemos:
- UI del modal con sección de carga de foto
- Capacitor Camera instalado y configurado
- Funcionalidad de tomar foto desde cámara
- Funcionalidad de seleccionar foto desde galería
- Preview de la imagen seleccionada
- Botón para remover foto
- Validación: egreso requiere foto obligatoria
- Permisos de Android configurados en AndroidManifest.xml

### ❌ Lo que falta:
- Campo en base de datos para guardar URL del comprobante
- Bucket de Supabase Storage configurado
- Lógica de subida de imagen a Storage
- Servicio para guardar operación con comprobante
- Manejo de errores en subida de archivos

---

## 🎯 Requerimientos Funcionales

1. **Para EGRESOS:**
   - Comprobante fotográfico **OBLIGATORIO**
   - No permitir confirmar sin foto
   - Mostrar badge "Obligatorio" en la UI

2. **Para INGRESOS:**
   - Comprobante fotográfico **OPCIONAL**
   - Permitir confirmar sin foto
   - Mostrar label "(opcional)" en la UI

3. **Carga de imágenes:**
   - Desde cámara del dispositivo
   - Desde galería del dispositivo
   - Solo formato imagen (JPG, PNG)
   - Calidad: 80% (balance entre calidad y tamaño)

4. **Almacenamiento:**
   - Imágenes en Supabase Storage
   - URL del comprobante en la base de datos
   - Estructura organizada por fecha

---

## 🚀 Plan de Implementación (Paso a Paso)

### **PASO 1: Migración de Base de Datos**

**Nota:** El campo ya fue agregado a `doc/schema_inicial_completo.sql` para nuevas instalaciones.

**Para la base de datos existente, ejecutar en Supabase SQL Editor:**

```sql
-- Agregar campo para URL del comprobante
ALTER TABLE operaciones_cajas
ADD COLUMN comprobante_url TEXT;

-- Comentario descriptivo
COMMENT ON COLUMN operaciones_cajas.comprobante_url IS
'URL del comprobante fotográfico subido a Supabase Storage. Obligatorio para egresos, opcional para ingresos.';
```

**Validación:**
- ✅ Schema actualizado en `doc/schema_inicial_completo.sql`
- [ ] Ejecutar ALTER TABLE en Supabase SQL Editor
- [ ] Verificar que el campo se agregó correctamente
- [ ] Confirmar que operaciones existentes tienen NULL en este campo

---

### **PASO 2: Configurar Supabase Storage**

**Bucket a crear:** `comprobantes`

**Configuración:**
- **Nombre:** `comprobantes`
- **Público:** No (privado)
- **Tamaño máximo por archivo:** 5 MB
- **Tipos de archivo permitidos:** `image/jpeg`, `image/png`, `image/jpg`

**Estructura de carpetas:**
```
comprobantes/
├── 2026/
│   ├── 01/
│   │   ├── {uuid}.jpg
│   │   └── {uuid}.jpg
│   ├── 02/
│   │   └── {uuid}.jpg
│   └── ...
└── ...
```

**Políticas de seguridad (RLS):**

1. **Policy para INSERT (Subir archivos):**
```sql
CREATE POLICY "Empleados autenticados pueden subir comprobantes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comprobantes' AND
  auth.uid() IS NOT NULL
);
```

2. **Policy para SELECT (Ver archivos):**
```sql
CREATE POLICY "Empleados autenticados pueden ver comprobantes"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'comprobantes' AND
  auth.uid() IS NOT NULL
);
```

3. **Policy para DELETE (Eliminar archivos - opcional):**
```sql
-- Solo si queremos permitir eliminar comprobantes
CREATE POLICY "Empleados pueden eliminar sus comprobantes"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'comprobantes' AND
  auth.uid() IS NOT NULL
);
```

**Validación:**
- Bucket `comprobantes` creado
- Políticas configuradas
- Probar subida manual desde Supabase Dashboard

---

### **PASO 3: Actualizar Modelo TypeScript**

**Archivo:** `src/app/features/dashboard/models/operacion-caja.model.ts`

**Antes:**
```typescript
export interface OperacionCaja {
  id: string;
  fecha: string;
  caja_id: number;
  empleado_id: number | null;
  tipo_operacion: TipoOperacionCaja;
  monto: number;
  saldo_anterior: number | null;
  saldo_actual: number | null;
  tipo_referencia_id: number | null;
  referencia_id: string | null;
  descripcion: string | null;
  created_at: string;
  // Relaciones
  empleado?: { id: number; nombre: string } | null;
}
```

**Después:**
```typescript
export interface OperacionCaja {
  id: string;
  fecha: string;
  caja_id: number;
  empleado_id: number | null;
  tipo_operacion: TipoOperacionCaja;
  monto: number;
  saldo_anterior: number | null;
  saldo_actual: number | null;
  tipo_referencia_id: number | null;
  referencia_id: string | null;
  descripcion: string | null;
  comprobante_url: string | null; // ⬅️ NUEVO CAMPO
  created_at: string;
  // Relaciones
  empleado?: { id: number; nombre: string } | null;
}
```

---

### **PASO 4: Actualizar Interface del Modal**

**Archivo:** `src/app/features/dashboard/components/operacion-modal/operacion-modal.component.ts`

**Antes:**
```typescript
export interface OperacionModalResult {
  cajaId: number;
  monto: number;
  descripcion: string;
}
```

**Después:**
```typescript
export interface OperacionModalResult {
  cajaId: number;
  monto: number;
  descripcion: string;
  fotoComprobante: string | null; // ⬅️ NUEVO: DataURL de la imagen
}
```

**Modificar método `confirmar()`:**
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
    return;
  }

  const result: OperacionModalResult = {
    cajaId: this.form.value.cajaId,
    monto: this.form.value.monto,
    descripcion: this.form.value.descripcion || '',
    fotoComprobante: this.fotoComprobante // ⬅️ NUEVO
  };

  this.modalCtrl.dismiss(result, 'confirm');
}
```

---

### **PASO 5: Crear Servicio de Upload**

**Archivo:** `src/app/core/services/storage.service.ts` (NUEVO)

**Funcionalidades:**
1. Convertir DataURL a Blob
2. Generar nombre único para archivo
3. Subir archivo a Supabase Storage
4. Obtener URL pública del archivo
5. Eliminar archivo (opcional)

**Código:**
```typescript
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private supabase = inject(SupabaseService);

  /**
   * Sube una imagen a Supabase Storage
   * @param dataUrl - DataURL de la imagen (desde Camera.getPhoto)
   * @param bucket - Nombre del bucket ('comprobantes')
   * @returns Path del archivo en Storage o null si falla
   */
  async uploadImage(dataUrl: string, bucket: string = 'comprobantes'): Promise<string | null> {
    try {
      // 1. Convertir DataURL a Blob
      const blob = this.dataURLtoBlob(dataUrl);

      // 2. Generar nombre único con estructura de carpetas por fecha
      const fileName = this.generateFileName();

      // 3. Subir a Supabase Storage
      const { data, error } = await this.supabase.client.storage
        .from(bucket)
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          upsert: false
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

  /**
   * Obtiene la URL pública de un archivo
   * @param path - Path del archivo en Storage
   * @param bucket - Nombre del bucket
   * @returns URL pública o null si falla
   */
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

  /**
   * Elimina un archivo de Storage
   * @param path - Path del archivo
   * @param bucket - Nombre del bucket
   */
  async deleteFile(path: string, bucket: string = 'comprobantes'): Promise<boolean> {
    try {
      const { error } = await this.supabase.client.storage
        .from(bucket)
        .remove([path]);

      if (error) {
        console.error('Error al eliminar archivo:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error en deleteFile:', error);
      return false;
    }
  }

  /**
   * Convierte DataURL a Blob
   */
  private dataURLtoBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  /**
   * Genera nombre único para archivo con estructura de carpetas por fecha
   * Formato: YYYY/MM/{uuid}.jpg
   */
  private generateFileName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID();

    return `${year}/${month}/${uuid}.jpg`;
  }
}
```

---

### **PASO 6: Modificar Servicio de Operaciones**

**Archivo:** `src/app/features/dashboard/services/operaciones-caja.service.ts`

**Modificar método de registro de operación:**

```typescript
import { inject } from '@angular/core';
import { StorageService } from '../../../core/services/storage.service';

async registrarOperacion(
  cajaId: number,
  tipo: 'INGRESO' | 'EGRESO',
  monto: number,
  descripcion: string,
  fotoComprobante: string | null // ⬅️ NUEVO parámetro
): Promise<boolean> {
  try {
    let comprobanteUrl: string | null = null;

    // 1. Si hay foto, subirla primero a Storage
    if (fotoComprobante) {
      await this.ui.showLoading('Subiendo comprobante...');

      const path = await this.storageService.uploadImage(fotoComprobante);

      if (!path) {
        await this.ui.hideLoading();
        await this.ui.showError('Error al subir el comprobante. Intenta de nuevo.');
        return false;
      }

      // Obtener URL pública del comprobante
      comprobanteUrl = this.storageService.getPublicUrl(path);
    }

    // 2. Obtener empleado actual
    const empleado = await this.authService.getEmpleadoActual();
    if (!empleado) {
      await this.ui.showError('No se pudo obtener información del empleado');
      return false;
    }

    // 3. Guardar operación en BD con URL del comprobante
    const { error } = await this.supabase.client
      .from('operaciones_cajas')
      .insert({
        caja_id: cajaId,
        empleado_id: empleado.id,
        tipo_operacion: tipo,
        monto: monto,
        descripcion: descripcion || null,
        comprobante_url: comprobanteUrl // ⬅️ NUEVO campo
      });

    if (error) {
      console.error('Error al registrar operación:', error);

      // Si falla el insert y ya subimos la imagen, eliminarla
      if (comprobanteUrl) {
        // TODO: Implementar limpieza de imagen huérfana
      }

      await this.ui.showError('Error al registrar la operación');
      return false;
    }

    await this.ui.showSuccess(`${tipo} registrado correctamente`);
    return true;

  } catch (error) {
    console.error('Error en registrarOperacion:', error);
    await this.ui.showError('Error inesperado');
    return false;
  }
}
```

---

### **PASO 7: Actualizar Componente Home**

**Archivo:** `src/app/features/dashboard/pages/home/home.page.ts`

**Modificar llamada al servicio:**

```typescript
async onOperacion(tipo: string, tipoCaja?: string) {
  // ... código existente para abrir modal ...

  const { data, role } = await modal.onWillDismiss();

  if (role === 'confirm' && data) {
    await this.ui.showLoading();

    // Llamar al servicio con el nuevo parámetro fotoComprobante
    const success = await this.operacionesService.registrarOperacion(
      data.cajaId,
      tipo === 'ingreso' ? 'INGRESO' : 'EGRESO',
      data.monto,
      data.descripcion,
      data.fotoComprobante // ⬅️ NUEVO parámetro
    );

    await this.ui.hideLoading();

    if (success) {
      await this.cargarDatos(); // Recargar datos
    }
  }
}
```

---

## 🔒 Consideraciones de Seguridad

1. **Autenticación:**
   - Solo usuarios autenticados pueden subir comprobantes
   - Validar sesión antes de cada operación

2. **Validación de archivos:**
   - Solo permitir imágenes (JPG, PNG)
   - Limitar tamaño máximo (5 MB)
   - Validar tipo MIME del archivo

3. **Políticas RLS:**
   - Bucket privado (no público)
   - Solo usuarios autenticados pueden leer/escribir
   - Implementar políticas granulares si es necesario

4. **Manejo de errores:**
   - Si falla la subida, no guardar la operación
   - Si falla la operación, eliminar la imagen subida (huérfana)
   - Mostrar mensajes claros al usuario

---

## 📊 Flujo de Trabajo

```
1. Usuario abre modal de Ingreso/Egreso
   ↓
2. Usuario completa formulario
   ↓
3. Usuario carga foto de comprobante (obligatorio si es egreso)
   ↓
4. Usuario presiona "Confirmar"
   ↓
5. VALIDACIÓN: ¿Es egreso sin foto?
   SÍ → Bloquear confirmación
   NO → Continuar
   ↓
6. ¿Hay foto cargada?
   NO → Ir a paso 9
   SÍ → Continuar
   ↓
7. SUBIR foto a Supabase Storage
   ↓
8. ¿Subida exitosa?
   NO → Mostrar error y detener
   SÍ → Obtener URL del comprobante
   ↓
9. GUARDAR operación en BD con URL (o null)
   ↓
10. ¿Guardado exitoso?
    NO → Eliminar imagen huérfana y mostrar error
    SÍ → Mostrar éxito
    ↓
11. Recargar datos y cerrar modal
```

---

## ✅ Checklist de Validación

Antes de considerar completa la implementación, verificar:

- [ ] Campo `comprobante_url` agregado a `operaciones_cajas`
- [ ] Bucket `comprobantes` creado en Supabase
- [ ] Políticas RLS configuradas correctamente
- [ ] Modelo TypeScript actualizado
- [ ] Interface del modal actualizada
- [ ] StorageService creado y probado
- [ ] OperacionesService modificado
- [ ] Home page actualizado
- [ ] Pruebas en web: Ingreso sin foto
- [ ] Pruebas en web: Ingreso con foto
- [ ] Pruebas en web: Egreso sin foto (debe bloquear)
- [ ] Pruebas en web: Egreso con foto
- [ ] Pruebas en Android: Todos los casos anteriores
- [ ] Manejo de errores de red
- [ ] Manejo de errores de Storage
- [ ] UI muestra mensajes claros

---

## 🐛 Posibles Problemas y Soluciones

### Problema 1: "Error al subir imagen"
**Causa:** Políticas RLS mal configuradas o bucket no existe
**Solución:** Verificar políticas y que el bucket esté creado

### Problema 2: "Imagen no se muestra"
**Causa:** URL pública incorrecta o bucket privado sin políticas SELECT
**Solución:** Verificar getPublicUrl() y política SELECT

### Problema 3: "Operación guardada pero sin comprobante"
**Causa:** Fallo en subida pero se guardó la operación
**Solución:** Implementar transacción: primero subir, luego guardar

### Problema 4: "Imágenes huérfanas en Storage"
**Causa:** Se subió imagen pero falló el guardado de operación
**Solución:** Implementar limpieza de imágenes huérfanas

---

## 📝 Notas Finales

- Este plan debe ejecutarse **paso a paso** con validación en cada etapa
- NO avanzar al siguiente paso si el anterior tiene errores
- Probar en **web Y Android** antes de dar por completado cada paso
- Documentar cualquier cambio o decisión importante
- Mantener este documento actualizado con cambios realizados

---

**Autor:** Claude Code
**Última actualización:** 2026-02-06
