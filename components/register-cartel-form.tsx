"use client";

import { useEffect, useId, useState } from "react";
import { BadgePlus, Loader2, X } from "lucide-react";
import type { AnalyzedCartel } from "@/data/territorial";
import { registerCartel } from "@/lib/cartel-repository";

type Props = {
  cartel: AnalyzedCartel;
  onClose: () => void;
  /** Se llama con el id del registro creado (o existente, si ya estaba vinculado). */
  onRegistered: (recordId: string, alreadyExisted: boolean) => void;
};

/**
 * Alta rápida de un cartel del mapa en el registro administrativo. Todos los
 * campos son opcionales: el registro puede nacer mínimo (solo el vínculo
 * territorial) y completarse después durante la inspección o el expediente.
 */
export function RegisterCartelForm({ cartel, onClose, onRegistered }: Props) {
  const titleId = useId();
  const [empresa, setEmpresa] = useState("");
  const [cuit, setCuit] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [numero, setNumero] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const [longitude, latitude] = cartel.geometry.coordinates;
    const result = await registerCartel({
      territorialFeatureId: String(cartel.properties.id),
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
    onRegistered(result.recordId, result.alreadyExisted);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-ink/40 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl border border-white bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <span className="grid size-11 place-items-center rounded-xl bg-municipal-50 text-municipal-700">
            <BadgePlus size={20} />
          </span>
          <button onClick={onClose} className="icon-button grid" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <h2 id={titleId} className="mt-4 font-display text-lg font-extrabold text-ink">
          Registrar este cartel
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Crea el registro administrativo de <b className="text-ink">{cartel.properties.name || "este cartel"}</b> y
          lo vincula al mapa. Todos los campos son opcionales: podés completarlos después.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <Field label="Empresa" value={empresa} onChange={setEmpresa} placeholder="Razón social" />
          <Field label="CUIT" value={cuit} onChange={setCuit} placeholder="30-00000000-0" inputMode="numeric" />
          <div className="grid grid-cols-[1fr_92px] gap-3">
            <Field label="Domicilio" value={domicilio} onChange={setDomicilio} placeholder="Calle" />
            <Field label="N°" value={numero} onChange={setNumero} placeholder="123" inputMode="numeric" />
          </div>

          {error && (
            <p role="alert" className="text-[11px] font-semibold text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
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
