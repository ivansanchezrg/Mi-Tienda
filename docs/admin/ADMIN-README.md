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

> **Panel con tabs internas (refactor 2026-06-13):** `/admin` ya no es una sola página. Tiene 4 tabs internas (patrón chrome-tabs, rutas planas, `AdminTabsComponent` detecta la activa por `NavigationEnd`): **Negocios** (lo de este README) · **Suscripciones** · **Planes** · **Cobro**. Las 3 últimas son del módulo de monetización — ver [SUSCRIPCION-README.md](../suscripcion/SUSCRIPCION-README.md). Cada página incluye `<app-admin-tabs>` en su header y está protegida por `superadminGuard`.

## Estructura de archivos

```
features/admin/
├── components/
│   └── admin-tabs/                 ← AdminTabsComponent (tabs internas del panel)
└── pages/
    └── negocios/
        ├── admin-negocios.page.ts    ← lógica completa (clase AdminNegociosPage)
        ├── admin-negocios.page.html  ← listado + cards
        └── admin-negocios.page.scss  ← estilos
        (tabs suscripciones/planes/configuracion → SUSCRIPCION-README.md)

docs/admin/
└── sql/
    ├── functions/
    │   └── fn_consultar_usuario_por_email.sql
    └── setup/
        └── realtime_negocios.sql            ← habilitar Realtime en tabla negocios

docs/setup/
└── 03_functions.sql   ← contiene fn_set_negocio_activo (bloquea si negocio/usuario suspendido)
```

> **Nota (2026-06-16):** la suspensión de propietarios ya NO se hace con `fn_suspender_usuario` (eliminada — ponía `usuarios.activo = false`, muro seco). Ahora es **por cobro**: `fn_suspender_propietario_suscripcion` (módulo suscripción) marca `SUSPENDIDA` la suscripción de todos los negocios del propietario, mostrando la pantalla de cobro. Ver `SUSCRIPCION-README.md` → "Suspensión por propietario".

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

`AdminNegociosPage.cargar()` trae negocios y suscripciones **en paralelo** (`Promise.all`) y las mergea por `negocio_id`:

```typescript
const [respNegocios, suscripciones] = await Promise.all([
  this.supabase.client
    .from('negocios')
    .select(`
      id, nombre, slug, propietario_usuario_id, created_at,
      propietario:usuarios!propietario_usuario_id (nombre, email),
      configuraciones (clave, valor)
    `)
    .order('created_at', { ascending: true }),
  this.suscripcion.listarSuscripcionesAdmin(),
]);
```

El JOIN embebido `propietario:usuarios!...` trae `nombre` y `email` del propietario (`activo` ya no existe — columna eliminada). El join a `configuraciones` permite leer los flags de módulos (`recargas_celular_habilitada`, `recargas_bus_habilitada`, `caja_varios_activa`, `caja_varios_transferencia_dia`). Los negocios se agrupan visualmente por propietario usando `propietariosAgrupados` (getter calculado), que también deriva `PropietarioGrupo.suspendido` (true si **todos** sus negocios tienen `suscripcion.estado === 'SUSPENDIDA'`).

**Modelo:** `features/admin/models/negocio-admin.model.ts` (fuente de verdad — `NegocioAdmin`, `ModulosNegocio`, `PropietarioGrupo`, `SuscripcionNegocio`). Además de los datos de control e identidad del negocio, `ModulosNegocio` incluye `varios_monto` y `tipo_comprobante`. `NegocioAdmin.suscripcion` (tipo `SuscripcionNegocio | null`) viene de `SuscripcionAdmin` (módulo suscripción) — ver [SUSCRIPCION-README.md](../suscripcion/SUSCRIPCION-README.md).

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

## Suspensión de propietarios (por cobro)

> **Cambio 2026-06-16:** la suspensión del propietario desde `/admin` ya NO usa `fn_suspender_usuario` (eliminada). La suscripción se paga **por propietario, no por sucursal**, así que suspender es una acción de cobro que afecta a **todos** sus negocios.

El menú de opciones (⋯) de la tab Negocios tiene **dos niveles**:

| Menú | Acción | Función SQL | Efecto |
|------|--------|------------|--------|
| Header del propietario | Registrar pago | `fn_registrar_pago_propietario` | Renueva la suscripción de **todos** los negocios del propietario a la vez (mismo plan, periodo y vencimiento). |
| Header del propietario | Suspender / Reactivar negocio(s) | `fn_suspender_propietario_suscripcion` | Marca `SUSPENDIDA`/`ACTIVA` la suscripción de **todos** los negocios del propietario. Cada sucursal muestra la pantalla de cobro. |
| Fila del negocio | Ingresar · Módulos | — | El pago y la suspensión NO viven aquí: ambos son por dueño, no por sucursal. |

Pago y suspensión son acciones del **propietario** (la suscripción se paga por dueño). La suspensión muestra un `AlertController` de confirmación antes de ejecutarse. Ver detalle completo en `SUSCRIPCION-README.md` → "Suspensión por propietario" y "Registrar un pago".

### `usuarios.activo` — eliminada (2026-06-16)

La columna `usuarios.activo` (suspensión global del propietario) **ya no existe**. Ninguna función SQL la escribe ni la lee. Su infraestructura asociada se eliminó del frontend:

- ~~Canal `usuario-activo-{id}` reaccionando a `activo=false`~~ — el canal `usuario-activo-{id}` sigue existiendo (detecta `DELETE` del usuario y cambios de nombre en tiempo real), pero ya no tiene rama de suspensión.
- ~~`handleUsuarioDesactivado('usuario')` / `/auth/pending?motivo=usuario`~~ — eliminados. `PendingPage` ahora es de un solo propósito: membresía removida.
- ~~Validación en `fn_set_negocio_activo`~~ — eliminada.

**Lo que reemplaza cada caso de suspensión hoy:**

| Antes (eliminado) | Ahora |
|---|---|
| `fn_suspender_usuario` → `usuarios.activo=false` → muro seco `/auth/pending` | `fn_suspender_propietario_suscripcion` → `suscripciones.estado='SUSPENDIDA'` en todos sus negocios → pantalla de cobro `/suscripcion` (WhatsApp + cuentas) |

### Membresía (empleado removido de un negocio) — esto sí sigue igual

- **Canal `membresia-activa-{usuarioId}-{negocioId}`** (tabla `usuario_negocios`): si `activo` → `false`, `handleUsuarioDesactivado()` redirige a `/auth/pending?motivo=membresia`.

```
Admin desactiva membresía desde /usuarios
  └─ fn_actualizar_membresia → UPDATE usuario_negocios SET activo = false
       └─ Realtime notifica al cliente del usuario activo
            └─ iniciarRealtimeMembresia() handler (activo = false)
                 └─ handleUsuarioDesactivado()
                      └─ navigate /auth/pending?motivo=membresia
```

Para que Realtime funcione, la tabla `usuario_negocios` debe estar publicada con `REPLICA IDENTITY FULL`. Ver `docs/usuarios/sql/setup/realtime_usuario_negocios.sql`.

---

## Pantalla `/auth/pending` — solo membresía removida

`PendingPage` ya no distingue motivos — siempre es el caso "tu acceso a este negocio fue removido" (icono `ban-outline`, título "Acceso removido"). El botón "Verificar estado" llama `authService.validarUsuario()` directo (sin consulta intermedia a BD).

> La suspensión por cobro (propietario) NO usa esta pantalla — usa `ROUTES.suscripcion` vía `suscripcionGuard`.

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

### `fn_suspender_propietario_suscripcion(p_propietario_id UUID, p_suspender BOOLEAN, p_nota TEXT)`

**Archivo:** `docs/suscripcion/sql/functions/fn_suspender_propietario_suscripcion.sql`

- Solo ejecutable por superadmin (valida internamente)
- Recorre **todos** los negocios del propietario e inserta una fila nueva en `suscripciones` con `estado = 'SUSPENDIDA'` (o `'ACTIVA'` al reactivar), conservando plan y `vence_el`. Historial intacto.
- Negocios sin suscripción previa se omiten.
- Retorna `{ success, propietario_id, estado, negocios_afectados }`

### `fn_set_negocio_activo` (en `docs/setup/03_functions.sql`)

Llamada al activar o cambiar de negocio. Valida que el usuario tenga membresía activa en ese negocio (excepto superadmin). **Ya no valida** `usuarios.activo` ni `negocios.activo` (ambas columnas eliminadas).

> El bloqueo por **suscripción suspendida** (cobro) NO ocurre aquí — lo maneja el `suscripcionGuard` vía `fn_estado_suscripcion`, redirigiendo a la pantalla de cobro.

---

## Mapa rápido de archivos

| Archivo | Qué tiene |
|---------|-----------|
| `features/admin/pages/negocios/admin-negocios.page.ts` | Listado de negocios por propietario, `entrarNegocio()`, `crearNegocio()`, `abrirOpciones()` (negocio), `abrirOpcionesPropietario()` (propietario), `registrarPago()`, `toggleSuspensionPropietario()`, getter `propietariosAgrupados` |
| `features/admin/components/admin-tabs/admin-tabs.component.ts` | Tabs internas del panel: Negocios / Planes / Cobro |
| `features/auth/services/auth.service.ts` | `iniciarRealtimeNegocio()`, `cerrarRealtimeNegocio()`, `handleUsuarioDesactivado()`, `cambiarNegocio()`, `irAlPanelAdmin()` |
| `features/auth/pages/pending/pending.page.ts` | Pantalla de suspensión con mensajes contextuales por `motivo` |
| `features/auth/pages/seleccionar-negocio/seleccionar-negocio.page.ts` | Selector con badges de negocios suspendidos, bloqueo de tap en suspendidos |
| `docs/suscripcion/sql/functions/fn_suspender_propietario_suscripcion.sql` | Suspender/reactivar por cobro todos los negocios de un propietario |
| `docs/admin/sql/setup/realtime_negocios.sql` | Publicar tabla `negocios` en Realtime |
| `docs/setup/03_functions.sql` | `fn_set_negocio_activo` — valida suspensión al activar negocio |
| `docs/setup/02_rls.sql` | Políticas RLS de `negocios` (3 ramas: JWT, superadmin vía tabla, membresías) |
| `shared/components/options-modal/` | `OptionsModalComponent` — menú ⋯ de opciones por negocio |
| `core/guards/superadmin.guard.ts` | Protege `/admin` — verifica `es_superadmin` en Preferences |
