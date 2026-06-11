# Ingreso / Egreso Manual — Referencia Técnica

## ¿Qué es?

Modal para **registrar movimientos manuales de efectivo** en las cajas que lo permiten (ver "Cajas habilitadas"). Un ingreso aumenta el saldo de la caja; un egreso lo reduce.

**Puntos de entrada:**
- `OperacionesCajaPage` → "⋮" → `OptionsModalComponent` (Ingreso / Egreso) → abre `OperacionModalComponent`
- Home → FAB central → opción de gasto → abre el mismo modal (vía `onOperacion`)

> **Diferencia clave con el cierre diario:** Las operaciones del cierre las calcula el sistema (`categoria_id = NULL`). Las manuales las inicia el usuario (categoría + monto + foto). `fn_reparar_deficit_turno` es el único caso intermedio.

---

## 1. Archivos involucrados

| Archivo | Rol |
|---|---|
| `components/operacion-modal/operacion-modal.component.ts` | Modal: formulario, cámara, validaciones, confirmar/cancelar |
| `components/operacion-modal/operacion-modal.component.html` | Template del formulario |
| `services/operaciones-caja.service.ts` | `registrarOperacion()`, `obtenerCategorias()` |
| `services/cajas.service.ts` | `obtenerCajas()` — para el selector de caja dentro del modal |
| `core/services/storage.service.ts` | `elegirFuenteFoto()`, `uploadImage()`, `getSignedUrl()`, `deleteFile()` |
| `models/categoria-operacion.model.ts` | `CategoriaOperacion` |

### Cajas habilitadas

El selector del modal (`cajasFiltradas`) muestra **CAJA**, **CAJA_CHICA**, **VARIOS** y las cajas
personalizadas (**`CUSTOM_*`**), con dos condiciones por `@Input()`:
- `excluirCajaChica = true` → oculta CAJA_CHICA (ej: cuando se opera desde fuera del turno)
- `variosActiva = false` → oculta VARIOS (módulo opt-in no activado)

CAJA_CELULAR y CAJA_BUS no permiten operaciones manuales y quedan excluidas siempre.
Otros `@Input()`: `cajaIdPreseleccionada` (preselecciona y muestra la mini-card de la caja).

---

## 2. Flujo del proceso

```
Usuario toca "⋮" en la caja → OptionsModalComponent: Ingreso / Egreso
        ↓
abrirModalOperacion(tipo)
  └─ OperacionModalComponent (recibe cajas + flags)
       ├─ ngOnInit: filtra cajasFiltradas (CAJA/CAJA_CHICA/VARIOS/CUSTOM_* según flags)
       │            + obtenerCategorias(tipo) → categorías filtradas por INGRESO/EGRESO
       ├─ Usuario completa: caja + categoría + monto (+ descripción/foto según reglas)
       └─ confirmar() → role: 'confirm', data: OperacionModalResult
        ↓
ejecutarOperacion(tipo, data)
  └─ registrarOperacion(cajaId, tipo, categoriaId, monto, descripcion, foto)
       ├─ getUsuarioActual() PRIMERO (si falla, no se sube nada — sin huérfanos)
       ├─ Si hay foto → uploadImage(rawUrl, 'comprobantes/operaciones') → path en Storage
       ├─ rpc('fn_registrar_operacion_manual', {...})
       │    └─ Si RPC falla y había foto → storageService.deleteFile(path) (limpieza)
       └─ refresco de saldo + lista de operaciones
```

---

## 3. Reglas de validación del modal

| Campo | INGRESO | EGRESO |
|---|---|---|
| Caja | Obligatorio | Obligatorio |
| Categoría | Obligatorio | Obligatorio |
| Monto | Obligatorio (> 0) | Obligatorio (> 0, ≤ saldo disponible) |
| Descripción | Condicional* | Condicional* |
| Comprobante (foto) | Opcional | Opcional |

> \* **Regla "otros" (`requiereDescripcion`):** la descripción es obligatoria (mín. 3 caracteres)
> solo cuando el **nombre** de la categoría seleccionada matchea `/otros?/i` ("Otros Gastos",
> "Otros Ingresos", etc.), sin importar el tipo. ⚠️ Es una regla por nombre, no por flag: si el
> usuario crea una categoría que contiene "otro" en el nombre, hereda la obligatoriedad; si
> renombra "Otros Gastos", la pierde. Mejora futura: flag explícito en la categoría.

- **`montoExcedeSaldo`:** para EGRESO, si `monto > saldoCajaSeleccionada` → error inline + botón deshabilitado. `saldoCajaSeleccionada` se actualiza al cambiar la caja en el selector (subscription a `cajaId`).
- El botón "Confirmar" está `[disabled]` con `form.invalid || montoExcedeSaldo`. `confirmar()` repite la misma validación defensivamente.

---

## 4. Cámara y compresión de imagen

La captura y compresión están centralizadas en `StorageService` (ver [CORE-README.md](../core/CORE-README.md#storageservice)).

`OperacionModalComponent` llama a `storageService.elegirFuenteFoto('libre', false, false)` — el
flujo estándar del proyecto para comprobantes: menú de fuente (cámara/galería) + captura,
**sin recorte** (`withCrop = false`). No configura `Camera.getPhoto` ni arma menús propios.

El modal mantiene dos propiedades separadas:
- `fotoPreviewUrl: SafeUrl` — para el `<img [src]>` inmediato (URL nativa via `Capacitor.convertFileSrc`, sin pasar por el bridge)
- `fotoRawUrl: string` — se pasa al caller al confirmar, quien lo entrega a `uploadImage()`

Flujo completo al registrar un comprobante:
1. `elegirFuenteFoto('libre', false, false)` → menú de fuente → cámara/galería → retorna `{ previewUrl, rawUrl }`
2. Preview aparece inmediato en la UI (`fotoPreviewUrl`)
3. Al confirmar: el modal emite `fotoRawUrl` en `OperacionModalResult.fotoComprobante`
4. `registrarOperacion()` llama `uploadImage(rawUrl, 'comprobantes/operaciones')` → comprime a WebP → sube a Storage → retorna `path`
5. El `path` se pasa al RPC — nunca la URL

Cuando el usuario cancela, `elegirFuenteFoto()` retorna `null` silenciosamente (la excepción del plugin queda encapsulada en el servicio).

---

## 5. Storage — path vs URL firmada

`registrarOperacion()` guarda el **path** en BD (`operaciones_cajas.comprobante_url`), no una URL firmada:

```
{negocio_id}/comprobantes/operaciones/2026/05/abc123.webp   ← lo que está en BD
```

Para ver la imagen → `storageService.getSignedUrl(path)` genera una URL temporal. Esto evita exponer URLs públicas y permite revocarlas.

**Bucket:** único de la plataforma, **`mi-tienda`** (privado), con aislamiento multi-tenant por
`{negocio_id}/` al inicio del path — el `negocio_id` lo inyecta `StorageService` internamente,
nunca se pasa como parámetro (ver CLAUDE.md → "Storage multi-tenant").

**Limpieza de huérfanos (2 capas):** (a) el empleado se resuelve ANTES del upload — si la sesión
está rota no se sube nada; (b) si el RPC falla después de subir, `deleteFile(path)` elimina la
imagen para no dejar archivos sin registro en BD.

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

**Restricción de turno (v3.2):** para `CAJA_CHICA`, la función valida que `p_empleado_id` tenga
**el turno activo** (`hora_fecha_cierre IS NULL`, **sin filtro de fecha** — misma definición que
`obtenerTurnoActivo()`). La versión anterior filtraba por "hoy" casteando el DATE local a
medianoche UTC (corrimiento de 5h) y rechazaba turnos abiertos después de las ~19:00 hora
Ecuador — corregido el 2026-06-10. Esta validación es la última línea de defensa — la UI ya
bloquea el acceso.

**Restricción VARIOS (v3.1):** si la caja es `VARIOS`, valida que `caja_varios_activa = 'true'`
en `configuraciones` — un negocio sin el módulo activado no puede operar sobre ella ni por RPC.

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
