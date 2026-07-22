import { Injectable, inject } from '@angular/core';
import { filter } from 'rxjs/operators';
import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { LoggerService } from './logger.service';
import { OutboxService, OutboxVenta } from './outbox.service';
import { OutboxClientesService, OutboxCliente } from './outbox-clientes.service';
import { AuthService } from '../../features/auth/services/auth.service';
import { CatalogoLocalService } from './catalogo-local.service';
import { ClientesLocalService } from './clientes-local.service';
import { ImagenLocalService } from './imagen-local.service';
import { InventarioService } from '../../features/inventario/services/inventario.service';
import { ClientesService } from '../../features/clientes/services/clientes.service';
import { ProductoPOS } from '../../features/inventario/models/producto.model';
import { TIMING } from '../config/timing.config';

/**
 * SyncService — drena la cola del OutboxService contra Supabase (§4.4 PLAN-OFFLINE-POS)
 * y precalienta el cache offline (Fase P, PLAN-OFFLINE-CALLE §2.9).
 *
 * Local-First: las ventas ya están en disco (OutboxService). Este servicio las empuja
 * al servidor cuando hay red, en orden FIFO estricto (el trigger de saldo de caja suma
 * cada venta EFECTIVO en orden de inserción — drenar fuera de orden descuadra el ledger).
 *
 * Disparo automático: al volver la red (NetworkService) y tras encolar. Manual: botón
 * "Sincronizar ahora". La idempotency_key hace el reenvío 100% seguro (un duplicado en el
 * servidor responde success).
 *
 * Clasificación de fallos:
 *   • Error de RED      → la venta queda PENDING, se reintenta luego (no se quema un intento real).
 *   • Error de DATOS    → ERROR (dead-letter): no se reintenta en loop, visible en tab Pendientes.
 *
 * Priming (Fase P): el catálogo POS y el Consumidor Final solo se cacheaban al entrar
 * al POS con red — si el vendedor abre turno y sale a la calle sin entrar al POS, la
 * calle queda sin catálogo. precalentarOffline() descarga catálogo+categorías+clientes+CF
 * en los momentos con red garantizada: arranque con sesión, reconexión y apertura de turno
 * (respaldo). Reutiliza los mismos ganchos de red/sesión que ya drenan el outbox — sin
 * infraestructura nueva.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
    private supabase       = inject(SupabaseService);
    private network        = inject(NetworkService);
    private logger         = inject(LoggerService);
    private outbox         = inject(OutboxService);
    private outboxClientes = inject(OutboxClientesService);
    private auth           = inject(AuthService);
    private catalogoLocal  = inject(CatalogoLocalService);
    private clientesLocal  = inject(ClientesLocalService);
    private imagenLocal    = inject(ImagenLocalService);
    private inventarioSvc  = inject(InventarioService);
    private clientesSvc    = inject(ClientesService);

    private sincronizando  = false;
    private primingEnCurso = false;

    constructor() {
        // Disparo automático al volver la red. El primer valor del BehaviorSubject puede
        // ser true (online), pero sincronizar() es no-op si la cola está vacía.
        // sincronizar() (drenar ventas/clientes pendientes) sí corre inmediato — es
        // trabajo que el usuario ya generó y espera ver reflejado cuanto antes.
        this.network.getNetworkStatus().subscribe(online => {
            if (!online) return;
            void this.sincronizar();

            // precalentarOffline() SIEMPRE diferido (mismo TIMING.primingArranqueDeferMs
            // que el arranque en frío de abajo) — sin esto, cada reconexión de red
            // (incluida la que dispara Android 1-3s después de reanudar del background,
            // justo el instante más caliente del resume) competía por ancho de banda/CPU
            // con fn_home_dashboard y el refresh del token en gama baja.
            setTimeout(() => void this.precalentarOffline(), TIMING.primingArranqueDeferMs);
        });

        // Arranque en frío: el contador del outbox nace en 0 y este servicio es lazy.
        // Sin esto, una cola que quedó de una sesión anterior (app cerrada con ventas
        // pendientes) ni se muestra en el badge ni se drena hasta que alguna página
        // inyecte el servicio. Al restaurarse la sesión (usuario con negocio activo):
        // hidratar el badge, drenar lo pendiente y precalentar el cache offline.
        this.auth.usuarioActual$
            .pipe(filter(u => !!u?.negocio_id))
            .subscribe(() => {
                void this.outbox.refrescarContador();
                void this.sincronizar();

                // Diferido: al arranque, el Home dispara fn_home_dashboard en el mismo
                // instante — no competir por ancho de banda/CPU con la RPC más pesada
                // de la app (el catálogo completo) justo ahí. El vendedor está en el
                // local con WiFi; unos segundos de diferencia no importan (§P.3).
                setTimeout(() => void this.precalentarOffline(), TIMING.primingArranqueDeferMs);
            });
    }

    /**
     * Descarga catálogo POS + categorías + clientes + Consumidor Final a disco, para
     * que el vendedor pueda salir a la calle sin depender de haber entrado antes al POS.
     * Best-effort — nunca lanza, nunca muestra toast (es trabajo en background que el
     * usuario no inició). Reentrante-seguro y salta si el cache ya es fresco.
     */
    async precalentarOffline(): Promise<void> {
        if (this.primingEnCurso) return;
        if (!this.network.isConnected()) return;
        if (!this.auth.usuarioActualValue?.negocio_id) return;

        this.primingEnCurso = true;
        try {
            const fresco = await this.esCacheFresco();
            if (fresco) return;

            // Independientes entre sí — un fallo en clientes no debe frenar el catálogo.
            await Promise.all([
                this.precalentarCatalogo(),
                this.precalentarClientes(),
            ]);
        } finally {
            this.primingEnCurso = false;
        }
    }

    /** True si el último priming del catálogo tiene menos de TIMING.primingFrescuraMinutos. */
    private async esCacheFresco(): Promise<boolean> {
        const timestamp = await this.catalogoLocal.obtenerTimestamp();
        if (!timestamp) return false;
        const minutos = (Date.now() - timestamp) / 60_000;
        return minutos < TIMING.primingFrescuraMinutos;
    }

    private async precalentarCatalogo(): Promise<void> {
        try {
            // obtenerProductosCatalogoPOS ya escribe cache_catalogo internamente cuando
            // corre online sin filtro (InventarioService — el write no es nuevo, solo
            // se invoca desde este momento adicional). obtenerConsumidorFinal cachea el
            // CF en localStorage con el mismo criterio online.
            const categorias = await this.inventarioSvc.obtenerCategorias();
            const catalogo = await this.inventarioSvc.obtenerProductosCatalogoPOS(undefined, categorias);
            await this.clientesSvc.obtenerConsumidorFinal();

            // Descargar los BINARIOS de las fotos a disco para que se vean offline tras un
            // cold start (el signedUrlCache es solo RAM y muere con el proceso). Best-effort,
            // en tandas — no bloquea el resto del priming.
            void this.precalentarImagenes(catalogo);
        } catch (err) {
            this.logger.error('SyncService', 'Error al precalentar catálogo/CF', err);
        }
    }

    /**
     * Extrae todos los paths de imagen del catálogo (SKU + template + presentaciones)
     * y los baja a disco.
     *
     * PÚBLICO (2026-07-13): también lo llama PosPage cada vez que carga el catálogo
     * online (carga inicial, ionViewWillEnter, pull-to-refresh). Sin ese hook, el POS
     * solo descargaba los binarios de las imágenes que llegaban a RENDERIZARSE (vía
     * resolveImageUrl → descarga en background del visible) — un producto nuevo creado
     * en Inventario quedaba en el cache SQLite del catálogo pero SIN binario si no se
     * pintó en pantalla, y en el próximo arranque offline aparecía sin foto. No usar
     * precalentarOffline() para esto: su gate de frescura (esCacheFresco) saltaría el
     * priming justo después de un refresh del catálogo (timestamp recién actualizado).
     * Barato cuando no hay imágenes nuevas: precargarCatalogo() compara contra el
     * índice en disco y solo descarga faltantes (tandas de 5, best-effort).
     */
    async precalentarImagenes(catalogo: ProductoPOS[]): Promise<void> {
        try {
            const paths: (string | null | undefined)[] = [];
            for (const p of catalogo) {
                paths.push(p.imagen_url);
                paths.push(p.producto_template?.imagen_url);
                for (const pres of p.presentaciones ?? []) paths.push(pres.imagen_url);
            }
            await this.imagenLocal.precargarCatalogo(paths);
        } catch (err) {
            this.logger.error('SyncService', 'Error al precalentar imágenes', err);
        }
    }

    private async precalentarClientes(): Promise<void> {
        try {
            const clientes = await this.clientesSvc.descargarSnapshotParaCache();
            await this.clientesLocal.guardar(clientes);
        } catch (err) {
            this.logger.error('SyncService', 'Error al precalentar clientes', err);
        }
    }

    /**
     * Drena las colas en orden FIFO. Reentrante-seguro: si ya hay un drenado en curso,
     * retorna sin duplicar. Se detiene al primer error de red (no tiene sentido seguir
     * intentando sin conexión) o al primer error de datos (preserva el orden FIFO).
     *
     * Orden entre colas (Fase D, §6.5.2): clientes ANTES que ventas, a completitud.
     * Una venta offline puede referenciar un cliente que también es offline — si se
     * drenara la venta primero, su clienteId (UUID local) aún no existiría en el
     * servidor → rechazo por FK. Drenar clientes primero garantiza que, cuando le toque
     * el turno a las ventas, todo clienteId que apunte a un cliente offline ya fue
     * creado (o remapeado) en el servidor.
     */
    async sincronizar(): Promise<void> {
        if (this.sincronizando) return;
        if (!this.network.isConnected()) return;

        this.sincronizando = true;
        try {
            await this.sincronizarClientes();
            if (!this.network.isConnected()) return; // se cayó la red entre colas

            const pendientes = await this.outbox.obtenerPendientes(); // ya viene FIFO
            for (const venta of pendientes) {
                if (!this.network.isConnected()) break; // se cayó la red a mitad de drenado

                const resultado = await this.empujarVenta(venta);
                if (resultado === 'red') break;   // cortar — el listener reintentará al volver la red
                if (resultado === 'datos') break; // cortar — mantener FIFO; la cola queda bloqueada en esta venta
                // 'ok' → continúa con la siguiente
            }
        } finally {
            this.sincronizando = false;
        }
    }

    /** Drena outbox_clientes a completitud, ANTES que las ventas (ver doc de sincronizar()). */
    private async sincronizarClientes(): Promise<void> {
        const pendientes = await this.outboxClientes.obtenerPendientes(); // ya viene FIFO
        for (const cliente of pendientes) {
            if (!this.network.isConnected()) break;

            const resultado = await this.empujarCliente(cliente);
            if (resultado === 'red') break;   // cortar — se reintenta al volver la red
            if (resultado === 'datos') break; // cortar — mantener FIFO; dead-letter visible en Pendientes
            // 'ok' → continúa con el siguiente
        }
    }

    /**
     * Empuja un cliente creado offline al servidor vía fn_upsert_cliente (Fase D).
     * Si el servidor reusó un registro existente (upsert por identificación, o
     * idempotencia por id en un reintento), remapea el clienteId en las ventas
     * encoladas que lo referenciaban — sin esto viajarían con un id que el servidor
     * nunca creó. Retorna 'ok' | 'red' | 'datos' para que el bucle decida si continuar.
     */
    private async empujarCliente(cliente: OutboxCliente): Promise<'ok' | 'red' | 'datos'> {
        await this.outboxClientes.marcarEstado(cliente.id, 'SYNCING');
        const p = cliente.payload;

        try {
            const { data, error } = await this.supabase.client.rpc('fn_upsert_cliente', {
                p_id:             cliente.id,
                p_nombre:         p.nombre,
                p_identificacion: p.identificacion,
                p_telefono:       p.telefono,
                p_email:          p.email,
            });

            if (!error) {
                const idServidor = data?.cliente_id as string | undefined;
                if (idServidor && idServidor !== cliente.id) {
                    await this.outbox.remapearClienteId(cliente.id, idServidor);
                }
                await this.outboxClientes.eliminar(cliente.id);
                return 'ok';
            }

            if (this.supabase.esErrorDeTransporte(error)) {
                await this.outboxClientes.marcarEstado(cliente.id, 'PENDING', { error: error.message });
                return 'red';
            }

            await this.outboxClientes.marcarEstado(cliente.id, 'ERROR', {
                error: error.message, incrementarIntento: true,
            });
            this.logger.error('SyncService', `Cliente ${cliente.id} rechazado por el servidor`, error);
            return 'datos';

        } catch (err: any) {
            await this.outboxClientes.marcarEstado(cliente.id, 'PENDING', { error: err?.message ?? 'error de red' });
            return 'red';
        }
    }

    /**
     * Empuja una venta al servidor. Marca SYNCING → al RPC → SYNCED+eliminar | PENDING | ERROR.
     * Retorna 'ok' | 'red' | 'datos' para que el bucle decida si continuar.
     */
    private async empujarVenta(venta: OutboxVenta): Promise<'ok' | 'red' | 'datos'> {
        await this.outbox.marcarEstado(venta.idempotencyKey, 'SYNCING');
        const p = venta.payload;

        try {
            const { error } = await this.supabase.client.rpc('fn_registrar_venta_pos', {
                p_turno_id:                p.turnoId,
                p_empleado_id:             p.empleadoId,
                p_cliente_id:              p.clienteId,
                p_tipo_comprobante:        p.tipoComprobante,
                p_total:                   p.total,
                p_subtotal:                p.subtotal,
                p_descuento:               p.descuento,
                p_descuento_pct:           p.descuentoPct,
                p_base_iva_0:              p.baseIva0,
                p_base_iva_15:             p.baseIva15,
                p_iva_valor:               p.ivaValor,
                p_metodo_pago:             p.metodoPago,
                p_items:                   p.items,
                p_idempotency_key:         venta.idempotencyKey,
                p_permitir_stock_negativo: true, // stock offline optimista (§5)
                p_fecha:                   p.fechaVenta, // fecha REAL de la venta, no la de sincronización
            });

            if (!error) {
                // success o duplicado (idempotencia) → ambos son éxito
                await this.outbox.eliminar(venta.idempotencyKey);
                return 'ok';
            }

            if (this.supabase.esErrorDeTransporte(error)) {
                await this.outbox.marcarEstado(venta.idempotencyKey, 'PENDING', { error: error.message });
                return 'red';
            }

            // Error de datos (validación del servidor) → dead-letter
            await this.outbox.marcarEstado(venta.idempotencyKey, 'ERROR', {
                error: error.message, incrementarIntento: true,
            });
            this.logger.error('SyncService', `Venta ${venta.idempotencyKey} rechazada por el servidor`, error);
            return 'datos';

        } catch (err: any) {
            // Excepción de transporte (sin conexión, timeout) → tratar como red
            await this.outbox.marcarEstado(venta.idempotencyKey, 'PENDING', { error: err?.message ?? 'error de red' });
            return 'red';
        }
    }
}
