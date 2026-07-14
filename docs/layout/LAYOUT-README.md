# Layout

Feature contenedora del **shell de la aplicación autenticada**: tab bar inferior, drawer lateral (sidebar), FAB central, y `router-outlet` para todas las páginas internas.

## Estructura

```
features/layout/
├── layout.routes.ts
└── pages/
    └── main/
        ├── main-layout.page.ts/.html/.scss
        └── ...
```

## Responsabilidades

- **Tab bar** con accesos a Inicio, Inventario, POS, Ventas, Clientes.
- **FAB central** que abre el menú de acciones rápidas (Nueva nota, Cuadre, Calculadora).
- **Sidebar** (drawer en móvil, fijo en ≥992px) con menú secundario.
- **Coordina visibilidad de tabs** vía `UiService.tabsVisible` signal. Páginas de detalle pueden ocultarlas con `ui.hideTabs()`.
- **Banner offline** (`OfflineBannerComponent`) cuando el usuario pierde conexión o hay ventas en cola.

## Banner offline (`OfflineBannerComponent`)

Global en `app.component.html`, sobre el `ion-router-outlet`. Único punto visual del estado offline.

- **Dos estados:** "Sin conexión" (ámbar / `warning`) cuando no hay red; "Sincronizando N venta(s)" (azul /
  `primary`, clicable → `/ventas/pendientes`) cuando hay cola drenándose con red. Visible si `isOffline || pendientes > 0`.
- **Empuja el contenido, no lo tapa:** `ion-app` es flex column (`app.component.scss`); el banner ocupa su
  altura arriba y el router-outlet toma el resto. No usa `position: fixed`.
- **Safe area (celular):** el `:host` reserva el `safe-area-inset-top` **solo cuando el banner es visible**
  (`:host-context(body.offline-banner-visible)`) — online no ocupa espacio. Esa franja usa `--app-bg` (color de
  la app), así la status bar (hora/batería) conserva su color y el banner empieza debajo.
- **Coordinación global:** el componente togglea la clase `body.offline-banner-visible`. En `global.scss` esa
  clase anula `--ion-safe-area-top` en `ion-toolbar` y `.sidebar-header` (evita doble safe area / hueco), y lo
  **restaura** en `ion-toast` (para que los toasts no se peguen a la status bar).

> Detalle completo del rediseño en `PLAN-OFFLINE-POS-2026-06-08.md` §13.3.

## Notas técnicas

- No tiene servicios propios — solo orquesta UI.
- El sidebar es un componente compartido en `shared/components/sidebar/`.
- Aplica el guard `authGuard` desde `app.routes.ts` (no en este feature).
- Safe area de Android se compensa en `main-layout.page.scss`.

## Candado del tab POS y del sidebar — orden de suscripción obligatorio

`main-layout.page.ts` (tab bar) y `sidebar.component.ts` derivan el candado del POS y la
visibilidad del menú del mismo estado reactivo (`TurnosCajaService.esMiTurno$`,
`ConfigService.config$`). **Ambos `ngOnInit` deben suscribirse a esos observables de forma
síncrona, ANTES de cualquier `await`** (ej. `authService.getUsuarioActual()`,
`configService.get()`).

**Por qué:** son `BehaviorSubject` — entregan su último valor al momento de suscribir, así
que suscribir antes de hidratar no pierde ninguna emisión. Si en cambio se suscribe
*después* de un `await` de I/O, y ese `await` se cuelga (típico tras un reposo largo: el
cache de `ConfigService` tiene TTL de 1h, y con el TTL vencido `get()` va a BD justo cuando
la radio del teléfono recién despierta), la UI queda congelada en su estado inicial
mientras el `await` no resuelve: candado del POS cerrado en el tab bar y sidebar sin menú,
aunque `esMiTurno$` ya haya emitido `true` (el turno se hidrata local-first sin red en
`TurnosCajaService`). El Home no depende de ese `await` — pinta desde su propio snapshot —
por lo que puede mostrar "caja abierta" al mismo tiempo que el candado sigue cerrado.
Bug real, corregido 2026-07-12.
