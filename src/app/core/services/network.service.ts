import { Injectable } from '@angular/core';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
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

  private async initializeNetworkMonitoring() {
    if (this.initialized) return;
    this.initialized = true;

    const status = await Network.getStatus();
    this.isOnline$.next(status.connected);

    // Evento nativo del OS — reacciona al instante al cambiar de red
    Network.addListener('networkStatusChange', status => {
      this.isOnline$.next(status.connected);
    });

    // Re-verifica al volver del background (puede haber cambiado de red mientras estaba suspendida)
    App.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        const s = await Network.getStatus();
        this.isOnline$.next(s.connected);
      }
    });
  }

  getNetworkStatus(): Observable<boolean> {
    return this.isOnline$.asObservable();
  }

  isConnected(): boolean {
    return this.isOnline$.value;
  }
}
