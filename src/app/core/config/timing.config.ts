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

  /**
   * Delay antes de disparar el priming del catálogo/clientes en el arranque
   * (Fase P — PLAN-OFFLINE-CALLE §2.9). El vendedor está en el local con WiFi,
   * no hay apuro de milisegundos — diferirlo evita competir por ancho de banda/CPU
   * con las queries del Home (fn_home_dashboard) justo en el instante más caliente
   * del arranque, en gama baja.
   */
  primingArranqueDeferMs: 6_000,

  /**
   * Frescura del priming del cache offline (catálogo/clientes/CF): si el último
   * snapshot tiene menos de este umbral, se salta la descarga. Evita bursts de red
   * en reconexiones frecuentes (red que parpadea offline↔online).
   */
  primingFrescuraMinutos: 12,

  /**
   * Tope de espera (ms) para las mutaciones críticas de turno (abrir / cerrar).
   * Con red "conectada pero rota" (WiFi asociado sin respuesta del servidor) el
   * fetch puede colgar hasta el timeout del sistema (30-60s+), dejando un spinner
   * eterno. Pasado este tope se corta con un mensaje claro para que el usuario
   * reintente, en vez de esperar indefinidamente. Ver conTimeout() en timeout.util.
   */
  turnoMutacionTimeoutMs: 20_000,
} as const;
