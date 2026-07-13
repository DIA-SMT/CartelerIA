"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface LightboxPhoto {
  url: string;
  alt: string;
}

type Props = {
  photos: LightboxPhoto[];
  startIndex: number;
  onClose: () => void;
};

/**
 * Visor de fotos a pantalla completa (sin dependencias). Esc o clic afuera
 * cierra; ← → navegan cuando hay varias imágenes.
 */
export function PhotoLightbox({ photos, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), photos.length - 1));
  const many = photos.length > 1;

  const prev = useCallback(() => setIndex((i) => (i - 1 + photos.length) % photos.length), [photos.length]);
  const next = useCallback(() => setIndex((i) => (i + 1) % photos.length), [photos.length]);

  useEffect(() => {
    // Fase capture + stopPropagation: si no, el Esc también dispara los handlers
    // de los modales/paneles de abajo (p. ej. cerraría la ficha del cartel).
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === "ArrowLeft" && many) { event.preventDefault(); event.stopPropagation(); prev(); }
      else if (event.key === "ArrowRight" && many) { event.preventDefault(); event.stopPropagation(); next(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, prev, next, many]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Fotografía ampliada: ${photo.alt}`}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar visor"
        className="absolute right-4 top-4 grid size-10 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/25"
      >
        <X size={20} />
      </button>

      {many && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); prev(); }}
          aria-label="Foto anterior"
          className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/25 sm:left-5"
        >
          <ChevronLeft size={22} />
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[86vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
      />

      {many && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); next(); }}
          aria-label="Foto siguiente"
          className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/25 sm:right-5"
        >
          <ChevronRight size={22} />
        </button>
      )}

      {many && (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white">
          {index + 1} / {photos.length}
        </span>
      )}
    </div>
  );
}
