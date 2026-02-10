import { Component, inject, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
  ModalController, ActionSheetController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, cameraOutline, closeCircle, imagesOutline } from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { GastoModalResult, CategoriaGasto } from '../../models/gasto-diario.model';
import { GastosDiariosService } from '../../services/gastos-diarios.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

@Component({
  selector: 'app-gasto-modal',
  templateUrl: './gasto-modal.component.html',
  styleUrls: ['./gasto-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonSpinner,
    CurrencyInputDirective,
    NumbersOnlyDirective
  ]
})
export class GastoModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private fb = inject(FormBuilder);
  private actionSheetCtrl = inject(ActionSheetController);
  private cdr = inject(ChangeDetectorRef);
  private gastosService = inject(GastosDiariosService);

  form!: FormGroup;
  fotoComprobante: string | null = null; // URL de la foto cargada
  categorias: CategoriaGasto[] = [];
  cargandoCategorias = true;

  constructor() {
    addIcons({ closeOutline, cameraOutline, closeCircle, imagesOutline });

    // Crear form inmediatamente (síncrono)
    this.form = this.fb.group({
      categoria_gasto_id: [null, Validators.required],
      monto: [null, [Validators.required, Validators.min(0.01)]],
      observaciones: ['']
    });
  }

  async ngOnInit() {
    await this.cargarCategorias();
  }

  async cargarCategorias() {
    this.cargandoCategorias = true;
    this.categorias = await this.gastosService.getCategorias();
    this.cargandoCategorias = false;
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async seleccionarFoto() {
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Seleccionar comprobante',
      buttons: [
        {
          text: 'Tomar foto',
          icon: 'camera-outline',
          handler: () => {
            this.tomarFoto(CameraSource.Camera);
          }
        },
        {
          text: 'Seleccionar de galería',
          icon: 'images-outline',
          handler: () => {
            this.tomarFoto(CameraSource.Photos);
          }
        },
        {
          text: 'Cancelar',
          icon: 'close',
          role: 'cancel'
        }
      ]
    });

    await actionSheet.present();
  }

  async tomarFoto(source: CameraSource) {
    try {
      const image = await Camera.getPhoto({
        quality: 80,              // Calidad 80% (buen balance calidad/tamaño)
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source,
        width: 1200,              // Limitar ancho máximo a 1200px
        height: 1600,             // Limitar alto máximo a 1600px
        correctOrientation: true  // Corregir orientación (importante!)
      });

      this.fotoComprobante = image.dataUrl || null;
      this.cdr.detectChanges(); // Forzar detección de cambios para web
    } catch (error) {
      console.error('Error al tomar/seleccionar foto:', error);
      // Si el usuario cancela, no hacer nada
    }
  }

  removerFoto() {
    this.fotoComprobante = null;
    this.cdr.detectChanges(); // Forzar detección de cambios para web
  }

  confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const result: GastoModalResult = {
      categoria_gasto_id: this.form.value.categoria_gasto_id,
      monto: this.form.value.monto,
      observaciones: this.form.value.observaciones || '',
      fotoComprobante: this.fotoComprobante
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
