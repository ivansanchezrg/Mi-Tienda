# Mi Tienda

App de gestion para tiendas minoristas. SaaS multi-tenant — una sola instancia sirve multiples negocios aislados via RLS.

**No es un e-commerce.** Es una herramienta interna de administracion: caja, ventas POS, recargas de saldo celular/bus, inventario, creditos a clientes y nomina de empleados.

---

## Stack

| Componente | Version | Notas |
|---|---|---|
| Angular | 20.x | Standalone components siempre |
| Ionic | 8.x | Modo `md` en todas las plataformas |
| Capacitor | 8.x | APK Android (plataforma principal) |
| Supabase JS | 2.x | Auth + DB + Storage + Realtime |
| Node.js | 22.x | |

---

## Setup de desarrollo

```bash
npm install
npm start                   # web en http://localhost:8100
npx cap run android         # APK en dispositivo/emulador
```

Crear `src/environments/environment.ts` a partir de `environment.example.ts` con las credenciales de Supabase.

---

## Arquitectura

### Multi-tenant

Cada negocio es un tenant aislado. El `negocio_id` viaja en el JWT y RLS filtra todas las tablas automaticamente. Nunca hardcodear un `negocio_id` en codigo.

```
Login Google
  └─ validarUsuario()
       ├── es_superadmin → /admin (sin negocio_id en JWT)
       ├── sin negocios  → /onboarding
       ├── 1 negocio     → /caja (JWT con negocio_id)
       └── N negocios    → /auth/seleccionar-negocio → /caja
```

### Roles

| Rol | Flag | Ruta | Acceso |
|---|---|---|---|
| Superadmin | `usuarios.es_superadmin = true` | `/admin` | Todos los negocios, sin escribir datos operativos |
| Admin | `usuario_negocios.rol = 'ADMIN'` | `/caja` + rutas protegidas | Gestion completa del negocio |
| Empleado | `usuario_negocios.rol = 'EMPLEADO'` | `/caja` + rutas basicas | Operaciones del dia |

### Cajas (hasta 5 por negocio)

| Codigo BD | Nombre UI | Rol | Tipo |
|---|---|---|---|
| `CAJA` | Tienda | Vault de depositos acumulados | Base |
| `CAJA_CHICA` | Cajon | Efectivo del dia (ventas + recargas) | Base |
| `VARIOS` | Varios | Fondo fijo de gastos | Opt-in |
| `CAJA_CELULAR` | Celular | Saldo recargas celular | Solo superadmin |
| `CAJA_BUS` | Bus | Saldo recargas bus | Solo superadmin |

---

## Modulos

| Modulo | Ruta | Estado | Doc |
|---|---|---|---|
| Auth | `/auth` | Completo | [AUTH-README](docs/auth/AUTH-README.md) |
| Admin (superadmin) | `/admin` | Completo | [ADMIN-README](docs/admin/ADMIN-README.md) |
| Crear negocio (wizard) | `/crear-negocio` | Completo | [CREAR-NEGOCIO-README](docs/crear-negocio/CREAR-NEGOCIO-README.md) |
| Caja | `/caja` | Completo (v5 — 5 cajas) | [DASHBOARD-README](docs/caja/DASHBOARD-README.md) |
| Recargas virtuales | `/recargas-virtuales` | Completo | [RECARGAS-README](docs/recargas-virtuales/RECARGAS-VIRTUALES-README.md) |
| Usuarios (Equipo) | `/usuarios` | Completo | [USUARIOS-README](docs/usuarios/USUARIOS-README.md) |
| Inventario | `/inventario` | Completo | [INVENTARIO-README](docs/inventario/INVENTARIO-README.md) |
| POS | `/pos` | Completo | [POS-README](docs/pos/POS-README.md) |
| Ventas | `/ventas` | Completo | [VENTAS-README](docs/ventas/VENTAS-README.md) |
| Clientes y creditos | `/clientes` | Completo | [CLIENTES-README](docs/clientes/CLIENTES-README.md) |
| Configuracion | `/configuracion` | Completo | [CONFIGURACION-README](docs/configuracion/CONFIGURACION-README.md) |
| Movimientos empleados | `/movimientos-empleados` | En desarrollo | [MOV-EMPLEADOS-README](docs/movimientos-empleados/MOVIMIENTOS-EMPLEADOS-README.md) |

---

## Estructura de carpetas

```
src/app/
├── core/
│   ├── services/          # Supabase, UI, Config, Currency, Storage, Logger, Network
│   ├── config/            # routes.config.ts, pagination.config.ts
│   ├── guards/            # auth, public, role, superadmin, pending-changes
│   └── utils/             # date.util.ts, cedula.util.ts
├── features/              # Un directorio por modulo (pages/, services/, models/, components/)
├── shared/
│   ├── components/        # sidebar, options-modal, empty-state, options-menu
│   ├── directives/        # currency-input, numbers-only, scroll-reset
│   └── pages/             # PaginatedListPage<T> (clase base listas paginadas)
└── environments/

docs/
├── setup/                 # schema.sql, 01_teardown, 02_rls, 03_functions, ORDEN_EJECUCION.txt
├── auth/                  # Flujo de auth, guards, Realtime suspensiones
├── caja/                  # Turnos, operaciones, cierre diario v5
├── ventas/                # Listado, resumen, anulacion
├── pos/                   # Flujo de venta, descuentos, escaner
├── inventario/            # Productos, presentaciones, kardex
├── clientes/              # Creditos, cuentas por cobrar
├── recargas-virtuales/    # Celular/bus, liquidacion de ganancias
├── usuarios/              # Equipo, transferencias, membresias
├── movimientos-empleados/ # Cuenta corriente, nomina, adelantos
├── configuracion/         # Parametros, categorias de operacion
├── admin/                 # Panel superadmin, suspension de negocios
├── onboarding/            # Wizard creacion de negocio
├── notas/                 # Notas rapidas
├── guides/                # ESTRUCTURA-PROYECTO.md, ARQUITECTURA.md
└── DESIGN.md              # Sistema de diseno (colores, tipografia, componentes)
```

---

## Reset de base de datos

Para ejecutar la BD desde cero en Supabase SQL Editor, seguir el orden en:

```
docs/setup/ORDEN_EJECUCION.txt
```

Resumen de pasos:
1. `01_teardown.sql` — destruye todo (solo dev)
2. `schema.sql` — tablas, ENUMs, vistas, seeds globales
3. `02_rls.sql` — politicas Row Level Security
4. `03_functions.sql` + `fn_assert_no_superadmin.sql` — funciones de setup
5. Funciones de onboarding/tenancy
6. Funciones de modulos (caja, inventario, pos, recargas, etc.)
7. Vistas (`v_saldos_empleados`)
8. Triggers externos
9. Realtime (publicar tablas para websockets)

---

## Convenciones de codigo

### Angular
- Standalone components siempre (`standalone: true`)
- `inject()` en lugar de constructor para DI
- `addIcons({})` en constructor para iconos Ionic
- Rutas SIEMPRE via `ROUTES` de `core/config/routes.config.ts`
- Fechas SIEMPRE via `getFechaLocal()` de `core/utils/date.util.ts`, nunca `toISOString()`

### Ionic
- Modo `md` en todas las plataformas
- Sin `breakpoints` en modales con scroll interno (bloquea swipe en Android)
- Sin `ActionSheetController`, `PopoverController` ni `ion-select` — usar `OptionsModalComponent`

### PostgreSQL (Supabase)
- Todas las mutaciones multi-tabla via funcion RPC (`supabase.rpc('fn_nombre', params)`)
- Asignacion de variables: `:= (SELECT ...)` — nunca `SELECT ... INTO variable`
- Toda funcion de mutacion llama `PERFORM public.fn_assert_no_superadmin();` al inicio
- `SECURITY DEFINER` + `SET search_path = public` en todas las funciones
- IDs siempre `UUID`, nunca `INTEGER`

---

## Documentacion detallada

| Tema | Archivo |
|---|---|
| Guia de estructura y patrones | [ESTRUCTURA-PROYECTO.md](docs/guides/ESTRUCTURA-PROYECTO.md) |
| Arquitectura de cajas | [ARQUITECTURA.md](docs/guides/ARQUITECTURA.md) |
| Sistema de diseno | [DESIGN.md](docs/guides/DESIGN.md) |
| Schema completo de BD | [schema.sql](docs/setup/schema.sql) |
| Auditoria de produccion | [AUDITORIA-PRODUCCION-2026-05-07.md](docs/guides/AUDITORIA-PRODUCCION-2026-05-07.md) |
