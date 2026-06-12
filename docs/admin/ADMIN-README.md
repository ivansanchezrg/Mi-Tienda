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
    │   ├── fn_suspender_usuario.sql         ← suspender/reactivar un usuario globalmente
    │   └── fn_consultar_usuario_por_email.sql
    └── setup/
        └── realtime_negocios.sql            ← habilitar Realtime en tabla negocios

docs/setup/
└── 03_functions.sql   ← contiene fn_set_negocio_activo (bloquea si negocio/usuario suspendido)
```

> **Nota:** `fn_suspender_negocio` no tiene archivo propio — la suspensión de negocios se ejecuta como UPDATE directo sobre la tabla `negocios` desde `AdminDashboardPage` via query directa `supabase.client.from('negocios').update(...)`. Solo `fn_suspender_usuario` requiere función SQL por las protecciones adicionales (no auto-suspensión, no suspender otro superadmin).

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
    id, nombre, slug, propietario_usuario_id, created_at,
    propietario:usuarios!propietario_usuario_id (nombre, email, activo),
    configuraciones (clave, valor)
  `)
  .order('created_at', { ascending: true })
```

El JOIN embebido `propietario:usuarios!...` trae `nombre`, `email` y `activo` del propietario. El join a `configuraciones` permite leer los flags de módulos (`recargas_celular_habilitada`, `recargas_bus_habilitada`, `caja_varios_activa`, `caja_varios_transferencia_dia`). Los negocios se agrupan visualmente por propietario usando `propietariosAgrupados` (getter calculado).

**Modelo** (`features/admin/models/negocio-admin.model.ts`):

```typescript
export interface ModulosNegocio {
  celular:      boolean;
  bus:          boolean;
  varios:       boolean;
  varios_monto: number;
}

export interface NegocioAdmin {
  id:                     string;
  nombre:                 string;
  slug:                   string;
  propietario_usuario_id: string;
  propietario_nombre:     string;
  propietario_email:      string;
  propietario_activo:     boolean;
  created_at:             string;
  modulos:                ModulosNegocio;
}

export interface PropietarioGrupo {
  usuario_id: string;
  nombre:     string;
  email:      string;
  activo:     boolean;
  negocios:   NegocioAdmin[];
}
```

### 3. Entrar a operar en un negocio

Al tocar la card de un negocio → `entrarNegocio(negocio)`:

```typescript
await this.authService.cambiarNegocio(negocio.id, negocio.nombre);
```

`cambiarNegocio()` llama `fn_set_negocio_activo`, refresca el JWT con el nuevo `negocio_id` y hace `window.location.href = ROUTES.home` (hard reload — patrón multi-tenant para limpiar todo estado en memoria). Desde `/caja` el superadmin opera con rol ADMIN dentro del negocio.

> **Bug corregido (2026-06-03):** `cambiarNegocio()` no escribía `AUTENTICADO_KEY` en Preferences. El `authGuard` detectaba `hasActiveAuth() = false` tras el hard reload y redirigía al login en lugar de entrar al negocio. Fix: se agregó `Preferences.set({ key: AUTENTICADO_KEY, value: 'true' })` en `cambiarNegocio()`, igual que en `activarNegocio()`.

Para volver a `/admin`: botón en el sidebar → `irAlPanelAdmin()`.

### 4. Activar módulos de un negocio

Menú ⋯ → "Módulos" → `ModulosNegocioModalComponent` → `fn_configurar_modulos_admin`.

> **2026-06-11:** el modal solo gestiona **Celular, Bus y tipo de comprobante**. La Caja Varios pasó a potestad del ADMIN del negocio (`fn_configurar_caja_varios`, Parámetros → Caja Varios, reversible). El campo `varios` de `ModulosNegocio` se conserva como dato informativo (resumen de módulos del listado), leído de `configuraciones` al cargar.

La función crea la caja (`INSERT ... ON CONFLICT DO NOTHING`) y actualiza los flags en `configuraciones`. Las categorías de sistema (`PAGO-PROV-CEL`, `COMPRA-BUS`) ya existen globalmente en `categorias_sistema` — no se crean por negocio.

**Visibilidad de cajas en el home del admin del negocio:** cuando se activa un módulo, `fn_configurar_modulos_admin` inserta la caja nueva. Supabase Realtime propaga el INSERT al `CajasService` del negocio (`cajas$`). El subscribe de `cajas$` en `HomePage` detecta que llegó una caja de módulo que no estaba antes (`CAJA_CELULAR`, `CAJA_BUS`), invalida el `ConfigService` y re-lee los flags — las cards aparecen sin recargar la página.

Al **desactivar** un módulo, solo cambia el flag en `configuraciones` (la caja no se toca). El admin del negocio debe refrescar la página para que las cards desaparezcan.

### 5. Crear negocio

Botón "Crear negocio" → navega al wizard reutilizable:

```typescript
this.router.navigate([ROUTES.crearNegocio.root], { queryParams: { context: 'admin' } });
```

El wizard (`/crear-negocio?context=admin`) opera en modo `sucursal-superadmin`. Pide el email del admin del nuevo negocio. Al finalizar, usa `fn_completar_onboarding`. Ver [AUTH-README.md](../auth/AUTH-README.md) sección "Creación de negocios".

---

## Suspensión de negocios y usuarios

El menú de opciones (⋯) de cada negocio abre `OptionsModalComponent` con las opciones disponibles. La acción de suspensión de propietario está implementada:

| Acción | Función SQL | Efecto |
|--------|------------|--------|
| Suspender / Reactivar propietario | `fn_suspender_usuario` | Bloquea al propietario en **todos sus negocios** (campo `activo` en tabla `usuarios`). |

La acción muestra un `AlertController` de confirmación antes de ejecutarse.

> **Nota:** La suspensión directa de un negocio (sin suspender al propietario) no está expuesta en el menú de opciones actualmente. Se puede hacer con UPDATE directo sobre `negocios.activo` desde SQL si se necesita.

### Diferencia entre los dos tipos de suspensión

```
Suspensión de negocio (UPDATE directo en negocios)
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
- Si `activo` pasa a `false` → `handleUsuarioDesactivado('usuario')` → redirige a `/auth/pending?motivo=usuario`
- La sesión OAuth **no se cierra** — el usuario puede tocar "Verificar estado" cuando lo reactiven sin re-autenticarse

**Canal `membresia-activa-{usuarioId}-{negocioId}`** (tabla `usuario_negocios`):
- Si `activo` pasa a `false` → `handleUsuarioDesactivado('membresia')` → redirige a `/auth/pending?motivo=membresia`

```
Superadmin suspende propietario desde /admin
  └─ fn_suspender_usuario → UPDATE usuarios SET activo = false
       └─ Realtime notifica al cliente del usuario activo
            └─ iniciarRealtimeUsuario() handler (activo = false)
                 └─ handleUsuarioDesactivado('usuario')
                      └─ cerrarRealtimeUsuario() + Preferences.remove
                           └─ toast "Tu cuenta fue suspendida por el administrador."
                                └─ navigate /auth/pending?motivo=usuario

Admin desactiva membresía desde /usuarios
  └─ fn_actualizar_membresia → UPDATE usuario_negocios SET activo = false
       └─ Realtime notifica al cliente del usuario activo
            └─ iniciarRealtimeMembresia() handler (activo = false)
                 └─ handleUsuarioDesactivado('membresia')
                      └─ cerrarRealtimeUsuario() + Preferences.remove
                           └─ toast "Tu acceso a este negocio fue removido por el administrador."
                                └─ navigate /auth/pending?motivo=membresia
```

Para que Realtime funcione, la tabla `usuario_negocios` debe estar publicada con `REPLICA IDENTITY FULL`. Ver `docs/usuarios/sql/setup/realtime_usuario_negocios.sql`.

---

## Pantalla `/auth/pending` — mensajes contextuales

La página muestra UI diferente según el query param `motivo`:

| `motivo` | Icono | Título | Mensaje | Botón "Verificar" |
|----------|-------|--------|---------|-------------------|
| `usuario` | `ban-outline` | Cuenta suspendida | "Tu cuenta fue suspendida por el administrador. Contactalo para que te reactive." | ✅ Visible |
| `membresia` | `ban-outline` | Acceso removido | "Tu acceso a este negocio fue removido. Contacta al administrador si crees que es un error." | ❌ Oculto |

**Lógica del botón "Verificar estado"** (`reintentar()`):

```
1. Consulta directa a BD (NO usa retorno de validarUsuario)
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

-- 2. Crear funciones
-- docs/admin/sql/functions/fn_suspender_usuario.sql
-- docs/admin/sql/functions/fn_consultar_usuario_por_email.sql
```

---

## Mapa rápido de archivos

| Archivo | Qué tiene |
|---------|-----------|
| `features/admin/pages/dashboard/admin-dashboard.page.ts` | Listado de negocios agrupados por propietario, `entrarNegocio()`, `crearNegocio()`, `abrirOpciones()`, `abrirModulos()`, `toggleUsuario()`, getter `propietariosAgrupados` |
| `features/auth/services/auth.service.ts` | `iniciarRealtimeNegocio()`, `cerrarRealtimeNegocio()`, `handleUsuarioDesactivado()`, `cambiarNegocio()`, `irAlPanelAdmin()` |
| `features/auth/pages/pending/pending.page.ts` | Pantalla de suspensión con mensajes contextuales por `motivo` |
| `features/auth/pages/seleccionar-negocio/seleccionar-negocio.page.ts` | Selector con badges de negocios suspendidos, bloqueo de tap en suspendidos |
| `docs/admin/sql/functions/fn_suspender_usuario.sql` | Suspender/reactivar propietario globalmente |
| `docs/admin/sql/setup/realtime_negocios.sql` | Publicar tabla `negocios` en Realtime |
| `docs/setup/03_functions.sql` | `fn_set_negocio_activo` — valida suspensión al activar negocio |
| `docs/setup/02_rls.sql` | Políticas RLS de `negocios` (3 ramas: JWT, superadmin vía tabla, membresías) |
| `shared/components/options-modal/` | `OptionsModalComponent` — menú ⋯ de opciones por negocio |
| `core/guards/superadmin.guard.ts` | Protege `/admin` — verifica `es_superadmin` en Preferences |
