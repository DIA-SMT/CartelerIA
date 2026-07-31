"use client";

import { useEffect, type RefObject } from "react";

/**
 * Pila de contenedores modales montados. Solo el de arriba atrapa Tab: si
 * todos lo hicieran, dos overlays apilados (formulario + confirmación) se
 * roban el foco entre sí y el Tab queda clavado. El scroll del body vuelve
 * al vaciarse la pila.
 */
const modalStack: HTMLElement[] = [];

const TABBABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Comportamiento de cáscara modal que ningún overlay debería reimplementar:
 * - bloquea el scroll del body mientras está montado (con contador para pilas);
 * - mueve el foco adentro al abrir ([autofocus] o primer tabbable);
 * - atrapa Tab/Shift+Tab dentro del contenedor;
 * - restituye el foco al elemento que lo tenía al cerrar.
 *
 * El manejo de Escape queda en cada componente (cada overlay decide su
 * prioridad frente a los que tiene encima; ver photo-lightbox).
 */
export function useModalShell(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modalStack.length === 0) document.body.style.overflow = "hidden";
    modalStack.push(container);

    const tabbables = () => Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));
    const initial = container.querySelector<HTMLElement>("[autofocus]") ?? tabbables()[0];
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (modalStack[modalStack.length - 1] !== container) return;
      const list = tabbables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && container.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const position = modalStack.lastIndexOf(container);
      if (position !== -1) modalStack.splice(position, 1);
      if (modalStack.length === 0) document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [containerRef]);
}
