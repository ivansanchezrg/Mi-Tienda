# CLAUDE.md — Mi Tienda

Contexto rápido del proyecto para IAs. Lee esto antes de cualquier tarea.

---

## Qué es este proyecto

App móvil Android (APK) para gestión de una tienda minorista. Maneja caja (sistema de 4 cajas físicas/virtuales), ventas, recargas de saldo celular/bus, inventario y gastos operativos con comprobantes fotográficos.

**No es un e-commerce ni una web app.** Es una herramienta interna de administración para una sola tienda.

---

## Stack

| Componente   | Versión | Notas                          |
| ------------ | ------- | ------------------------------ |
| Angular      | 20.x    | Standalone components SIEMPRE  |
| Ionic        | 8.x     | Componentes nativos Android    |
| Capacitor    | 8.x     | Empaquetado APK                |
| Supabase JS  | 2.x     | Auth + DB + Storage            |
| Node.js      | 22.x    |                                |

---

## Módulos (`src/app/features/`)

| Módulo              | Estado           |
| ------------------- | ---------------- |
| `auth`              | ✅ Completo      |
| `dashboard`         | ✅ Completo      |
| `recargas-virtuales`| ✅ Completo      |
| `gastos-diarios`    | ✅ Completo      |
| `usuarios`          | ✅ Completo      |
| `inventario`        | 🚧 En desarrollo |
| `pos`               | 🚧 En desarrollo |
| `reportes`          | 🚧 En desarrollo |

---

## Estructura de carpetas

```
src/app/
├── core/
│   ├── services/          # Servicios globales (ver abajo)
│   ├── guards/            # auth, public, role, pending-changes
│   └── utils/             # date.util.ts
├── features/              # Módulos (cada uno tiene pages/, services/, models/, components/)
├── shared/
│   ├── components/        # sidebar, under-construction
│   └── directives/        # currency-input, numbers-only, scroll-reset
└── environments/
    ├── environment.example.ts   # Plantilla (en git)
    └── environment.ts           # Credenciales reales (en .gitignore)
```

---

## Servicios core — cuándo usar cada uno

| Servicio                  | Uso                                                         |
| ------------------------- | ----------------------------------------------------------- |
| `SupabaseService`         | Todas las queries y auth. Usar siempre `.call()` o `.rpc()` |
| `UiService`               | Loading, toasts, alertas, confirmaciones                    |
| `CurrencyService`         | Formateo de moneda (no formatear manualmente)               |
| `StorageService`          | Capacitor Preferences (datos locales persistentes)          |
| `GananciasService`        | Lógica de comisiones recargas virtuales                     |
| `RecargasVirtualesService`| Operaciones de saldo celular/bus                            |
| `LoggerService`           | Logs estructurados (no usar console.log directo)            |
| `NetworkService`          | Estado de conectividad                                      |

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
import { closeOutline, addOutline } from 'ionicons/icons';

constructor() {
  addIcons({ closeOutline, addOutline });
}
```
> **Importante:** antes de borrar un icono de `addIcons()`, buscar su nombre string en los `.html` del componente. Los bindings `[name]="variable"` no aparecen en análisis estático.

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

---

## Funciones PostgreSQL — convenciones

- Nombre con prefijo `fn_`: `fn_ejecutar_cierre_diario`, `fn_registrar_operacion_manual`
- Retornan `JSON` con resultado detallado
- `SECURITY DEFINER` + `SET search_path = public` (obligatorio para evitar caída de permisos)
- `GRANT EXECUTE ... TO authenticated; GRANT EXECUTE ... TO anon;`
- Finalizar con `NOTIFY pgrst, 'reload schema';`
- Documentar las funciones en `docs/<modulo>/sql/functions/`

---

## Reglas críticas

### Fechas — NUNCA `toISOString()`
```typescript
// ❌ Da fecha UTC (puede ser el día anterior en América)
new Date().toISOString().split('T')[0]

// ✅ Siempre usar esto (en date.util.ts o copiado en el servicio)
getFechaLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
```

### Imágenes — NUNCA foto a resolución completa
```typescript
// ✅ Siempre con límites (reduce de 5MB a ~300KB)
Camera.getPhoto({ quality: 80, width: 1200, height: 1600, correctOrientation: true });
```

### Configuración — NUNCA hardcodear valores de negocio
Los valores como `fondo_fijo_diario`, `caja_chica_transferencia_diaria` viven en la tabla `configuraciones`. Leerlos con query, no hardcodearlos en el código.

---

## Principios de UX del proyecto

- **Mínimo input del usuario**: si el sistema puede calcular algo, lo calcula. El usuario ingresa el mínimo posible.
- **Guías visuales para acciones físicas**: cuando hay que hacer algo con dinero físico (sobres, fondos), mostrar tarjetas visuales explicativas.
- **Wizards multi-paso**: indicador "Paso X de Y" + barra de progreso + paso de resumen antes de confirmar.
- **Campo principal**: clase `.destacado` (border primary + box-shadow).

---

## Nombres de cajas (UI vs BD)

| Código BD    | Nombre en UI | Subtítulo       |
| ------------ | ------------ | --------------- |
| `CAJA`       | Tienda       | Efectivo        |
| `CAJA_CHICA` | Varios       | Gastos menores  |
| `CAJA_CELULAR` | Celular    | Saldo digital   |
| `CAJA_BUS`   | Bus          | Saldo digital   |

> No renombrar los códigos de BD. Solo los labels de UI difieren.

---

## No hacer

- No usar `new Date().toISOString()` para fechas locales
- No subir fotos a resolución completa
- No hardcodear valores de negocio en código
- No hacer múltiples INSERT/UPDATE sueltos para operaciones relacionadas → usar función SQL
- No usar constructor para inyección de dependencias → usar `inject()`
- No crear componentes sin `standalone: true`
- No formatear moneda manualmente → usar `CurrencyService`
- No mostrar `console.log` en producción → usar `LoggerService`

---

## Documentación por módulo

| Módulo              | Doc principal                                              |
| ------------------- | ---------------------------------------------------------- |
| Dashboard           | `docs/dashboard/DASHBOARD-README.md`                       |
| Auth                | `docs/auth/AUTH-README.md`                                 |
| Recargas Virtuales  | `docs/recargas-virtuales/RECARGAS-VIRTUALES-README.md`     |
| Gastos Diarios      | `docs/gastos-diarios/GASTOS-DIARIOS-README.md`             |
| Core/Servicios      | `docs/core/CORE-README.md`                                 |
| Sistema de diseño   | `docs/DESIGN.md`                                           |
| Schema BD           | `docs/schema.sql`                                          |
