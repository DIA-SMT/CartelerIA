"use client";

import { MapPin } from "lucide-react";
import { animate, createAnimatable, createScope, stagger, utils } from "animejs";
import { useEffect, useMemo, useRef } from "react";

const COLUMNS = 7;
const ROWS = 5;
const PIECES = COLUMNS * ROWS;
const irregularShapes = [
  "polygon(0 0,100% 0,94% 47%,100% 100%,0 100%,7% 56%)",
  "polygon(4% 0,100% 0,100% 100%,5% 100%,0 58%,8% 39%)",
  "polygon(0 0,91% 0,100% 39%,94% 100%,0 100%,6% 51%)",
  "polygon(7% 0,100% 0,94% 53%,100% 100%,0 100%,0 34%)",
  "polygon(0 0,100% 0,93% 41%,100% 100%,8% 100%,0 63%)",
];

const markers = [
  { left: "28%", top: "31%" },
  { left: "48%", top: "22%" },
  { left: "62%", top: "43%" },
  { left: "39%", top: "62%" },
  { left: "74%", top: "68%" },
];

export function TryhardHeroMap() {
  const root = useRef<HTMLDivElement>(null);
  const pieces = useMemo(() => Array.from({ length: PIECES }, (_, index) => ({
    index,
    column: index % COLUMNS,
    row: Math.floor(index / COLUMNS),
  })), []);

  useEffect(() => {
    if (!root.current) return;

    const scope = createScope({
      root,
      mediaQueries: {
        mobile: "(max-width: 767px)",
        reducedMotion: "(prefers-reduced-motion: reduce)",
      },
    }).add(self => {
      const container = root.current;
      const map = container?.querySelector<HTMLElement>(".tryhard-map-tilt");
      const mapPieces = Array.from(container?.querySelectorAll<HTMLElement>(".tryhard-map-piece") ?? []);
      const mapBase = container?.querySelector<HTMLElement>(".tryhard-map-base");
      const mobile = self?.matches.mobile ?? false;
      const reducedMotion = self?.matches.reducedMotion ?? false;
      let pieceAnimations: ReturnType<typeof animate>[] = [];
      let exploded = false;

      if (!container || !map) return;

      if (reducedMotion) {
        utils.set(".tryhard-map-piece", { opacity: 1, scale: 1, x: 0, y: 0 });
        utils.set(".tryhard-map-shell", { opacity: 1, scale: 1, y: 0 });
        utils.set(".tryhard-analysis-line", { opacity: .4 });
        return;
      }

      animate(".tryhard-map-shell", {
        opacity: [0, 1],
        scale: [.92, 1],
        y: [mobile ? 14 : 28, 0],
        duration: mobile ? 900 : 1150,
        ease: "out(4)",
      });

      animate(".tryhard-map-piece", {
        opacity: [0, 1],
        scale: [.92, 1],
        y: [mobile ? 8 : 15, 0],
        delay: stagger(mobile ? 10 : 22, { grid: [COLUMNS, ROWS], from: "center" }),
        duration: mobile ? 620 : 820,
        ease: "out(3)",
      });

      animate(".tryhard-map-glow", {
        opacity: [.5, .86],
        scale: [1, 1.08],
        duration: 4800,
        alternate: true,
        loop: true,
        ease: "inOut(2)",
      });

      animate(".tryhard-marker", {
        opacity: [.42, 1],
        scale: [.78, 1.24],
        delay: stagger(260),
        duration: 1800,
        alternate: true,
        loop: true,
        ease: "inOut(2)",
      });

      animate(".tryhard-analysis-line", {
        opacity: [.14, .55],
        strokeDashoffset: [42, 0],
        delay: stagger(380),
        duration: 3400,
        alternate: true,
        loop: true,
        ease: "inOut(2)",
      });

      animate(".tryhard-scan", {
        y: ["-140%", "520%"],
        opacity: [0, .5, 0],
        duration: 5200,
        delay: 1200,
        loop: true,
        ease: "inOut(2)",
      });

      if (mobile) return;

      const tilt = createAnimatable(map, {
        x: 520,
        y: 520,
        rotateX: 650,
        rotateY: 650,
        ease: "out(3)",
      });

      const clearPieceAnimations = () => {
        pieceAnimations.forEach(animation => animation.revert());
        pieceAnimations = [];
      };

      const setPiecesExploded = (exploded: boolean) => {
        clearPieceAnimations();
        if (mapBase) pieceAnimations.push(animate(mapBase, { opacity: exploded ? 0 : 1, duration: 500, ease: "out(3)" }));
        mapPieces.forEach((piece, index) => {
          const column = index % COLUMNS;
          const row = Math.floor(index / COLUMNS);
          const vectorX = (column - (COLUMNS - 1) / 2) / ((COLUMNS - 1) / 2);
          const vectorY = (row - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
          pieceAnimations.push(animate(piece, {
            x: exploded ? vectorX * 32 : 0,
            y: exploded ? vectorY * 26 : 0,
            scale: exploded ? .94 : 1,
            duration: exploded ? 650 : 800,
            ease: "out(4)",
          }));
        });
      };

      const onPointerMove = (event: PointerEvent) => {
        const x = event.clientX / window.innerWidth - .5;
        const y = event.clientY / window.innerHeight - .5;
        tilt.x(x * 20);
        tilt.y(y * 16);
        tilt.rotateY(x * 20);
        tilt.rotateX(y * -16);
      };

      const onBackgroundClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("a,button,input,select,textarea,article,[role='button'],.leaflet-container,.leaflet-control")) return;
        exploded = !exploded;
        container.dataset.exploded = String(exploded);
        setPiecesExploded(exploded);
      };

      const onPointerLeave = (event: MouseEvent) => {
        if (event.relatedTarget) return;
        tilt.x(0);
        tilt.y(0);
        tilt.rotateX(0);
        tilt.rotateY(0);
      };

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("click", onBackgroundClick, true);
      document.documentElement.addEventListener("mouseout", onPointerLeave);

      return () => {
        clearPieceAnimations();
        window.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("click", onBackgroundClick, true);
        document.documentElement.removeEventListener("mouseout", onPointerLeave);
      };
    });

    return () => scope.revert();
  }, []);

  return (
    <div ref={root} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden px-3 [perspective:1200px]">
      <div className="relative w-[96vw] max-w-[1010px] opacity-[.17] sm:w-[90vw] sm:opacity-[.2] lg:w-[68vw] lg:opacity-[.24]">
      <div className="tryhard-map-glow absolute inset-[7%] rounded-full bg-[radial-gradient(circle,rgba(45,176,255,.38)_0%,rgba(1,102,255,.17)_45%,transparent_72%)] blur-[45px] will-change-transform" />

      <div className="tryhard-map-shell relative opacity-0 will-change-transform">
        <div className="tryhard-map-tilt relative will-change-transform [transform-style:preserve-3d]">
          <div className="relative aspect-[678/508] overflow-hidden rounded-[28px] border border-white/90 bg-white/75 p-2.5 shadow-[0_28px_90px_rgba(1,102,255,.18)] backdrop-blur sm:p-3.5">
            <div className="relative size-full overflow-hidden rounded-[20px] bg-[#eaf5ff]">
              <div className="tryhard-map-base absolute inset-0 bg-[url('/images/hero-map-smt.png')] bg-cover bg-center bg-no-repeat" />
              <div className="absolute inset-0 grid grid-cols-7 grid-rows-5 overflow-hidden">
                {pieces.map(({ index, column, row }) => (
                  <div
                    key={index}
                    className="tryhard-map-piece opacity-0"
                    style={{
                      backgroundImage: "url('/images/hero-map-smt.png')",
                      backgroundRepeat: "no-repeat",
                      backgroundSize: `${COLUMNS * 100}% ${ROWS * 100}%`,
                      backgroundPosition: `${column === 0 ? 0 : column / (COLUMNS - 1) * 100}% ${row === 0 ? 0 : row / (ROWS - 1) * 100}%`,
                      clipPath: irregularShapes[(index + row * 2) % irregularShapes.length],
                    }}
                  />
                ))}
              </div>

              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 678 508" fill="none">
                <path className="tryhard-analysis-line" d="M118 179C225 124 313 145 407 199C481 242 531 220 594 165" stroke="#2DB0FF" strokeWidth="2" strokeLinecap="round" strokeDasharray="10 13" />
                <path className="tryhard-analysis-line" d="M169 337C250 275 347 269 426 318C481 352 527 352 582 315" stroke="#0166FF" strokeWidth="2" strokeLinecap="round" strokeDasharray="9 14" />
                <path className="tryhard-analysis-line" d="M324 78C342 150 334 213 306 269C282 319 297 377 348 430" stroke="#F4DC00" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="7 15" />
              </svg>

              {markers.map((marker, index) => <span key={index} className="tryhard-marker pointer-events-none absolute size-2.5 rounded-full border-2 border-white bg-[#F4DC00] shadow-[0_0_0_5px_rgba(244,220,0,.18),0_0_18px_rgba(244,220,0,.85)] will-change-transform" style={marker} />)}

              <div className="tryhard-scan pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-[#2DB0FF]/30 to-transparent opacity-0 will-change-transform" />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,.12),transparent_34%,rgba(45,176,255,.08))] ring-1 ring-inset ring-[#0166FF]/10" />
            </div>
          </div>
        </div>

        <div className="absolute -bottom-3 left-5 hidden items-center gap-2 rounded-xl border border-white bg-white/95 px-3.5 py-2.5 text-[10px] font-extrabold text-[#0166FF] shadow-lg sm:flex">
          <span className="grid size-6 place-items-center rounded-lg bg-[#0166FF] text-white"><MapPin size={13}/></span>
          Modelo territorial interactivo
        </div>
      </div>
      </div>
    </div>
  );
}
