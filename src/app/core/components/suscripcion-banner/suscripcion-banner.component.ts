import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import { timeOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { NetworkService } from '@core/services/network.service';
import { AuthService } from '../../../features/auth/services/auth.service';
import { BannerComponent, BannerColor } from '@shared/components/banner/banner.component';
import { ROUTES } from '@core/config/routes.config';
import { EstadoSuscripcionResult } from '../../../features/suscripcion/models/suscripcion.model';

/**
 * Aviso preventivo "tu plan vence en X días". Consume el BannerComponent genérico.
 *
 * Se muestra solo cuando faltan ≤ UMBRAL días y la suscripción NO está bloqueada
 * (cuando está bloqueada no es un banner: es la pantalla completa del suscripcionGuard).
 * Tocar el banner lleva a "Mi Plan". El superadmin nunca lo ve.
 *
 * Ver docs/PLAN-PLANES-SUSCRIPCION.md §4.3.
 */
@Component({
  selector: 'app-suscripcion-banner',
  templateUrl: './suscripcion-banner.component.html',
  styleUrls: ['./suscripcion-banner.component.scss'],
  standalone: true,
  imports: [BannerComponent],
})
export class SuscripcionBannerComponent implements OnInit, OnDestroy {
  private suscripcion = inject(SuscripcionService);
  private network = inject(NetworkService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private sub = new Subscription();

  /** Días desde los cuales se muestra el aviso preventivo. */
  private readonly UMBRAL_DIAS = 7;

  estado: EstadoSuscripcionResult | null = null;
  online = true;

  // Clase en <body> para reservar el safe-area-top mientras el banner es visible
  // (mismo mecanismo que offline-banner). Distinta clase para no pisarse entre sí.
  private static readonly BODY_CLASS = 'suscripcion-banner-visible';

  constructor() {
    addIcons({ timeOutline });
  }

  ngOnInit() {
    // Reacciona a cambios del estado (ej. tras registrar un pago o cambiar de negocio).
    this.sub.add(
      this.suscripcion.estado$.subscribe(estado => {
        this.estado = estado;
        this.actualizarBodyClass();
      })
    );
    // Sin conexión, este aviso se oculta: gana el banner "sin conexión" (warning).
    // Sin red la app no puede procesar la renovación de todos modos → pedir "Renovar"
    // a alguien offline sería pedir una acción imposible. Al volver la red, reaparece.
    this.sub.add(
      this.network.getNetworkStatus().subscribe(online => {
        this.online = online;
        this.actualizarBodyClass();
      })
    );
    // Reacciona a cambios de usuario:
    //  - con negocio activo (no superadmin) → carga el estado.
    //  - sin usuario / sin negocio (login, onboarding, logout) → limpia el estado
    //    para que el banner desaparezca de inmediato. Sin esto, al cerrar sesión el
    //    `estado` quedaba obsoleto y el banner seguía visible en /auth/login.
    this.sub.add(
      this.auth.usuarioActual$.subscribe(usuario => {
        if (usuario?.negocio_id && !usuario.es_superadmin) {
          void this.suscripcion.getEstado();
        } else {
          this.estado = null;
          this.actualizarBodyClass();
        }
      })
    );
  }

  /**
   * Visible si: hay un usuario con negocio activo (no superadmin), hay conexión,
   * hay estado no bloqueado (TRIAL/ACTIVA) y faltan ≤ umbral días.
   * Exigir el usuario con negocio garantiza que NUNCA se muestre en login/onboarding/
   * logout (no es contenido de la app del negocio). Sin red se oculta (gana el offline).
   */
  get visible(): boolean {
    const usuario = this.auth.usuarioActualValue;
    if (!usuario?.negocio_id || usuario.es_superadmin) return false;
    if (!this.online) return false;
    const e = this.estado;
    if (!e || !e.tiene_suscripcion || e.bloqueada) return false;
    if (e.dias_restantes === undefined) return false;
    return e.dias_restantes <= this.UMBRAL_DIAS;
  }

  /** True cuando el vencimiento es inminente (hoy o mañana) → sube la urgencia visual. */
  get urgente(): boolean {
    return (this.estado?.dias_restantes ?? 0) <= 1;
  }

  /**
   * Rojo (danger) si es inminente; azul (primary) si es un recordatorio preventivo.
   * NO usa warning: ese color es exclusivo del aviso "sin conexión" (offline-banner).
   * Mantener un color por tipo de evento evita que el usuario confunda dos avisos
   * distintos, y que coincidan dos franjas idénticas si se muestran a la vez.
   */
  get color(): BannerColor {
    return this.urgente ? 'danger' : 'primary';
  }

  /** CTA más enfático cuando es inminente. */
  get accionTexto(): string {
    return this.urgente ? 'Renovar ahora' : 'Renovar';
  }

  get texto(): string {
    const dias = this.estado?.dias_restantes ?? 0;
    if (dias <= 0) return 'Tu plan vence hoy. Renueva para no perder acceso.';
    if (dias === 1) return 'Tu plan vence mañana. Renueva para no perder acceso.';
    return `Tu plan vence en ${dias} días. Renueva para no perder acceso.`;
  }

  private actualizarBodyClass() {
    document.body.classList.toggle(SuscripcionBannerComponent.BODY_CLASS, this.visible);
  }

  irAMiPlan() {
    this.router.navigate([ROUTES.suscripcion]);
  }

  ngOnDestroy() {
    document.body.classList.remove(SuscripcionBannerComponent.BODY_CLASS);
    this.sub.unsubscribe();
  }
}
