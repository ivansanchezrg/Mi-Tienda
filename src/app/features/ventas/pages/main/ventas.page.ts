import { Component } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton } from '@ionic/angular/standalone';
import { UnderConstructionComponent } from 'src/app/shared/components/under-construction/under-construction.component';

@Component({
  selector: 'app-ventas',
  templateUrl: './ventas.page.html',
  styleUrls: ['./ventas.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton, UnderConstructionComponent]
})
export class VentasPage {}
