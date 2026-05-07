import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface PeriodOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-period-filter',
  templateUrl: './period-filter.component.html',
  styleUrls: ['./period-filter.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class PeriodFilterComponent {
  @Input() options: PeriodOption[] = [];
  @Input() selected: string = '';
  @Input() label: string = '';
  @Output() selectionChange = new EventEmitter<string>();

  onSelect(value: string) {
    if (value === this.selected) return;
    this.selectionChange.emit(value);
  }
}
