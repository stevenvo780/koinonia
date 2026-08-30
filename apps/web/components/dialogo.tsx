'use client';

/**
 * Pedir un texto sin `window.prompt`.
 *
 * `window.prompt` no es un atajo: es una pantalla que no se puede etiquetar, que los lectores de
 * pantalla anuncian mal o no anuncian, que no acepta ayuda ni mensaje de error, y que **en una PWA
 * de iOS se cierra sin valor o devuelve `null`** —que es como entra buena parte del público de este
 * proyecto—. Un motivo de retirada que se pierde en silencio deja un hueco en el historial que
 * después nadie sabe explicar.
 *
 * Este diálogo es de la casa y cumple lo que aquél no puede:
 *
 *  · el campo tiene `<label>` de verdad, con su ayuda enlazada por `aria-describedby`;
 *  · el foco se atrapa dentro mientras está abierto y vuelve a donde estaba al cerrarse;
 *  · `Escape` cierra sin escribir nada, y cerrar sin escribir no cuenta como confirmar;
 *  · dos botones, los dos en castellano, y el que confirma dice qué va a hacer.
 *
 * El foco se atrapa dos veces a propósito: `showModal()` ya lo hace en un navegador moderno, y el
 * manejador de `Tab` lo sostiene igual si `showModal` no existe o falla porque el elemento ya
 * estaba abierto. Una garantía de accesibilidad que depende de que el navegador coopere no es una
 * garantía.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { enfocarTrasPintar } from '../lib/foco';

const FOCALIZABLES =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DialogoTexto({
  abierto,
  titulo,
  etiqueta,
  ayuda,
  minimo = 1,
  confirmar,
  cancelar = 'Dejarlo así',
  trabajando = false,
  onConfirmar,
  onCancelar,
}: {
  readonly abierto: boolean;
  readonly titulo: string;
  readonly etiqueta: string;
  readonly ayuda: string;
  readonly minimo?: number;
  readonly confirmar: string;
  readonly cancelar?: string;
  /** Mientras el POST está en vuelo: los dos botones se bloquean y el rótulo lo dice. */
  readonly trabajando?: boolean;
  readonly onConfirmar: (texto: string) => void;
  readonly onCancelar: () => void;
}): ReactNode {
  const dialogo = useRef<HTMLDialogElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const idBase = useId();
  const idTitulo = `${idBase}-titulo`;
  const idCampo = `${idBase}-campo`;
  const idAyuda = `${idBase}-ayuda`;
  const [texto, setTexto] = useState('');
  const [tocado, setTocado] = useState(false);

  const corto = texto.trim().length < minimo;
  const invalido = tocado && corto;

  useEffect(() => {
    const elemento = dialogo.current;
    if (elemento === null) return;
    if (abierto) {
      setTexto('');
      setTocado(false);
      if (!elemento.open) {
        // `showModal` devuelve el foco solo al cerrarse, y vuelve inerte lo de detrás.
        if (typeof elemento.showModal === 'function') elemento.showModal();
        else elemento.setAttribute('open', '');
      }
      // Al abrir, el foco va al campo: quien no ve la pantalla tiene que aterrizar en lo que se
      // le está pidiendo, no en el título ni en el botón de cancelar.
      enfocarTrasPintar(() => campo.current);
    } else {
      // Al cerrar se vacía. Dejar el motivo escrito dentro de un diálogo oculto lo conserva en el
      // documento sin que nadie lo vea ni pueda borrarlo, y lo reaparece en la siguiente apertura
      // como si fuera de esta vez.
      setTexto('');
      setTocado(false);
      if (elemento.open) elemento.close();
    }
  }, [abierto]);

  const atraparFoco = useCallback((evento: React.KeyboardEvent<HTMLDialogElement>) => {
    if (evento.key !== 'Tab') return;
    const elemento = dialogo.current;
    if (elemento === null) return;
    const focalizables = [...elemento.querySelectorAll<HTMLElement>(FOCALIZABLES)].filter(
      (nodo) => nodo.offsetParent !== null || nodo === document.activeElement,
    );
    const primero = focalizables[0];
    const ultimo = focalizables.at(-1);
    if (primero === undefined || ultimo === undefined) return;
    if (evento.shiftKey && document.activeElement === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }, []);

  function intentarConfirmar(): void {
    setTocado(true);
    if (corto) {
      campo.current?.focus();
      return;
    }
    onConfirmar(texto.trim());
  }

  return (
    <dialog
      ref={dialogo}
      className="dialogo"
      aria-labelledby={idTitulo}
      onKeyDown={atraparFoco}
      onCancel={(evento) => {
        // `Escape` cierra, y cerrar **no** es confirmar: el texto a medio escribir se descarta.
        evento.preventDefault();
        if (!trabajando) onCancelar();
      }}
      onClose={() => {
        if (abierto && !trabajando) onCancelar();
      }}
    >
      <h2 id={idTitulo}>{titulo}</h2>
      <div className="campo">
        <label htmlFor={idCampo}>{etiqueta}</label>
        <span className="ayuda" id={idAyuda}>
          {ayuda}
        </span>
        <textarea
          id={idCampo}
          ref={campo}
          required
          minLength={minimo}
          disabled={trabajando}
          aria-describedby={invalido ? `${idAyuda} ${idBase}-error` : idAyuda}
          aria-invalid={invalido}
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value);
          }}
        />
        {invalido && (
          <p className="error-campo" id={`${idBase}-error`} role="alert">
            Escribí el motivo antes de continuar. Sin motivo, el hueco queda sin explicación.
          </p>
        )}
      </div>
      <div className="acciones-dialogo">
        <button className="boton" type="button" disabled={trabajando} onClick={intentarConfirmar}>
          {trabajando ? 'Guardando…' : confirmar}
        </button>{' '}
        <button
          className="boton secundario"
          type="button"
          disabled={trabajando}
          onClick={onCancelar}
        >
          {cancelar}
        </button>
      </div>
    </dialog>
  );
}
