# Onboarding — Wizard de creación de negocio

Wizard reutilizable para crear un negocio: **3 pasos en modo `inicial`** (incluye una pantalla educativa del sistema de cajas) y **2 pasos en modos `sucursal-*`** (la pantalla educativa se salta — el creador ya conoce el sistema). Es el **único punto de entrada** para crear negocios en toda la plataforma — no existe otro flujo paralelo. Desde onboarding inicial hasta sucursales creadas por el superadmin, todo usa las mismas páginas y la misma función SQL: `fn_completar_onboarding`.

---

## Puntos de entrada y modos

El wizard se puede iniciar desde 4 contextos distintos. El modo determina quién es el admin del nuevo negocio, quién es el propietario y qué pasa después de crearlo.

| Contexto | Ruta | Modo | Admin del negocio | Propietario | Al finalizar |
|----------|------|------|-------------------|-------------|--------------|
| Usuario sin negocios (primer login) | `/onboarding/negocio` | `inicial` | Usuario logueado | Usuario logueado | Activa JWT → `/caja` |
| Admin → sidebar "Nueva sucursal" | `/crear-negocio?context=sucursal` | `sucursal-admin` | Usuario logueado | Usuario logueado | Toast + vuelve a `/caja` |
| Superadmin dentro de un negocio → sidebar "Nueva sucursal" | `/crear-negocio?context=sucursal` | `sucursal-superadmin` | Email ingresado manualmente | Email del admin (o diferente) | Toast + vuelve a `/caja` |
| Superadmin desde `/admin` → "Crear negocio" | `/crear-negocio?context=admin` | `sucursal-superadmin` | Email ingresado manualmente | Email del admin (o diferente) | Toast + vuelve a `/admin` |

**Regla clave:** el modo `sucursal-superadmin` NO activa el JWT del nuevo negocio. El creador vuelve a donde estaba. Solo el modo `inicial` activa el negocio recién creado y lleva al usuario a `/caja`.

---

## Arquitectura del wizard

```
OnboardingService          ← estado compartido entre pasos (draft + mode)
     │
     ├─ Paso 1: OnboardingNegocioPage   (/onboarding/negocio o /crear-negocio/negocio)
     │     SOLO el nombre del negocio (2026-06-11: teléfono/dirección/correo
     │     eliminados del funnel — se completan en Configuración → Parámetros)
     │     + Email/nombre del admin (solo en modo sucursal-superadmin)
     │
     ├─ Paso educativo: OnboardingContextoPage   (SOLO modo inicial)
     │     Explica el sistema de 3 cajas (Cajón → Tienda → Varios opcional)
     │     En modos sucursal-* se salta: negocio → caja directo
     │
     └─ Paso final: OnboardingCajaPage   (/onboarding/caja o /crear-negocio/caja)
           Radio-cards Caja Varios (opt-in) + monto diario si está activa
           (2026-06-11: sueldo base eliminado del funnel — se envía 0 y se
           configura en Parámetros cuando el negocio contrate empleados)
           → onboardingService.completar() → fn_completar_onboarding (atómico)
           → modo inicial: activa JWT + toast "¡{nombre} está listo! 🎉"
```

**Numeración de pasos:** dinámica por modo — `inicial` muestra "Paso 1/2/3 de 3" (barra 0.33/0.66/1); `sucursal-*` muestra "Paso 1/2 de 2" (barra 0.5/1). El CTA final también es por modo: "Crear mi negocio" / "Crear sucursal" / "Crear negocio".

### Por qué dos módulos de rutas (`onboarding/` y `crear-negocio/`)

Las mismas páginas (`OnboardingNegocioPage`, `OnboardingCajaPage`) se montan en dos módulos de rutas distintos porque el layout que las rodea difiere:

- `/onboarding/*` — sin sidebar, sin tabs (el usuario todavía no tiene negocio)
- `/crear-negocio/*` — con sidebar activo (el admin/superadmin ya tiene un negocio activo)

El modo del wizard se resuelve en `OnboardingNegocioPage.resolverMode()` al entrar al paso 1.

---

## OnboardingService — estado del wizard

**Archivo:** `features/onboarding/services/onboarding.service.ts`

Servicio singleton que actúa como "store" del wizard. Persiste el borrador entre navegaciones (el usuario puede volver al paso 1 y los valores se restauran).

### Tipos clave

```typescript
export type OnboardingMode = 'inicial' | 'sucursal-admin' | 'sucursal-superadmin';

export interface OnboardingData {
  nombre:           string;   // Paso 1
  telefono:         string;
  direccion:        string;
  variosActiva:     boolean;  // Paso 2
  montoVarios:      number;
  nominaSueldoBase: number;
  // Solo en modo sucursal-superadmin:
  adminEmail?:       string;
  adminNombre?:      string;
  propietarioEmail?: string;
}
```

### Métodos

| Método | Qué hace |
|--------|----------|
| `setMode(mode)` | Inicializa el modo y limpia el draft. Llamar al entrar al paso 1. |
| `guardarPaso1(data)` | Merge parcial de los datos del paso 1 en el draft |
| `guardarPaso2(data)` | Merge parcial de los datos del paso 2 en el draft |
| `completar()` | Llama `fn_completar_onboarding` con todo el draft. Retorna `negocio_id` o `null` si falla. |
| `activarYFinalizar(negocioId)` | Solo para modo `inicial`: activa JWT + refresca sesión + llama `validarUsuario()` → `/caja` |
| `verificarEmailAdmin(email)` | Consulta `fn_consultar_usuario_por_email`. Retorna `{ existe, nombre, negocios }`. Solo en modo `sucursal-superadmin`. |
| `reset()` | Limpia draft y restaura modo a `inicial`. Llamar al cancelar o después de un error. |

### Draft persistido en memoria

El draft vive en `OnboardingService._draft` (en memoria, no en Preferences). Si el usuario recarga la página a mitad del wizard, el draft se pierde. Esto es intencional: el wizard es una operación corta y no vale la pena persistirlo en disco. `ngOnInit()` de cada paso restaura el draft si existe.

**Guard de draft perdido (2026-06-11):** los pasos 2 y 3 (`OnboardingContextoPage`, `OnboardingCajaPage`) verifican en `ngOnInit()` que `draft.nombre` exista. Si el usuario recargó la página (draft vacío), redirigen al paso 1 con `replaceUrl` — sin esto, `completar()` enviaría `nombre: ''` a la función SQL y el usuario quedaría atrapado en un error sin salida. La ruta del paso 1 se resuelve por URL (`/crear-negocio` vs `/onboarding`) porque el modo en memoria también se pierde al recargar.

---

## Paso 1 — Datos del negocio (`OnboardingNegocioPage`)

**Archivos:** `features/onboarding/pages/negocio/`

**UI:** muestra el logo del proyecto en lugar del icono `storefront-outline`. Los inputs `[type=number]` tienen las flechas ocultas (regla global en `global.scss`).

### Resolución del modo

```typescript
private async resolverMode(): Promise<OnboardingMode> {
  const esCrearNegocio = url.includes('/crear-negocio');
  if (!esCrearNegocio) return 'inicial';          // ruta /onboarding

  const context = queryParams.get('context');
  const esSuperadmin = usuario?.es_superadmin ?? false;

  if (context === 'admin') return 'sucursal-superadmin';   // desde /admin
  return esSuperadmin ? 'sucursal-superadmin' : 'sucursal-admin';  // desde sidebar
}
```

### Campos del formulario

| Campo | Visible en | Obligatorio | Validación |
|-------|-----------|-------------|------------|
| Nombre del negocio | Todos los modos | ✅ | min 2, max 80 chars |
| Teléfono | Todos los modos | ❌ | max 20 chars |
| Dirección | Todos los modos | ❌ | max 200 chars |
| Email del admin | Solo `sucursal-superadmin` | ✅ | formato email válido + verificación en BD |
| Nombre del admin | Solo `sucursal-superadmin` | Solo si email es nuevo | max 100 chars |

### Verificación de email (modo sucursal-superadmin)

Cuando el superadmin ingresa el email del admin, el wizard verifica si ese email ya está registrado en `usuarios`. La verificación dispara **automáticamente al dejar de escribir** (`debounceTime(600)` sobre `valueChanges`) y también al perder foco (blur como vía rápida; el debounce solo dispara si el estado sigue `pendiente`, evitando doble RPC):

```
superadmin escribe email → 600ms sin teclear (o blur) → verificarEmail()
  │
  ├─ Email inválido → estado 'pendiente', no avanza
  │
  ├─ Llamada a fn_consultar_usuario_por_email → estado 'verificando'
  │
  ├─ Email existe en BD → estado 'existe'
  │     Muestra nombre real del usuario (readonly)
  │     Muestra lista de negocios donde ya tiene membresía
  │     Campo "Nombre del admin" oculto (ya tiene nombre)
  │     Botón Continuar habilitado
  │
  ├─ Email no existe → estado 'nuevo'
  │     Campo "Nombre del admin" visible y obligatorio (mín 2 chars)
  │     Botón Continuar habilitado cuando nombre es válido
  │
  └─ Error en consulta → estado 'error'
        Permite continuar (fn_completar_onboarding maneja ambos casos)
```

**Importante:** el estado de verificación se resetea si el usuario modifica el email después de verificar (suscripción a `valueChanges` del control `adminEmail`).

### Navegación

- Botón "Continuar" → guarda paso 1 en draft → navega al paso 2
- Botón atrás:
  - `inicial` → alert de confirmación ("¿Cerrar sesión?") antes de `logoutSilent()` — un toque accidental no debe expulsar al prospecto en pleno funnel de captación
  - `sucursal-admin` / `sucursal-superadmin` desde sidebar → `/caja`
  - `sucursal-superadmin` desde `/admin` → `/admin`

---

## Paso 2 — Configuración de caja (`OnboardingCajaPage`)

**Archivos:** `features/onboarding/pages/caja/`

### Campos del formulario

| Campo | Descripción | Obligatorio | Validación |
|-------|-------------|-------------|------------|
| Toggle Caja Varios | Activa la caja VARIOS (fondo de emergencia) | ❌ | — |
| Monto diario Varios | Cuánto se transfiere a Varios al cierre de cada turno | Solo si toggle ON | > 0 |
| Sueldo base nómina | Sueldo mensual base para el módulo de nómina | ✅ | >= 0 |

**Validator personalizado `variosMontoValidator`:** si el toggle está activo pero el monto es 0 o vacío, el formulario es inválido. Se evalúa a nivel de grupo (no del control individual).

> **Nota (v6.2):** El fondo del cajón ya no se configura en el onboarding. Cada empleado declara libremente cuánto efectivo deja al abrir cada turno (`turnos_caja.fondo_apertura`). No hay valor predeterminado global.

### Flujo al confirmar

```
onboardingService.completar()
  │
  ├─ Error → showError() (sin limpiar draft — el usuario puede reintentar)
  │
  └─ Éxito (negocioId recibido)
       │
       ├─ mode === 'inicial'
       │     onboardingService.activarYFinalizar(negocioId)
       │       → fn_set_negocio_activo → refreshSession → validarUsuario() → /caja
       │
       └─ mode === 'sucursal-*'
             onboardingService.reset()
             showSuccess('Negocio creado correctamente.')
             navigate → /admin (sucursal-superadmin) | /caja (sucursal-admin)
             [El JWT NO cambia — el usuario sigue en su negocio anterior]
```

---

## Función SQL — `fn_completar_onboarding`

**Archivo:** `docs/onboarding/sql/functions/fn_completar_onboarding.sql`
**Versión actual:** v2.1 (colores de cajas + categorías de sistema)

Operación atómica: crea todo o no crea nada. Si falla cualquier paso, rollback completo.

> **v2.0 (2026-05-30):**
> - `DROP FUNCTION IF EXISTS` movido al inicio del archivo (antes estaba al final, lo que dejaba dos versiones convivendo si la firma cambiaba).
> - Eliminado `EXCEPTION WHEN OTHERS` enmascarador — ahora los errores propagan con su SQLSTATE original.
> - `p_propietario_email` (opcional) permite al superadmin crear un negocio asignando a otro usuario como propietario, mientras él queda como admin operativo.
>
> **v2.1 (2026-06-01):**
> - Colores de cajas ajustados: `CAJA_CHICA` → `#0077cc` (azul), `VARIOS` → `#e06c00` (naranja).
> - Nuevas categorías de sistema: `Fondo Apertura Turno` (EGRESO), `Cierre — Ventas del dia` (INGRESO), `Cierre — Ventas con POS` (INGRESO). Usadas por `fn_abrir_turno` y `fn_ejecutar_cierre_diario` para etiquetar automáticamente sus operaciones.

### Qué crea en una sola transacción

| Paso | Tabla | Descripción |
|------|-------|-------------|
| 1 | `usuarios` | Crea el usuario admin si no existe. Si ya existe, lo reutiliza. |
| 2 | `usuarios` | Crea/resuelve el usuario propietario (puede coincidir con el admin). |
| 3 | `negocios` | Inserta el negocio con `slug` generado automáticamente desde el nombre. |
| 4 | `usuario_negocios` | Membresía ADMIN del admin en el nuevo negocio (upsert). |
| 4b | `usuario_negocios` | Si el propietario difiere del admin, también le da membresía ADMIN. |
| 5 | `cajas` | 2 cajas base: `CAJA` (Tienda) y `CAJA_CHICA` (Cajón, color `#0077cc` azul). `VARIOS` (Varios, color `#e06c00`) solo si el usuario la activó en el wizard (`p_varios_activa`). `CAJA_CELULAR` y `CAJA_BUS` solo si el superadmin los habilita después via `fn_configurar_modulos`. |
| 6 | `categorias_operaciones` | 20 categorías preconfiguradas: egresos + ingresos estándar de tienda minorista + 3 categorías de sistema: `Fondo Apertura Turno` (EGRESO), `Cierre — Ventas del dia` (INGRESO), `Cierre — Ventas con POS` (INGRESO). |
| 7 | `categorias_productos` | 8 categorías base (Sin categoría, Bebidas, Snacks, etc.). |
| 8 | `configuraciones` | Defaults del negocio + valores del wizard (Varios, nómina, POS, módulos). |
| 8b | `suscripciones` | Suscripción del negocio nuevo (1 fila por negocio — `negocio_id` UNIQUE). **Si el propietario ya tiene una suscripción vigente** (creando su 2º/3er negocio con plan MAX) → el negocio **hereda** plan + estado + periodo + `vence_el` de esa suscripción (todos sus negocios quedan sincronizados). **Si es su primer negocio** → nace con el plan `PRO` en `TRIAL`. Si PRO no existe/está inactivo, falla con `onboarding_error:` y hace rollback. Ver `SUSCRIPCION-README.md` → "Suscripciones sincronizadas por propietario". |
| 9 | `secuencias_comprobantes` | Secuencias en 0 para TICKET, NOTA_VENTA, FACTURA, RECARGA. |
| 10 | `clientes` | Cliente "Consumidor Final" (requerido por el POS). |

### Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `p_nombre_negocio` | VARCHAR | ✅ | Nombre del negocio |
| `p_admin_email` | VARCHAR | ✅ | Email del admin (debe ser el email del JWT en modo usuario normal) |
| `p_admin_nombre` | VARCHAR | ❌ | Nombre del admin (para crear fila en `usuarios` si no existe) |
| `p_negocio_telefono` | VARCHAR | ❌ | Teléfono → se guarda en `negocios.telefono` |
| `p_negocio_direccion` | VARCHAR | ❌ | Dirección → se guarda en `negocios.direccion` |
| `p_varios_activa` | BOOLEAN | ❌ | Activar caja Varios (default false) |
| `p_caja_varios_monto` | DECIMAL | ❌ | Monto diario a Varios (requerido si `p_varios_activa = true`) |
| `p_nomina_sueldo_base` | DECIMAL | ❌ | Sueldo base mensual (default 0) |
| `p_propietario_email` | VARCHAR | ❌ | Email del propietario. Si NULL, propietario = admin |

### Reglas de seguridad internas

La función valida el JWT del llamador:

```
Usuario normal (no superadmin):
  - p_admin_email DEBE coincidir con su propio email (no puede crear para otro)
  - p_propietario_email DEBE ser su propio email (no puede asignar otro propietario)

Superadmin:
  - Puede crear para cualquier email como admin
  - Puede especificar un propietario distinto del admin
```

### Retorno

```json
{
  "success": true,
  "negocio_id": "uuid",
  "usuario_id": "uuid",
  "propietario_id": "uuid"
}
```

---

## Función SQL — `fn_configurar_modulos`

**Archivo:** `docs/onboarding/sql/functions/fn_configurar_modulos.sql`

Habilita los módulos opcionales `CAJA_CELULAR` y/o `CAJA_BUS` para un negocio existente. Solo el superadmin puede ejecutarla. Se llama desde Parámetros → Módulos en el panel del negocio.

> **2026-06-11:** la Caja Varios ya no se gestiona aquí — pasó a potestad del ADMIN del negocio via `fn_configurar_caja_varios` (Parámetros → Caja Varios; reversible, con salvaguarda de saldo $0). Ver `docs/configuracion/sql/functions/fn_configurar_caja_varios.sql`.

**Parámetros:** `p_celular BOOLEAN`, `p_bus BOOLEAN`

- Crea la caja física (`cajas`) si no existe
- Actualiza las configuraciones `recargas_celular_habilitada` y `recargas_bus_habilitada`

---

## Datos que se establecen al crear un negocio

### Tabla `negocios` (identidad — fuente de verdad)

| Columna | Valor inicial | Quién puede cambiarlo después |
|---------|--------------|-------------------------------|
| `nombre` | Nombre del wizard | Admin en Parámetros → Negocio |
| `telefono` | Teléfono del wizard | Admin en Parámetros → Negocio |
| `direccion` | Dirección del wizard | Admin en Parámetros → Negocio |
| `correo_electronico` | — | Admin en Parámetros → Negocio |
| `ruc`, `razon_social`, `nombre_comercial` | — | Admin en Parámetros → Datos SRI |
| `codigo_establecimiento`, `codigo_punto_emision` | `001` | Admin en Parámetros → Datos SRI |
| `ambiente_sri` | `1` (pruebas) | Admin en Parámetros → Datos SRI |
| `obligado_contabilidad` | `false` | Admin en Parámetros → Datos SRI |

Vía RPC `fn_actualizar_datos_negocio` (SECURITY DEFINER). El nombre también actualiza el cache local del sidebar via `AuthService.actualizarNombreNegocio()`.

### Tabla `configuraciones` (parámetros operativos)

Los módulos los leen via `ConfigService.get()`.

| Clave | Valor inicial | Quién puede cambiarla después |
|-------|--------------|-------------------------------|
| `caja_varios_activa` | Toggle del wizard | Admin del negocio via `fn_configurar_caja_varios` (Parámetros → Caja Varios; reversible — desactivar exige saldo $0) |
| `caja_varios_transferencia_dia` | Monto del wizard (o 0) | Admin en Parámetros |
| `recargas_celular_habilitada` | `false` | Solo superadmin via `fn_configurar_modulos` / `fn_configurar_modulos_admin` |
| `recargas_bus_habilitada` | `false` | Solo superadmin via `fn_configurar_modulos` / `fn_configurar_modulos_admin` |
| `pos_descuentos_habilitados` | `false` | Admin en Parámetros |
| `pos_descuento_maximo_pct` | `0` | Admin en Parámetros |
| `pos_umbral_monto_descuento` | `0` | Admin en Parámetros |
| `pos_iva_porcentaje` | `15` | Admin en Parámetros |
| `nomina_sueldo_base` | Sueldo del wizard | Admin en Parámetros |
| `nomina_dia_pago` | `1` | Admin en Parámetros |

---

## Diagrama completo del flujo

```
Usuario nuevo (sin negocios)
  └─ validarUsuario() → 0 membresías → /onboarding/negocio
       │
       ├─ Paso 1: nombre + datos del negocio
       │     guardarPaso1() → draft
       │          └─ navigate /onboarding/caja
       │
       └─ Paso 2: caja + configuraciones
             guardarPaso2() → draft completo
                  └─ onboardingService.completar()
                       └─ fn_completar_onboarding (atómico)
                            ├─ crea negocios, cajas, categorías, configuraciones...
                            └─ retorna negocio_id
                                 └─ activarYFinalizar(negocioId)
                                      └─ fn_set_negocio_activo → refreshSession
                                           └─ validarUsuario() → /caja

Admin con negocio activo → "Nueva sucursal" en sidebar
  └─ navigate /crear-negocio?context=sucursal (mode = sucursal-admin)
       ├─ Paso 1 + Paso 2 (igual que arriba, sin campo email admin)
       └─ completar() → negocio creado → toast + navigate /caja
          [JWT no cambia — sigue en el negocio anterior]

Superadmin desde /admin → "Crear negocio"
  └─ navigate /crear-negocio?context=admin (mode = sucursal-superadmin)
       ├─ Paso 1: nombre + email del admin (con verificación en BD)
       │     ├─ Email existe: reutiliza usuario, muestra nombre + negocios actuales
       │     └─ Email nuevo: crea usuario, pide nombre obligatorio
       └─ Paso 2: caja + configuraciones
             completar() → negocio creado → toast + navigate /admin
             [JWT no cambia — sigue en el panel admin]
```

---

## Mapa rápido de archivos

| Archivo | Qué tiene |
|---------|-----------|
| `features/onboarding/services/onboarding.service.ts` | Store del wizard: draft, mode, `completar()`, `activarYFinalizar()`, `verificarEmailAdmin()` |
| `features/onboarding/pages/negocio/onboarding-negocio.page.ts` | Paso 1: nombre, teléfono, dirección, email admin. Resolución del modo. Verificación de email. |
| `features/onboarding/pages/caja/onboarding-caja.page.ts` | Paso 2: Caja Varios toggle (+ monto si activa), sueldo base de nómina. Llama `completar()` y maneja los 3 destinos post-creación. |
| `features/onboarding/onboarding.routes.ts` | Rutas `/onboarding/negocio` y `/onboarding/caja` (sin sidebar) |
| `features/crear-negocio/crear-negocio.routes.ts` | Rutas `/crear-negocio/negocio` y `/crear-negocio/caja` (con sidebar) |
| `docs/onboarding/sql/functions/fn_completar_onboarding.sql` | Función atómica: crea negocio + todas sus tablas asociadas en una sola transacción |
| `docs/onboarding/sql/functions/fn_configurar_modulos.sql` | Habilita módulos CAJA_CELULAR / CAJA_BUS / VARIOS (solo superadmin, desde dentro del negocio) |
| `docs/admin/sql/functions/fn_configurar_modulos_admin.sql` | Habilita módulos CAJA_CELULAR / CAJA_BUS / VARIOS (solo superadmin, desde `/admin`) |
| `docs/setup/03_functions.sql` | `fn_set_negocio_activo` — activa el JWT con el negocio recién creado (llamado por `activarYFinalizar`) |

---

## Referencia cruzada

- **Flujo de login y JWT post-onboarding:** [`docs/auth/AUTH-README.md`](../auth/AUTH-README.md)
- **Panel superadmin (crear negocio desde /admin):** [`docs/admin/ADMIN-README.md`](../admin/ADMIN-README.md)
- **Configuraciones del negocio (editar post-creación):** [`docs/configuracion/CONFIGURACION-README.md`](../configuracion/CONFIGURACION-README.md)
