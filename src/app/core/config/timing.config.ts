/**
 * Constantes de timing técnicas usadas a lo largo de la app.
 * Valores **operacionales**, no de negocio — esos viven en `configuraciones`
 * (tabla BD) y se leen vía `ConfigService`.
 */
export const TIMING = {
  /** Umbral en segundos para refrescar proactivamente el JWT al volver del background. */
  jwtRefreshUmbralSegundos: 300,

  /** Debounce default para inputs de búsqueda (ms). */
  searchDebounceMs: 500,

  /** Debounce para inputs de búsqueda en POS (más conservador, evita queries por keystroke). */
  posSearchDebounceMs: 600,

  /** Delay del debounce de hideLoading() para no parpadear entre overlays consecutivos (ms). */
  hideLoadingDebounceMs: 50,

  /** Throttle entre intentos de refreshSessionOnResume (ms). */
  resumeRefreshThrottleMs: 30_000,
} as const;
