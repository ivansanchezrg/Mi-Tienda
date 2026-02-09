import { Injectable } from '@angular/core';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { BehaviorSubject, Observable, interval } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NetworkService {
  private isOnline$ = new BehaviorSubject<boolean>(true);
  private initialized = false;
  private pollingInterval: any;

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
      this.isOnline$.next(status.connected);
    });

    // Verificar estado cuando la app vuelve del background
    App.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        await this.checkConnection();
      }
    });

    // Polling cada 5 segundos como fallback (solo en Android/iOS)
    this.startPolling();
  }

  /**
   * Inicia polling periódico para verificar conexión
   */
  private startPolling() {
    // Verificar cada 5 segundos
    this.pollingInterval = setInterval(async () => {
      await this.checkConnection();
    }, 5000);
  }

  /**
   * Detiene el polling
   */
  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
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
