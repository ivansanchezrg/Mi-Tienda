/**
 * Error lanzado por `conTimeout()` cuando la promesa no resuelve dentro del tope.
 * Se distingue de un error de red normal para que el caller pueda dar un mensaje
 * específico ("el servidor no respondió a tiempo") en vez del genérico.
 */
export class TimeoutError extends Error {
  constructor(message = 'La operación tardó demasiado en responder') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Envuelve una promesa con un tope de tiempo. Si `promise` no resuelve/rechaza
 * dentro de `ms`, la promesa devuelta rechaza con `TimeoutError`.
 *
 * Pensado para MUTACIONES críticas (abrir/cerrar turno) sobre red que puede estar
 * "conectada pero rota" (WiFi asociado sin respuesta): sin este tope el fetch se
 * cuelga hasta el timeout del sistema (30-60s+) y el spinner gira eterno.
 *
 * A diferencia del patrón fail-open de los guards (que resuelven un valor por
 * defecto al vencer el tope), aquí se RECHAZA a propósito: una mutación no puede
 * asumir éxito ni un valor neutro — el caller debe tratar el timeout como fallo
 * y ofrecer reintentar.
 *
 * Nota: `conTimeout` no cancela la request subyacente (el fetch sigue en vuelo hasta
 * que el sistema lo corte). Solo garantiza que el caller deje de esperar. Para las
 * mutaciones de turno esto es seguro porque son idempotentes a nivel de UX: si la
 * escritura llegó a completarse en el servidor, el siguiente refresh del estado del
 * turno lo reflejará; si no, el usuario reintenta.
 */
export function conTimeout<T>(promise: PromiseLike<T>, ms: number, mensaje?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(mensaje)), ms);

    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
