import { Component, Input, OnInit, OnDestroy, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, barcodeOutline, saveOutline, documentTextOutline, scanOutline } from 'ionicons/icons';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

import { Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { InventarioService } from '../../services/inventario.service';
import { KardexModalComponent } from '../kardex-modal/kardex-modal.component';

// Directivas y Servicios de utilidad del Core/Shared
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';

@Component({
    selector: 'app-producto-modal',
    templateUrl: './producto-modal.component.html',
    styleUrls: ['./producto-modal.component.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule, ReactiveFormsModule, NumbersOnlyDirective, CurrencyInputDirective]
})
export class ProductoModalComponent implements OnInit, OnDestroy {
    @Input() producto?: Producto;
    @Input() categorias: CategoriaProducto[] = [];
    @Input() codigoBarrasInicial?: string;

    private modalCtrl = inject(ModalController);
    private fb = inject(FormBuilder);
    private inventarioService = inject(InventarioService);
    private currencyService = inject(CurrencyService);
    private ui = inject(UiService);
    private ngZone = inject(NgZone);

    productoForm!: FormGroup;
    escaneando = false;
    modo: 'CREAR' | 'EDITAR' = 'CREAR';

    private audioCtx: AudioContext | null = null;

    constructor() {
        addIcons({ closeOutline, barcodeOutline, saveOutline, documentTextOutline, scanOutline });
    }

    ngOnInit() {
        this.modo = this.producto ? 'EDITAR' : 'CREAR';
        this.initForm();
    }

    private initForm() {
        this.productoForm = this.fb.group({
            codigo_barras: [this.codigoBarrasInicial || this.producto?.codigo_barras || ''],
            nombre: [this.producto?.nombre || '', [Validators.required, Validators.minLength(3)]],
            categoria_id: [this.producto?.categoria_id || null],
            precio_costo: [this.producto?.precio_costo || '', [Validators.required]],
            precio_venta: [this.producto?.precio_venta || '', [Validators.required]],
            stock_actual: [this.producto?.stock_actual || '', [Validators.required]],
            stock_minimo: [this.producto?.stock_minimo || 5, [Validators.required]],
            tiene_iva: [this.producto?.tiene_iva || false]
        });
    }

    cerrar(data?: Producto) {
        this.modalCtrl.dismiss(data);
    }

    async guardar() {
        if (this.productoForm.invalid) {
            this.productoForm.markAllAsTouched();
            return;
        }

        const value = this.productoForm.value;
        const codigoBarras = value.codigo_barras?.trim() ? value.codigo_barras.trim() : null;

        // El CurrencyInputDirective puede devolver strings "1,200.50". 
        // Usamos el currencyService.parse para asegurar que viajan a la BD como tipo numérico Double.
        const productoPayload: Partial<Producto> = {
            ...value,
            codigo_barras: codigoBarras,
            precio_costo: this.currencyService.parse(value.precio_costo),
            precio_venta: this.currencyService.parse(value.precio_venta),
            stock_actual: Number(value.stock_actual) || 0,
            stock_minimo: Number(value.stock_minimo) || 0,
            activo: this.producto?.activo ?? true
        };

        try {
            let result: Producto;
            if (this.modo === 'CREAR') {
                result = await this.inventarioService.crearProducto(productoPayload);
            } else {
                result = await this.inventarioService.actualizarProducto(this.producto!.id, productoPayload);
            }
            this.cerrar(result);
        } catch (error) {
            console.error('Error guardando producto', error);
        }
    }

    async abrirKardex() {
        if (!this.producto) return;

        const modal = await this.modalCtrl.create({
            component: KardexModalComponent,
            componentProps: {
                productoId: this.producto.id,
                productoNombre: this.producto.nombre
            }
        });
        await modal.present();
    }

    async escanearCodigo() {
        const { camera } = await BarcodeScanner.requestPermissions();
        if (camera !== 'granted') {
            this.ui.showToast('Permiso de cámara denegado', 'warning');
            return;
        }

        this.escaneando = true;
        document.body.classList.add('scanner-active');

        try {
            await BarcodeScanner.addListener('barcodesScanned', (event) => {
                this.ngZone.run(async () => {
                    const codigo = event.barcodes[0]?.rawValue;
                    if (!codigo) return;
                    // Feedback: vibración + beep
                    navigator.vibrate?.(40);
                    this.playBeep();
                    // Captura automática: carga al input y cierra
                    this.productoForm.patchValue({ codigo_barras: codigo });
                    this.ui.showToast(`Código capturado: ${codigo}`, 'success');
                    await this.cerrarEscaner();
                });
            });
            await BarcodeScanner.startScan();
        } catch {
            await this.cerrarEscaner();
        }
    }

    async cerrarEscaner() {
        await BarcodeScanner.removeAllListeners();
        await BarcodeScanner.stopScan();
        document.body.classList.remove('scanner-active');
        this.escaneando = false;
    }

    esCampoInvalido(campo: string): boolean {
        const control = this.productoForm.get(campo);
        return !!(control && control.invalid && (control.dirty || control.touched));
    }

    private playBeep() {
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

    ngOnDestroy() {
        if (this.escaneando) this.cerrarEscaner();
        this.audioCtx?.close().catch(() => {});
    }
}

