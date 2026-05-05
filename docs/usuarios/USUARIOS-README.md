# Usuarios — Gestión de Equipo por Negocio

Módulo para gestionar el equipo del negocio activo. Solo accesible para rol `ADMIN`.
Ruta: `/usuarios` — protegida por `roleGuard(['ADMIN'])`.

El módulo opera sobre el negocio activo del JWT: la RLS filtra automáticamente
por `negocio_id`, por lo que el admin solo ve y gestiona su propio equipo.

---

## Modelo de datos

Un usuario puede pertenecer a múltiples negocios. La membresía vive en `usuario_negocios`:

```
usuarios (datos globales)
  id, nombre, email, es_superadmin

usuario_negocios (membresía por negocio)
  id (membresia_id), usuario_id, negocio_id, rol, activo
```

**Regla de negocio clave:** un empleado solo puede estar **activo en un negocio a la vez**.
Si está activo en Tienda A, no puede reactivarse en Tienda B sin primero ser transferido.

---

## Modelo TypeScript

```typescript
// features/usuarios/models/usuario.model.ts

export interface Usuario {
  membresia_id: string;   // UUID de usuario_negocios — identifica la membresía
  id:           string;   // UUID de usuarios — identifica la persona
  nombre:       string;
  email:        string;
  rol:          RolUsuario;
  activo:       boolean;
  es_superadmin: boolean;
  created_at:   string;
}
```

> `membresia_id` es el ID que se pasa a las funciones SQL (`fn_transferir_empleado`,
> `fn_actualizar_membresia`). `id` es el ID del usuario en la tabla `usuarios`.

---

## Listado

**Archivo:** `features/usuarios/pages/list/`

- Muestra **todos** los usuarios del negocio activo: activos e inactivos
- Activos primero (orden por `activo DESC`)
- Usuarios inactivos aparecen con badge "Inactivo" — el admin puede gestionarlos
- Toca una tarjeta → abre `EditarUsuarioModalComponent`
- FAB (+) → abre `RegistrarUsuarioModalComponent`

### RLS — por qué aparecen los inactivos

La política `usuarios_select` usa `comparten_negocio(id)` para determinar visibilidad.
Esta función verifica pertenencia al negocio **sin filtrar por `activo`** en la fila del
empleado — solo requiere que el admin esté activo. Así un inactivo sigue siendo visible
y gestionable.

> Ver `comparten_negocio()` en `docs/setup/schema.sql`.

---

## Registrar usuario (`RegistrarUsuarioModalComponent`)

**Archivo:** `features/usuarios/components/registrar-usuario-modal/`

Llama a `fn_registrar_usuario_negocio(nombre, email, rol)` via RPC.

La función maneja dos casos internamente:
- Email nuevo → INSERT en `usuarios` + INSERT en `usuario_negocios`
- Email ya existe (fue registrado en otro negocio) → solo INSERT en `usuario_negocios`

---

## Editar usuario (`EditarUsuarioModalComponent`)

**Archivo:** `features/usuarios/components/editar-usuario-modal/`

### Campos editables

| Campo | Quién puede editar |
|-------|--------------------|
| Nombre | Siempre (incluso propio perfil y superadmin) |
| Rol | Solo ADMIN sobre otro usuario (no sobre sí mismo, no sobre superadmin) |
| Activo | Solo ADMIN sobre otro usuario (no sobre sí mismo, no sobre superadmin) |

### Protecciones en UI

| Caso | Aviso | Campos bloqueados |
|------|-------|-------------------|
| `es_superadmin = true` | Banner azul info | Rol + Estado |
| `esMismoUsuario = true` | Banner amarillo warning | Rol + Estado |
| Empleado inactivo (desactivado manualmente) | Banner gris — puede reactivarse | Ninguno extra |
| Empleado inactivo (activo en otra sucursal) | Banner amarillo — indica dónde está activo | Ninguno extra (BD lo bloquea si intenta reactivar) |

### Protección del último admin

Antes de degradar (ADMIN → EMPLEADO) o desactivar a un ADMIN, se consulta
`contarAdmins()`. Si es el único ADMIN activo → error, acción bloqueada.

### Cambios de rol/activo via función SQL

`update()` en `UsuarioService` usa `fn_actualizar_membresia` para cambios de
`rol`/`activo`. La función valida:
- Al reactivar (FALSE → TRUE): si el usuario ya está activo en otro negocio → `RAISE EXCEPTION`
- El frontend detecta el mensaje de error y muestra: *"No se puede reactivar: ya está activo en otra sucursal"*

---

## Transferir empleado entre sucursales

Disponible en el modal de edición cuando el empleado:
- Está **activo** en el negocio actual
- Es **EMPLEADO** (no ADMIN)
- No es el mismo usuario logueado
- No es superadmin

### Flujo

1. Admin ve lista de sucursales destino (sus otros negocios, excluye el actual)
2. Toca una sucursal → alerta de confirmación
3. Llama `fn_transferir_empleado(membresia_id, negocio_destino_id, rol)`
4. Modal cierra con `{ transferido: true, negocioNombre, empleadoNombre }`
5. Listado recarga completo + toast: *"Juan fue transferido a Tienda Este. Su membresía aquí quedó inactiva."*

### Qué hace la función SQL

```
1. Verifica que el caller es ADMIN o superadmin
2. Verifica que la membresía existe
3. Verifica que la membresía está activa (no se puede transferir un inactivo)
4. Verifica que el negocio destino es distinto al origen
5. UPDATE usuario_negocios SET activo = FALSE WHERE id = membresia_id
6. INSERT ... ON CONFLICT DO UPDATE SET activo = TRUE, rol = ...
```

El paso 6 usa `ON CONFLICT (usuario_id, negocio_id)` — si ya tenía membresía
en el destino (inactiva), la reactiva. Si no, la crea.

> Ver función completa: `docs/usuarios/sql/functions/fn_transferir_empleado.sql`

### Estado post-transferencia

El empleado transferido aparece como **inactivo** en el negocio origen.
Desde ese negocio, el admin verá el banner amarillo: *"Activo en Tienda Este"*
y no podrá reactivarlo — debe hacerse desde Tienda Este.

---

## Kick en tiempo real al desactivar membresía

Cuando un ADMIN desactiva la membresía de un usuario (`activo = false` en `usuario_negocios`),
si ese usuario está conectado en ese momento **es expulsado automáticamente** sin necesidad de
que recargue o navegue.

### Cómo funciona

`AuthService` abre un canal Realtime (`membresia-activa-{usuarioId}-{negocioId}`) al activar
el negocio. Escucha `UPDATE` en `usuario_negocios` filtrado por `usuario_id`.

Cuando `fn_actualizar_membresia` setea `activo = false`:
1. Supabase emite el evento al canal del usuario afectado
2. `AuthService.handleUsuarioDesactivado('membresia')` limpia la sesión local
3. Toast: *"Tu acceso a este negocio fue removido por el administrador."*
4. Redirige a `/auth/pending?motivo=membresia`

### Requisitos de BD

La tabla `usuario_negocios` debe estar publicada en Realtime con `REPLICA IDENTITY FULL`.
Ver: `docs/usuarios/sql/setup/realtime_usuario_negocios.sql`

> `REPLICA IDENTITY FULL` es obligatorio — sin él los eventos UPDATE no incluyen `usuario_id`
> ni `negocio_id` y el filtro del canal nunca hace match.

---

## Funciones SQL del módulo

| Función | Archivo | Qué hace |
|---------|---------|---------|
| `fn_registrar_usuario_negocio` | `docs/setup/03_functions.sql` | Crea usuario + membresía (o solo membresía si el email ya existe) |
| `fn_transferir_empleado` | `docs/usuarios/sql/functions/fn_transferir_empleado.sql` | Mueve membresía activa a otro negocio |
| `fn_actualizar_membresia` | `docs/usuarios/sql/functions/fn_actualizar_membresia.sql` | Actualiza rol/activo con validación de conflicto multi-negocio |

> `fn_registrar_usuario_negocio` está en `03_functions.sql` porque se necesita
> en el setup inicial (onboarding de negocio). Las otras dos son features del módulo.

---

## Mapa de archivos

| Archivo | Qué tiene |
|---------|---------|
| `features/usuarios/pages/list/list.page.ts` | Listado, refresh, apertura de modales, toast post-transferencia |
| `features/usuarios/services/usuario.service.ts` | `getAll()`, `create()`, `update()` (via `fn_actualizar_membresia`), `transferir()`, `contarAdmins()` |
| `features/usuarios/models/usuario.model.ts` | `Usuario`, `CreateUsuarioDto`, `UpdateUsuarioDto`, `RolUsuario` |
| `features/usuarios/components/registrar-usuario-modal/` | Formulario de alta |
| `features/usuarios/components/editar-usuario-modal/` | Edición + banners de estado + transferencia entre sucursales |
| `docs/usuarios/sql/functions/fn_transferir_empleado.sql` | Función de transferencia |
| `docs/usuarios/sql/functions/fn_actualizar_membresia.sql` | Función de actualización con validación multi-negocio |

---

## Gotchas

### Trigger `trg_updated_at_usuario_negocios`
Si existe este trigger en `usuario_negocios` y la tabla no tiene columna `updated_at`,
cualquier UPDATE falla con `record "new" has no field "updated_at"`.
Solución: `DROP TRIGGER IF EXISTS trg_updated_at_usuario_negocios ON usuario_negocios;`

### Cast de enum en funciones SQL
La columna `rol` en `usuario_negocios` es de tipo `rol_usuario_enum`, no `TEXT`.
Pasar un `TEXT` sin cast desde plpgsql causa error `42804`.
Siempre usar `p_rol::rol_usuario_enum` en los INSERT/UPDATE de esa columna.

### `comparten_negocio()` y usuarios inactivos
La función `comparten_negocio()` no filtra por `activo` en la fila del empleado —
solo verifica pertenencia al negocio. Esto es intencional: permite que la RLS de
`usuarios` deje pasar registros inactivos para que el admin pueda verlos y gestionarlos.
