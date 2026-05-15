# Android — Builds y Entornos

Referencia rápida para generar APK y correr la app en Android según el entorno.

---

## Entornos disponibles

| Entorno | Supabase | App en dispositivo | Comando |
|---------|----------|--------------------|---------|
| **Producción** | `mi tienda` (us-east-1) | Mi Tienda (`ec.mitienda.app`) | `npm run android` |
| **Test** | `mi tienda test` (us-west-2) | Mi Tienda Test (`ec.mitienda.app.test`) | `npm run android:test` |

Ambas apps coexisten en el dispositivo sin pisarse — tienen `applicationId` diferente.

**APKs generados en:**
- `android/app/build/outputs/apk/production/debug/` → producción
- `android/app/build/outputs/apk/staging/debug/` → test

---

## Credenciales

Cada entorno tiene su propio archivo de credenciales (ambos en `.gitignore`):

| Archivo | Entorno | Plantilla |
|---------|---------|-----------|
| `src/environments/environment.ts` | Producción | `environment.example.ts` |
| `src/environments/environment.test.ts` | Test | `environment.test.example.ts` |

Para obtener las credenciales de un proyecto:
1. Ir a [supabase.com/dashboard](https://supabase.com/dashboard)
2. Seleccionar el proyecto
3. **Settings → API Keys**
4. Copiar **Project URL** y **anon public**

---

## Comandos

```bash
# Producción
npm run android

# Test
npm run android:test

# Solo serve en browser (test)
ionic serve --configuration=test
```

Cada comando hace en orden: `ng build` → `cap sync android` → `cap run android`.

---

## Agregar un entorno nuevo

1. Crear `src/environments/environment.NOMBRE.ts` con las credenciales
2. Agregar `src/environments/environment.NOMBRE.ts` al `.gitignore`
3. Agregar configuración `NOMBRE` en `angular.json` (secciones `build` y `serve`)
4. Agregar script `android:NOMBRE` en `package.json`
