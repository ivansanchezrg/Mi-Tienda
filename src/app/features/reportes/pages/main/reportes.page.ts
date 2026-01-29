import { Component } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton } from '@ionic/angular/standalone';
import { UnderConstructionComponent } from 'src/app/shared/components/under-construction/under-construction.component';

@Component({
  selector: 'app-reportes',
  templateUrl: './reportes.page.html',
  styleUrls: ['./reportes.page.scss'],
  standalone: true,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton, UnderConstructionComponent]
})
export class ReportesPage {}
