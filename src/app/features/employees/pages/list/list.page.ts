import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonButtons, IonMenuButton } from '@ionic/angular/standalone';
import { EmployeeService } from '../../services/employee.service';
import { Employee } from '../../models/employee.model';

@Component({
  selector: 'app-list',
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonButtons,
    IonMenuButton
  ]
})
export class ListPage implements OnInit {
  private employeeService = inject(EmployeeService);

  employees: Employee[] = [];

  ngOnInit() {
    this.loadEmployees();
  }

  async loadEmployees() {
    const data = await this.employeeService.getAll();
    if (data) {
      this.employees = data;
    }
  }
}
