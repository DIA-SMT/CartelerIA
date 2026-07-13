"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  Lock,
  Ruler,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  computeSurface,
  DEFAULT_INSPECTION_STATE,
  getInspectionState,
  INSPECTION_FORM_STEPS,
  INSPECTION_STATE_ORDER,
  INSPECTION_STATES,
  type InspectionState,
} from "@/data/inspections";
import {
  addInspectionPhotos,
  createInspection,
  deleteInspectionPhoto,
  loadInspectionPhotos,
  updateInspection,
  type InspectionPhoto,
  type InspectionRecord,
} from "@/lib/inspection-repository";
import type { AuthState } from "@/hooks/use-auth";
import { PhotoLightbox, type LightboxPhoto } from "./photo-lightbox";

type Props = {
  cartelId: string;
  cartelName: string;
  prefill?: { empresa?: string | null; cuit?: string | null };
  auth: AuthState;
  onClose: () => void;
  onSaved: () => void;
  /** Si se pasa, el formulario edita esta inspección en lugar de crear una nueva. */
  existing?: InspectionRecord | null;
};

const SUPPORT_OPTIONS: { value: string; label: string }[] = [
  { value: "led", label: "Pantalla LED" },
  { value: "cartel_tradicional", label: "Cartel tradicional" },
  { value: "medianera", label: "Medianera" },
  { value: "cerca_obra", label: "Cerco de obra" },
  { value: "gigantografia", label: "Gigantografía" },
];

const MAX_PHOTOS = 6;

type SaveState = "idle" | "saving" | "error";

export function InspectionForm({ cartelId, cartelName, prefill, auth, onClose, onSaved, existing }: Props) {
  const isEdit = Boolean(existing);
  const [step, setStep] = useState(0);
  const [empresa, setEmpresa] = useState(existing?.empresa ?? prefill?.empresa ?? "");
  const [cuit, setCuit] = useState(existing?.cuit ?? prefill?.cuit ?? "");
  const [tipoSoporte, setTipoSoporte] = useState(existing?.tipoSoporte ?? "");
  const [ancho, setAncho] = useState(existing?.anchoM != null ? String(existing.anchoM) : "");
  const [alto, setAlto] = useState(existing?.altoM != null ? String(existing.altoM) : "");
  const [estado, setEstado] = useState<InspectionState>(existing?.estado ?? DEFAULT_INSPECTION_STATE);
  const [observaciones, setObservaciones] = useState(existing?.observaciones ?? "");
  const [photos, setPhotos] = useState<File[]>([]);
  /** Fotos ya guardadas (solo edición) y las marcadas para eliminar al guardar. */
  const [existingPhotos, setExistingPhotos] = useState<InspectionPhoto[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photosWarning, setPhotosWarning] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!existing) return;
    let active = true;
    loadInspectionPhotos(existing.id).then((data) => { if (active) setExistingPhotos(data); });
    return () => { active = false; };
  }, [existing]);

  const anchoNum = ancho === "" ? null : Number(ancho);
  const altoNum = alto === "" ? null : Number(alto);
  const surface = computeSurface(anchoNum, altoNum);

  const previews = useMemo(() => photos.map((file) => URL.createObjectURL(file)), [photos]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const totalSteps = INSPECTION_FORM_STEPS.length;
  const currentStep = INSPECTION_FORM_STEPS[step];
  const isLast = step === totalSteps - 1;
  const canWrite = auth.available && auth.canInspect;

  /** Fotos guardadas que siguen vigentes (no marcadas para eliminar). */
  const keptPhotos = existingPhotos.filter((photo) => !removedPhotoIds.has(photo.id));
  const maxNewPhotos = Math.max(0, MAX_PHOTOS - keptPhotos.length);

  const handleAddPhotos = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    setPhotos((current) => [...current, ...incoming].slice(0, maxNewPhotos));
  };

  const removePhoto = (index: number) => {
    setPhotos((current) => current.filter((_, i) => i !== index));
  };

  const toggleRemoveExisting = (photoId: string) => {
    setRemovedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const openLightbox = (list: LightboxPhoto[], index: number) => setLightbox({ photos: list, index });

  const handleSubmit = async () => {
    if (!canWrite) return;
    setSaveState("saving");
    setErrorMessage(null);

    if (isEdit && existing) {
      const ok = await updateInspection(existing.id, {
        tipoSoporte: tipoSoporte || null,
        anchoM: anchoNum,
        altoM: altoNum,
        empresa: empresa.trim() || null,
        cuit: cuit.trim() || null,
        observaciones: observaciones.trim() || null,
      });
      if (!ok) {
        setSaveState("error");
        setErrorMessage("No se pudieron guardar los cambios. Verificá tu sesión y permisos.");
        return;
      }
      for (const photo of existingPhotos) {
        if (removedPhotoIds.has(photo.id)) await deleteInspectionPhoto(photo);
      }
      const failed = photos.length > 0 ? await addInspectionPhotos(existing.id, photos) : 0;
      setPhotosWarning(failed);
      onSaved();
      return;
    }

    const result = await createInspection({
      cartelId,
      estado,
      tipoSoporte: tipoSoporte || null,
      anchoM: anchoNum,
      altoM: altoNum,
      empresa: empresa.trim() || null,
      cuit: cuit.trim() || null,
      observaciones: observaciones.trim() || null,
      photos,
    });
    if (!result.ok) {
      setSaveState("error");
      setErrorMessage(result.error ?? "No se pudo guardar la inspección.");
      return;
    }
    setPhotosWarning(result.photosFailed);
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Inspección de ${cartelName}`}
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-white bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-slate-100 px-5 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <span className="section-kicker">{isEdit ? "Editar inspección" : "Nueva inspección"}</span>
            <button onClick={onClose} className="icon-button grid" aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
          <h2 className="mt-1 truncate font-display text-base font-extrabold text-ink">{cartelName}</h2>

          <ol className="mt-3 flex items-center gap-1.5" aria-label="Progreso del formulario">
            {INSPECTION_FORM_STEPS.map((formStep, index) => (
              <li key={formStep.id} className="flex-1">
                <span
                  className={`block h-1.5 rounded-full ${index <= step ? "bg-municipal-700" : "bg-slate-200"}`}
                  aria-current={index === step ? "step" : undefined}
                />
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] font-semibold text-slate-500">
            Paso {step + 1} de {totalSteps} · {currentStep.title}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!canWrite && (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] font-semibold text-amber-800">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <span>
                Necesitás una sesión con rol operativo (inspector, coordinador o administrador)
                para guardar. Podés completar el formulario, pero el guardado estará deshabilitado.
              </span>
            </div>
          )}

          {currentStep.id === "identificacion" && (
            <Fieldset legend="Identificación">
              <ReadOnlyField label="Cartel vinculado" value={`${cartelName} · ${cartelId}`} />
              <TextField label="Empresa" value={empresa} onChange={setEmpresa} placeholder="Razón social" />
              <TextField label="CUIT" value={cuit} onChange={setCuit} placeholder="30-00000000-0" inputMode="numeric" />
            </Fieldset>
          )}

          {currentStep.id === "caracteristicas" && (
            <Fieldset legend="Características físicas">
              <SelectField
                label="Tipo de soporte"
                value={tipoSoporte}
                onChange={setTipoSoporte}
                options={[{ value: "", label: "Seleccionar…" }, ...SUPPORT_OPTIONS]}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Ancho (m)" value={ancho} onChange={setAncho} placeholder="0.00" inputMode="decimal" />
                <TextField label="Alto (m)" value={alto} onChange={setAlto} placeholder="0.00" inputMode="decimal" />
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-municipal-50 px-3 py-2.5 text-xs font-bold text-municipal-700">
                <Ruler size={15} />
                Superficie: {surface !== null ? `${surface.toLocaleString("es-AR")} m²` : "— (completá ancho y alto)"}
              </div>
            </Fieldset>
          )}

          {currentStep.id === "administrativa" && (
            <Fieldset legend="Situación administrativa">
              {isEdit ? (
                <>
                  <ReadOnlyField label="Estado de la inspección" value={getInspectionState(estado).label} />
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    El estado se cambia desde &ldquo;Avanzar estado&rdquo; en la inspección (así queda registrado en el historial).
                  </p>
                </>
              ) : (
                <>
                  <SelectField
                    label="Estado de la inspección"
                    value={estado}
                    onChange={(value) => setEstado(value as InspectionState)}
                    options={INSPECTION_STATE_ORDER.map((config) => ({ value: config.key, label: config.label }))}
                  />
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    {INSPECTION_STATES[estado].description}
                  </p>
                </>
              )}
              <TextAreaField label="Observaciones" value={observaciones} onChange={setObservaciones} />
            </Fieldset>
          )}

          {currentStep.id === "evidencia" && (
            <Fieldset legend="Evidencia">
              {isEdit && existingPhotos.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-slate-400">Fotografías guardadas ({keptPhotos.length})</span>
                  <ul className="mt-1.5 grid grid-cols-3 gap-2">
                    {existingPhotos.map((photo, index) => {
                      const removed = removedPhotoIds.has(photo.id);
                      const keptWithUrl = keptPhotos.filter((item) => item.url);
                      return (
                        <li key={photo.id} className="relative overflow-hidden rounded-lg border border-slate-200">
                          {photo.url ? (
                            <button
                              type="button"
                              onClick={() => !removed && openLightbox(keptWithUrl.map((item, i) => ({ url: item.url as string, alt: `Fotografía ${i + 1}` })), keptWithUrl.findIndex((item) => item.id === photo.id))}
                              className="block w-full"
                              aria-label={`Ampliar fotografía ${index + 1}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={photo.url} alt={`Fotografía ${index + 1}`} className={`aspect-square w-full object-cover ${removed ? "opacity-30 grayscale" : ""}`} />
                            </button>
                          ) : (
                            <span className="grid aspect-square w-full place-items-center bg-slate-100 text-slate-300"><Camera size={16} /></span>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleRemoveExisting(photo.id)}
                            className={`absolute right-1 top-1 grid size-6 place-items-center rounded-md text-white ${removed ? "bg-municipal-700" : "bg-ink/70"}`}
                            aria-label={removed ? `Restaurar fotografía ${index + 1}` : `Eliminar fotografía ${index + 1} al guardar`}
                            title={removed ? "Restaurar" : "Eliminar al guardar"}
                          >
                            {removed ? <Check size={12} /> : <Trash2 size={12} />}
                          </button>
                          {removed && <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-red-600/85 py-0.5 text-center text-[8px] font-extrabold uppercase text-white">Se eliminará</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => handleAddPhotos(event.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={photos.length >= maxNewPhotos}
                className="secondary-button w-full justify-center disabled:opacity-60"
              >
                <Camera size={15} />
                Agregar fotografías ({keptPhotos.length + photos.length}/{MAX_PHOTOS})
              </button>
              {photos.length === 0 ? (
                !isEdit && (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-[11px] text-slate-400">
                    Sin fotografías cargadas todavía.
                  </p>
                )
              ) : (
                <ul className="grid grid-cols-3 gap-2">
                  {previews.map((url, index) => (
                    <li key={url} className="group relative overflow-hidden rounded-lg border border-slate-200">
                      <button
                        type="button"
                        onClick={() => openLightbox(previews.map((item, i) => ({ url: item, alt: `Evidencia nueva ${i + 1}` })), index)}
                        className="block w-full"
                        aria-label={`Ampliar fotografía ${index + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Evidencia ${index + 1}`} className="aspect-square w-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute right-1 top-1 grid size-6 place-items-center rounded-md bg-ink/70 text-white"
                        aria-label={`Quitar fotografía ${index + 1}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Fieldset>
          )}

          {currentStep.id === "confirmacion" && (
            <Fieldset legend="Confirmación">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <SummaryRow label="Cartel" value={`${cartelName} · ${cartelId}`} />
                <SummaryRow label="Empresa" value={empresa || "—"} />
                <SummaryRow label="CUIT" value={cuit || "—"} />
                <SummaryRow label="Tipo de soporte" value={SUPPORT_OPTIONS.find((o) => o.value === tipoSoporte)?.label ?? "—"} />
                <SummaryRow label="Dimensiones" value={anchoNum && altoNum ? `${ancho} × ${alto} m` : "—"} />
                <SummaryRow label="Superficie" value={surface !== null ? `${surface.toLocaleString("es-AR")} m²` : "—"} />
                <SummaryRow label="Estado" value={INSPECTION_STATES[estado].label} />
                <SummaryRow label="Observaciones" value={observaciones || "—"} />
                <SummaryRow label="Fotografías" value={isEdit ? `${keptPhotos.length} guardadas${removedPhotoIds.size > 0 ? ` (${removedPhotoIds.size} a eliminar)` : ""} + ${photos.length} nuevas` : `${photos.length}`} />
              </div>
              {errorMessage && (
                <p role="alert" className="text-[11px] font-semibold text-red-600">
                  {errorMessage}
                </p>
              )}
            </Fieldset>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0 || saveState === "saving"}
            className="secondary-button compact justify-center disabled:opacity-50"
          >
            <ChevronLeft size={14} />
            Atrás
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canWrite || saveState === "saving"}
              className="primary-button compact justify-center disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveState === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saveState === "saving" ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar inspección"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((value) => Math.min(totalSteps - 1, value + 1))}
              className="primary-button compact justify-center"
            >
              Siguiente
              <ChevronRight size={14} />
            </button>
          )}
        </footer>
        {photosWarning > 0 && (
          <p className="px-5 pb-3 text-[11px] font-semibold text-amber-700">
            La inspección se guardó, pero {photosWarning} foto(s) no pudieron subirse.
          </p>
        )}
      </div>
      {lightbox && <PhotoLightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-400">
        <ClipboardList size={13} />
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function TextField({
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
  inputMode?: "numeric" | "decimal" | "text";
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

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="detail-title">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1.5 w-full rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-ink outline-none ring-1 ring-inset ring-slate-100 focus:ring-municipal-500"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="detail-title">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="filter-select mt-1.5 w-full"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="detail-title">{label}</span>
      <p className="mt-1.5 flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600">
        <Check size={13} className="text-municipal-600" />
        {value}
      </p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      <span className="text-right text-[11px] font-bold text-ink">{value}</span>
    </div>
  );
}
