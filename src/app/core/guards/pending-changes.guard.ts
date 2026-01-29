import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { AlertController } from '@ionic/angular/standalone';

export interface HasPendingChanges {
  hasPendingChanges: () => boolean;
  resetState: () => void;
}

export const pendingChangesGuard: CanDeactivateFn<HasPendingChanges> = async (component) => {
  // Si el componente dice que no tiene cambios pendientes, permitir salida
  if (!component.hasPendingChanges()) {
    return true;
  }

  // Si hay cambios, mostrar alerta de confirmación
  const alertCtrl = inject(AlertController);
  const alert = await alertCtrl.create({
    header: '¿Salir del Cierre?',
    message: 'Si sales ahora, se perderán los datos que has ingresado. ¿Estás seguro?',
    buttons: [
      {
        text: 'Cancelar',
        role: 'cancel'
      },
      {
        text: 'Salir',
        role: 'destructive'
      }
    ]
  });

  await alert.present();
  const { role } = await alert.onDidDismiss();

  // Si el usuario confirma la salida, limpiamos el estado antes de irnos
  if (role === 'destructive') {
    component.resetState();
    return true;
  }

  return false;
};
