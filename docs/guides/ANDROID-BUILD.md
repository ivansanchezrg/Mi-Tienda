# Android — Builds y Entornos

Referencia rápida para generar APK y correr la app en Android según el entorno.

---

## Entornos disponibles

| Entorno | Supabase | Optimización | App en dispositivo | Comando |
|---------|----------|--------------|--------------------|---------|
| **Producción** | `mi tienda` (us-east-1) | ✅ Sí | Mi Tienda (`ec.mitienda.app`) | `npm run android` |
| **Test** | `mi tienda test` (us-west-2) | ❌ No | Mi Tienda Test (`ec.mitienda.app.test`) | `npm run android:test` |
| **Test Device** | `mi tienda test` (us-west-2) | ✅ Sí | Mi Tienda Test (`ec.mitienda.app.test`) | `npm run android:test-device` |

Ambas apps coexisten en el dispositivo sin pisarse — tienen `applicationId` diferente.

**`test` vs `test-device`:** el entorno `test` mantiene `optimization: false` para facilitar el debugging (source maps completos, sin tree-shaking). `test-device` usa `optimization: true`, lo que produce un bundle idéntico al de producción (~1.6 MB vs ~3.3 MB) y permite medir el rendimiento real en el dispositivo — cold start, tiempo de carga, etc.

**APKs generados en:**
- `android/app/build/outputs/apk/production/debug/` → producción
- `android/app/build/outputs/apk/staging/debug/` → test / test-device

---

## Credenciales

Cada entorno tiene su propio archivo de credenciales (los 3 listados en `.gitignore`):

| Archivo | Rol | Plantilla |
|---------|-----|-----------|
| `src/environments/environment.ts` | Base / desarrollo (`ng serve` sin configuración) | `environment.example.ts` |
| `src/environments/environment.prod.ts` | **Producción** — el build prod lo sustituye vía `fileReplacements` (angular.json) | `environment.example.ts` |
| `src/environments/environment.test.ts` | Test y Test Device (`fileReplacements` de ambas configs) | `environment.test.example.ts` |

> ⚠️ **Pendiente de seguridad (C-1 de `AUDITORIA-PRODUCCION-2026-05-07.md`):**
> `environment.ts` y `environment.prod.ts` están en `.gitignore` pero **siguen trackeados
> en git** (el gitignore no des-trackea lo ya commiteado) — sus credenciales viven en el
> repositorio y su historial. Antes de cualquier release: rotar la anon key en Supabase,
> `git rm --cached` de ambos y limpiar el historial con `git filter-repo` (paso a paso en
> la auditoría, hallazgo C-1). `environment.test.ts` sí está limpio (nunca fue trackeado).
> Borrar esta nota cuando C-1 quede resuelto.

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

# Test (sin optimización — para debugging)
npm run android:test

# Test Device (con optimización — para medir rendimiento real)
npm run android:test-device

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
