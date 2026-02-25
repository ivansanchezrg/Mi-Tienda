# Actualización de UI sin Recarga de Página — Referencia Técnica

## ¿Qué es?

Patrón que usan todas las páginas del dashboard para **actualizar la UI después de una operación exitosa sin recargar la página** (sin `router.navigate` ni `location.reload`). El usuario ve los datos actualizados de forma inmediata.

---

## 1. Patrón principal

Después de cualquier operación exitosa, se llama `cargarDatos()` para re-consultar la BD. Angular detecta el cambio en las propiedades y actualiza el DOM automáticamente.

```
modal.onDidDismiss()
  └─ si role === 'confirm'
       └─ ejecutarOperacion(tipo, data)
            ├─ service.registrarOperacion(...)  →  guarda en BD
            └─ si success → cargarDatos()       →  actualiza UI
```

El `cargarDatos()` usa `Promise.all()` para consultar en paralelo: estado caja, saldos, último cierre y ganancias pendientes.

---

## 2. Gotcha: Supabase INSERT/UPDATE devuelve `data: null`

**Síntoma:** La operación se guarda en BD correctamente, pero la UI no se actualiza. Al recargar la página (F5) los datos aparecen bien.

**Causa:** Supabase devuelve `data: null` en INSERT/UPDATE por defecto (a menos que se agregue `.select()`). El helper `supabase.call()` retorna `response.data`, por lo que siempre retorna `null` en estos casos → el `if (success)` nunca se cumple → `cargarDatos()` nunca se ejecuta.

**Solución:** Para INSERT/UPDATE sin necesidad del registro devuelto, verificar `response.error` directamente en lugar de pasar por `supabase.call()`:

```typescript
async guardarDatos(): Promise<boolean> {
  const response = await this.supabase.client
    .from('tabla')
    .insert({ campo: 'valor' });

  if (response.error) return false;
  return true;  // ✅ no depende de response.data
}
```

Si se necesita el registro insertado, agregar `.select().single()`:

```typescript
const result = await this.supabase.call<MiTipo>(
  this.supabase.client.from('tabla').insert({ ... }).select().single(),
  'Guardado'
);
```

**Regla:**
- `SELECT` → usar `supabase.call()` (devuelve `data`)
- `INSERT/UPDATE` sin dato de retorno → verificar `error === null`
- `INSERT/UPDATE` con dato de retorno → agregar `.select()` al query
