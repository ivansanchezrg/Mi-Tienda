# POS — Documentación del módulo

## Escáner de código de barras por cámara

### Plugin utilizado

`@capacitor-mlkit/barcode-scanning`

```bash
npm install @capacitor-mlkit/barcode-scanning
npx cap sync
```

---

### El problema más común (y su solución)

MLKit renderiza la cámara en una capa **nativa debajo del WebView**.
Si el WebView es opaco, la cámara existe pero no se ve — el resultado es un fondo de color sólido.

**Lo que NO funciona:**
- Solo CSS con `background: transparent` en los elementos Ionic
- `getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT)` en MainActivity
- `document.documentElement.classList.add(...)` desde Angular

**Lo que SÍ funciona (los dos cambios necesarios):**

---

### Cambio 1 — CSS: ocultar el DOM con `visibility: hidden`

En `src/global.scss`:

```scss
body.scanner-active {
  visibility: hidden;
  --background: transparent;
  --ion-background-color: transparent;

  ion-app,
  ion-content,
  ion-router-outlet {
    --background: transparent !important;
    background: transparent !important;
  }
}

// El overlay del escáner debe seguir visible
body.scanner-active .scanner-overlay {
  visibility: visible;
}
```

> `visibility: hidden` oculta todo el DOM pero mantiene el WebView transparente.
> El overlay recibe `visibility: visible` para que el frame y el botón de cerrar sigan siendo visibles.

---

### Cambio 2 — Android: tema transparente

En `android/app/src/main/res/values/styles.xml`, en el estilo `AppTheme.NoActionBar`:

```xml
<style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="windowActionBar">false</item>
    <item name="windowNoTitle">true</item>
    <item name="android:background">@android:color/transparent</item>  <!-- era #3880ff -->
    <item name="android:windowIsTranslucent">true</item>
</style>
```

> `android:background` transparente + `windowIsTranslucent` le dicen a Android que la Activity
> puede dejar pasar lo que hay detrás (la cámara).
> Sin este cambio, aunque el CSS esté correcto, la Activity sigue pintando el fondo de color.

> **Nota:** `MainActivity.java` no necesita ningún cambio — queda como `extends BridgeActivity {}` vacío.

---

### Implementación en el componente

#### Permisos en `AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

#### TypeScript

```typescript
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

// Propiedades
escaneando = false;
private ultimoCodigoEscaneado = '';
private ultimoTiempoEscaneado = 0;

async abrirEscanerCamara() {
  const { camera } = await BarcodeScanner.requestPermissions();
  if (camera !== 'granted') {
    // mostrar toast de permiso denegado
    return;
  }

  this.escaneando = true;
  document.body.classList.add('scanner-active');

  try {
    await BarcodeScanner.addListener('barcodesScanned', async (event) => {
      const codigo = event.barcodes[0]?.rawValue;
      if (!codigo) return;

      // Anti-duplicados: ignora el mismo código dentro de 1.5 s
      const ahora = Date.now();
      if (codigo === this.ultimoCodigoEscaneado && ahora - this.ultimoTiempoEscaneado < 1500) return;
      this.ultimoCodigoEscaneado = codigo;
      this.ultimoTiempoEscaneado = ahora;

      await this.procesarCodigo(codigo);
    });
    await BarcodeScanner.startScan();
  } catch {
    await this.cerrarEscaner();
  }
}

async cerrarEscaner() {
  await BarcodeScanner.removeAllListeners();
  await BarcodeScanner.stopScan();
  document.body.classList.remove('scanner-active');
  this.escaneando = false;
}
```

> **Nombre del evento:** `barcodesScanned` (plural) — no `barcodeScanned`.
> **Estructura del evento:** `event.barcodes[0]?.rawValue` — no `event.barcode.rawValue`.

#### HTML — overlay del escáner

```html
@if (escaneando) {
<div class="scanner-overlay">
  <div class="scanner-frame"></div>
  <p class="scanner-hint">Apunta al código de barras</p>
  <button class="scanner-close-btn" (click)="cerrarEscaner()">
    <ion-icon name="close-outline"></ion-icon>
  </button>
</div>
}
```

#### SCSS del overlay (en el componente)

```scss
.scanner-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;

  .scanner-frame {
    width: 260px;
    height: 160px;
    border: 2px solid white;
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  }

  .scanner-hint {
    color: white;
    font-size: 14px;
    margin-top: var(--spacing-lg);
    text-shadow: 0 1px 4px rgba(0,0,0,0.6);
  }

  .scanner-close-btn {
    pointer-events: all;
    position: absolute;
    top: calc(var(--spacing-xl) + env(safe-area-inset-top));
    right: var(--spacing-md);
    background: rgba(0,0,0,0.5);
    border: none;
    border-radius: 50%;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    ion-icon { font-size: 24px; }
  }
}
```

---

### Anti-duplicados (importante para POS)

El escáner continuo puede detectar el mismo código varias veces por segundo.
Sin debounce, un solo scan agrega el producto múltiples veces al carrito.

Patrón implementado: guardar el último código + timestamp, ignorar si el mismo código llega en menos de 1500 ms.

---

### Resumen de archivos modificados

| Archivo | Cambio |
|---|---|
| `src/global.scss` | Clase `body.scanner-active` con `visibility: hidden` |
| `android/app/src/main/res/values/styles.xml` | `background` transparente + `windowIsTranslucent` |
| Componente `.ts` | `abrirEscanerCamara()`, `cerrarEscaner()`, debounce |
| Componente `.html` | Overlay `@if (escaneando)` |
| Componente `.scss` | Estilos del overlay |
