import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
  IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonIcon, IonButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, cashOutline, phonePortraitOutline, busOutline,
  chevronForwardOutline, chevronDownOutline, checkmarkCircle, timeOutline,
  flashOutline, arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
  receiptOutline, calculatorOutline, lockClosedOutline, lockOpenOutline,
  informationCircleOutline, clipboardOutline
} from 'ionicons/icons';
import { ScrollablePage } from '@core/pages/scrollable.page';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
    IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle, IonCardContent,
    IonGrid, IonRow, IonCol, IonIcon, IonButton
  ]
})
export class HomePage extends ScrollablePage {
  private router = inject(Router);

  cajaAbierta = true;
  fechaActual = '29 Enero 2026';
  horaApertura = '7:00 AM';
  empleadoApertura = 'Carlos M.';

  saldos = {
    caja: 1250.50,
    cajaChica: 320.00,
    celular: 480.75,
    bus: 150.00
  };

  constructor() {
    super();
    addIcons({
      walletOutline, cashOutline, phonePortraitOutline, busOutline,
      chevronForwardOutline, chevronDownOutline, checkmarkCircle, timeOutline,
      flashOutline, arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
      receiptOutline, calculatorOutline, lockClosedOutline, lockOpenOutline,
      informationCircleOutline, clipboardOutline
    });
  }

  getTotalEfectivo(): number {
    return this.saldos.caja + this.saldos.cajaChica + this.saldos.celular + this.saldos.bus;
  }

  handleRefresh(event: any) {
    setTimeout(() => {
      event.target.complete();
    }, 1500);
  }

  onSaldoClick(tipo: string) {
    console.log('Saldo click:', tipo);
  }

  onOperacion(tipo: string) {
    console.log('Operación:', tipo);
  }

  onCuadre() {
    console.log('Cuadre de caja');
  }

  onCerrarDia() {
    this.router.navigate(['/home/cierre-diario']);
  }

  onAbrirDia() {
    console.log('Abrir día');
  }
}
