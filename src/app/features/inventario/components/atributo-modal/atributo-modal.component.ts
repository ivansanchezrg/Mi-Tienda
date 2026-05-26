import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, colorPaletteOutline, pricetagOutline, addOutline, checkmarkOutline } from 'ionicons/icons';
import { UppercaseInputDirective } from '../../../../shared/directives/uppercase-input.directive';
import { AtributoService } from '../../services/atributo.service';
import { Atributo, AtributoOpcion } from '../../models/producto.model';

export interface AtributoModalResult {
    atributo: Atributo;
    opcion: AtributoOpcion;
}

@Component({
    selector: 'app-atributo-modal',
    templateUrl: './atributo-modal.component.html',
    styleUrls: ['./atributo-modal.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonButton,
        IonIcon,
        IonSpinner,
        UppercaseInputDirective,
    ]
})
export class AtributoModalComponent implements OnInit, OnDestroy {

    /** Atributos ya asignados al producto — para evitar duplicar el mismo tipo */
    @Input() atributoIdsExistentes: string[] = [];

    /** Nombre del producto — se muestra como badge en el header */
    @Input() nombreProducto = '';

    private modalCtrl = inject(ModalController);
    private atributoService = inject(AtributoService);

    // Paso 1 — tipo de atributo
    textoAtributo = '';
    atributosSugeridos: Atributo[] = [];
    buscandoAtributos = false;
    atributoSeleccionado: Atributo | null = null;

    // Paso 2 — valor de la opción
    textoOpcion = '';
    opcionesSugeridas: AtributoOpcion[] = [];
    buscandoOpciones = false;

    guardando = false;

    private atributoSearch$ = new Subject<string>();
    private opcionSearch$ = new Subject<string>();
    private atributoSearchSub!: Subscription;
    private opcionSearchSub!: Subscription;

    get paso(): 1 | 2 {
        return this.atributoSeleccionado ? 2 : 1;
    }

    get atributoTipoNoCoincideExacto(): boolean {
        if (!this.textoAtributo || this.textoAtributo.trim().length < 2) return false;
        const norm = this.textoAtributo.toUpperCase().trim();
        return !this.atributosSugeridos.some(a => a.nombre === norm);
    }

    get opcionNoCoincideExacto(): boolean {
        if (!this.textoOpcion || this.textoOpcion.trim().length < 1) return false;
        const norm = this.textoOpcion.toUpperCase().trim();
        return !this.opcionesSugeridas.some(o => o.valor === norm);
    }

    constructor() {
        addIcons({ closeOutline, colorPaletteOutline, pricetagOutline, addOutline, checkmarkOutline });
    }

    ngOnInit() {
        this.atributoSearchSub = this.atributoSearch$
            .pipe(debounceTime(300), distinctUntilChanged())
            .subscribe(texto => this.ejecutarBusquedaAtributos(texto));

        this.opcionSearchSub = this.opcionSearch$
            .pipe(debounceTime(300), distinctUntilChanged())
            .subscribe(texto => this.ejecutarBusquedaOpciones(texto));
    }

    // ── Paso 1: tipo ─────────────────────────────

    onAtributoInput(valor: string) {
        this.textoAtributo = valor;
        if (!valor || valor.trim().length < 2) {
            this.atributosSugeridos = [];
            this.buscandoAtributos = false;
            return;
        }
        this.buscandoAtributos = true;
        this.atributoSearch$.next(valor);
    }

    private async ejecutarBusquedaAtributos(texto: string) {
        this.atributosSugeridos = await this.atributoService.buscarAtributos(texto);
        this.buscandoAtributos = false;
    }

    async seleccionarTipo(atributo: Atributo) {
        this.atributoSeleccionado = atributo;
        this.atributosSugeridos = [];
        this.textoAtributo = atributo.nombre;
        this.opcionesSugeridas = await this.atributoService.obtenerOpcionesAtributo(atributo.id);
    }

    async crearYSeleccionarTipo(nombre: string) {
        if (!nombre || nombre.trim().length < 2) return;
        const atributo = await this.atributoService.crearOObtenerAtributo(nombre);
        if (atributo) await this.seleccionarTipo(atributo);
    }

    volverAlPaso1() {
        this.atributoSeleccionado = null;
        this.textoOpcion = '';
        this.opcionesSugeridas = [];
    }

    // ── Paso 2: valor ─────────────────────────────

    onOpcionInput(valor: string) {
        this.textoOpcion = valor;
        if (!valor || valor.trim().length < 1) {
            return;
        }
        this.buscandoOpciones = true;
        this.opcionSearch$.next(valor);
    }

    private async ejecutarBusquedaOpciones(texto: string) {
        if (!this.atributoSeleccionado?.id) return;
        this.opcionesSugeridas = await this.atributoService.buscarOpcionesAtributo(
            this.atributoSeleccionado.id, texto
        );
        this.buscandoOpciones = false;
    }

    async confirmarOpcion(opcion: AtributoOpcion) {
        if (!this.atributoSeleccionado) return;
        const result: AtributoModalResult = {
            atributo: this.atributoSeleccionado,
            opcion
        };
        this.modalCtrl.dismiss(result, 'confirm');
    }

    async crearYConfirmarOpcion(valor: string) {
        if (!this.atributoSeleccionado?.id || !valor || valor.trim().length < 1 || this.guardando) return;
        this.guardando = true;
        try {
            const opcion = await this.atributoService.crearOObtenerOpcionAtributo(
                this.atributoSeleccionado.id, valor
            );
            if (opcion) await this.confirmarOpcion(opcion);
        } finally {
            this.guardando = false;
        }
    }

    // ─────────────────────────────────────────────

    cerrar() {
        this.modalCtrl.dismiss(null, 'cancel');
    }

    ngOnDestroy() {
        this.atributoSearchSub?.unsubscribe();
        this.opcionSearchSub?.unsubscribe();
    }
}
