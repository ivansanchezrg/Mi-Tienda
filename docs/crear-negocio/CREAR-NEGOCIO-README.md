# Crear Negocio

Wrapper de feature que **reutiliza las páginas del onboarding inicial** para crear sucursales o nuevos negocios desde dentro de la app.

Single source of truth: el wizard del onboarding es el único flujo de creación de negocios. Esta feature solo redirige a esas páginas en modo "sucursal".

## Estructura

```
features/crear-negocio/
└── crear-negocio.routes.ts    # Rutas que delegan al onboarding
```

## Modos de operación

| Punto de entrada | Ruta | Modo en `OnboardingService` |
|---|---|---|
| Sidebar → "Nueva sucursal" (admin común) | `/crear-negocio?context=sucursal` | `sucursal-admin` |
| Sidebar (superadmin operando dentro de un negocio) | `/crear-negocio?context=sucursal` | `sucursal-superadmin` |
| `/admin` → "Crear negocio" (superadmin) | `/crear-negocio?context=admin` | `sucursal-superadmin` |

Más detalles: ver `docs/onboarding/ONBOARDING-README.md` (sección "Modos del wizard") y la sección "Creación de negocios — wizard único reutilizable" en `CLAUDE.md`.

## Función SQL involucrada

`fn_completar_onboarding(p_nombre, p_caja_varios_activa, p_email_admin)` — crea el negocio + 3 cajas base + opt-in a Varios. Es la misma función que usa el onboarding inicial (no se duplica lógica).

## Notas

- No tiene componentes ni servicios propios.
- No tiene README de SQL porque no aporta funciones nuevas.
