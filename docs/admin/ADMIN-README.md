# Admin — Panel de Superadmin

Panel exclusivo para el superadmin del sistema. Permite gestionar todos los negocios de la plataforma: listarlos, crear nuevos, entrar a operar dentro de uno y suspender/reactivar tanto negocios como sus propietarios.

Ruta: `/admin`. Guard: `superadminGuard`.

---

## Qué hace el módulo

El superadmin es el único rol que puede:

1. **Ver todos los negocios** de la plataforma (activos y suspendidos)
2. **Crear un negocio nuevo** vía el wizard reutilizable (`/crear-negocio?context=admin`)
3. **Entrar a operar dentro de un negocio** como si fuera el admin del negocio
4. **Suspender / reactivar un negocio** (bloquea todos sus usuarios excepto al superadmin)
5. **Suspender / reactivar al propietario** de un negocio (bloqueo global — afecta todos sus negocios)

---

## Estructura de archivos

```
features/admin/
└── pages/
    └── dashboard/
        ├── admin-dashboard.page.ts    ← lógica completa
        ├── admin-dashboard.page.html  ← listado + cards
        └── admin-dashboard.page.scss  ← estilos

docs/admin/
└── sql/
    ├── functions/
    │   ├── fn_suspender_negocio.sql   ← suspender/reactivar un negocio
    │   ├── fn_suspender_usuario.sql   ← suspender/reactivar un usuario globalmente
    │   └── fn_consultar_usuario_por_email.sql
    └── setup/
        └── realtime_negocios.sql      ← habilitar Realtime en tabla negocios
```

---

## Flujo completo del superadmin

### 1. Login → `/admin`

```
Login Google
  └─ validarUsuario()
       └─ es_superadmin = true + sin negocio cacheado
            └─ guarda UsuarioActual con negocio_id: ''
                 └─ navega a /admin
```

El superadmin llega a `/admin` sin `negocio_id` en el JWT — opera fuera de cualquier tenant. Las RLS de `negocios` usan una verificación directa contra la tabla `usuarios` (no `get_es_superadmin()`) para este caso. Ver [AUTH-README.md](../auth/AUTH-README.md) sección 13.

### 2. Listado de negocios

`AdminDashboardPage.cargar()` ejecuta:

```typescript
this.supabase.client
  .from('negocios')
  .select(`
    id, nombre, slug, activo, propietario_usuario_id, created_at,
    propietario:usuarios!propietario_usuario_id (activo)
  `)
  .order('created_at', { ascending: true })
```

El JOIN embebido `propietario:usuarios!...` trae el campo `activo` del propietario para mostrar el badge de "Propietario suspendido" en la card.

**Interfaz interna:**

```typescript
interface NegocioAdmin {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;                   // estado del negocio
  propietario_usuario_id: string;    // FK al usuario propietario
  propietario_activo: boolean;       // viene del JOIN
  created_at: string;
}
```

### 3. Entrar a operar en un negocio

Al tocar la card de un negocio → `entrarNegocio(negocio)`:

```typescript
await this.authService.cambiarNegocio(negocio.id, negocio.nombre);
```

`cambiarNegocio()` llama `fn_set_negocio_activo`, refresca el JWT con el nuevo `negocio_id` y hace `window.location.href = ROUTES.home` (hard reload — patrón multi-tenant para limpiar todo estado en memoria). Desde `/caja` el superadmin opera con rol ADMIN dentro del negocio.

Para volver a `/admin`: botón en el sidebar → `irAlPanelAdmin()`.

### 4. Crear negocio

Botón "Crear negocio" → navega al wizard reutilizable:

```typescript
this.router.navigate([ROUTES.crearNegocio.root], { queryParams: { context: 'admin' } });
```

El wizard (`/crear-negocio?context=admin`) opera en modo `sucursal-superadmin`. Pide el email del admin del nuevo negocio. Al finalizar, usa `fn_completar_onboarding`. Ver [AUTH-README.md](../auth/AUTH-README.md) sección "Creación de negocios".

---

## Suspensión de negocios y usuarios

El menú de opciones (⋯) de cada negocio abre `OptionsModalComponent` con dos acciones:

| Acción | Función SQL | Efecto |
|--------|------------|--------|
| Suspender / Reactivar negocio | `fn_suspender_negocio` | Bloquea acceso a todos los usuarios del negocio. Solo el superadmin puede entrar. |
| Suspender / Reactivar propietario | `fn_suspender_usuario` | Bloquea al propietario en **todos sus negocios** (campo `activo` en tabla `usuarios`). |

Ambas acciones muestran un `AlertController` de confirmación antes de ejecutarse.

### Diferencia clave entre los dos tipos de suspensión

```
Suspensión de negocio (fn_suspender_negocio)
  → UPDATE negocios SET activo = false WHERE id = p_negocio_id
  → Afecta: todos los usuarios de ESE negocio específico
  → Caso de uso: negocio moroso, cierre temporal, fraude del negocio

Suspensión de usuario (fn_suspender_usuario)
  → UPDATE usuarios SET activo = false WHERE id = p_usuario_id
  → Afecta: el propietario en TODOS sus negocios
  → Caso de uso: fraude del propietario, múltiples negocios comprometidos
```

### Cómo el sistema bloquea el acceso

La verificación ocurre en `fn_set_negocio_activo` (llamada al activar o cambiar de negocio):

```sql
-- Bloquea si el usuario está suspendido globalmente
IF (SELECT activo FROM usuarios WHERE id = p_usuario_id) = FALSE THEN
    RAISE EXCEPTION 'Usuario suspendido y no puede acceder';
END IF;

-- Bloquea si el negocio está suspendido (excepto superadmin)
IF (SELECT activo FROM negocios WHERE id = p_negocio_id) = FALSE
   AND NOT v_es_superadmin THEN
    RAISE EXCEPTION 'Negocio no existe o no esta activo';
END IF;
```

### Detección en tiempo real (Realtime)

Los usuarios activos se enteran de la suspensión en segundos via Supabase Realtime — no tienen que esperar al próximo login ni a que el JWT expire.

**Canal `usuario-activo-{id}`** (tabla `usuarios`):
- Si `activo` pasa a `false` → `handleUsuarioDesactivado()` → redirige a `/auth/pending?motivo=usuario`
- La sesión OAuth **no se cierra** — el usuario puede tocar "Verificar estado" cuando lo reactiven sin re-autenticarse

**Canal `negocio-activo-{negocioId}`** (tabla `negocios`):
- Si `activo` pasa a `false` → cierra ambos canales Realtime, limpia Preferences, redirige a `/auth/pending?motivo=negocio`

```
Superadmin suspende negocio desde /admin
  └─ fn_suspender_negocio → UPDATE negocios SET activo = false
       └─ Realtime notifica al cliente del usuario activo
            └─ iniciarRealtimeNegocio() handler
                 └─ cerrarRealtimeUsuario() (cierra ambos canales)
                      └─ Preferences.remove('usuario_actual')
                           └─ toast "Este negocio fue suspendido"
                                └─ navigate /auth/pending?motivo=negocio

Superadmin suspende propietario desde /admin
  └─ fn_suspender_usuario → UPDATE usuarios SET activo = false
       └─ Realtime notifica al cliente del usuario activo
            └─ iniciarRealtimeUsuario() handler (activo = false)
                 └─ handleUsuarioDesactivado()
                      └─ cerrarRealtimeUsuario() + Preferences.remove
                           └─ toast "Tu acceso fue suspendido"
                                └─ navigate /auth/pending?motivo=usuario
```

Para que Realtime funcione, la tabla `negocios` debe estar publicada con `REPLICA IDENTITY FULL`. Ver `docs/admin/sql/setup/realtime_negocios.sql`.

---

## Pantalla `/auth/pending` — mensajes contextuales

La página muestra UI diferente según el query param `motivo`:

| `motivo` | Icono | Título | Mensaje | Botón "Verificar" |
|----------|-------|--------|---------|-------------------|
| `usuario` | `ban-outline` | Cuenta suspendida | "Tu cuenta fue suspendida por el administrador. Contactalo para que te reactive." | ✅ Visible |
| `negocio` | `business-outline` | Negocio suspendido | "Este negocio fue suspendido por el administrador. Contactalo para que lo reactive." | ✅ Visible |
| `membresia` | `ban-outline` | Acceso removido | "Tu acceso a este negocio fue removido. Contactá al administrador si creés que es un error." | ❌ Oculto |

**Lógica del botón "Verificar estado"** (`reintentar()`):

```
1. Consulta directa a BD (NO usa retorno de validarUsuario)
   - motivo=negocio → SELECT activo FROM negocios WHERE id = negocio_cacheado
   - motivo=usuario → SELECT activo FROM usuarios WHERE email = email_jwt

2. Si sigue suspendido → toast contextual "sigue suspendido" + no navega

3. Si fue reactivado → llama validarUsuario() que navega al selector o /caja
```

El motivo para consultar BD directo en lugar de interpretar el retorno de `validarUsuario()`: esa función retorna `false` tanto cuando el usuario sigue suspendido **como** cuando navega al selector de negocios (múltiples negocios) — ambos casos producirían el toast de error incorrecto.

---

## Selector de negocios — comportamiento con negocios suspendidos

Cuando el usuario llega al selector después de reintentar, puede ver negocios suspendidos:

- Card con clase `negocio-card--suspendido` (opacity 0.6, sin transform en tap)
- Badge "Suspendido" en color warning
- Flecha de navegación oculta
- Al tocar → toast "Este negocio está suspendido. Contactá al administrador." (no navega)

El selector muestra **todos** los negocios del usuario (activos y suspendidos) para que pueda ver el estado. Solo activa negocios con `negocio_activo = true`.

---

## Funciones SQL

### `fn_suspender_negocio(p_negocio_id UUID, p_activo BOOLEAN)`

**Archivo:** `docs/admin/sql/functions/fn_suspender_negocio.sql`

- Solo ejecutable por superadmin (valida internamente)
- `UPDATE negocios SET activo = p_activo WHERE id = p_negocio_id`
- Retorna `{ success, negocio_id, nombre, activo }`
- El Realtime de `negocios` propaga el cambio a usuarios activos en segundos

### `fn_suspender_usuario(p_usuario_id UUID, p_activo BOOLEAN)`

**Archivo:** `docs/admin/sql/functions/fn_suspender_usuario.sql`

- Solo ejecutable por superadmin (valida internamente)
- Protecciones:
  - No puede suspender a otro superadmin
  - No puede suspenderse a sí mismo
- `UPDATE usuarios SET activo = p_activo WHERE id = p_usuario_id`
- Retorna `{ success, usuario_id, nombre, email, activo }`
- El Realtime de `usuarios` propaga el cambio a usuarios activos en segundos

### `fn_set_negocio_activo` (en `docs/setup/03_functions.sql`)

Llamada al activar o cambiar de negocio. Bloquea el acceso si:
- `usuarios.activo = false` (suspensión global del usuario)
- `negocios.activo = false` (suspensión del negocio), salvo superadmin

---

## Setup necesario en Supabase

Al crear el schema desde cero o tras un reset, ejecutar en este orden:

```sql
-- 1. Columna activo en usuarios (si no existe)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Habilitar Realtime en negocios
-- docs/admin/sql/setup/realtime_negocios.sql

-- 3. Crear funciones
-- docs/admin/sql/functions/fn_suspender_negocio.sql
-- docs/admin/sql/functions/fn_suspender_usuario.sql
```

---

## Mapa rápido de archivos

| Archivo | Qué tiene |
|---------|-----------|
| `features/admin/pages/dashboard/admin-dashboard.page.ts` | Listado de negocios, `entrarNegocio()`, `crearNegocio()`, `abrirOpciones()`, `toggleNegocio()`, `toggleUsuario()` |
| `features/auth/services/auth.service.ts` | `iniciarRealtimeNegocio()`, `cerrarRealtimeNegocio()`, `handleUsuarioDesactivado()`, `cambiarNegocio()`, `irAlPanelAdmin()` |
| `features/auth/pages/pending/pending.page.ts` | Pantalla de suspensión con mensajes contextuales por `motivo` |
| `features/auth/pages/seleccionar-negocio/seleccionar-negocio.page.ts` | Selector con badges de negocios suspendidos, bloqueo de tap en suspendidos |
| `docs/admin/sql/functions/fn_suspender_negocio.sql` | Suspender/reactivar negocio |
| `docs/admin/sql/functions/fn_suspender_usuario.sql` | Suspender/reactivar propietario globalmente |
| `docs/admin/sql/setup/realtime_negocios.sql` | Publicar tabla `negocios` en Realtime |
| `docs/setup/03_functions.sql` | `fn_set_negocio_activo` — valida suspensión al activar negocio |
| `docs/setup/02_rls.sql` | Políticas RLS de `negocios` (3 ramas: JWT, superadmin vía tabla, membresías) |
| `shared/components/options-modal/` | `OptionsModalComponent` — menú ⋯ de opciones por negocio |
| `core/guards/superadmin.guard.ts` | Protege `/admin` — verifica `es_superadmin` en Preferences |
