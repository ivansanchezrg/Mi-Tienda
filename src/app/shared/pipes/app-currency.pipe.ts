import { Pipe, PipeTransform, inject } from '@angular/core';
import { CurrencyService } from '@core/services/currency.service';

@Pipe({ name: 'appCurrency', standalone: true, pure: true })
export class AppCurrencyPipe implements PipeTransform {
  private cs = inject(CurrencyService);

  transform(value: number | null | undefined): string {
    if (value == null) return '0.00';
    return this.cs.format(value);
  }
}
