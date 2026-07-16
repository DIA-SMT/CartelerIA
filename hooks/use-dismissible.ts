"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Anima entrada y salida de un overlay que el padre monta/desmonta con
 * condicional (`{open && <Modal/>}`). El truco: el componente controla cuándo
 * se llama a `onClose` (que es lo que lo desmonta), así queda montado durante
 * su propia animación de salida.
 *
 * - `open`  → false en el primer frame, true en el siguiente: dispara la
 *   transición CSS de entrada al montar.
 * - `close` → pone `open=false` (transición de salida) y recién después de
 *   `duration` ejecuta el `onClose` real del padre.
 *
 * Devolvé `open` a `data-state`/estilos y usá `close` en todos los cierres
 * (backdrop, botón, Escape).
 */
export function useDismissible(onClose: () => void, duration = 220) {
  const [open, setOpen] = useState(false);
  const closing = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    window.setTimeout(onClose, duration);
  }, [onClose, duration]);

  return { open, close };
}
