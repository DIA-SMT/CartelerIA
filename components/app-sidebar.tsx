"use client";

import { useEffect, useRef, useState } from "react";
import {
  ClipboardCheck,
  FolderOpen,
  Gauge,
  Home,
  Library,
  Map as MapIcon,
  Menu,
  Route,
  Settings,
  Signpost,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { APPROVALS_COUNT_EVENT } from "@/data/approvals";
import { useAuth } from "@/hooks/use-auth";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";

/**
 * Escala de z-index del proyecto, que hasta ahora estaba repartida por el
 * código. Se documenta acá porque este cajón tuvo que ubicarse dentro de ella:
 *
 *     1     main y footer
 *    90     visor de PDF
 *   500-700 controles del mapa y ficha de cartel
 *  1000     barra superior, paneles de sesión, alta e inspección
 *  1050     ESTE CAJÓN — sobre la barra y el mapa, bajo todo panel modal
 *  1100     paneles de Configuración (historial de roles, invitación)
 *  1200     confirm-dialog
 *  1300     lightbox de fotografías
 *  1400     toasts
 *  2000     recorrido guiado
 *
 * Nota conocida: el visor de PDF quedó en 90, o sea por debajo de la barra
 * superior. Es una inconsistencia previa a este componente y se dejó como
 * estaba: subirlo taparía el encabezado, que hoy permanece visible mientras se
 * lee un documento.
 */
const SIDEBAR_Z_INDEX = 1050;

type SidebarItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

type SidebarGroup = {
  titulo: string;
  items: SidebarItem[];
};

const NAVEGACION: SidebarItem[] = [
  { href: "#inicio", label: "Inicio", icon: Home },
  { href: "#mapa", label: "Mapa", icon: MapIcon },
  { href: "#carteles", label: "Carteles", icon: Signpost },
  { href: "#documentos", label: "Documentos", icon: Library },
  { href: "#corredores", label: "Corredores", icon: Route },
];

/**
 * Único punto de navegación de la aplicación.
 *
 * Se desliza POR ENCIMA del contenido y no lo empuja: es lo que evita que
 * Leaflet tenga que recalcular su tamaño, que el spotlight del recorrido
 * guiado se reposicione y que los anclajes apunten a otro lado.
 */
export function AppSidebar() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Contador de aprobaciones pendientes: lo publica la bandeja al refrescar.
  // Vive acá y en ningún otro lado: antes lo escuchaba el header.
  useEffect(() => {
    const onCount = (event: Event) => setPendingApprovals((event as CustomEvent<number>).detail);
    window.addEventListener(APPROVALS_COUNT_EVENT, onCount);
    return () => window.removeEventListener(APPROVALS_COUNT_EVENT, onCount);
  }, []);

  // Perder la sesión cierra el cajón: puede estar mostrando items de gestión.
  useEffect(() => {
    if (!auth.user) setOpen(false);
  }, [auth.user]);

  const isAdmin = auth.canRead && auth.role === "administrador";
  const grupos: SidebarGroup[] = [
    { titulo: "Navegación", items: NAVEGACION },
    ...(auth.canRead
      ? [{
          titulo: "Gestión",
          items: [
            { href: "#indicadores", label: "Indicadores", icon: Gauge },
            { href: "#expedientes", label: "Expedientes", icon: FolderOpen },
          ],
        }]
      : []),
    ...(isAdmin
      ? [{
          titulo: "Administración",
          items: [
            { href: "#aprobaciones", label: "Aprobaciones", icon: ClipboardCheck, badge: pendingApprovals },
            { href: "#configuracion", label: "Configuración", icon: Settings },
          ],
        }]
      : []),
  ];

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú de navegación"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-2.5 text-tiny font-bold text-slate-600 transition duration-fast hover:border-municipal-300 hover:text-municipal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-municipal-500 focus-visible:ring-offset-2"
      >
        <Menu size={18}/>
        <span className="hidden sm:inline">Menú</span>
      </button>

      {open && (
        <SidebarDrawer
          grupos={grupos}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SidebarDrawer({ grupos, onClose }: { grupos: SidebarGroup[]; onClose: () => void }) {
  // 200ms: el mismo valor que la clase `duration-200` de abajo, para que el
  // desmontaje no corte la animación de salida. Ojo: el token `DEFAULT` de
  // tailwind.config (250ms) NO tiene clase utilitaria — ni `duration` ni
  // `duration-DEFAULT` se generan—, así que los overlays usan `duration-200`.
  const { open, close } = useDismissible(onClose, 200);
  const panelRef = useRef<HTMLDivElement>(null);
  // Scroll lock apilado, foco inicial, trampa de Tab y restitución del foco al
  // cerrar. Antes el header resolvía todo esto a mano; ya no.
  useModalShell(panelRef);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: SIDEBAR_Z_INDEX }}
      data-state={open ? "open" : "closed"}
    >
      {/* Telón: solo opacidad. */}
      <button
        type="button"
        aria-label="Cerrar menú"
        onClick={close}
        className="absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px] transition-opacity duration-200 ease-out"
        style={{ opacity: open ? 1 : 0 }}
      />

      {/* Panel: solo transform. Nada de animar width, left ni box-shadow. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        className="absolute inset-y-0 left-0 flex w-[86vw] max-w-xs flex-col border-r border-black/5 bg-white/95 shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-out will-change-transform"
        style={{ transform: open ? "translate3d(0,0,0)" : "translate3d(-100%,0,0)" }}
      >
        <div className="flex h-[72px] shrink-0 items-center justify-between gap-2 border-b border-black/5 px-4">
          <span className="micro-label">Navegar</span>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar menú"
            className="icon-button grid"
          >
            <X size={19}/>
          </button>
        </div>

        <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-4">
          {grupos.map((grupo) => (
            <div key={grupo.titulo} className="mb-4 last:mb-0">
              <span className="micro-label px-2">{grupo.titulo}</span>
              <ul className="mt-1.5 grid gap-0.5">
                {grupo.items.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={close}
                      className="flex items-center gap-2.5 rounded-xl px-2 py-2.5 text-tiny font-bold text-slate-600 transition duration-fast hover:bg-municipal-50 hover:text-municipal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-municipal-500"
                    >
                      <item.icon size={16} className="shrink-0 text-slate-400"/>
                      <span className="flex-1">{item.label}</span>
                      {Boolean(item.badge) && (
                        <span className="badge-soft" aria-label={`${item.badge} pendientes`}>
                          <i style={{ background: "#f59e0b" }}/>
                          {(item.badge ?? 0) > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
