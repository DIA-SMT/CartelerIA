"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, FileLock2, ScrollText, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { TabAuditoria } from "./tab-auditoria";
import { TabCorpus } from "./tab-corpus";
import { TabRoles } from "./tab-roles";
import { TabSeguridad } from "./tab-seguridad";
import { TabUsuarios } from "./tab-usuarios";

type TabKey = "usuarios" | "roles" | "auditoria" | "seguridad" | "corpus";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "usuarios", label: "Usuarios", icon: Users },
  { key: "roles", label: "Roles y permisos", icon: ShieldCheck },
  { key: "auditoria", label: "Auditoría", icon: ScrollText },
  { key: "seguridad", label: "Seguridad", icon: FileLock2 },
  { key: "corpus", label: "Corpus documental", icon: Database },
];

function esTab(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

/** Lee la pestaña del hash: #configuracion?tab=auditoria */
function tabDelHash(): TabKey {
  if (typeof window === "undefined") return "usuarios";
  const hash = window.location.hash;
  const separador = hash.indexOf("?");
  if (separador === -1) return "usuarios";
  const tab = new URLSearchParams(hash.slice(separador + 1)).get("tab");
  return esTab(tab) ? tab : "usuarios";
}

/**
 * Administración del sistema: identidades, permisos, auditoría y estado.
 *
 * Se monta solo para el rol administrador, y el dashboard la carga con
 * `dynamic()` para que no entre en el bundle inicial: es la sección más pesada
 * de la aplicación y la ve una sola persona.
 *
 * La pestaña vive en la URL para que sea enlazable: se puede mandar
 * `#configuracion?tab=auditoria` en un correo y abre donde corresponde.
 */
export default function Configuracion() {
  const auth = useAuth();
  const isAdmin = auth.canRead && auth.role === "administrador";
  const [tab, setTab] = useState<TabKey>("usuarios");
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

  // La URL manda al montar y ante cualquier cambio de hash (enlaces externos).
  useEffect(() => {
    const sincronizar = () => setTab(tabDelHash());
    sincronizar();
    window.addEventListener("hashchange", sincronizar);
    return () => window.removeEventListener("hashchange", sincronizar);
  }, []);

  const irA = useCallback((key: TabKey, mueveFoco = false) => {
    setTab(key);
    // replaceState en vez de asignar location.hash: cambiar el hash volvería a
    // scrollear a la sección y el foco saltaría de la fila de pestañas.
    window.history.replaceState(null, "", `#configuracion?tab=${key}`);
    if (mueveFoco) tabRefs.current[key]?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const indice = TABS.findIndex((item) => item.key === tab);
    if (indice === -1) return;
    let destino: number | null = null;
    if (event.key === "ArrowRight") destino = (indice + 1) % TABS.length;
    if (event.key === "ArrowLeft") destino = (indice - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") destino = 0;
    if (event.key === "End") destino = TABS.length - 1;
    if (destino === null) return;
    event.preventDefault();
    irA(TABS[destino].key, true);
  };

  // Fail-closed: sin rol administrador la sección no existe. La nav tampoco la
  // ofrece, pero un enlace directo tiene que encontrarse con nada.
  if (!isAdmin) return null;

  return (
    <section id="configuracion" className="section-block">
      <header className="max-w-2xl">
        <span className="micro-label">Administración del sistema</span>
        <h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Configuración
        </h2>
        <p className="mt-2 text-tiny leading-5 text-slate-500">
          Usuarios, roles, auditoría y estado del sistema. Las identidades se administran
          con Supabase Auth; acá se define qué puede hacer cada cuenta.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Secciones de configuración"
        onKeyDown={onKeyDown}
        className="mt-5 flex flex-wrap gap-1.5"
      >
        {TABS.map((item) => {
          const activo = item.key === tab;
          return (
            <button
              key={item.key}
              ref={(node) => { tabRefs.current[item.key] = node; }}
              type="button"
              role="tab"
              id={`tab-${item.key}`}
              aria-selected={activo}
              aria-controls={`panel-${item.key}`}
              tabIndex={activo ? 0 : -1}
              onClick={() => irA(item.key)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-tiny font-bold transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-municipal-500 focus-visible:ring-offset-2 ${
                activo
                  ? "border-municipal-600 bg-municipal-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-municipal-300 hover:text-municipal-700"
              }`}
            >
              <item.icon size={14}/>
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="mt-5 focus-visible:outline-none"
      >
        {tab === "usuarios" && <TabUsuarios/>}
        {tab === "roles" && <TabRoles/>}
        {tab === "auditoria" && <TabAuditoria/>}
        {tab === "seguridad" && <TabSeguridad/>}
        {tab === "corpus" && <TabCorpus/>}
      </div>
    </section>
  );
}
