import { Injectable } from '@angular/core';
import { Network } from '@capacitor/network';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NetworkService {
  private isOnline$ = new BehaviorSubject<boolean>(true);
  private initialized = false;

  constructor() {
    this.initializeNetworkMonitoring();
  }

  /**
   * Inicializa el monitoreo de red
   */
  private async initializeNetworkMonitoring() {
    if (this.initialized) return;
    this.initialized = true;

    // Obtener estado inicial
    const status = await Network.getStatus();
    this.isOnline$.next(status.connected);

    // Escuchar cambios de estado
    Network.addListener('networkStatusChange', status => {
      console.log('Network status changed:', status.connected);
      this.isOnline$.next(status.connected);
    });
  }

  /**
   * Observable del estado de conexión
   * @returns Observable que emite true cuando hay internet, false cuando no
   */
  getNetworkStatus(): Observable<boolean> {
    return this.isOnline$.asObservable();
  }

  /**
   * Obtiene el estado actual de conexión (síncrono)
   * @returns true si hay internet, false si no
   */
  isConnected(): boolean {
    return this.isOnline$.value;
  }

  /**
   * Verifica el estado de conexión actual desde el plugin
   * @returns Promise con el estado de conexión
   */
  async checkConnection(): Promise<boolean> {
    const status = await Network.getStatus();
    this.isOnline$.next(status.connected);
    return status.connected;
  }
}
