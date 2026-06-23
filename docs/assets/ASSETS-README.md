# Assets (App Icon & Splash) — Mi Tienda

Documentación del flujo para actualizar el icono y splash screen de la app Android.

---

## Contexto importante

Android maneja iconos en **dos formatos** según la versión del OS:

| Formato | Android | Archivos | Prioridad |
|---------|---------|----------|-----------|
| **Legacy PNG** | < 8.0 (API < 26) | `mipmap-*dpi/ic_launcher.png` | Fallback |
| **Adaptive Icon** | ≥ 8.0 (API ≥ 26) | `mipmap-anydpi-v26/ic_launcher.xml` + foreground + background | **Usado por defecto** |

> En dispositivos modernos (Android 8+) se usa el **adaptive icon**. Si solo actualizás el legacy PNG vas a seguir viendo el icono viejo.

### Estructura del adaptive icon

```
ic_launcher.xml
├── background → @color/ic_launcher_background  (color XML)
├── foreground → @mipmap/ic_launcher_foreground  (PNG por densidad)
└── monochrome → @mipmap/ic_launcher_monochrome  (PNG por densidad, Android 13+)
```

Android recorta el **33% exterior** del foreground para aplicar formas (círculo, squircle, etc.). El contenido importante debe estar en el **centro 60-65%**.

### Splash screen

Configurado en `android/app/src/main/res/values/styles.xml`:

```xml
<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
    <item name="windowSplashScreenBackground">#0052CC</item>
    <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
    <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
</style>
```

El color de `windowSplashScreenBackground` debe coincidir con el background del ícono para coherencia visual.

---

## Flujo recomendado — IconKitchen (flujo actual)

**IconKitchen** ([icon.kitchen](https://icon.kitchen)) es la herramienta correcta porque genera el foreground y background separados, incluyendo monochrome para Android 13+.

### 1. Preparar la imagen fuente

Opciones (en orden de calidad):

**Opción A — SVG** (mejor calidad): subir el SVG del ícono a IconKitchen.

**Opción B — PNG** (también válido): imagen `1024x1024px`, fondo opaco, ícono centrado ocupando el **60-65% central** (~640px), dejando al menos 190px de margen en cada borde.

Para convertir SVG a PNG con sharp (si el SVG es demasiado complejo):
```bash
node -e "
const sharp = require('./node_modules/sharp');
sharp('assets/icon-only.svg')
  .resize(1024, 1024)
  .png()
  .toFile('assets/icon-only.png')
  .then(() => console.log('OK'));
"
```

### 2. Generar con IconKitchen

1. Ir a [icon.kitchen](https://icon.kitchen)
2. Subir la imagen fuente
3. Configurar: fondo `#0052CC`, foreground centrado con padding
4. Descargar el ZIP → extraer en `assets/IconKitchen-Output/`

La estructura esperada:
```
assets/IconKitchen-Output/
└── android/
    └── res/
        ├── mipmap-anydpi-v26/
        │   └── ic_launcher.xml
        ├── mipmap-hdpi/
        │   ├── ic_launcher.png
        │   ├── ic_launcher_foreground.png
        │   ├── ic_launcher_background.png
        │   └── ic_launcher_monochrome.png
        ├── mipmap-mdpi/ ...
        ├── mipmap-xhdpi/ ...
        ├── mipmap-xxhdpi/ ...
        └── mipmap-xxxhdpi/ ...
```

### 3. Copiar los archivos al proyecto Android

```bash
SRC="assets/IconKitchen-Output/android/res"
DST="android/app/src/main/res"

for density in mipmap-hdpi mipmap-mdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  cp "$SRC/$density/ic_launcher.png" "$DST/$density/ic_launcher.png"
  cp "$SRC/$density/ic_launcher_foreground.png" "$DST/$density/ic_launcher_foreground.png"
  cp "$SRC/$density/ic_launcher_background.png" "$DST/$density/ic_launcher_background.png"
  cp "$SRC/$density/ic_launcher_monochrome.png" "$DST/$density/ic_launcher_monochrome.png"
done

cp "$SRC/mipmap-anydpi-v26/ic_launcher.xml" "$DST/mipmap-anydpi-v26/ic_launcher.xml"
cp "$SRC/mipmap-anydpi-v26/ic_launcher.xml" "$DST/mipmap-anydpi-v26/ic_launcher_round.xml"
```

### 4. Actualizar el adaptive icon XML

IconKitchen puede generar el XML apuntando al PNG de background. Cambiarlo para que use el color XML (más flexible):

Archivo: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
```

Hacer lo mismo en `ic_launcher_round.xml`.

### 5. Actualizar el color de background

Archivo: `android/app/src/main/res/values/ic_launcher_background.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0052CC</color>
</resources>
```

### 6. Actualizar el splash screen

Archivo: `android/app/src/main/res/values/styles.xml`

El color `windowSplashScreenBackground` debe coincidir con `ic_launcher_background`:
```xml
<item name="windowSplashScreenBackground">#0052CC</item>
<item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
```

### 7. Sincronizar con Capacitor

```bash
npx cap sync android
```

### 8. Limpiar caché y recompilar

**Android cachea agresivamente los iconos.** Para ver el cambio:

```bash
# Opción A — desinstalar la app del dispositivo antes de instalar la nueva versión
adb uninstall ec.mitienda.app

# Opción B — clean build
cd android && ./gradlew clean && cd ..
```

---

## Paleta de colores actual

| Elemento | Color | Archivo |
|----------|-------|---------|
| Fondo ícono (background) | `#0052CC` | `values/ic_launcher_background.xml` |
| Fondo splash | `#0052CC` | `values/styles.xml` |
| Foreground | Blanco sobre azul | PNGs de IconKitchen |

Si cambia el color de la paleta, actualizar los tres lugares anteriores.

---

## Prompts para generar el ícono con IA

### Estilo flat corporativo (actual)
```
Create a mobile app icon for a small retail store management app called "Mi Tienda".
The icon should be:
- Exactly 1024x1024 pixels
- Solid white background (#FFFFFF), covering the ENTIRE canvas edge to edge, no padding
- NO rounded corners (the OS applies them automatically)
- The store illustration CENTERED, occupying 60-65% of the canvas (roughly 640x640px area in the middle)
- Leave white space on all four sides (about 190px on each edge)
- The store/shop illustration in a single corporate blue (#0052CC), clean flat design, no gradients, no shadows
- Show a storefront with an awning, or a shopping bag, or a cash register
- No text inside the icon
- PNG format, fully opaque (no transparency anywhere)
```

### Para pedir SVG (mejor calidad en IconKitchen)
```
Create a mobile app icon for a small retail store management app called "Mi Tienda".
Output format: SVG vector file
The icon should be:
- Viewbox 1024x1024
- Solid white background (#FFFFFF) covering the entire canvas
- The store illustration CENTERED, occupying 60-65% of the canvas
- Leave white space on all four sides (about 190px on each edge)
- The store/shop illustration in a single corporate blue (#0052CC), clean flat design
- Pure vector shapes only (paths, rects, circles) — no embedded images, no base64, no filters
- No text inside the icon
```

> **Nota**: si el SVG pesa más de 200KB probablemente tiene paths rasterizados embebidos — no sirve para vector drawable de Android. Convertirlo a PNG con sharp y usar IconKitchen.

---

## Troubleshooting

### Sigo viendo el icono viejo después de compilar
1. Desinstalá completamente la app antes de instalar la nueva versión
2. Verificá que `ic_launcher.xml` apunte a `@color/ic_launcher_background` (no a `@mipmap/ic_launcher_background`)
3. `cd android && ./gradlew clean` + recompilar

### El ícono se ve recortado en los bordes
El safe zone no es suficiente. Regenerar la imagen con el ícono ocupando solo el 60-65% central.

### El splash sigue mostrando el ícono anterior
Verificar que `windowSplashScreenAnimatedIcon` en `styles.xml` apunte a `@mipmap/ic_launcher_foreground` y no a `@drawable/ic_splash_logo` u otro drawable viejo.

### El ícono se ve borroso en el splash
El `ic_launcher_foreground.png` es un PNG rasterizado — se ve borroso si Android lo escala. Para mayor nitidez, IconKitchen genera los PNGs en la densidad correcta para cada tamaño de pantalla, lo que minimiza el escalado.

### Flash blanco entre el splash y el contenido de la app
**Síntoma**: el splash desaparece correctamente, pero por una fracción de segundo se ve una pantalla blanca antes de que aparezca la primera página (login o dashboard).

**Causa**: Capacitor oculta el splash automáticamente en cuanto monta el WebView, pero Angular todavía no terminó de renderizar la primera ruta.

**Solución implementada** (control manual del splash):

`capacitor.config.ts` — desactivar el ocultamiento automático:
```typescript
plugins: {
  SplashScreen: {
    launchAutoHide: false,   // Capacitor NO oculta el splash solo
    backgroundColor: '#0052CC'  // debe coincidir con windowSplashScreenBackground
  }
}
```

`app.component.ts` — ocultar manualmente en el primer `NavigationEnd`:
```typescript
private setupSplashScreenHide() {
  if (!Capacitor.isNativePlatform()) return;

  this.router.events
    .pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      take(1)
    )
    .subscribe(async () => {
      await SplashScreen.hide();
    });
}
```

**Por qué esperar al `NavigationEnd`**: la app tiene guards (`auth`, `caja-abierta`) y servicios que arrancan en el bootstrap (`TurnosCajaService`). Con `setTimeout` fijo o `requestAnimationFrame` el splash se puede ocultar antes de que esos procesos terminen en dispositivos lentos. `NavigationEnd` garantiza que la primera ruta real ya fue resuelta y renderizada.

> Si algún día se agrega una ruta que falle permanentemente en el bootstrap, el splash quedaría visible indefinidamente. En ese caso añadir un timeout de seguridad de 5–8 s como fallback.
