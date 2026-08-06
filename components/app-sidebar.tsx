"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ClipboardCheck,
  FolderOpen,
  Gauge,
  Home,
  Library,
  Map as MapIcon,
  Menu,
  Route,
  Scale,
  Settings,
  Signpost,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { APPROVALS_COUNT_EVENT } from "@/data/approvals";
import { useAuth } from "@/hooks/use-auth";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";
import type { AppRole } from "@/lib/roles";

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

const ROLE_LABELS: Record<AppRole, string> = {
  administrador: "Administrador",
  coordinador: "Coordinador",
  inspector: "Inspector",
  consulta: "Consulta",
};

const ROLE_COLORS: Record<AppRole, string> = {
  administrador: "#0166FF",
  coordinador: "#0891b2",
  inspector: "#16a34a",
  consulta: "#64748b",
};

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

/**
 * El orden de esta lista es el mismo en el que aparecen las secciones al
 * scrollear. No es cosmético: si el menú y la página discrepan, hacer clic en
 * un ítem "salta" secciones y desorienta.
 */
const NAVEGACION: SidebarItem[] = [
  { href: "#inicio", label: "Inicio", icon: Home },
  { href: "#mapa", label: "Mapa", icon: MapIcon },
  { href: "#carteles", label: "Carteles", icon: Signpost },
  { href: "#normativa", label: "Normativa", icon: Scale },
  { href: "#documentos", label: "Documentos", icon: Library },
  { href: "#corredores", label: "Corredores", icon: Route },
];

/** Secciones que el marcador de posición mira al scrollear. */
const SECCIONES_OBSERVABLES = new Set([
  ...NAVEGACION.map((item) => item.href),
  "#indicadores",
  "#expedientes",
  "#aprobaciones",
]);

/**
 * Único punto de navegación de la aplicación.
 *
 * El cajón se dibuja en un portal sobre `document.body`, no donde está el
 * botón. No es un capricho: la barra superior tiene `backdrop-blur`, y un
 * `backdrop-filter` convierte a ese elemento en el bloque contenedor de sus
 * descendientes `position: fixed`. Sin el portal, el cajón queda encerrado
 * dentro de los 72px de alto del header.
 *
 * Se desliza POR ENCIMA del contenido y no lo empuja: es lo que evita que
 * Leaflet tenga que recalcular su tamaño, que el spotlight del recorrido
 * guiado se reposicione y que los anclajes apunten a otro lado.
 */
export function AppSidebar() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [montado, setMontado] = useState(false);
  const [activo, setActivo] = useState("#inicio");
  const toggleRef = useRef<HTMLButtonElement>(null);

  // El portal solo existe en el navegador.
  useEffect(() => setMontado(true), []);

  // Sección actual mientras se scrollea. Se calcula acá, en el componente que
  // está siempre montado, para que al abrir el cajón la marca ya esté puesta y
  // no aparezca un parpadeo.
  //
  // Es una lectura de posiciones, no un IntersectionObserver: hay menos de diez
  // secciones y así el criterio queda explícito —la última cuyo borde superior
  // pasó por debajo de la barra— en vez de depender de umbrales de visibilidad
  // que se comportan raro con secciones muy altas como el mapa.
  useEffect(() => {
    const OFFSET = 96; // 72px de barra + aire
    let pendiente = false;

    const recalcular = () => {
      pendiente = false;
      if (window.location.hash.startsWith("#configuracion")) {
        setActivo("#configuracion");
        return;
      }
      // `target: es5` no deja iterar un NodeList directamente.
      const secciones = Array.from(document.querySelectorAll<HTMLElement>("[id]"))
        .filter((elemento) => SECCIONES_OBSERVABLES.has(`#${elemento.id}`));

      let actual = "#inicio";
      secciones.forEach((elemento) => {
        if (elemento.getBoundingClientRect().top <= OFFSET) actual = `#${elemento.id}`;
      });

      // Al final de la página gana la última sección, aunque su borde no haya
      // llegado a cruzar la barra: si no, nunca se marca.
      const ultima = secciones[secciones.length - 1];
      if (ultima && window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        actual = `#${ultima.id}`;
      }
      setActivo(actual);
    };

    const alScrollear = () => {
      if (pendiente) return;
      pendiente = true;
      window.setTimeout(recalcular, 120);
    };

    recalcular();
    window.addEventListener("scroll", alScrollear, { passive: true });
    window.addEventListener("hashchange", recalcular);
    return () => {
      window.removeEventListener("scroll", alScrollear);
      window.removeEventListener("hashchange", recalcular);
    };
  }, []);

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
    // Gestión y Administración también siguen el orden de la página. La
    // excepción es Configuración, que no está en el scroll: es una pantalla
    // aparte y va última, como corresponde a una herramienta.
    ...(auth.canRead
      ? [{
          titulo: "Área de trabajo",
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

      {open && montado && createPortal(
        <SidebarDrawer
          grupos={grupos}
          rol={auth.canRead ? auth.role : null}
          activo={activo}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  );
}

function SidebarDrawer({
  grupos,
  rol,
  activo,
  onClose,
}: {
  grupos: SidebarGroup[];
  rol: AppRole | null;
  activo: string;
  onClose: () => void;
}) {
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
        className="absolute inset-y-0 left-0 flex w-[87vw] max-w-[19rem] flex-col border-r border-black/5 bg-white/95 shadow-2xl backdrop-blur-xl transition-transform duration-200 ease-out will-change-transform"
        style={{ transform: open ? "translate3d(0,0,0)" : "translate3d(-100%,0,0)" }}
      >
        {/* Identidad, a la misma altura que la barra superior: al abrir el
            cajón el logo queda exactamente donde estaba. */}
        <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-black/5 px-4">
          <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-100">
            <Image src="/logo-municipalidad-smt.png" alt="" width={38} height={38}/>
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate font-display text-tiny tracking-tight text-ink">
              Cartelería Urbana
            </strong>
            <small className="block truncate text-micro font-semibold uppercase tracking-[.14em] text-slate-400">
              San Miguel de Tucumán
            </small>
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar menú"
            className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-400 transition duration-fast hover:bg-slate-100 hover:text-municipal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-municipal-500"
          >
            <X size={18}/>
          </button>
        </div>

        <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          {grupos.map((grupo, indice) => (
            <div key={grupo.titulo} className={indice > 0 ? "mt-5 border-t border-slate-100 pt-4" : ""}>
              <span className="micro-label px-2">{grupo.titulo}</span>
              <ul className="mt-2 grid gap-1">
                {grupo.items.map((item) => {
                  const esActivo = item.href === activo;
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        onClick={close}
                        aria-current={esActivo ? "page" : undefined}
                        className={`group flex items-center gap-2.5 rounded-xl px-2 py-2 text-tiny font-bold transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-municipal-500 ${
                          esActivo
                            ? "bg-municipal-50 text-municipal-700"
                            : "text-slate-600 hover:bg-slate-50 hover:text-municipal-700"
                        }`}
                      >
                        <span
                          className={`grid size-8 shrink-0 place-items-center rounded-lg transition duration-fast ${
                            esActivo
                              ? "bg-municipal-600 text-white"
                              : "bg-slate-100 text-slate-500 group-hover:bg-municipal-100 group-hover:text-municipal-700"
                          }`}
                        >
                          <item.icon size={16}/>
                        </span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {Boolean(item.badge) && (
                          <span className="badge-soft shrink-0" aria-label={`${item.badge} pendientes`}>
                            <i style={{ background: "#f59e0b" }}/>
                            {(item.badge ?? 0) > 99 ? "99+" : item.badge}
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Pie: con qué rol se está mirando. Es la pregunta que uno se hace
            cuando algo no aparece en pantalla. */}
        <div className="shrink-0 border-t border-black/5 px-4 py-3">
          {rol ? (
            <span className="badge-soft">
              <i style={{ background: ROLE_COLORS[rol] }}/>
              {ROLE_LABELS[rol]}
            </span>
          ) : (
            <span className="text-micro font-semibold text-slate-400">
              Sesión no iniciada · solo capas territoriales
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
