# Ingreso / Egreso Manual — Referencia Técnica

## ¿Qué es?

Modal para **registrar movimientos manuales de efectivo** en CAJA o CAJA_CHICA. Un ingreso aumenta el saldo de la caja; un egreso lo reduce.

**Punto de entrada:** `OperacionesCajaPage` → toca "⋮" (menú, solo visible si la caja permite operaciones manuales) → ActionSheet → Ingreso / Egreso → abre `OperacionModalComponent`.

> **Diferencia clave con el cierre diario:** Las operaciones del cierre las calcula el sistema (`categoria_id = NULL`). Las manuales las inicia el usuario (categoría + monto + foto). `fn_reparar_deficit_turno` es el único caso intermedio.

---

## 1. Archivos involucrados

| Archivo | Rol |
|---|---|
| `components/operacion-modal/operacion-modal.component.ts` | Modal: formulario, cámara, validaciones, confirmar/cancelar |
| `components/operacion-modal/operacion-modal.component.html` | Template del formulario |
| `services/operaciones-caja.service.ts` | `registrarOperacion()`, `obtenerCategorias()` |
| `services/cajas.service.ts` | `obtenerCajas()` — para el selector de caja dentro del modal |
| `core/services/storage.service.ts` | `capturarFoto()`, `uploadImage()`, `getSignedUrl()`, `deleteFile()` |
| `models/categoria-operacion.model.ts` | `CategoriaOperacion` |

### Cajas habilitadas

Solo **CAJA**, **CAJA_CHICA** y **VARIOS** aparecen en el selector del modal (`cajasFiltradas`). CAJA_CELULAR y CAJA_BUS no permiten operaciones manuales y quedan excluidas.

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
       ├─ rpc('fn_registrar_operacion_manual', {...})
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

## 4. Cámara y compresión de imagen

La captura y compresión están centralizadas en `StorageService` (ver [CORE-README.md](../core/CORE-README.md#storageservice)).

`OperacionModalComponent` llama a `storageService.capturarFoto(source)` — **no configura `Camera.getPhoto` directamente**. Todos los parámetros de captura viven en un único lugar: `StorageService.capturarFoto()`.

El modal mantiene dos propiedades separadas:
- `fotoPreviewUrl: SafeUrl` — para el `<img [src]>` inmediato (URL nativa via `Capacitor.convertFileSrc`, sin pasar por el bridge)
- `fotoRawUrl: string` — se pasa al caller al confirmar, quien lo entrega a `uploadImage()`

Flujo completo al registrar un comprobante:
1. `capturarFoto(source)` → abre cámara/galería → retorna `{ previewUrl, rawUrl }`
2. Preview aparece inmediato en la UI (`fotoPreviewUrl`)
3. Al confirmar: el modal emite `fotoRawUrl` en `OperacionModalResult.fotoComprobante`
4. `registrarOperacion()` llama `uploadImage(rawUrl, 'comprobantes', 'operaciones')` → comprime a WebP → sube a Storage → retorna `path`
5. El `path` se pasa al RPC — nunca la URL

Cuando el usuario cancela, `capturarFoto()` retorna `null` silenciosamente (la excepción del plugin queda encapsulada en el servicio).

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

Categorías especiales del sistema (no aparecen en el dropdown del usuario — viven en `categorias_sistema`, tabla global sin `negocio_id`):
- `DEF-RETIRAR` — Ajuste Déficit Turno Anterior (usado por `fn_reparar_deficit_turno`)
- `DEF-REPONER` — Reposición Déficit Turno Anterior (usado por `fn_reparar_deficit_turno`)

---

## 7. Función SQL: `fn_registrar_operacion_manual`

> 📄 Código fuente completo: [`docs/caja/sql/functions/fn_registrar_operacion_manual.sql`](./sql/functions/fn_registrar_operacion_manual.sql)

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

**Restricción de turno (v2.2):** para `CAJA_CHICA`, la función valida que `p_empleado_id` tenga un turno activo hoy (`hora_fecha_cierre IS NULL`). Si el empleado no es el dueño del turno activo, lanza excepción. Esta validación es la última línea de defensa — la UI ya bloquea el acceso via `turnoAjeno=true`.

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
