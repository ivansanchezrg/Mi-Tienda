# Plan: Alinear Auth al modelo Multi-Tenant (v11.0)

## Contexto

Schema v11.0 introduce multi-tenancy real:
- Cada usuario puede pertenecer a varios negocios (`usuario_negocios`)
- El negocio activo se setea en el JWT via `fn_set_negocio_activo` → `raw_app_meta_data`
- El cliente debe llamar `supabase.auth.refreshSession()` para que el JWT actualizado
  entre en vigor y las RLS empiecen a filtrar por `negocio_id`

El flujo de login actual asume **un único negocio** (no existe paso de selección).
El modelo `UsuarioActual` no lleva `negocio_id` ni `rol` (estos vivían como columnas
en `usuarios`, ahora viven en `usuario_negocios` y en el JWT).

---

## Qué cambia en el modelo de datos

### Antes (v10.x)
```
usuarios:
  id, nombre, usuario (email), activo, rol, es_superadmin
```
`rol` era global, un único negocio por usuario.

### Ahora (v11.0)
```
usuarios:
  id, nombre, email, activo, es_superadmin  ← sin rol

usuario_negocios:
  usuario_id, negocio_id, rol, activo       ← rol por negocio

JWT app_metadata (tras fn_set_negocio_activo + refreshSession):
  negocio_id, rol, es_superadmin
```

---

## Impacto en frontend

### 1. Modelo `UsuarioActual`

**Cambios:**
- `usuario` → `email` (alinearse con nombre de columna en BD)
- `rol` → ya no viene de `usuarios`, viene del JWT via `fn_set_negocio_activo`.
  Se mantiene en el modelo pero se carga desde el resultado de `fn_set_negocio_activo`.
- `negocio_id: string` — nuevo campo (UUID del negocio activo)
- `negocio_nombre: string` — nuevo campo (nombre del negocio para mostrar en UI)

```typescript
export interface UsuarioActual {
  id: string;              // UUID (antes era number)
  nombre: string;
  email: string;           // antes: usuario
  activo: boolean;
  rol: RolUsuario;         // ADMIN | EMPLEADO (viene de usuario_negocios via JWT)
  es_superadmin: boolean;
  negocio_id: string;      // UUID del negocio activo
  negocio_nombre: string;  // nombre para mostrar en sidebar
}
```

### 2. Flujo de login — 4 pasos ahora

```
ANTES:
  1. OAuth Google
  2. callback → validarUsuario() → /home

AHORA:
  1. OAuth Google
  2. callback → validarUsuario() → obtener negocios del usuario
  3a. Si 1 negocio  → fn_set_negocio_activo → refreshSession → /home
  3b. Si N negocios → /auth/seleccionar-negocio (nueva pantalla)
       → usuario elige → fn_set_negocio_activo → refreshSession → /home
```

### 3. Nuevas rutas y páginas

| Ruta | Componente | Cuándo aparece |
|------|-----------|----------------|
| `/auth/seleccionar-negocio` | `SelectorNegocioPage` | Usuario tiene 2+ negocios activos |

### 4. `AuthService` — cambios

- `validarUsuario()`: reemplazar query `usuarios.eq('usuario', email)` → `.eq('email', email)`.
  Después de validar, obtener lista de negocios del usuario. Si hay 1 → activar automático.
  Si hay N → redirigir a `/auth/seleccionar-negocio`.
- Auto-registro: cambiar columna `usuario` → `email`.
- `activarNegocio(negocioId)`: nuevo método público. Llama `fn_set_negocio_activo` via RPC,
  luego `supabase.auth.refreshSession()`, luego completa el flujo hacia `/home`.
- `iniciarRealtimeUsuario(id)`: el `id` pasa de `number` a `string` (UUID).
- `canalUsuarioId`: `number | null` → `string | null`.

### 5. Sidebar

- Mostrar `negocio_nombre` (viene de `UsuarioActual.negocio_nombre`).
- Ya no muestra `rol` hardcodeado de `UsuarioActual` — sigue igual
  (el rol sigue en el modelo, solo cambió de dónde viene).

### 6. Guards — sin cambios de lógica

`authGuard`, `publicGuard`, `roleGuard` no cambian su lógica.
`roleGuard` sigue leyendo `usuario.rol` de Preferences — funciona igual
porque `rol` sigue siendo parte de `UsuarioActual`.

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `features/auth/models/usuario_actual.model.ts` | `id: string`, `email`, `negocio_id`, `negocio_nombre` |
| `features/auth/services/auth.service.ts` | `validarUsuario()`, `activarNegocio()`, tipos `string` en Realtime |
| `features/auth/pages/callback/callback.page.ts` | `validateAndRedirect()` ya no va directo a `/home` |
| `features/auth/auth.routes.ts` | Agregar ruta `seleccionar-negocio` |
| `core/config/routes.config.ts` | `ROUTES.auth.seleccionarNegocio` |

## Archivos a crear

| Archivo | Qué es |
|---------|--------|
| `features/auth/pages/seleccionar-negocio/seleccionar-negocio.page.ts` | Lista de negocios del usuario para elegir |
| `features/auth/pages/seleccionar-negocio/seleccionar-negocio.page.html` | UI con cards por negocio |
| `features/auth/pages/seleccionar-negocio/seleccionar-negocio.page.scss` | Estilos |

---

## Implementación paso a paso

### Paso 1 — Modelo `UsuarioActual`
Actualizar tipos. Impacto en cascada: sidebar, guards, todos los que llaman
`getUsuarioActual()`. Buscar usos de `usuario.usuario` → cambiar a `usuario.email`.

### Paso 2 — `AuthService`

#### `validarUsuario()` — nuevo flujo
```
1. getUser() → email del JWT
2. .from('usuarios').select('id, nombre, email, activo, es_superadmin')
   .eq('email', email).maybeSingle()
3. Si no existe → auto-registro (INSERT email, nombre, activo: false) → /pending
4. Si activo: false → /pending
5. Si activo: true →
     a. Obtener negocios: .from('usuario_negocios')
           .select('negocio_id, rol, negocios(nombre)')
           .eq('usuario_id', data.id)
           .eq('activo', true)
     b. Si 0 negocios → error "sin acceso a ningún negocio"
     c. Si 1 negocio → activarNegocio(negocioId) directamente
     d. Si N negocios → guardar lista en memoria, redirigir a /auth/seleccionar-negocio
```

#### `activarNegocio(negocioId, negocioNombre, rol)` — nuevo método
```
1. supabase.rpc('fn_set_negocio_activo', { p_negocio_id: negocioId })
2. supabase.client.auth.refreshSession()
3. saveUsuarioActual({ ...usuarioBase, negocio_id, negocio_nombre, rol })
4. iniciarRealtimeUsuario(usuarioBase.id)
5. validadoEnEstaSesion = true
6. redirigir a /home
```

### Paso 3 — `SelectorNegocioPage`
Recibe la lista de negocios desde `AuthService` (propiedad pública temporal).
Muestra cards: nombre del negocio + rol del usuario en ese negocio.
Al tocar → llama `authService.activarNegocio(...)`.
Muestra spinner durante la activación.

### Paso 4 — `CallbackPage`
`validateAndRedirect()` ya no llama a `goHome()` directamente.
Delega todo el flujo de redirección a `authService.validarUsuario()`
(igual que hoy — solo que `validarUsuario` ya no redirige siempre a `/home`).
Sin cambios en `CallbackPage` si `validarUsuario()` internamente maneja la redirección.

### Paso 5 — Rutas y `ROUTES`
Agregar `/auth/seleccionar-negocio` en `auth.routes.ts` y `routes.config.ts`.

---

## Impacto en otros módulos

### `UsuariosModule` — listado de empleados
Actualmente muestra columna `rol` que venía de `usuarios`. Ahora el rol viene de
`usuario_negocios`. La query del servicio de usuarios necesita un JOIN:
```sql
SELECT u.id, u.nombre, u.email, u.activo, un.rol
FROM usuarios u
INNER JOIN usuario_negocios un
  ON un.usuario_id = u.id AND un.negocio_id = get_negocio_id()
WHERE un.activo = true
```
Este cambio va en el servicio de usuarios — **fuera del scope de este plan**.

### Sidebar
Mostrar `negocio_nombre` de `UsuarioActual`. Mínimo cambio en el template.

### `roleGuard` y `ConfigService`
Sin cambios — operan sobre `UsuarioActual.rol` que sigue siendo `'ADMIN' | 'EMPLEADO'`.

---

## Auto-registro — columna `email`

La tabla `usuarios` ya no tiene columna `usuario` — ahora es `email`.
El INSERT de auto-registro cambia:

```typescript
// ANTES
.insert({ nombre, usuario: user.email, rol: 'EMPLEADO', activo: false })

// AHORA
.insert({ nombre, email: user.email, activo: false })
// rol ya no va aquí — vive en usuario_negocios
// activo: false → admin debe aprobar + asignar a un negocio
```

---

## Orden de ejecución

```
1. usuario_actual.model.ts       → tipos base
2. auth.service.ts               → validarUsuario(), activarNegocio()
3. routes.config.ts              → ROUTES.auth.seleccionarNegocio
4. auth.routes.ts                → ruta lazy loaded
5. seleccionar-negocio.page.*    → nueva pantalla
6. callback.page.ts              → si necesita ajuste mínimo
7. sidebar.component.ts/html     → mostrar negocio_nombre
8. AUTH-README.md                → actualizar documentación
```

---

## Verificación post-implementación

- [ ] Login con usuario de 1 negocio → va directo a `/home`
- [ ] Login con usuario de 2+ negocios → aparece pantalla de selección
- [ ] Seleccionar negocio → JWT actualizado (verificar `app_metadata` en Supabase Dashboard)
- [ ] Sidebar muestra nombre del negocio correcto
- [ ] `roleGuard` sigue protegiendo rutas ADMIN correctamente
- [ ] Realtime de usuario sigue funcionando (canal se abre al activar negocio)
- [ ] Logout y re-login fluyen sin errores
- [ ] Superadmin puede seleccionar cualquier negocio (aunque no tenga membresía)
