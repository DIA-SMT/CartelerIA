"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  History,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";
import { APP_ROLES, type AppRole } from "@/lib/roles";
import {
  ROLE_REASON_MIN_LENGTH,
  asignarRol,
  invitarUsuario,
  loadCambiosDeRol,
  loadPerfiles,
  type CambioDeRol,
  type PerfilMunicipal,
} from "@/lib/perfiles-repository";
import { ConfirmDialog, confirmDialogIsOpen } from "./confirm-dialog";
import { toast } from "./toaster";

type LoadPhase = "idle" | "loading" | "ready" | "error";

type PendingChange = {
  perfil: PerfilMunicipal;
  rol: AppRole;
  fundamento: string;
};

const ROLE_COLORS: Record<AppRole, string> = {
  administrador: "#0166FF",
  coordinador: "#0891b2",
  inspector: "#16a34a",
  consulta: "#64748b",
};

const ROLE_LABELS: Record<AppRole, string> = {
  administrador: "Administrador",
  coordinador: "Coordinador",
  inspector: "Inspector",
  consulta: "Consulta",
};

function fecha(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("es-AR") : "—";
}

/**
 * Padrón de usuarios municipales y cambio de rol auditado.
 *
 * Administrar el equipo dejó de requerir entrar al SQL Editor de Supabase, y
 * de paso dejó de ser la única acción del sistema sin fundamento ni traza: cada
 * cambio pasa por `asignar_rol`, que exige administrador humano, fundamento y
 * escribe el historial en la misma transacción.
 */
export function UsuariosAdmin() {
  const auth = useAuth();
  const isAdmin = auth.canRead && auth.role === "administrador";

  const [perfiles, setPerfiles] = useState<PerfilMunicipal[]>([]);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<AppRole>("consulta");
  const [draftReason, setDraftReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<PerfilMunicipal | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const refreshSequence = useRef(0);
  const applyingIds = useRef(new Set<string>());

  const closeEditor = () => {
    setEditingId(null);
    setDraftReason("");
    setFormError(null);
  };

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!isAdmin) {
      setPerfiles([]);
      setLoadError(null);
      setLoadPhase("idle");
      setDataOwnerId(null);
      return;
    }
    setPerfiles([]);
    setDataOwnerId(null);
    setLoadPhase("loading");
    setLoadError(null);
    const result = await loadPerfiles();
    if (sequence !== refreshSequence.current) return;
    setDataOwnerId(auth.user?.id ?? null);
    setPerfiles(result.data);
    setLoadError(result.ok ? null : result.error);
    setLoadPhase(result.ok ? "ready" : "error");
  }, [isAdmin, auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  // Cambiar de sesión descarta el padrón y cualquier edición a medio tipear.
  useEffect(() => {
    closeEditor();
    setPendingChange(null);
    setHistoryFor(null);
  }, [auth.user?.id]);

  if (!isAdmin) return null;
  const ownsData = dataOwnerId === auth.user?.id;
  const blocked = loadPhase !== "ready";

  const startEditing = (perfil: PerfilMunicipal) => {
    setEditingId(perfil.userId);
    setDraftRole(perfil.rol);
    setDraftReason("");
    setFormError(null);
  };

  // Paso 1: validar acá lo mismo que valida el RPC, para que el error se vea
  // antes de enviar y no como un rechazo de la base.
  const requestChange = (perfil: PerfilMunicipal) => {
    if (blocked || applyingIds.current.has(perfil.userId)) return;
    const fundamento = draftReason.trim();
    if (draftRole === perfil.rol) {
      setFormError("El rol elegido es el que ya tiene la cuenta.");
      return;
    }
    if (fundamento.length < ROLE_REASON_MIN_LENGTH) {
      setFormError(`El fundamento debe tener al menos ${ROLE_REASON_MIN_LENGTH} caracteres.`);
      return;
    }
    setFormError(null);
    setPendingChange({ perfil, rol: draftRole, fundamento });
  };

  // Paso 2: confirmado en el diálogo, se aplica.
  const applyChange = async (change: PendingChange) => {
    setPendingChange(null);
    const id = change.perfil.userId;
    if (applyingIds.current.has(id)) return;
    applyingIds.current.add(id);
    setBusyId(id);
    try {
      const result = await asignarRol(id, change.rol, change.fundamento);
      if (!result.ok) {
        setFormError(result.error);
        toast(result.error ?? "No se pudo aplicar el cambio de rol.", "error");
        return;
      }
      toast(
        result.changed
          ? `Rol actualizado a ${ROLE_LABELS[change.rol]} y asentado en el historial.`
          : "La cuenta ya tenía ese rol: no se registró ningún cambio.",
        result.changed ? "success" : "info",
      );
      closeEditor();
      await refresh();
    } finally {
      applyingIds.current.delete(id);
      setBusyId(null);
    }
  };

  return (
    <section id="usuarios" className="section-block">
      <div className="section-heading">
        <div>
          <span className="section-kicker">Administración</span>
          <h2>Usuarios y roles</h2>
          <p>Padrón de cuentas municipales. Cada cambio de rol exige fundamento y queda asentado.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loadPhase === "loading" || busyId !== null}
            className="secondary-button compact"
          >
            <RefreshCw size={13} className={loadPhase === "loading" ? "animate-spin" : ""}/>
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            disabled={blocked || inviteBusy}
            className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UserPlus size={14}/>
            Invitar usuario
          </button>
        </div>
      </div>

      {!ownsData || loadPhase === "idle" || loadPhase === "loading" ? (
        <TableSkeleton/>
      ) : loadPhase === "error" ? (
        <div role="alert" className="empty-state border-red-200 bg-red-50">
          <span><AlertTriangle size={22}/></span>
          <h3>No se pudo cargar el padrón</h3>
          <p>{loadError} Las acciones quedan bloqueadas hasta completar una carga válida.</p>
          <button type="button" onClick={refresh} className="secondary-button compact">Reintentar</button>
        </div>
      ) : perfiles.length === 0 ? (
        <div className="empty-state">
          <span><Users size={22}/></span>
          <h3>Sin cuentas registradas</h3>
          <p>Las cuentas se crean por invitación desde Supabase y nacen con rol de consulta.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[680px] text-left text-tiny">
            <thead className="bg-slate-50">
              <tr className="micro-label">
                <th className="px-3 py-2.5">Nombre</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Rol</th>
                <th className="px-3 py-2.5">Último cambio</th>
                <th className="px-3 py-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {perfiles.map((perfil) => {
                const isSelf = perfil.userId === auth.user?.id;
                const editing = editingId === perfil.userId;
                return (
                  <UserRow
                    key={perfil.userId}
                    perfil={perfil}
                    isSelf={isSelf}
                    editing={editing}
                    blocked={blocked}
                    busy={busyId === perfil.userId}
                    draftRole={draftRole}
                    draftReason={draftReason}
                    formError={editing ? formError : null}
                    onEdit={() => startEditing(perfil)}
                    onCancel={closeEditor}
                    onRole={setDraftRole}
                    onReason={setDraftReason}
                    onSubmit={() => requestChange(perfil)}
                    onHistory={() => setHistoryFor(perfil)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingChange && (
        <ConfirmDialog
          title="Cambiar el rol de la cuenta"
          description={`${pendingChange.perfil.nombre || pendingChange.perfil.email || pendingChange.perfil.userId} pasa de ${ROLE_LABELS[pendingChange.perfil.rol]} a ${ROLE_LABELS[pendingChange.rol]}. El cambio queda asentado con este fundamento:`}
          quote={pendingChange.fundamento}
          tone={pendingChange.rol === "consulta" ? "reject" : "approve"}
          confirmLabel="Cambiar rol"
          onConfirm={() => void applyChange(pendingChange)}
          onCancel={() => setPendingChange(null)}
        />
      )}

      {historyFor && (
        <RoleHistoryPanel perfil={historyFor} onClose={() => setHistoryFor(null)}/>
      )}

      {inviteOpen && (
        <InvitePanel
          busy={inviteBusy}
          onBusy={setInviteBusy}
          onClose={() => setInviteOpen(false)}
          onInvited={refresh}
        />
      )}
    </section>
  );
}

/**
 * Alta de cuenta y asignación de rol en un solo paso.
 *
 * La cuenta siempre nace en `consulta` (lo impone el trigger de alta); si se
 * pidió otro rol, el servidor lo asigna con el token de quien invita, así el
 * cambio queda en el historial con su nombre y su fundamento. Por eso el
 * fundamento se exige solo cuando hay un cambio real que asentar.
 */
function InvitePanel({
  busy,
  onBusy,
  onClose,
  onInvited,
}: {
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const { open, close } = useDismissible(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalShell(panelRef);
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<AppRole>("consulta");
  const [fundamento, setFundamento] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const requiereFundamento = rol !== "consulta";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirmDialogIsOpen() || busy) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, busy]);

  const validar = () => {
    const correo = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) {
      setError("Escribí un correo válido.");
      return;
    }
    if (requiereFundamento && fundamento.trim().length < ROLE_REASON_MIN_LENGTH) {
      setError(`El fundamento debe tener al menos ${ROLE_REASON_MIN_LENGTH} caracteres.`);
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const enviar = async () => {
    setConfirming(false);
    onBusy(true);
    setError(null);
    try {
      const result = await invitarUsuario({
        email: email.trim(),
        nombre: nombre.trim() || null,
        rol,
        fundamento: fundamento.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        toast(result.error ?? "No se pudo invitar a la cuenta.", "error");
        return;
      }
      toast(
        result.rolAsignado || !requiereFundamento
          ? `Invitación enviada a ${email.trim()} con rol ${ROLE_LABELS[rol]}.`
          : `Cuenta creada, pero el rol quedó en Consulta: asignalo desde la tabla.`,
        result.rolAsignado || !requiereFundamento ? "success" : "info",
      );
      await onInvited();
      close();
    } finally {
      onBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1100] grid place-items-center bg-ink/45 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={() => { if (!busy) close(); }}
      data-state={open ? "open" : "closed"}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Invitar cuenta municipal"
        className="w-full max-w-md rounded-2xl border border-white bg-white p-5 shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="micro-label">Alta de cuenta</span>
            <h2 className="font-display text-base font-extrabold text-ink">Invitar usuario</h2>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Cerrar" className="secondary-button compact"><X size={14}/></button>
        </div>

        <p className="mt-2 text-tiny leading-4 text-slate-500">
          Se envía una invitación por correo. La persona define su contraseña al aceptarla.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="micro-label">Correo</span>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              placeholder="nombre@smt.gob.ar"
              className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-tiny text-slate-700 outline-none focus:border-municipal-500"
            />
          </label>
          <label className="block">
            <span className="micro-label">Nombre (opcional)</span>
            <input
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              maxLength={120}
              placeholder="Cómo figura en el padrón"
              className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-tiny text-slate-700 outline-none focus:border-municipal-500"
            />
          </label>
          <label className="block">
            <span className="micro-label">Rol</span>
            <select
              value={rol}
              onChange={(event) => setRol(event.target.value as AppRole)}
              className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-tiny font-semibold text-slate-700 outline-none focus:border-municipal-500"
            >
              {APP_ROLES.map((item) => (
                <option key={item} value={item}>{ROLE_LABELS[item]}</option>
              ))}
            </select>
          </label>
          {requiereFundamento && (
            <label className="block">
              <span className="micro-label">Fundamento del rol (obligatorio)</span>
              <textarea
                value={fundamento}
                onChange={(event) => setFundamento(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder={`Por qué recibe este rol (mínimo ${ROLE_REASON_MIN_LENGTH} caracteres)`}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-tiny text-slate-700 outline-none focus:border-municipal-500"
              />
            </label>
          )}
          {!requiereFundamento && (
            <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-micro leading-4 text-slate-500">
              Una cuenta de consulta nace con ese rol: no hay cambio que fundamentar.
            </p>
          )}
        </div>

        {error && <p role="alert" className="mt-2 text-micro font-semibold text-red-700">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="secondary-button compact">Cancelar</button>
          <button
            type="button"
            onClick={validar}
            disabled={busy || !email.trim()}
            className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin"/> : <Mail size={13}/>}
            Enviar invitación
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Invitar cuenta municipal"
          description={`Se invitará a ${email.trim()} con rol ${ROLE_LABELS[rol]}.${requiereFundamento ? " El rol queda asentado en el historial con este fundamento:" : ""}`}
          quote={requiereFundamento ? fundamento.trim() : null}
          tone="approve"
          confirmLabel="Invitar"
          onConfirm={() => void enviar()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function UserRow({
  perfil,
  isSelf,
  editing,
  blocked,
  busy,
  draftRole,
  draftReason,
  formError,
  onEdit,
  onCancel,
  onRole,
  onReason,
  onSubmit,
  onHistory,
}: {
  perfil: PerfilMunicipal;
  isSelf: boolean;
  editing: boolean;
  blocked: boolean;
  busy: boolean;
  draftRole: AppRole;
  draftReason: string;
  formError: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onRole: (rol: AppRole) => void;
  onReason: (value: string) => void;
  onSubmit: () => void;
  onHistory: () => void;
}) {
  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-3 py-2 font-bold text-ink">
          {perfil.nombre || "Sin nombre"}
          {isSelf && <span className="ml-1.5 text-micro font-semibold text-slate-400">(vos)</span>}
        </td>
        <td className="max-w-[220px] truncate px-3 py-2 text-slate-500">{perfil.email || "—"}</td>
        <td className="px-3 py-2">
          <span className="badge-soft"><i style={{ background: ROLE_COLORS[perfil.rol] }}/>{ROLE_LABELS[perfil.rol]}</span>
        </td>
        <td className="px-3 py-2 text-slate-500">{fecha(perfil.rolCambiadoEn)}</td>
        <td className="px-3 py-2">
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={onHistory} className="secondary-button compact" title="Historial de roles">
              <History size={13}/>
            </button>
            <button
              type="button"
              onClick={editing ? onCancel : onEdit}
              disabled={blocked || isSelf || busy}
              title={isSelf ? "Nadie puede cambiar su propio rol." : "Cambiar rol"}
              className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserCog size={13}/>
              {editing ? "Cerrar" : "Cambiar rol"}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-t border-slate-100 bg-slate-50/70">
          <td colSpan={5} className="px-3 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <label className="flex flex-col gap-1">
                <span className="micro-label">Nuevo rol</span>
                <select
                  value={draftRole}
                  onChange={(event) => onRole(event.target.value as AppRole)}
                  className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-tiny font-semibold text-slate-700 outline-none focus:border-municipal-500"
                >
                  {APP_ROLES.map((rol) => (
                    <option key={rol} value={rol}>{ROLE_LABELS[rol]}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="micro-label">Fundamento (obligatorio)</span>
                <textarea
                  value={draftReason}
                  onChange={(event) => onReason(event.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder={`Por qué cambia el rol (mínimo ${ROLE_REASON_MIN_LENGTH} caracteres)`}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-tiny text-slate-700 outline-none focus:border-municipal-500"
                />
              </label>
              <button
                type="button"
                onClick={onSubmit}
                disabled={blocked || busy}
                className="primary-button compact justify-center self-end disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin"/> : <ShieldCheck size={13}/>}
                Aplicar cambio
              </button>
            </div>
            {formError && <p role="alert" className="mt-1.5 text-micro font-semibold text-red-700">{formError}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

/** Historial inmutable de cambios de rol de una cuenta. */
function RoleHistoryPanel({ perfil, onClose }: { perfil: PerfilMunicipal; onClose: () => void }) {
  const { open, close } = useDismissible(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalShell(panelRef);
  const [cambios, setCambios] = useState<CambioDeRol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadCambiosDeRol(perfil.userId).then((result) => {
      if (!active) return;
      setCambios(result.data);
      setError(result.ok ? null : result.error);
      setLoading(false);
    });
    return () => { active = false; };
  }, [perfil.userId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmDialogIsOpen()) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[1100] grid place-items-center bg-ink/45 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={close}
      data-state={open ? "open" : "closed"}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Historial de roles de ${perfil.nombre || perfil.email || "la cuenta"}`}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white bg-white p-5 shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="micro-label">Historial de roles</span>
            <h2 className="font-display text-base font-extrabold text-ink">{perfil.nombre || perfil.email || perfil.userId}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar" className="secondary-button compact"><X size={14}/></button>
        </div>

        {loading ? (
          <div className="mt-4 space-y-2" aria-label="Cargando historial">
            <div className="skeleton h-14 rounded-xl"/>
            <div className="skeleton h-14 rounded-xl"/>
          </div>
        ) : error ? (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-tiny font-semibold text-red-800">{error}</p>
        ) : cambios.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-tiny text-slate-500">
            Esta cuenta no registra cambios de rol. Conserva el que recibió al darse de alta.
          </p>
        ) : (
          <ol className="mt-4 space-y-2">
            {cambios.map((cambio) => (
              <li key={cambio.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="badge-soft"><i style={{ background: ROLE_COLORS[cambio.rolAnterior ?? "consulta"] }}/>{cambio.rolAnterior ? ROLE_LABELS[cambio.rolAnterior] : "Sin rol"}</span>
                  <span className="text-micro font-bold text-slate-400">→</span>
                  <span className="badge-soft"><i style={{ background: ROLE_COLORS[cambio.rolNuevo] }}/>{ROLE_LABELS[cambio.rolNuevo]}</span>
                </div>
                <p className="mt-1.5 text-tiny leading-4 text-slate-600">{cambio.fundamento}</p>
                <p className="mt-1 text-micro text-slate-400">
                  {[
                    cambio.actorNombre,
                    cambio.actorRol ? ROLE_LABELS[cambio.actorRol] : null,
                    new Date(cambio.createdAt).toLocaleString("es-AR"),
                  ].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3" aria-label="Cargando usuarios">
      <div className="skeleton h-8 rounded-lg"/>
      <div className="skeleton h-9 rounded-lg"/>
      <div className="skeleton h-9 rounded-lg"/>
    </div>
  );
}
