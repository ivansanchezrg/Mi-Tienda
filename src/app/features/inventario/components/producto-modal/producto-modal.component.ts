import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, barcodeOutline, saveOutline, documentTextOutline } from 'ionicons/icons';

import { Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { InventarioService } from '../../services/inventario.service';
import { KardexModalComponent } from '../kardex-modal/kardex-modal.component';

// Directivas y Servicios de utilidad del Core/Shared
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { CurrencyService } from '../../../../core/services/currency.service';

@Component({
    selector: 'app-producto-modal',
    templateUrl: './producto-modal.component.html',
    styleUrls: ['./producto-modal.component.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule, ReactiveFormsModule, NumbersOnlyDirective, CurrencyInputDirective]
})
export class ProductoModalComponent implements OnInit {
    @Input() producto?: Producto;
    @Input() categorias: CategoriaProducto[] = [];

    private modalCtrl = inject(ModalController);
    private fb = inject(FormBuilder);
    private inventarioService = inject(InventarioService);
    private currencyService = inject(CurrencyService);

    productoForm!: FormGroup;
    modo: 'CREAR' | 'EDITAR' = 'CREAR';

    constructor() {
        addIcons({ closeOutline, barcodeOutline, saveOutline, documentTextOutline });
    }

    ngOnInit() {
        this.modo = this.producto ? 'EDITAR' : 'CREAR';
        this.initForm();
    }

    private initForm() {
        this.productoForm = this.fb.group({
            codigo_barras: [this.producto?.codigo_barras || ''],
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
            },
            cssClass: 'modal-fullscreen-mobile'
        });
        await modal.present();
    }

    esCampoInvalido(campo: string): boolean {
        const control = this.productoForm.get(campo);
        return !!(control && control.invalid && (control.dirty || control.touched));
    }
}

