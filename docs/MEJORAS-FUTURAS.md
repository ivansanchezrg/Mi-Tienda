# Mejoras Futuras — Mi Tienda

Mejoras identificadas en auditoría profesional (2026-03-25).
No son urgentes para el contexto actual (app interna, 1 tienda, 1-2 usuarios), pero vale la pena considerarlas si el proyecto crece.

---

## 1. Change Detection — OnPush

**Qué es:** Angular re-evalúa todos los bindings de un componente cada vez que algo cambia en la app. Con `OnPush`, solo re-evalúa cuando cambian los `@Input()` o se dispara un evento del template.

**Beneficio:** Menos re-renders → más fluidez en Android, especialmente en listas largas (inventario, ventas, kardex).

**Cómo aplicar:**
```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
```

**Consideraciones:**
- Requiere usar `signal()` o `BehaviorSubject` + `async` pipe para datos reactivos
- Los `this.loading = true` directos no disparan re-render → hay que usar `ChangeDetectorRef.markForCheck()` o migrar a signals
- Aplicar gradualmente, empezando por componentes de lista (tarjetas, items)

**Prioridad:** Baja. Solo si se notan problemas de rendimiento en listas con 100+ items.

---

## 2. Testing — Unit Tests

**Qué falta:** El proyecto no tiene tests. Para una app interna con 1-2 usuarios, el testing manual es suficiente.

**Si se decide agregar:**
- Empezar por servicios core (`CurrencyService`, `date.util.ts`) — lógica pura, fácil de testear
- Funciones SQL críticas: `fn_ejecutar_cierre_diario`, `fn_registrar_operacion_manual` — usar pgTAP o tests manuales con transacciones
- NO testear componentes UI ni modales (costo/beneficio muy bajo para este proyecto)

**Prioridad:** Baja. Solo si se agregan más desarrolladores o la lógica financiera se vuelve más compleja.

---

## 3. Accesibilidad (a11y)

**Estado actual:** La app usa componentes Ionic que ya incluyen ARIA roles básicos. No se ha hecho auditoría formal.

**Mejoras posibles:**
- `aria-label` en botones de solo icono (FABs, botón cerrar modal)
- `aria-live="polite"` en totalizadores que cambian (total POS, saldo de caja)
- Contraste de colores en textos secundarios (gris sobre blanco)

**Prioridad:** Muy baja. La app es de uso interno con usuarios conocidos. Considerar si se publica en Play Store.

---

## 4. switchMap para búsquedas

**Qué es:** Cuando el usuario escribe rápido en un campo de búsqueda, `switchMap` cancela la petición anterior antes de lanzar la nueva. Con el patrón actual (`debounceTime` + `subscribe`), si el usuario escribe "abc" rápido, se lanzan 3 queries y solo importa la última.

**Dónde aplicar:** Búsqueda en inventario, búsqueda en ventas.

**Ejemplo:**
```typescript
this.searchControl.valueChanges.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(term => this.servicio.buscar(term))
).subscribe(results => this.items = results);
```

**Prioridad:** Baja. Con `debounceTime(300)` el problema es mínimo. Solo si se nota lag en búsquedas con muchos productos.

---

## 5. Cola offline

**Qué es:** Guardar operaciones localmente cuando no hay internet y sincronizar cuando se recupera la conexión.

**Estado actual:** `NetworkService` detecta conectividad y muestra banner, pero las operaciones fallan si no hay internet.

**Complejidad:** Alta. Requiere:
- Base de datos local (SQLite via Capacitor)
- Cola de operaciones pendientes
- Resolución de conflictos al sincronizar
- UI para mostrar operaciones pendientes

**Prioridad:** Muy baja. La tienda tiene WiFi estable. Solo considerar si se expande a múltiples tiendas o vendedores ambulantes.

---

## 6. Lazy loading de imágenes

**Qué es:** Cargar imágenes de comprobantes solo cuando son visibles en pantalla.

**Estado actual:** Las imágenes se cargan con signed URLs de Supabase Storage. No hay lazy loading explícito.

**Cómo aplicar:** `loading="lazy"` en `<img>` tags o usar `IntersectionObserver`.

**Prioridad:** Baja. Solo relevante en páginas que muestren muchos comprobantes (historial de operaciones).

---

## 7. Manejo de errores global — ErrorHandler

**Qué es:** Angular permite un `ErrorHandler` global que captura excepciones no manejadas.

**Estado actual:** Cada componente/servicio maneja sus propios errores con try/catch + `UiService.showError()`. `LoggerService` registra errores en archivo.

**Mejora:** Un `ErrorHandler` global que envíe errores no capturados a `LoggerService` automáticamente:
```typescript
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private logger = inject(LoggerService);
  handleError(error: any) {
    this.logger.error('GLOBAL', 'Unhandled error', error);
  }
}
```

**Prioridad:** Media-baja. Útil para capturar errores que se escapan de los try/catch.

---

## Resumen de prioridades

| Mejora | Prioridad | Cuándo considerar |
|--------|-----------|-------------------|
| OnPush | Baja | Si hay lag en listas largas |
| Tests | Baja | Si se agregan desarrolladores |
| Accesibilidad | Muy baja | Si se publica en Play Store |
| switchMap | Baja | Si búsquedas son lentas |
| Cola offline | Muy baja | Si se expande a múltiples tiendas |
| Lazy images | Baja | Si hay muchos comprobantes |
| ErrorHandler global | Media-baja | Siguiente iteración de calidad |
