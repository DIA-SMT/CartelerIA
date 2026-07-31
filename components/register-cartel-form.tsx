"use client";

import { useEffect, useId, useState } from "react";
import { BadgePlus, Loader2, X } from "lucide-react";
import type { TerritorialLinkStatus } from "@/data/carteles";
import type { AnalyzedCartel } from "@/data/territorial";
import { useDismissible } from "@/hooks/use-dismissible";
import { registerCartel } from "@/lib/cartel-repository";

type Props = {
  cartel: AnalyzedCartel;
  onClose: () => void;
  /** Se llama con el id del registro creado (o existente, si ya estaba vinculado). */
  onRegistered: (
    recordId: string,
    alreadyExisted: boolean,
    linkStatus: TerritorialLinkStatus,
  ) => void;
};

/**
 * Alta rápida de un cartel del mapa en el registro administrativo. Todos los
 * campos son opcionales: el registro puede nacer mínimo (solo el vínculo
 * territorial) y completarse después durante la inspección o el expediente.
 */
export function RegisterCartelForm({ cartel, onClose, onRegistered }: Props) {
  const titleId = useId();
  const { open, close } = useDismissible(onClose);
  const [empresa, setEmpresa] = useState("");
  const [cuit, setCuit] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [numero, setNumero] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Capture + stopPropagation: este modal abre sobre la ficha del cartel,
    // que también cierra con Esc en fase burbuja. Sin esto, un Esc cierra ambos.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [close]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || linkReason.trim().length < 5) return;
    setSaving(true);
    setError(null);
    const [longitude, latitude] = cartel.geometry.coordinates;
    const result = await registerCartel({
      territorialFeatureId: String(cartel.properties.id),
      linkReason: linkReason.trim(),
      latitud: latitude ?? null,
      longitud: longitude ?? null,
      empresa: empresa.trim() || null,
      cuit: cuit.trim() || null,
      domicilio: domicilio.trim() || null,
      numero: numero.trim() || null,
    });
    setSaving(false);
    if (!result.ok || !result.recordId) {
      setError(result.error ?? "No se pudo registrar el cartel.");
      return;
    }
    onRegistered(
      result.recordId,
      result.alreadyExisted,
      result.linkStatus ?? "sin_vinculo",
    );
  };

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-ink/40 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl border border-white bg-white p-6 shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <span className="grid size-11 place-items-center rounded-xl bg-municipal-50 text-municipal-700">
            <BadgePlus size={20} />
          </span>
          <button onClick={close} className="icon-button grid" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <h2 id={titleId} className="mt-4 font-display text-lg font-extrabold text-ink">
          Registrar este cartel
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Crea el registro administrativo de <b className="text-ink">{cartel.properties.name || "este cartel"}</b>.
          El vínculo con el mapa quedará pendiente de resolución administrativa.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <Field label="Empresa" value={empresa} onChange={setEmpresa} placeholder="Razón social" />
          <Field label="CUIT" value={cuit} onChange={setCuit} placeholder="30-00000000-0" inputMode="numeric" />
          <div className="grid grid-cols-[1fr_92px] gap-3">
            <Field label="Domicilio" value={domicilio} onChange={setDomicilio} placeholder="Calle" />
            <Field label="N°" value={numero} onChange={setNumero} placeholder="123" inputMode="numeric" />
          </div>
          <label className="block">
            <span className="detail-title">Fundamento del vínculo</span>
            <textarea
              value={linkReason}
              onChange={(event) => setLinkReason(event.target.value)}
              rows={2}
              required
              minLength={5}
              placeholder="Indicá por qué este registro corresponde al punto territorial"
              className="mt-1.5 w-full rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-ink outline-none ring-1 ring-inset ring-slate-100 focus:ring-municipal-500"
            />
            <span className="mt-1 block text-micro text-slate-400">
              También se usa para volver a solicitar un vínculo previamente rechazado.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-[11px] font-semibold text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || linkReason.trim().length < 5}
            className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <BadgePlus size={15} />}
            {saving ? "Registrando…" : "Registrar cartel"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block">
      <span className="detail-title">{label}</span>
      <div className="filter-input mt-1.5">
        <input
          type="text"
          inputMode={inputMode}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </label>
  );
}
