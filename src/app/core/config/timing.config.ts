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

  /**
   * Tiempo mínimo en background (ms) para que el home se refresque solo al
   * reanudar la app con proceso vivo. Por debajo de este umbral no se refetchea:
   * los switches rápidos entre apps no ameritan re-query (el Realtime ya cubre
   * los cambios de saldos entre medio).
   */
  resumeHomeRefreshMinMs: 60_000,
} as const;
