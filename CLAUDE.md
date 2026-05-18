# CLAUDE.md — Mi Tienda

Contexto rápido del proyecto para IAs. Lee esto antes de cualquier tarea.

---

## Qué es este proyecto

App de gestión para tiendas minoristas. Maneja caja (hasta **5 cajas** físicas/virtuales: CAJA, CAJA_CHICA, VARIOS, CAJA_CELULAR, CAJA_BUS), ventas POS, recargas de saldo celular/bus e inventario.

Un negocio recién creado tiene solo **3 cajas base** (CAJA, CAJA_CHICA, VARIOS). VARIOS, CAJA_CELULAR y CAJA_BUS son **opt-in por negocio**:

- **VARIOS** — opcional desde el onboarding (toggle "Activar Caja Varios"). Si no se activó en el onboarding, solo el superadmin puede activarla después desde Parámetros → Módulos. Una vez activa **no se puede desactivar**. Flag: `caja_varios_activa`.
- **CAJA_CELULAR / CAJA_BUS** — solo el superadmin las habilita por negocio desde Parámetros → Módulos (sección visible únicamente para superadmin). Cada una es independiente. Flags: `recargas_celular_habilitada`, `recargas_bus_habilitada`.

Funciones SQL involucradas: `fn_completar_onboarding` (3 cajas + Varios opcional), `fn_configurar_modulos` (superadmin, desde negocio), `fn_configurar_modulos_admin` (superadmin, desde `/admin`).

**Es una SaaS multi-tenant y multiplataforma** — no es un e-commerce. Es una herramienta interna de administración que puede servir a múltiples negocios independientes desde una sola instancia.

### Multi-tenant
- Cada negocio es un tenant aislado identificado por `negocio_id` en el JWT
- La BD usa RLS (Row Level Security) en todas las tablas para aislar datos entre negocios
- Supabase expone `get_negocio_id()` y `get_email()` como funciones helper que leen el JWT
- Toda query filtra automáticamente por `negocio_id` vía RLS — **nunca hardcodear** un `negocio_id` en código
- El superadmin puede operar dentro de cualquier negocio cambiando el `negocio_id` del JWT (`cambiarNegocio()`)
- **Al agregar una tabla nueva:** siempre crear la política RLS correspondiente con `negocio_id = get_negocio_id()` **y** agregar la política RESTRICTIVE `superadmin_no_write` (ver abajo) en `docs/setup/02_rls.sql`
- **Al agregar una función SQL nueva:** usar `SECURITY DEFINER` + `SET search_path = public` y filtrar por `get_negocio_id()` internamente
- **Al agregar una función SQL de mutación:** llamar `PERFORM public.fn_assert_no_superadmin();` al inicio (antes de cualquier otra lógica). Ejecutar `docs/setup/fn_assert_no_superadmin.sql` en Supabase si la función helper aún no existe

### Superadmin — bloqueo en escrituras directas (RLS RESTRICTIVE)

Además del bloqueo en funciones RPC (`fn_assert_no_superadmin`), toda tabla mutable tiene una política RESTRICTIVE que bloquea INSERT/UPDATE/DELETE directos desde el cliente Angular:

```sql
-- En docs/setup/02_rls.sql — patrón para cada tabla nueva
DROP POLICY IF EXISTS "superadmin_no_write" ON mi_tabla;
CREATE POLICY "superadmin_no_write" ON mi_tabla AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (
        SELECT 1 FROM usuarios
        WHERE email = public.get_email() AND es_superadmin = true
    ));
```

**Por qué `WITH CHECK` y no `PERFORM`:** RLS no soporta `PERFORM` — solo expresiones booleanas. La subquery `NOT EXISTS` replica el mismo check que `fn_assert_no_superadmin()`.

**Tablas cubiertas actualmente** (en `02_rls.sql`): `clientes`, `productos`, `categorias_productos`, `producto_presentaciones`, `atributos`, `atributo_opciones`, `categorias_operaciones`, `movimientos_empleados`, `notas`, `configuraciones`, `turnos_caja`, `cajas`, `operaciones_cajas`, `ventas`, `recargas`, `recargas_virtuales`, `kardex_inventario`, `cuentas_cobrar`, `producto_atributos`, `ventas_detalles`.

Funciones exentas de `fn_assert_no_superadmin` (el superadmin sí las ejecuta): `fn_configurar_modulos`, `fn_configurar_modulos_admin`, `fn_suspender_negocio`, `fn_set_negocio_activo`, `fn_completar_onboarding`, `fn_actualizar_membresia`, `fn_transferir_empleado`, `fn_suspender_usuario`.

**Mensaje de error al usuario:** `fn_assert_no_superadmin` lanza `RAISE EXCEPTION 'superadmin_blocked: Esta acción no está disponible en modo supervisión'`. El prefijo `superadmin_blocked:` es detectado en dos lugares:
- `SupabaseService.call()` — extrae el texto después del prefijo y lo muestra como toast limpio (cubre todos los servicios que usan `call()`)
- Servicios que usan `.client.rpc()` directo — extraen el texto con el mismo regex: `rawMsg.match(/superadmin_blocked:\s*(.+)/i)`

**No ocultar botones en el frontend:** el superadmin ve el flujo completo para poder entender y dar soporte a los usuarios. La BD es el único guardián. Si intenta ejecutar una acción, recibe el toast de error automáticamente.

### Multiplataforma
- **Android**: APK vía Capacitor — plataforma principal, toda decisión UI/UX debe funcionar aquí primero
- **Web**: funciona en browser (PWA-like), usado en desktop y tablet
- **iOS**: compatible pero no es el foco actual
- Ionic 8 en modo `md` (Material Design) en todas las plataformas — no depender de comportamientos específicos de `ios` mode
- En desktop/tablet (≥992px) el split pane está activo y el sidebar es fijo — no asumir que el menú siempre es un drawer
- Safe area (`env(safe-area-inset-bottom)`) aplica en Android y iOS — ver sección "Safe area en Android"

---

## Stack

| Componente   | Versión | Notas                          |
| ------------ | ------- | ------------------------------ |
| Angular      | 20.x    | Standalone components SIEMPRE  |
| Ionic        | 8.x     | Multiplataforma — modo `md` en todas las plataformas |
| Capacitor    | 8.x     | Empaquetado APK                |
| Supabase JS  | 2.x     | Auth + DB + Storage            |
| Node.js      | 22.x    |                                |

---

## Módulos (`src/app/features/`)

| Módulo              | Estado           |
| ------------------- | ---------------- |
| `auth`              | ✅ Completo                                  |
| `admin`             | ✅ Panel superadmin (lista negocios, crear negocio, suspender/reactivar). Ruta: `/admin`. Guard: `superadminGuard` |
| `crear-negocio`     | ✅ Wizard reutilizable (`/crear-negocio?context=admin\|sucursal`). Reusa páginas del onboarding inicial cambiando el modo via `OnboardingService.setMode()` |
| `caja`              | ✅ Completo (v5 — 5 cajas, cierre wizard 2p) |
| `recargas-virtuales`| ✅ Completo                                  |
| `usuarios`          | ✅ Completo (solo Equipo — gestión de empleados del negocio activo) |
| `inventario`        | ✅ Completo                                  |
| `pos`               | ✅ Completo (descuentos, idempotencia, escáner) |
| `clientes`          | ✅ Completo (listado + créditos/fiados unificados)           |
| `configuracion`     | ✅ Completo (parámetros negocio, categorías)  |
| `movimientos-empleados` | 🚧 Frontend nuevo (cuenta corriente empleados, nomina). No requiere turno abierto. |
| ~~`reportes`~~      | ❌ Eliminado (2026-03-26) — el resumen diario se integró como panel colapsable en `ventas` |
| ~~`gastos-diarios`~~| ❌ Eliminado en v5 (2026-03-06) — los gastos van como EGRESO en `operacion-modal` |

---

## Arquitectura de roles y rutas

La app tiene **3 niveles de acceso** con rutas separadas:

| Nivel | Flag | Ruta | Guard |
|-------|------|------|-------|
| `es_superadmin = true` | Campo en `usuarios` | `/admin` | `superadminGuard` |
| `rol = 'ADMIN'` en `usuario_negocios` | JWT claim | `/caja` + rutas protegidas con `roleGuard(['ADMIN'])` | `authGuard` |
| `rol = 'EMPLEADO'` en `usuario_negocios` | JWT claim | `/caja` + rutas de empleado | `authGuard` |

**Flujo de login post-validación:**
```
validarUsuario()
    ├── es_superadmin + sin negocio cacheado → /admin
    ├── sin negocios → /auth/crear-negocio (onboarding)
    ├── 1 negocio   → activar directo → /caja
    └── N negocios  → /auth/seleccionar-negocio → /caja
```

**`/admin`** — Panel del superadmin (sin `negocio_id` en JWT):
- Lista todos los negocios de la plataforma (incluye los suspendidos, marcados con badge)
- Botón "Crear negocio" → navega al wizard `/crear-negocio?context=admin` (mismas páginas del onboarding inicial, en modo `sucursal-superadmin`). Pide email del admin del nuevo negocio.
- Botón "Suspender / Reactivar" por cada negocio → llama a `fn_suspender_negocio` (solo superadmin). Cuando un negocio está suspendido, su propietario, admins y empleados no pueden entrar; solo el superadmin sí.
- Toca un negocio → `cambiarNegocio()` → JWT actualizado con ese `negocio_id` → `/caja` para operar dentro del negocio como ADMIN
- `irAlPanelAdmin()` en `AuthService` para volver a `/admin` desde dentro de un negocio

**Superadmin y membresías — reglas críticas:**
- El superadmin **puede no tener membresía** en `usuario_negocios` para un negocio dado. `fn_set_negocio_activo` le asigna rol `ADMIN` virtual si no tiene membresía.
- `get_es_superadmin()` lee del JWT (`app_metadata`). Cuando el superadmin está en `/admin` (sin haber pasado por `fn_set_negocio_activo`), ese claim puede estar desactualizado. **Nunca usar `get_es_superadmin()` en RLS de tablas que el superadmin necesita leer desde `/admin`** — usar `EXISTS (SELECT 1 FROM usuarios WHERE email = get_email() AND es_superadmin = true)` en su lugar.
- La RLS de `negocios` usa la verificación contra tabla `usuarios` por este motivo (ver `02_rls.sql`).
- `validarUsuario()` en `AuthService` maneja el caso: superadmin con `negocio_id` cacheado pero sin membresía → re-activa usando el cache directamente sin buscar en `usuario_negocios`.

**`/caja` y resto** — App del negocio activo (con `negocio_id` en JWT, RLS filtra automáticamente):
- El módulo `usuarios/` solo gestiona el Equipo del negocio activo
- El módulo `admin/` NO aparece en el sidebar ni en las rutas de layout

---

## Creación de negocios — wizard único reutilizable

Toda creación de negocio (onboarding inicial Y sucursales desde dentro de la app) usa el **mismo wizard** y la **misma función SQL**: `fn_completar_onboarding`. Single source of truth — no hay duplicación de pasos, validaciones ni configuraciones por defecto.

| Punto de entrada | Ruta | Modo | Quién es ADMIN del nuevo negocio | Quién es propietario |
|------------------|------|------|----------------------------------|----------------------|
| Onboarding del primer negocio (usuario sin negocios) | `/onboarding/negocio` | `inicial` | El usuario logueado | El usuario logueado |
| Sidebar → "Nueva sucursal" (admin común) | `/crear-negocio?context=sucursal` | `sucursal-admin` | El usuario logueado | El usuario logueado |
| Sidebar → "Nueva sucursal" (superadmin operando dentro de un negocio) | `/crear-negocio?context=sucursal` | `sucursal-superadmin` | El superadmin pide email manual | El propietario del negocio actual (heredado) |
| `/admin` → "Crear negocio" (superadmin) | `/crear-negocio?context=admin` | `sucursal-superadmin` | Email ingresado manualmente | Mismo email del admin (o explícito) |

**Tabla `negocios.propietario_usuario_id`:** dueño del negocio, NOT NULL, FK con `ON DELETE RESTRICT`. Se setea al crear y no se modifica. Permite identificar al "dueño original" cuando un superadmin necesita actuar en su nombre.

**Tabla `negocios.activo`:** flag de suspensión. `false` = bloqueado para todos sus usuarios; solo el superadmin puede entrar (para reactivarlo). Solo el superadmin lo cambia, vía `fn_suspender_negocio`. La validación se hace en `fn_set_negocio_activo` antes de actualizar el JWT.

**OnboardingService.mode:** el servicio mantiene el modo del wizard en memoria (`inicial` | `sucursal-admin` | `sucursal-superadmin`). `OnboardingNegocioPage.ngOnInit()` lo resuelve desde la URL + query params + `es_superadmin` y llama `setMode()`. `OnboardingCajaPage` lee el modo al finalizar para decidir si activa el JWT del nuevo negocio (solo `inicial`) o vuelve al lugar anterior con un toast (modos `sucursal-*`).

> **Eliminado en 2026-05-02:** `fn_crear_negocio` (función SQL duplicada que creaba negocios con configuraciones desactualizadas y siempre 5 cajas), `crear-negocio-modal` y `crear-sucursal-modal` (componentes de modal que solo pedían el nombre), `negocio.service.ts.crearSucursal()`. Todo unificado en el wizard reutilizable.

---

## Estructura de carpetas

```
src/app/
├── core/
│   ├── services/          # Servicios globales (ver abajo)
│   ├── config/            # pagination.config.ts — PAGINATION_CONFIG (pageSize por módulo)
│   │                      # routes.config.ts — ROUTES (todas las rutas de la app)
│   ├── guards/            # auth, public, role, pending-changes, superadmin
│   └── utils/             # date.util.ts, cedula.util.ts
├── features/              # Módulos (cada uno tiene pages/, services/, models/, components/)
├── shared/
│   ├── components/        # sidebar, under-construction, options-menu, options-modal, empty-state
│   ├── directives/        # currency-input, numbers-only, scroll-reset
│   └── pages/             # paginated-list.page.ts (clase base listas paginadas)
└── environments/
    ├── environment.example.ts   # Plantilla (en git)
    └── environment.ts           # Credenciales reales (en .gitignore)
```

---

## Servicios core — cuándo usar cada uno

| Servicio                  | Uso                                                         |
| ------------------------- | ----------------------------------------------------------- |
| `SupabaseService`         | Todas las queries y auth. Usar siempre `.call()` o `.rpc()`. Tiene listener global de auth (TOKEN_REFRESHED, SIGNED_OUT), detección de JWT expirado en `call()`, refresh proactivo al volver del background (`refreshSessionOnResume()`), y `handleExpiredSession()` como punto centralizado de limpieza de sesión |
| `UiService`               | Loading, toasts, alertas, confirmaciones, `hideTabs()`/`showTabs()` para ocultar tabs en páginas de detalle |
| `ConfigService`           | Lee tabla `configuraciones` (clave/valor con prefijo por módulo: `negocio_`, `caja_`, `bus_`, `pos_`, `nomina_`) con cache en memoria. Métodos: `get()`, `getNombreNegocio()`, `invalidar()` |
| `CurrencyService`         | Formateo de moneda: `format(value)` y `parse(value)`. No formatear manualmente |
| `StorageService`          | Captura fotos y sube imágenes a Supabase Storage con compresión automática. Bucket único `mi-tienda`, aislado por `negocio_id`. Ver sección "Storage multi-tenant" |
| `GananciasService`        | Lógica de comisiones recargas virtuales (liquidación BUS mensual) |
| `RecargasVirtualesService`| Operaciones de saldo celular/bus                            |
| `LoggerService`           | Logs estructurados a filesystem con rotación (no usar console.log directo) |
| `NetworkService`          | Estado de conectividad: `isOnline$: BehaviorSubject<boolean>` |

---

## Patrones Angular/Ionic — OBLIGATORIOS

### Standalone components siempre
```typescript
@Component({
  standalone: true,
  imports: [CommonModule, IonHeader, IonToolbar, IonContent, ...]
})
```

### inject() en lugar de constructor
```typescript
private supabase = inject(SupabaseService);
private ui = inject(UiService);
private fb = inject(FormBuilder);
```

### Registrar iconos en constructor
```typescript
import { IonIcon } from '@ionic/angular/standalone';
import { closeOutline, addOutline } from 'ionicons/icons';

@Component({
  standalone: true,
  imports: [IonIcon, ...] // IonIcon DEBE estar en imports
})
export class MiComponent {
  constructor() {
    addIcons({ closeOutline, addOutline }); // registrar en constructor
  }
}
```

**Reglas críticas para iconos en Android (tree-shaking):**

1. **`IonIcon` debe estar en `imports[]` del componente** — incluyendo modales. La web "perdona" si está en otro componente padre; Android no.

2. **Nunca usar binding dinámico con ternario** — Android elimina los iconos que no puede detectar en compile-time:
```html
<!-- ❌ Android no puede detectar qué iconos se usan → los elimina -->
<ion-icon [name]="esIngreso ? 'arrow-down-outline' : 'arrow-up-outline'"></ion-icon>

<!-- ✅ Nombres estáticos en cada rama — Angular los detecta en compile-time -->
@if (esIngreso) {
  <ion-icon name="arrow-down-outline"></ion-icon>
} @else {
  <ion-icon name="arrow-up-outline"></ion-icon>
}
```

3. **Ser explícito con el sufijo** (`-outline`, `-sharp`) — en Android Ionic usa modo `md` y busca el SVG exacto registrado. Si registraste `closeOutline`, usar siempre `name="close-outline"`, nunca `name="close"`.

> **Importante:** antes de borrar un icono de `addIcons()`, buscar su nombre string en los `.html` del componente. Los bindings `[name]="variable"` no aparecen en análisis estático.

### Rutas — SIEMPRE usar `ROUTES` de `core/config/routes.config.ts`

Todas las rutas de la app están centralizadas en `src/app/core/config/routes.config.ts`.
**Nunca escribir strings de ruta directamente** en `navigate()`, `navigateForward()`, `navigateBack()` ni `routerLink`.

```typescript
// ❌ Incorrecto — string hardcodeado
this.navCtrl.navigateBack('/inventario');
this.router.navigate(['/caja']);
[routerLink]="'/configuracion'"

// ✅ Correcto — siempre via ROUTES
import { ROUTES } from '@core/config/routes.config';
this.navCtrl.navigateBack(ROUTES.inventario.root);
this.router.navigate([ROUTES.home]);
[routerLink]="configuracionRoute"  // propiedad del componente = ROUTES.configuracion.root
```

**Al agregar una ruta nueva** (nueva página, nueva feature, nueva subruta):
1. Agregar la constante en `routes.config.ts` bajo la clave del módulo correspondiente
2. Si es una función con parámetro (detalle con `:id`), usar la forma `(id: string) => \`/ruta/${id}\``
3. Usar `ROUTES` en todos los archivos que naveguen a esa ruta

```typescript
// routes.config.ts — estructura para un módulo nuevo
miFeature: {
  root:    '/mi-feature',
  detalle: (id: string) => `/mi-feature/${id}`,
  nuevo:   '/mi-feature/nuevo',
},
```

**Módulo `@core/config`** — el alias `@core` apunta a `src/app/core/`. Usar siempre el alias en features y shared, ruta relativa solo en core mismo.

---

### Modales — NUNCA usar sheet modals (`breakpoints`)
Los sheet modals (`breakpoints + initialBreakpoint`) bloquean el scroll interno en Android: Ionic interpreta el swipe como gesto de cierre hasta llegar al tope. Sin `breakpoints`, el modal es full-height por defecto en Android (md mode) y el scroll funciona nativamente.

> **Nota:** `presentationStyle` no existe en `ModalOptions` de `@ionic/angular` 8.x — no usar.

```typescript
// ✅ Correcto — full-height por defecto en Android, scroll nativo sin conflicto
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  componentProps: { dato: valor }
  // sin breakpoints, sin initialBreakpoint
});
await modal.present();

// ❌ Incorrecto — bloquea scroll en Android
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
```

- No usar `breakpoints`, `initialBreakpoint` ni `handleBehavior` en modales con scroll interno → bloquea scroll en Android.
  - **Excepción:** Modales sin scroll interno (listas cortas de acciones) SÍ pueden usar `breakpoints: [0, 1]` + `initialBreakpoint: 1` + `--height: auto` para bottom sheet nativo con swipe-to-dismiss. Ejemplo: `OptionsModalComponent`.
- No usar `cssClass: 'modal-fullscreen-mobile'` → ya no es necesario sin breakpoints
- El usuario cierra con el botón ✕ del header (modales fullscreen) o swipe down (bottom sheets)
- **NUNCA usar `ion-select`, `ActionSheetController` ni `PopoverController`** → bug de Ionic 8 + Capacitor en Android con standalone components: estos overlay controllers no se inicializan hasta que otra página los cargue primero. Afecta **tanto modales como pages** en primera carga.
  - **Selects y Action Sheets**: usar `OptionsModalComponent` (`shared/components/options-modal/`). Se abre como bottom sheet con swipe-to-dismiss.
  - **Confirmaciones simples (texto plano)**: usar `AlertController`. Los alerts NO renderizan HTML custom en Android — Ionic sanitiza el `message` y muestra las etiquetas como texto. `IonicSafeString` tampoco funciona de forma confiable. **Si necesitas UI custom (estilos, layout, tipografía grande), usar un `ModalController` con componente dedicado.**
  - **Overlays que SÍ funcionan**: `AlertController`, `ModalController`, `LoadingController`, `ToastController`.

### `bottom-sheet-modal` — patrón para modales compactos sin scroll

Para modales compactos (formularios cortos, confirmaciones con UI custom) que deben abrirse desde abajo y ajustarse al contenido:

```typescript
const modal = await this.modalCtrl.create({
  component: MiModalComponent,
  cssClass: 'bottom-sheet-modal',   // ← clase global en theme/custom/modals.scss
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
```

**Template del componente** — `div` directo, sin `ion-content`:
```html
<div class="modal-wrapper">
  <div class="modal-header">
    <div class="modal-header-icon">  <!-- color en SCSS local del componente -->
      <ion-icon name="mi-icono"></ion-icon>
    </div>
    <span class="modal-header-title">Título</span>
    <button class="modal-close-btn" (click)="cerrar()">
      <ion-icon name="close-outline"></ion-icon>
    </button>
  </div>
  <!-- contenido -->
  <div class="modal-actions">
    <ion-button expand="block" fill="outline" color="medium" (click)="cerrar()">Cancelar</ion-button>
    <ion-button expand="block" color="primary" (click)="confirmar()">Confirmar</ion-button>
  </div>
</div>
```

**SCSS local** — solo el color del icono, todo lo demás viene de `modals.scss`:
```scss
.modal-header-icon {
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  ion-icon { color: var(--ion-color-primary); }
}
```

> **NO usar** en modales con scroll largo — bloquea el swipe en Android (misma regla de `breakpoints`).
> Ejemplos actuales: `NuevaNotaModalComponent`, `CuadreCajaPage`, `CrearNegocioModalComponent`.

### `modal-actions` — variantes de layout de botones

La clase `.modal-actions` tiene 3 variantes según el contexto del modal:

| Variante | Clase | Layout | Uso |
|----------|-------|--------|-----|
| Default | `modal-actions` | Columna (apilados) | Modales con botones de texto largo o 3+ botones |
| Fila | `modal-actions modal-actions--row` | Fila (lado a lado) | **Default para 2 botones cortos** (Cancelar/Confirmar) |
| Compacto | `modal-actions modal-actions--compact` | Fila centrada, botones chicos | Modales de herramienta/info (calculadora, cuadre) |

**Regla:** Si el modal tiene exactamente 2 botones (Cancelar + Accion), usar `modal-actions--row`. Los botones apilados verticalmente solo se justifican cuando hay 3+ acciones o textos largos que no caben en una fila.

```html
<!-- ✅ 2 botones cortos — fila horizontal -->
<div class="modal-actions modal-actions--row">
  <ion-button expand="block" fill="outline" color="medium" (click)="cerrar()">Cancelar</ion-button>
  <ion-button expand="block" color="primary" (click)="confirmar()">Confirmar</ion-button>
</div>

<!-- ❌ 2 botones cortos apilados — desperdicia espacio vertical -->
<div class="modal-actions">
  <ion-button expand="block" fill="outline" color="medium" (click)="cerrar()">Cancelar</ion-button>
  <ion-button expand="block" color="primary" (click)="confirmar()">Confirmar</ion-button>
</div>
```

Definido en `src/theme/custom/modals.scss`. Ejemplos: `CrearNegocioModalComponent` (row), `CuadreCajaPage` (compact).

### `OptionsModalComponent` — componente estándar para selects y action sheets

Ubicación: `shared/components/options-modal/`. Reemplaza `<select>` nativo, `ion-select`, `ActionSheetController` y `PopoverController`.

Soporta **dos modos** según los `@Input()` que reciba:

**Modo acción** (action sheet) — opciones con iconos, sin selección previa:
```typescript
// Ejemplo: selección de método de pago en POS
const groups: ModalOptionGroup[] = [{
  options: [
    { label: 'Efectivo', icon: 'cash-outline', value: 'EFECTIVO' },
    { label: 'Transferencia', icon: 'phone-portrait-outline', value: 'TRANSFERENCIA' },
    { label: 'Fiado', icon: 'hand-right-outline', value: 'FIADO', color: 'danger' },
  ]
}];

const modal = await this.modalCtrl.create({
  component: OptionsModalComponent,
  componentProps: { title: 'Método de pago', groups },
  cssClass: 'options-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
await modal.present();
const { data } = await modal.onDidDismiss();
if (data) { /* data = 'EFECTIVO' | 'TRANSFERENCIA' | etc. */ }
```

**Modo selección** (select) — sin iconos, con checkmark en la opción activa:
```typescript
// Ejemplo: filtro de categoría en inventario
const groups: ModalOptionGroup[] = [
  { options: [{ label: 'Todas', value: 'todas' }] },
  { title: 'Categorías', options: categorias.map(c => ({ label: c.nombre, value: `cat-${c.id}` })) }
];

const modal = await this.modalCtrl.create({
  component: OptionsModalComponent,
  componentProps: { title: 'Filtrar', groups, selectedValue: this.filtroActual },
  cssClass: 'options-modal',
  breakpoints: [0, 1],
  initialBreakpoint: 1
});
await modal.present();
const { data } = await modal.onDidDismiss();
if (data) { this.onFiltroChange(data); }
```

**Patrón del botón que abre el modal** (reemplaza `<select>`):
```html
<button class="filter-selector" (click)="abrirSelector()">
  <span class="filter-selector-label">{{ labelActual }}</span>
  <ion-icon name="chevron-down-outline" class="filter-selector-arrow"></ion-icon>
</button>
```

**API del componente:**

| `@Input()`      | Tipo               | Descripción |
| --------------- | ------------------ | ----------- |
| `title`         | `string`           | Título del modal |
| `subtitle`      | `string?`          | Subtítulo opcional |
| `groups`        | `ModalOptionGroup[]` | Grupos de opciones |
| `selectedValue` | `string?`          | Valor seleccionado actual (activa modo selección con checkmark) |

| `ModalOption`   | Campo     | Obligatorio | Descripción |
| --------------- | --------- | ----------- | ----------- |
|                 | `label`   | ✅ | Texto de la opción |
|                 | `value`   | ✅ | Valor retornado al seleccionar |
|                 | `icon`    | ❌ | Icono a la izquierda (modo acción) |
|                 | `subtitle`| ❌ | Texto secundario debajo del label |
|                 | `color`   | ❌ | `'danger'` para opciones destructivas |

```typescript
// ❌ Incorrecto — no funciona en Android primera carga
const actionSheet = await this.actionSheetCtrl.create({ ... });
<ion-select formControlName="campo">...</ion-select>

// ✅ Correcto — OptionsModalComponent funciona siempre
const modal = await this.modalCtrl.create({
  component: OptionsModalComponent,
  componentProps: { title, groups, selectedValue },
  cssClass: 'options-modal',
  breakpoints: [0, 1], initialBreakpoint: 1
});
```

> **Excepción**: `<select>` nativo de HTML sigue siendo válido **dentro de formularios** (`FormGroup`) donde se necesita binding directo con `formControlName` y no justifica abrir un modal (ej: campo de categoría en formulario de producto). En estos casos usar `<select>` con estilos custom.

### `EmptyStateComponent` — estado vacío de listas

Ubicación: `shared/components/empty-state/`. Usar siempre que una lista no tenga ítems que mostrar.

```html
<app-empty-state
  icon="cart-outline"
  title="Sin ventas"
  hint="Las ventas del día aparecerán aquí.">
</app-empty-state>
```

| `@Input()`  | Tipo     | Descripción |
| ----------- | -------- | ----------- |
| `icon`      | `string` | Nombre del icono Ionicons (requerido) |
| `title`     | `string?` | Título principal (opcional) |
| `hint`      | `string?` | Texto descriptivo secundario (opcional) |

- Estilos encapsulados en el componente — **no agregar `.empty-state` en el SCSS de la página**
- Para estados vacíos dentro de modales o contenedores pequeños: `style="min-height: auto"` inline
- Los iconos usados frecuentemente ya están registrados en el componente. Si necesitas uno nuevo, agrégalo en `empty-state.component.ts`

### Loading + Pull-to-Refresh sin doble spinner
```typescript
async handleRefresh(event: CustomEvent) {
  await this.cargarDatos(true);  // silencioso=true: no muestra spinner de página
  (event.target as HTMLIonRefresherElement).complete();
}

async cargarDatos(silencioso = false) {
  if (!silencioso) this.loading = true;
  try { /* queries */ } finally { this.loading = false; }
}
```

### Listas paginadas con infinite scroll — `PaginatedListPage<T>`

Clase base abstracta en `src/app/shared/pages/paginated-list.page.ts`.
**Usar siempre que una página muestre una lista paginada con `ion-infinite-scroll`.**

Qué provee (ya no hay que declararlo en cada página):
- `items: T[]` — array acumulado de todas las páginas
- `loading: boolean` — skeleton en primera carga
- `hasMore: boolean` — controla el infinite scroll
- `showScrollTop: boolean` — muestra FAB "subir al inicio" al hacer scroll >600px
- `cargar()` — resetea a página 0 y recarga
- `cargarMas(event)` — handler de `(ionInfinite)`
- `handleRefresh(event)` — handler de `(ionRefresh)` (sin doble spinner)
- `onContentScroll(event)` — handler de `(ionScroll)` para scroll-to-top
- `scrollToTop()` — sube al inicio con animación
- `loadingMoreText` — texto contextual del spinner de infinite scroll (abstracto, cada subclase lo define)
- `ui` — instancia de `UiService` (heredada, no re-inyectar)
- `content` — `@ViewChild` del `<ion-content #content>` (heredado, no re-declarar)

Page sizes centralizados en `PAGINATION_CONFIG` (`src/app/core/config/pagination.config.ts`).

Qué implementa cada subclase:
```typescript
export class MiListaPage extends PaginatedListPage<MiItem> implements OnInit {
    private miServicio = inject(MiServicio);

    protected readonly pageSize = PAGINATION_CONFIG.miModulo.pageSize;
    readonly loadingMoreText = 'Cargando más items...';  // contextual a la sección

    protected async fetchPage(page: number): Promise<MiItem[]> {
        return this.miServicio.listar(page, this.pageSize);
    }

    async ngOnInit() {
        await this.cargar();
    }
}
```

Template mínimo:
```html
<ion-content #content [scrollEvents]="true" (ionScroll)="onContentScroll($event)">

  @if (loading) { <!-- skeleton --> }
  @else if (items.length === 0) { <!-- empty state --> }
  @else {
    @for (item of items; track item.id) { <!-- tarjeta --> }
  }

  <ion-infinite-scroll [disabled]="!hasMore" (ionInfinite)="cargarMas($event)">
    <ion-infinite-scroll-content loadingSpinner="crescent" [loadingText]="loadingMoreText"></ion-infinite-scroll-content>
  </ion-infinite-scroll>

  @if (showScrollTop) {
  <ion-fab vertical="bottom" horizontal="end" slot="fixed" class="scroll-top-fab">
    <ion-fab-button size="small" color="primary" (click)="scrollToTop()">
      <ion-icon name="arrow-up-outline"></ion-icon>
    </ion-fab-button>
  </ion-fab>
  }
</ion-content>
```

Estilo SCSS (en cada página, ajustar margin según si hay footer):
```scss
.scroll-top-fab {
    margin-bottom: env(safe-area-inset-bottom);
}
```

Ejemplo real: `VentasListadoPage`, `InventarioPage`

### Tabs internas en un módulo — patrón obligatorio

Cuando un módulo necesita tabs internas (ej: Ventas tiene Lista y Resumen):

1. **Componente de tabs** en `components/` (NO en `pages/`). Detecta la ruta activa con `NavigationEnd`, no con `@Input()`.
2. **Cada página incluye su propio `ion-header`** con el componente de tabs — NO usar layout wrapper con `router-outlet` hijo (causa conflictos con `ion-content` en Ionic).
3. **Rutas planas** en el routes file, sin children wrapper.
4. **Carpetas de pages** nombradas por función: `pages/listado/`, `pages/resumen/`, etc.

```typescript
// ventas.routes.ts — rutas planas, sin layout wrapper
export const VENTAS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./pages/listado/ventas-listado.page').then(m => m.VentasListadoPage) },
  { path: 'resumen', loadComponent: () => import('./pages/resumen/ventas-resumen.page').then(m => m.VentasResumenPage) }
];
```

```typescript
// ventas-tabs.component.ts — detecta ruta activa automáticamente
private router = inject(Router);
activeTab: 'lista' | 'resumen' = 'lista';
constructor() {
    this.syncTab(this.router.url);
    this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(e => this.syncTab(e.urlAfterRedirects));
}
```

Ejemplo real: módulo `ventas` (`VentasTabsComponent` + `VentasListadoPage` + `VentasResumenPage`)

### Animación de tabs — `.tab-animate`

Clase global en `global.scss`. Aplica fade + leve subida (8px → 0) al entrar un elemento al DOM.

**Cuándo usarla:** Solo en tabs **state-driven** (contenido controlado con `@if` dentro de una misma página). El `@if` destruye y recrea el DOM al cambiar tab, disparando la animación automáticamente.

```html
@if (tabActivo === 'CELULAR') {
  <div class="tab-animate">
    <!-- contenido del tab -->
  </div>
}
@if (tabActivo === 'BUS') {
  <div class="tab-animate">
    <!-- contenido del tab -->
  </div>
}
```

**Cuándo NO usarla:** Tabs **router-driven** (rutas separadas como `ventas`). Ionic ya aplica su propia animación nativa de transición de página en `ion-router-outlet` — agregar `.tab-animate` duplicaría la animación.

| Tipo de tabs | Animación |
|---|---|
| State-driven (`@if` en misma página) | `.tab-animate` en el div contenedor |
| Router-driven (rutas separadas) | Animación nativa de Ionic — no agregar nada |

Ejemplo real: `recargas-virtuales.page.html`

---

## Patrones Supabase — OBLIGATORIOS

### Todas las queries van por `supabase.call()`
```typescript
// Lectura
const data = await this.supabase.call<Producto[]>(
  this.supabase.client.from('productos').select('*'),
);

// Mutación con toast de éxito
await this.supabase.call(
  this.supabase.client.from('gastos').insert(payload),
  'Gasto registrado correctamente',
  { showLoading: true }
);
```

### Operaciones multi-tabla → siempre función PostgreSQL
```typescript
// ✅ Correcto: todo en una transacción atómica
const resultado = await this.supabase.call<ResultadoCierre>(
  this.supabase.client.rpc('fn_ejecutar_cierre_diario', { p_empleado_id: id, p_efectivo: monto })
);

// ❌ Incorrecto: múltiples .insert() sueltos desde el servicio
```

### Verificar éxito de INSERT/UPDATE
```typescript
// Supabase devuelve data: null en mutaciones sin .select()
// Verificar así:
const result = await this.supabase.call(...);
if (result !== null) { /* éxito — result puede ser [] o null */ }
// O mejor: agregar .select() al final para obtener el registro creado
```

### RLS OR clause en `usuario_negocios` — multiplicación de filas (multi-tenant)

La política RLS de `usuario_negocios` tiene una cláusula OR:
```sql
negocio_id = get_negocio_id()
OR usuario_id = (SELECT id FROM usuarios WHERE email = get_email())
```

La segunda rama devuelve **todas las membresías propias del usuario autenticado** (no solo la del negocio activo).
Cualquier vista o query que haga JOIN con `usuario_negocios` sin filtrar explícitamente por `negocio_id` recibirá una fila por cada negocio donde el usuario tenga membresía — multiplicando los resultados.

**Síntoma**: un admin con 3 negocios ve sus propios datos repetidos 3 veces en una vista.

**Regla**: toda vista o query que haga JOIN con `usuario_negocios` DEBE incluir:
```sql
WHERE un.negocio_id = public.get_negocio_id()
```
Ejemplo: `v_saldos_empleados` lo requiere aunque la RLS ya filtre — sin ese WHERE, retorna una fila por negocio del admin.

---

## Eficiencia de API — evitar abuso de requests

### Búsquedas: debounce + distinctUntilChanged
Toda búsqueda que dispare queries debe usar `debounceTime(500)` + `distinctUntilChanged()` para no bombardear Supabase:
```typescript
private search$ = new Subject<string>();
private searchSub!: Subscription;

ngOnInit() {
    this.searchSub = this.search$
        .pipe(debounceTime(500), distinctUntilChanged())
        .subscribe(() => this.cargar());
}

ngOnDestroy() { this.searchSub?.unsubscribe(); }
```

### Queries independientes: siempre en paralelo
```typescript
// ✅ Paralelo — 1 round-trip
const [ventas, resumen] = await Promise.all([
    this.servicio.listar(page),
    this.servicio.obtenerResumen(),
]);

// ❌ Secuencial — 2 round-trips innecesarios
const ventas = await this.servicio.listar(page);
const resumen = await this.servicio.obtenerResumen();
```

### Botones de acción: deshabilitar durante operación
Evita double-submit y requests duplicados:
```typescript
guardando = false;

async guardar() {
    if (this.guardando) return;
    this.guardando = true;
    try { /* ... */ } finally { this.guardando = false; }
}
```
```html
<button [disabled]="guardando" (click)="guardar()">Guardar</button>
```

### Datos que no cambian frecuentemente: cache en servicio
`ConfigService` ya implementa este patrón (cache en memoria, `invalidar()` manual).
Usar el mismo patrón si se necesita cache para otros datos de baja frecuencia de cambio.

---

## Funciones PostgreSQL — convenciones

- Nombre con prefijo `fn_`: `fn_ejecutar_cierre_diario`, `fn_registrar_operacion_manual`
- Retornan `JSON` con resultado detallado
- `SECURITY DEFINER` + `SET search_path = public` (obligatorio para evitar caída de permisos)
- `REVOKE EXECUTE ... FROM anon; GRANT EXECUTE ... TO authenticated;` (las funciones financieras nunca se exponen a `anon`)
- Finalizar con `NOTIFY pgrst, 'reload schema';`
- Documentar las funciones en `docs/<modulo>/sql/functions/`
- Templates completos y criterios de decisión en `docs/ESTRUCTURA-PROYECTO.md`

### Superadmin — bloqueo obligatorio en funciones de mutación

**Toda función SQL que mute datos operativos del negocio debe bloquear al superadmin.** El superadmin entra a un negocio solo para revisar datos — no para ejecutar operaciones.

Llamar a la función helper centralizada **al inicio de la función**, antes de cualquier otra lógica. Un solo `PERFORM`, un solo lugar de mantenimiento:

```sql
PERFORM public.fn_assert_no_superadmin();
```

La función helper está en `docs/setup/fn_assert_no_superadmin.sql` y debe ejecutarse en Supabase **antes** que cualquier función de mutación. Lanza `RAISE EXCEPTION` internamente — esa excepción burbujea automáticamente y aborta la función llamante, independientemente de si retorna `void`, `JSON` o `TABLE`.

**Funciones que SÍ deben bloquearse** — toda función que toque caja, ventas, inventario, clientes, recargas, nómina o notas:
`fn_abrir_turno`, `fn_ejecutar_cierre_diario_v5`, `fn_cierre_emergencia_turno`, `fn_registrar_operacion_manual`, `fn_crear_transferencia`, `fn_reparar_deficit_turno`, `fn_registrar_venta_pos`, `fn_anular_venta`, `fn_ajustar_stock_inventario`, `fn_crear_producto_simple`, `fn_crear_producto_con_variantes`, `fn_registrar_pago_fiado`, `fn_registrar_recarga_proveedor_celular`, `fn_registrar_pago_proveedor_celular`, `fn_registrar_compra_saldo_bus`, `fn_liquidar_ganancias_bus`, `fn_registrar_adelanto_sueldo`, `fn_pagar_nomina_empleado`, `fn_eliminar_nota`.

**Funciones que NO se bloquean** — funciones de setup/admin que el superadmin usa deliberadamente:
`fn_configurar_modulos`, `fn_configurar_modulos_admin`, `fn_suspender_usuario`, `fn_actualizar_membresia`, `fn_transferir_empleado`, `fn_set_negocio_activo`, `fn_completar_onboarding`, `fn_suspender_negocio`.

### Dónde vive cada función SQL

| Archivo | Qué contiene |
|---------|-------------|
| `docs/setup/03_functions.sql` | **Solo funciones de setup inicial** — las que deben existir para que la app funcione desde cero (auth, negocios, cajas). Se ejecutan junto con el schema al hacer un reset completo de Supabase. |
| `docs/<modulo>/sql/functions/fn_nombre.sql` | **Funciones de feature** — una función por archivo, en la carpeta del módulo al que pertenece. Ejemplos: `docs/usuarios/sql/functions/fn_transferir_empleado.sql`, `docs/caja/sql/functions/fn_ejecutar_cierre_diario.sql`. |

**Regla:** si la función se necesita antes de que exista cualquier dato de negocio → `03_functions.sql`. Si es lógica de negocio de un módulo específico → carpeta del módulo.

**Al crear una función nueva de feature:**
1. Crear el archivo en `docs/<modulo>/sql/functions/fn_nombre.sql`
2. Ejecutarlo directamente en Supabase SQL Editor (no agregarlo a `03_functions.sql`)
3. El archivo queda como fuente de verdad — si se necesita re-ejecutar, se hace desde ahí

### Asignación de variables en plpgsql — NUNCA `SELECT ... INTO`

En Supabase, **cualquier** `SELECT ... INTO variable` causa el error `relation "variable" does not exist` porque el parser interpreta la variable como una tabla. Esto aplica a todos los casos: columna única, agregados, EXISTS, múltiples variables.

```sql
-- ❌ Rompe en Supabase — parser interpreta v_caja_id como tabla
SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA';

-- ❌ También rompe — mismo bug con agregados
SELECT COUNT(*) + 1 INTO v_numero_turno FROM turnos_caja WHERE ...;

-- ❌ También rompe — mismo bug con EXISTS
SELECT EXISTS (...) INTO v_existe;

-- ❌ También rompe — mismo bug con múltiples variables
SELECT id, nombre INTO v_id, v_nombre FROM cajas WHERE ...;

-- ✅ Correcto — siempre usar := (SELECT ...)
v_caja_id      := (SELECT id FROM cajas WHERE codigo = 'CAJA');
v_numero_turno := (SELECT COUNT(*) + 1 FROM turnos_caja WHERE ...);
v_existe       := EXISTS (SELECT 1 FROM tabla WHERE ...);

-- ✅ Para FOR UPDATE (lock de fila): PERFORM + := separados
PERFORM id FROM cajas WHERE id = v_id FOR UPDATE;
v_saldo := (SELECT saldo_actual FROM cajas WHERE id = v_id);
```

**Regla absoluta:** Usar `:= (SELECT ...)` para toda asignación de variable en plpgsql. `SELECT ... INTO` no funciona en Supabase en ningún caso.

### Cuándo usar cada enfoque

| Caso | Usar | Por qué |
|------|------|---------|
| CRUD de 1 tabla (con JOINs simples) | **Query directa** `supabase.client.from()` | No justifica una función SQL |
| Operación que toca 2+ tablas | **Función RPC** `supabase.rpc()` | Atomicidad transaccional |
| Query compleja (GROUP BY, agregaciones, paginación) | **Función RPC** que retorna `TABLE` | Imposible con el query builder |
| Efecto automático al insertar/modificar fila | **Trigger** | No depende del frontend |

---

## Reglas críticas

### IDs — SIEMPRE `string` (UUID), nunca `number`

El schema usa UUIDs en todas las PKs y FKs desde la migración v11. Toda entidad de BD tiene `id: string`, nunca `id: number`.

**Al revisar o crear cualquier módulo, verificar:**
- Modelos (`*.model.ts`): todos los campos `id`, `*_id` que mapeen a columnas de BD → `string`
- Servicios: parámetros como `cajaId`, `empleadoId`, `categoriaId`, etc. → `string`
- Páginas/componentes: propiedades que reciben IDs de route params o `@Input()` → `string`
- Route params: nunca usar `Number(params['id']) || 0` — mantener como `string` directamente
- Funciones SQL (`p_*_id`): los parámetros que reciben UUIDs → `UUID` en plpgsql

```typescript
// ❌ Incorrecto — rompe con UUID: "invalid input syntax for type uuid: '0'"
cajaId: number = 0;
this.cajaId = Number(params['cajaId']) || 0;
async registrar(cajaId: number, categoriaId: number): Promise<void>

// ✅ Correcto
cajaId: string = '';
this.cajaId = params['cajaId'] || '';
async registrar(cajaId: string, categoriaId: string): Promise<void>
```

**Excepción legítima:** campos que son cantidades o contadores reales (`monto: number`, `saldo_actual: number`, `numero_turno: number`) siguen siendo `number`.

```sql
-- ❌ Incorrecto en función SQL
p_caja_id INTEGER

-- ✅ Correcto
p_caja_id UUID
```

### Fechas — NUNCA `toISOString()`
```typescript
// ❌ Da fecha UTC (puede ser el día anterior en América)
new Date().toISOString().split('T')[0]

// ✅ Siempre usar las utilidades de core/utils/date.util.ts:
getFechaLocal()                        // → '2026-03-10'  (fecha local hoy)
getInicioDiaSiguienteISO()             // → ISO del inicio del día siguiente (para .lt() en queries)
getInicioDiaSiguienteDeISO(fechaLocal) // → ISO del día siguiente de una fecha dada

// Rango de fechas — NUNCA T23:59:59 + .lte():
// ❌ Pierde operaciones en el último segundo del día
.lte('fecha', `${hoy}T23:59:59`)

// ✅ Exclusivo del día siguiente:
.lt('fecha', getInicioDiaSiguienteISO())
```

### Imágenes — NUNCA foto a resolución completa
```typescript
// ✅ Siempre con límites (reduce de 5MB a ~300KB)
Camera.getPhoto({ quality: 80, width: 1200, height: 1600, correctOrientation: true });
```

### Configuración — NUNCA hardcodear valores de negocio
Los valores de negocio viven en la tabla `configuraciones` (clave/valor). Leerlos con `ConfigService.get()`, no hardcodearlos.
Convención de claves: prefijo por módulo (`negocio_nombre`, `caja_fondo_fijo_diario`, `bus_alerta_saldo_bajo`, `pos_descuentos_habilitados`, `nomina_sueldo_base`).

---

## Principios de UX del proyecto

- **Mínimo input del usuario**: si el sistema puede calcular algo, lo calcula. El usuario ingresa el mínimo posible.
- **Guías visuales para acciones físicas**: cuando hay que hacer algo con dinero físico (sobres, fondos), mostrar tarjetas visuales explicativas.
- **Wizards multi-paso**: indicador "Paso X de Y" + barra de progreso + paso de resumen antes de confirmar.
- **Campo principal**: clase `.destacado` (border primary + box-shadow).

### FAB central — menú de acciones rápidas (`main-layout`)

El FAB del centro del tab bar abre un menú de opciones tipo cards flotantes (`fab-options` en `main-layout.page.scss`).

**Regla de orden**: la opción con el **nombre más largo va primero** (más arriba). Las cards se ajustan al tamaño de su contenido — la más larga queda más ancha y la más corta más angosta, creando un efecto pirámide visual natural.

```
  ┌──────────────────────┐  ← opción nombre largo (arriba)
  ┌───────────────┐         ← opción nombre corto (abajo)
        [ + ]
```

Cada opción usa `.fab-option` con `.fab-option-icon.<color>` para el círculo del icono. Colores actuales: `secondary` (notas), `tertiary` (cuadre). Al agregar una nueva opción, respetar el orden por longitud de nombre.

---

## Safe area en Android — patrón obligatorio

Todo elemento que tenga **fondo propio y toque el borde inferior de la pantalla** debe compensar la barra de navegación de Android (botones físicos o gesto swipe).

**Regla**: se aplica a `ion-footer`, FABs, tabs, footers de modales y cualquier panel anclado al fondo.

```scss
// Si el elemento ya tiene padding-bottom:
padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));

// Si no tiene padding propio:
padding-bottom: env(safe-area-inset-bottom);
```

`env(safe-area-inset-bottom)` vale `0` en dispositivos sin barra → no rompe el layout.

**Modales con footer custom:** los modales que tienen su propio footer (botón de acción al fondo) también necesitan safe area, ya que se renderizan sobre el tab bar pero fuera de su flujo. Usar `calc()` con el spacing ya existente:

```scss
// ✅ Footer de modal con padding propio
.vsm-footer {
    padding: var(--spacing-sm) var(--spacing-md);
    padding-bottom: calc(var(--spacing-sm) + env(safe-area-inset-bottom));
}

// ✅ .modal-actions ya incluye env(safe-area-inset-bottom) en modals.scss — no agregar de nuevo
```

> Los modales que usan `.modal-actions` (patrón `bottom-sheet-modal`) ya tienen safe area en `modals.scss`. Solo los footers custom necesitan agregarlo manualmente.

**Excepción — páginas dentro de tabs:** `ion-tab-bar` ya compensa el safe area internamente. Los footers de páginas que viven dentro de tabs **NO deben sumar** `env(safe-area-inset-bottom)` — se duplica el espacio. Solo usar `padding-bottom` normal. Los elementos `position: fixed` (overlays, scanners) sí lo necesitan porque están fuera del flujo del tab bar.

```scss
// ❌ Footer dentro de tabs — duplica safe area
padding-bottom: calc(var(--spacing-md) + env(safe-area-inset-bottom));

// ✅ Footer dentro de tabs — tab bar ya lo maneja
padding-bottom: var(--spacing-md);

// ✅ Elemento position: fixed (overlay/scanner) — sí necesita safe area
bottom: calc(var(--spacing-lg) + env(safe-area-inset-bottom));
```

**Estado actual del proyecto:**

| Elemento | Archivo | Estado |
| -------- | ------- | ------ |
| Footer totalizador ventas | `ventas.page.scss` | ✅ |
| Footer cobro POS | `pos.page.scss` | ✅ |
| Tab bar principal | `main-layout.page.scss` | ✅ |
| Sidebar footer | `sidebar.component.scss` | ✅ |
| FAB global | `global.scss` | ✅ |
| Footer modal variantes POS | `variante-selector-modal.component.scss` | ✅ |
| `.modal-actions` (bottom-sheet-modal) | `theme/custom/modals.scss` | ✅ |

---

## Nombres de cajas (UI vs BD) — hasta 5 cajas

| Código BD      | Nombre en UI | Subtítulo       | Rol                                      | Tipo       |
| -------------- | ------------ | --------------- | ---------------------------------------- | ---------- |
| `CAJA`         | Tienda       | Efectivo        | Vault de depósitos acumulados            | Base       |
| `CAJA_CHICA`   | Cajón        | Cajón diario    | Efectivo del día (ventas POS + recargas) | Base       |
| `VARIOS`       | Varios       | Fondo emergencia| Fondo fijo de gastos                     | Opt-in     |
| `CAJA_CELULAR` | Celular      | Saldo digital   | Efectivo recargas celular                | Opt-in (superadmin) |
| `CAJA_BUS`     | Bus          | Saldo digital   | Efectivo recargas bus                    | Opt-in (superadmin) |

> No renombrar los códigos de BD. Solo los labels de UI difieren.
> **v5 (2026-03-06):** `CAJA_CHICA` es ahora el cajón físico diario. `VARIOS` es el fondo de emergencia (antes era `CAJA_CHICA` en BD).
> **2026-05-01:** VARIOS pasa a opt-in. CELULAR/BUS solo se crean si el superadmin habilita el módulo en Parámetros → Módulos. Las funciones SQL del cierre ya manejan el caso "Varios desactivada" (`caja_varios_activa = false` → `transferencia_diaria = 0` en cascada).

---

## Storage multi-tenant — patrón obligatorio

Toda subida de archivos usa un **único bucket `mi-tienda`** con aislamiento por `negocio_id` al inicio del path. Nunca crear buckets separados por módulo ni por negocio.

### Estructura de paths

```
mi-tienda/
  {negocio_id}/
    comprobantes/YYYY/MM/operaciones/{uuid}.webp   ← comprobantes de caja
    productos/{categoria}/{uuid}.webp              ← fotos de productos
```

### API de StorageService

```typescript
// Capturar foto (cámara o galería) — retorna SafeUrl para preview + rawUrl para upload
const result = await this.storageService.capturarFoto(CameraSource.Camera);
if (!result) return; // usuario canceló
this.fotoPreviewUrl = result.previewUrl; // SafeUrl → <img [src]>
this.fotoRawUrl = result.rawUrl;         // string → uploadImage()

// Subir imagen — negocio_id se inyecta internamente, no se pasa como parámetro
const path = await this.storageService.uploadImage(rawUrl, 'comprobantes/operaciones');
const path = await this.storageService.uploadImage(rawUrl, `productos/${subfolder}`, false);

// Obtener URL firmada (bucket privado — comprobantes)
const url = await this.storageService.getSignedUrl(path);

// Obtener URL pública (bucket público — productos)
const url = this.storageService.getPublicUrl(path);

// Eliminar archivo (rollback si RPC falla, o al cambiar imagen)
await this.storageService.deleteFile(path);
```

### Reglas críticas

- **Nunca pasar `bucket` como parámetro** — el bucket (`mi-tienda`) es constante definido en `StorageService`. Los callers solo pasan `subfolder`.
- **Nunca pasar `negocio_id` como parámetro** — `StorageService` lo lee directamente de `AuthService.usuarioActualValue?.negocio_id`.
- **Subfolder describe el tipo de contenido**, no el negocio: `'comprobantes/operaciones'`, `'productos/bebidas'`.
- **Rollback obligatorio**: si el RPC falla después de un upload exitoso, llamar `deleteFile(path)` para no dejar huérfanos en Storage.
- **El path que retorna `uploadImage()` es lo que se guarda en BD** — nunca guardar URLs firmadas ni públicas en la base de datos.

### RLS de Storage — leer siempre del JWT, nunca de `auth.users`

Las políticas RLS sobre `storage.objects` deben leer el `negocio_id` **del JWT del request**, no haciendo una subquery a `auth.users`. La subquery a `auth.users` falla silenciosamente porque en el contexto de un request de Storage el rol es `authenticated` y `auth.uid()` puede no resolver correctamente dentro de esa subquery.

```sql
-- ❌ Incorrecto — subquery a auth.users falla en contexto Storage
WITH CHECK (
    bucket_id = 'mi-tienda'
    AND (storage.foldername(name))[1] = (
        SELECT raw_app_meta_data->>'negocio_id'
        FROM auth.users WHERE id = auth.uid()
    )
);

-- ✅ Correcto — leer directamente del JWT (mismo mecanismo que get_negocio_id())
WITH CHECK (
    bucket_id = 'mi-tienda'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'negocio_id')
);
```

`auth.jwt() -> 'app_metadata' ->> 'negocio_id'` es exactamente lo que usa `public.get_negocio_id()` — la fuente de verdad para RLS en toda la app. Las políticas de Storage siguen el mismo patrón. Ver `docs/setup/03_storage_rls.sql`.

### Al agregar un nuevo tipo de archivo

1. Definir el subfolder descriptivo (ej: `'notas/adjuntos'`)
2. Llamar `uploadImage(rawUrl, 'notas/adjuntos')` — el path resultante será `{negocio_id}/notas/adjuntos/YYYY/MM/{uuid}.webp`
3. Guardar el path en BD
4. Para visualizar: `getSignedUrl(path)` si el bucket es privado, `getPublicUrl(path)` si es público

---

## No hacer

- No hardcodear strings de rutas en `navigate()`, `navigateForward()`, `navigateBack()` ni `routerLink` — usar siempre `ROUTES` de `core/config/routes.config.ts`
- No usar `new Date().toISOString()` para fechas locales
- No subir fotos a resolución completa
- No hardcodear valores de negocio en código
- No hacer múltiples INSERT/UPDATE sueltos para operaciones relacionadas → usar función SQL
- No usar constructor para inyección de dependencias → usar `inject()`
- No crear componentes sin `standalone: true`
- No formatear moneda manualmente → usar `CurrencyService`
- No mostrar `console.log` en producción → usar `LoggerService`
- No dejar footers/paneles inferiores sin `env(safe-area-inset-bottom)` → ver sección "Safe area en Android"
- No usar `ActionSheetController`, `PopoverController` ni `ion-select` → usar `OptionsModalComponent` (modo acción o modo selección). `<select>` nativo solo dentro de formularios con `formControlName`
- No dejar botones de acción habilitados durante operaciones async → usar flag `guardando`/`procesando` + `[disabled]`
- No crear subscriptions (`.subscribe()`) sin cleanup en `ngOnDestroy()` → evitar memory leaks
- No usar `console.error()` en servicios → usar `LoggerService.error()` para que quede en los logs del dispositivo
- No crear funciones SQL de mutación sin `PERFORM public.fn_assert_no_superadmin();` al inicio
- No agregar una tabla nueva sin su política RESTRICTIVE `superadmin_no_write` en `docs/setup/02_rls.sql`
- No ocultar botones de acción al superadmin en el frontend — la seguridad está en la BD (RLS + `fn_assert_no_superadmin`). El superadmin necesita ver el flujo completo para dar soporte. Si intenta ejecutar una acción, recibe el toast de error de la BD.
- No llamar a `Camera.getPhoto` directamente — usar siempre `StorageService.capturarFoto()`
- No pasar `bucket` ni `negocio_id` a los métodos de `StorageService` — el bucket es `mi-tienda` (constante interna) y el `negocio_id` se inyecta automáticamente. Solo pasar el `subfolder` descriptivo
- No guardar URLs firmadas ni URLs públicas en la BD — guardar siempre el `path` que retorna `uploadImage()`

---

## Documentación por módulo

| Módulo              | Doc principal                                              |
| ------------------- | ---------------------------------------------------------- |
| Caja                | `docs/caja/DASHBOARD-README.md`                            |
| Auth                | `docs/auth/AUTH-README.md`                                 |
| Usuarios            | `docs/usuarios/USUARIOS-README.md`                         |
| Recargas Virtuales  | `docs/recargas-virtuales/RECARGAS-VIRTUALES-README.md`     |
| Inventario          | `docs/inventario/INVENTARIO-README.md`                     |
| POS                 | `docs/pos/POS-README.md`                                   |
| Ventas              | `docs/ventas/VENTAS-README.md`                             |
| Clientes y Créditos | `docs/clientes/CLIENTES-README.md`                         |
| Core/Servicios      | `docs/core/CORE-README.md`                                 |
| Sistema de diseño   | `docs/DESIGN.md`                                           |
| Shared              | `docs/shared/SHARED-README.md`                             |
| Estructura/Patrones | `docs/guides/ESTRUCTURA-PROYECTO.md`                       |
| Schema BD           | `docs/setup/schema.sql`                                    |
| Configuracion       | `docs/configuracion/CONFIGURACION-README.md`               |
| Arquitectura cajas  | `docs/guides/ARQUITECTURA.md`                              |
| Mov. Empleados      | `docs/movimientos-empleados/MOVIMIENTOS-EMPLEADOS-README.md` |
| App icon & splash   | `docs/assets/ASSETS-README.md`                             |
| Notas               | `docs/notas/NOTAS-README.md`                               |
| Layout              | `docs/layout/LAYOUT-README.md`                             |
| Historial Recargas  | `docs/historial-recargas/HISTORIAL-RECARGAS-README.md`     |
| Crear Negocio       | `docs/crear-negocio/CREAR-NEGOCIO-README.md`               |
| Auditoría producción | `docs/AUDITORIA-PRODUCCION-2026-05-07.md`                 |
