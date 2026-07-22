import { Injectable, inject, NgZone } from '@angular/core';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';
import { UiService } from './ui.service';

/**
 * Texto helper unificado para todos los inputs de código de barras en estado vacío.
 * Varía según si la plataforma tiene cámara/scanner (móvil/tablet) o no (web).
 * Reutilizado en producto-info-form, presentacion-modal y donde se capture un código.
 */
export function getBarcodeInputHint(): string {
    return Capacitor.isNativePlatform()
        ? 'Si lo dejas vacío, se generará un código automáticamente. También puedes escanear o ingresar uno manualmente.'
        : 'Si lo dejas vacío, se generará un código automáticamente. También puedes ingresarlo manualmente.';
}

/** Formatos estándar usados en toda la app (productos, presentaciones, QR de bus) */
const FORMATOS_DEFAULT: BarcodeFormat[] = [
    BarcodeFormat.Ean13,
    BarcodeFormat.Ean8,
    BarcodeFormat.Code128,
    BarcodeFormat.UpcA,
    BarcodeFormat.UpcE,
    BarcodeFormat.Code39,
    BarcodeFormat.QrCode,
];

/**
 * Área de detección en píxeles CSS (coordenadas de `getBoundingClientRect()`).
 * Solo se aceptan códigos cuyo centro caiga dentro de este rectángulo — el resto de la
 * cámara (que es fullscreen) se ignora. Devolverla desde un callback permite recalcularla
 * en cada lectura (el marco no cambia, pero así no se captura un rect obsoleto si rota).
 */
export interface AreaDeteccion {
    x: number;
    y: number;
    width: number;
    height: number;
}

@Injectable({ providedIn: 'root' })
export class BarcodeScannerService {

    readonly isAvailable = Capacitor.isNativePlatform();

    private ngZone = inject(NgZone);
    private ui = inject(UiService);

    private audioCtx: AudioContext | null = null;

    /** true mientras hay una sesión de escaneo activa (one-shot o continua) */
    private _scanning = false;

    get isScanning(): boolean {
        return this._scanning;
    }

    // ─────────────────────────────────────────────────────────────
    // scan() — escanea un solo código y cierra automáticamente.
    // Usado en: producto-form, presentacion-modal, inventario-lista.
    // Retorna el código leído, o null si falló/canceló.
    // ─────────────────────────────────────────────────────────────
    async scan(formats: BarcodeFormat[] = FORMATOS_DEFAULT): Promise<string | null> {
        const granted = await this.pedirPermiso();
        if (!granted) return null;

        // Si hay una sesión activa previa (ej: doble tap), limpiarla primero
        if (this._scanning) await this.detener();

        this._scanning = true;
        this.activarOverlay();

        return new Promise<string | null>(async (resolve) => {
            try {
                await BarcodeScanner.addListener('barcodesScanned', (event) => {
                    this.ngZone.run(async () => {
                        const codigo = event.barcodes[0]?.rawValue;
                        if (!codigo) return;
                        this.feedback();
                        await this.detener();
                        resolve(codigo);
                    });
                });
                await BarcodeScanner.startScan({ formats });
            } catch {
                await this.detener();
                resolve(null);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // startContinuous() — queda abierto escaneando múltiples códigos.
    // Usado en: POS (escaneo continuo de productos al carrito).
    // El llamador es responsable de llamar stop() cuando termina.
    // ─────────────────────────────────────────────────────────────
    async startContinuous(
        onScan: (codigo: string) => void,
        formats: BarcodeFormat[] = FORMATOS_DEFAULT,
        areaProvider?: () => AreaDeteccion | null
    ): Promise<boolean> {
        const granted = await this.pedirPermiso();
        if (!granted) return false;

        // Si hay una sesión activa previa (ej: doble tap en botón escáner), limpiarla primero
        if (this._scanning) await this.detener();

        this._scanning = true;
        this.activarOverlay();

        try {
            await BarcodeScanner.addListener('barcodesScanned', (event) => {
                // Detection area (opcional): la cámara es fullscreen, pero solo aceptamos
                // el código cuyo centro cae dentro del recuadro. Recorremos todos los
                // barcodes del frame y elegimos el PRIMERO que esté dentro — así un código
                // vecino fuera del marco no se cuela.
                const area = areaProvider?.() ?? null;
                const barcode = area
                    ? event.barcodes.find(b => this.centroDentroDelArea(b.cornerPoints, area))
                    : event.barcodes[0];

                const codigo = barcode?.rawValue;
                if (!codigo) return;
                this.ngZone.run(() => onScan(codigo));
            });
            await BarcodeScanner.startScan({ formats });
            return true;
        } catch {
            await this.detener();
            return false;
        }
    }

    /**
     * ¿El centro del código (promedio de sus 4 cornerPoints) cae dentro del área?
     *
     * Los cornerPoints llegan del plugin normalizados a **píxeles FÍSICOS de pantalla**
     * (verificado en el código nativo Android: normalizeCornerPoints escala la imagen al
     * tamaño de pantalla en displayMetrics.widthPixels/heightPixels). El área llega en
     * **píxeles CSS lógicos** (getBoundingClientRect). Se convierte CSS→físico multiplicando
     * por devicePixelRatio para comparar en el mismo espacio.
     *
     * Sin cornerPoints (no debería pasar en nativo con startScan) → true, para no
     * bloquear el escaneo por un dato faltante.
     */
    private centroDentroDelArea(
        cornerPoints: [[number, number], [number, number], [number, number], [number, number]] | undefined,
        area: AreaDeteccion
    ): boolean {
        if (!cornerPoints || cornerPoints.length < 4) return true;

        const cx = (cornerPoints[0][0] + cornerPoints[1][0] + cornerPoints[2][0] + cornerPoints[3][0]) / 4;
        const cy = (cornerPoints[0][1] + cornerPoints[1][1] + cornerPoints[2][1] + cornerPoints[3][1]) / 4;

        const dpr = window.devicePixelRatio || 1;
        const left   = area.x * dpr;
        const top    = area.y * dpr;
        const right  = (area.x + area.width) * dpr;
        const bottom = (area.y + area.height) * dpr;

        return cx >= left && cx <= right && cy >= top && cy <= bottom;
    }

    // ─────────────────────────────────────────────────────────────
    // stop() — cierra el scanner desde afuera (POS al cerrar overlay).
    // ─────────────────────────────────────────────────────────────
    async stop(): Promise<void> {
        await this.detener();
    }

    // ─────────────────────────────────────────────────────────────
    // Internos
    // ─────────────────────────────────────────────────────────────

    private async pedirPermiso(): Promise<boolean> {
        const { camera } = await BarcodeScanner.requestPermissions();
        if (camera !== 'granted') {
            this.ui.showToast('Permiso de cámara denegado', 'warning');
            return false;
        }
        return true;
    }

    private activarOverlay(): void {
        document.body.classList.add('scanner-active');
    }

    private async detener(): Promise<void> {
        this._scanning = false;
        // Revelar el WebView PRIMERO: quitar `scanner-active` devuelve el body a opaco al
        // instante, así el catálogo (o la página que cerró el escáner) reaparece sin esperar
        // a que la cámara nativa se apague. La cámara sigue detrás un microsegundo, pero ya
        // tapada por el body opaco — sin flash. Antes esto iba al final, tras dos awaits
        // nativos (removeAllListeners + stopScan), y ese lag se percibía al volver al POS.
        document.body.classList.remove('scanner-active');
        await BarcodeScanner.removeAllListeners();
        await BarcodeScanner.stopScan();
    }

    /** Vibración + beep — feedback al leer un código */
    feedback(): void {
        navigator.vibrate?.(40);
        this.playBeep();
    }

    private playBeep(): void {
        try {
            if (!this.audioCtx || this.audioCtx.state === 'closed') {
                this.audioCtx = new AudioContext();
            }
            const oscillator = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            oscillator.type = 'square';
            oscillator.frequency.value = 1000;
            gain.gain.value = 1.0;
            oscillator.connect(gain);
            gain.connect(this.audioCtx.destination);
            oscillator.start();
            oscillator.stop(this.audioCtx.currentTime + 0.12);
        } catch { /* silencioso si falla */ }
    }
}
