# Configuración Inicial - Mi Tienda

## Stack Tecnológico

| Componente    | Versión |
| ------------- | ------- |
| Ionic Angular | 8.x     |
| Angular       | 20.x    |
| Capacitor     | 8.x     |
| Node.js       | 22.x    |
| Supabase JS   | 2.x     |

---

## Crear Proyecto Nuevo

### 1. Requisitos Previos

```bash
npm install -g @angular/cli
npm install -g @ionic/cli@latest
```

### 2. Crear Proyecto

```bash
ionic start mi-tienda blank --type=angular --capacitor
cd mi-tienda
```

### 3. Instalar Dependencias

```bash
# Plugins Capacitor
npm install @capacitor/network@latest
npm install @capacitor/preferences@latest
npm install @capacitor/splash-screen@latest
npm install @capacitor/status-bar@latest

# SQLite (para dispositivos móviles)
npm install @capacitor-community/sqlite@latest

# Supabase (Backend as a Service)
npm install @supabase/supabase-js
```

### 4. Configurar Supabase

#### Instalar cliente de Supabase

```bash
npm install @supabase/supabase-js
```

#### Configurar Environments

**`src/environments/environment.ts`** (Desarrollo)

```typescript
export const environment = {
  production: false,

  // Supabase Configuration
  supabaseUrl: 'https://tu-proyecto.supabase.co',
  supabaseKey: 'tu-anon-key-aqui'
};
```

**`src/environments/environment.prod.ts`** (Producción)

```typescript
export const environment = {
  production: true,

  // Supabase Configuration
  supabaseUrl: 'https://tu-proyecto.supabase.co',
  supabaseKey: 'tu-anon-key-aqui'
};
```

> **Notas de Seguridad:**
> 
> - Las credenciales `supabaseUrl` y `supabaseKey` se obtienen desde el dashboard de Supabase
> - El `anon key` es seguro para usar en el cliente (frontend)
> - Habilitar Row Level Security (RLS) en Supabase para proteger los datos
> - En producción, considerar usar variables de entorno o secrets management

### 5. Agregar Plataforma Android

```bash
ionic build
npm install @capacitor/android
npx cap add android
npx cap sync
```

### 6. Configurar Capacitor

Editar el archivo `capacitor.config.ts` con la siguiente configuración:

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mitienda.app',
  appName: 'mi-tienda',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false
    }
  }
};

export default config;
```

**Configuraciones importantes:**

- `appId`: Identificador único de la aplicación (formato: com.dominio.app)
- `androidScheme: 'https'`: Usa HTTPS para evitar problemas de contenido mixto
- `CapacitorSQLite`: Configuración necesaria para el plugin de SQLite

### 7. Probar la Aplicación en Dispositivo Android

Esta sección te permite instalar y probar la aplicación en un teléfono Android físico.

#### Requisitos Previos

1. Conectar el dispositivo Android mediante USB
2. Habilitar la **Depuración USB** en el dispositivo:
   - Ir a **Ajustes** → **Información del teléfono**
   - Tocar 7 veces en **Número de compilación** para activar "Opciones de desarrollador"
   - Regresar a **Ajustes** → **Opciones de desarrollador**
   - Activar **Depuración USB**

#### Comandos para Instalar y Ejecutar

Ejecutar estos tres comandos **cada vez que hagas cambios en el código**:

```bash
# 1. Compila la aplicación Angular
npm run build

# 2. Sincroniza los archivos compilados con la carpeta Android
npx cap sync android

# 3. Instala y ejecuta la app en el dispositivo conectado
npx cap run android
```

**¿Qué hace cada comando?**

- `npm run build`: Compila tu código Angular y genera los archivos en la carpeta `www`
- `npx cap sync android`: Copia los archivos compilados a la carpeta `android` del proyecto
- `npx cap run android`: Compila el proyecto Android, instala el APK en tu dispositivo y lo ejecuta

> **Importante:** Debes ejecutar estos tres comandos cada vez que modifiques el código de tu aplicación para ver los cambios reflejados en el dispositivo.

#### Problema Común: SDK Location Not Found

**Error:**

```
FAILURE: Build failed with an exception.

* What went wrong:
Could not determine the dependencies of task ':app:compileDebugJavaWithJavac'.
> SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting
the sdk.dir path in your project's local properties file at
'C:\Users\ivan\Desktop\mi-tienda\android\local.properties'.
```

**Solución:**

Crear el archivo `android/local.properties` con el siguiente contenido:

```properties
## This file must *NOT* be checked into Version Control Systems,
# as it contains information specific to your local configuration.
#
# Location of the SDK. This is only used by Gradle.
# For customization when using a Version Control System, please read the
# header note.
sdk.dir=C\:\\Users\\TU_USUARIO\\AppData\\Local\\Android\\Sdk
```

> **Nota:** Reemplazar `TU_USUARIO` con el nombre de usuario de tu sistema. Este archivo no debe ser incluido en el control de versiones (Git).

#### Configurar Splash Screen (Eliminar Pantalla en Blanco)

**Problema:** Al abrir la app se muestra una pantalla en blanco durante 2-3 segundos antes de ver la interfaz.

**Solución:** Configurar el Splash Screen nativo de Android.

Editar el archivo `android/app/src/main/res/values/styles.xml`:

```xml
<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
    <item name="windowSplashScreenBackground">#3880ff</item>
    <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
    <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
</style>
```

**Configuración:**

- `windowSplashScreenBackground`: Color de fondo mientras carga (azul #3880ff)
- `windowSplashScreenAnimatedIcon`: Icono que se muestra (puede personalizarse)
- `postSplashScreenTheme`: Tema que se aplica después del splash

> **Resultado:** La pantalla en blanco se reemplaza por una pantalla azul con el logo de la app mientras carga.
