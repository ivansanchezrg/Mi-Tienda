# Ingreso / Egreso Manual — Referencia Técnica

## ¿Qué es?

Modal para **registrar movimientos manuales de efectivo** en CAJA o CAJA_CHICA. Un ingreso aumenta el saldo de la caja; un egreso lo reduce.

**Punto de entrada:** `OperacionesCajaPage` → toca "⋮" (menú, solo visible si la caja permite operaciones manuales) → ActionSheet → Ingreso / Egreso → abre `OperacionModalComponent`.

> **Diferencia clave con el cierre diario:** Las operaciones del cierre las calcula el sistema (`categoria_id = NULL`). Las manuales las inicia el usuario (categoría + monto + foto). `reparar_deficit_turno` es el único caso intermedio.

---

## 1. Archivos involucrados

| Archivo | Rol |
|---|---|
| `components/operacion-modal/operacion-modal.component.ts` | Modal: formulario, cámara, validaciones, confirmar/cancelar |
| `components/operacion-modal/operacion-modal.component.html` | Template del formulario |
| `services/operaciones-caja.service.ts` | `registrarOperacion()`, `obtenerCategorias()` |
| `services/cajas.service.ts` | `obtenerCajas()` — para el selector de caja dentro del modal |
| `services/storage.service.ts` | `uploadImage()`, `getSignedUrl()`, `deleteFile()` |
| `models/categoria-operacion.model.ts` | `CategoriaOperacion` |

### Cajas habilitadas

Solo **CAJA** y **CAJA_CHICA** aparecen en el selector del modal (`cajasFiltradas`). CAJA_CELULAR y CAJA_BUS no permiten operaciones manuales y quedan excluidas.

---

## 2. Flujo del proceso

```
Usuario toca "⋮" en la caja → ActionSheet: Ingreso / Egreso
        ↓
abrirModalOperacion(tipo)
  └─ obtenerCajas()            → lista de cajas filtradas a CAJA / CAJA_CHICA
  └─ OperacionModalComponent
       ├─ ngOnInit: obtenerCategorias(tipo) → categorías filtradas por INGRESO/EGRESO
       ├─ Usuario completa: categoría + monto + descripción + foto (según reglas)
       └─ confirmar() → role: 'confirm', data: OperacionModalResult
        ↓
ejecutarOperacion(tipo, data)
  └─ registrarOperacion(cajaId, tipo, categoriaId, monto, descripcion, foto)
       ├─ Si hay foto → storageService.uploadImage(dataUrl) → path en Storage
       ├─ rpc('registrar_operacion_manual', {...})
       │    └─ Si RPC falla y había foto → storageService.deleteFile(path) (limpieza)
       └─ cargarSaldoCaja() + cargarOperaciones(reset)
```

---

## 3. Reglas de validación del modal

| Campo | INGRESO | EGRESO |
|---|---|---|
| Categoría | Obligatorio | Obligatorio |
| Monto | Obligatorio (> 0) | Obligatorio (> 0, ≤ saldo disponible) |
| Descripción | Opcional | Obligatorio |
| Comprobante (foto) | Opcional | Obligatorio |

- **`montoExcedeSaldo`:** para EGRESO, si `monto > saldoCajaSeleccionada` → error inline + botón deshabilitado. `saldoCajaSeleccionada` viene de la caja actualmente seleccionada en el selector (cargada en `ngOnInit`).
- El botón "Confirmar" está `[disabled]` mientras cualquier validación falle. `confirmar()` tiene validaciones defensivas adicionales.

---

## 4. Cámara — parámetros de optimización

```typescript
Camera.getPhoto({
  quality:            80,    // 80% — buen balance calidad/tamaño
  width:              1200,  // Limitar ancho (px)
  height:             1600,  // Limitar alto (px)
  allowEditing:       false,
  resultType:         CameraResultType.DataUrl,
  correctOrientation: true   // Corregir rotación EXIF (importante en Android)
})
```

> Resultado típico: 200–500 KB en vez de 3–10 MB (~90% reducción). Supabase Storage no comprime automáticamente.

Cuando el usuario cancela, el plugin lanza una excepción — el `catch` la silencia deliberadamente. Si el permiso de cámara fue denegado, tampoco se muestra error (el usuario nota que no se abrió la cámara).

---

## 5. Storage — path vs URL firmada

`registrarOperacion()` guarda el **path** en BD (`operaciones_cajas.comprobante_url`), no una URL firmada:

```
comprobantes/2026/02/abc123.jpg   ← lo que está en BD
```

Para ver la imagen → `storageService.getSignedUrl(path)` genera una URL temporal. Esto evita exponer URLs públicas y permite revocarlas.

**Bucket:** `comprobantes` (privado — requiere signed URL para acceder).

**Limpieza de huérfanos:** Si el RPC falla después de subir la imagen, `deleteFile(path)` la elimina para no dejar archivos sin registro en BD.

---

## 6. Categorías

`obtenerCategorias(tipo)` filtra `categorias_operaciones` por `tipo = 'INGRESO'` o `tipo = 'EGRESO'` y `activo = true`, ordenadas por `codigo ASC`.

Categorías especiales usadas por el sistema (no aparecen en este modal):
- `EG-012` — Ajuste Déficit Turno Anterior (usado por `reparar_deficit_turno`)
- `IN-004` — Reposición Déficit Turno Anterior (usado por `reparar_deficit_turno`)

---

## 7. Función SQL: `registrar_operacion_manual`

> 📄 Código fuente completo: [`docs/sql/registrar_operacion_manual.sql`](./sql/registrar_operacion_manual.sql)

**Firma:**
```typescript
// OperacionesCajaService.registrarOperacion()
{
  p_caja_id,          // ID de la caja
  p_empleado_id,
  p_tipo_operacion,   // 'INGRESO' | 'EGRESO' (TEXT — PostgREST no castea ENUM automáticamente)
  p_categoria_id,
  p_monto,
  p_descripcion,      // nullable
  p_comprobante_url   // PATH en Storage (no URL firmada), nullable
}
```

**Retorna:** `{ success, operacion_id, saldo_anterior, saldo_nuevo }`

**Nota crítica:** `p_tipo_operacion` es `TEXT`, no `tipo_operacion_caja_enum`. PostgREST no castea automáticamente strings a enums PostgreSQL (genera 400 Bad Request). La función castea internamente: `v_tipo := p_tipo_operacion::tipo_operacion_caja_enum`.

---

## 8. Permisos Android

En `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
                 android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
                 android:maxSdkVersion="29" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

Después de agregar permisos: `npx cap sync android`.
