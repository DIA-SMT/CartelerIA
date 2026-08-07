"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileJson, FolderOpen, RotateCcw } from "lucide-react";
import {
  aplicarCorreccion,
  contarCambios,
  leerArchivoOcr,
  type ArchivoOcr,
} from "@/lib/ocr-archivo";
import { toast } from "../toaster";

/**
 * Corrección del OCR, con el PDF al lado.
 *
 * El archivo se abre desde el disco y se descarga corregido: no pasa por el
 * servidor ni por la base. No es una limitación, es dónde vive la verdad — el
 * ingest deriva los fragmentos de `data/ocr/<id>.json`, así que una corrección
 * guardada en la base la pisaría la próxima reingesta sin avisar.
 *
 * Se edita por página y no por fragmento porque el archivo tiene páginas: los
 * fragmentos los arma el ingest después, partiendo el texto. Corregir el
 * fragmento sería corregir el derivado.
 */
export function CorregirOcr({
  documentoId,
  onPendiente,
}: {
  documentoId: string;
  /**
   * Avisa al panel si hay correcciones sin descargar. El editor vive en
   * memoria: si se cierra sin bajar el archivo, el trabajo se pierde y no queda
   * rastro en ningún lado.
   */
  onPendiente: (hay: boolean) => void;
}) {
  const [archivo, setArchivo] = useState<ArchivoOcr | null>(null);
  const [textos, setTextos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const entradaRef = useRef<HTMLInputElement>(null);

  const pendientes = archivo ? contarCambios(archivo, textos) : 0;

  useEffect(() => {
    onPendiente(pendientes > 0);
    return () => onPendiente(false);
  }, [pendientes, onPendiente]);

  // Recargar o cerrar la pestaña también se lleva las correcciones puestas.
  useEffect(() => {
    if (pendientes === 0) return;
    const avisar = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendientes]);

  const abrir = async (lista: FileList | null) => {
    const elegido = lista?.[0];
    if (!elegido) return;
    const resultado = leerArchivoOcr(await elegido.text(), documentoId);
    if (!resultado.ok || !resultado.archivo) {
      setError(resultado.error);
      setArchivo(null);
      return;
    }
    setError(null);
    setArchivo(resultado.archivo);
    setTextos(resultado.archivo.paginas.map((item) => item.texto));
    setPagina(0);
  };

  const descargar = () => {
    if (!archivo) return;
    const corregido = aplicarCorreccion(archivo, textos, new Date().toISOString());
    const blob = new Blob([JSON.stringify(corregido, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `${documentoId}.json`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
    toast("Archivo descargado. Reemplazalo en data/ocr/ y corré npm run ingest:docs.");
  };

  if (!archivo) {
    return (
      <div className="empty-state">
        <span><FileJson size={22}/></span>
        <h3>Abrí el archivo de OCR</h3>
        <p>
          Está en <span className="font-mono">data/ocr/{documentoId}.json</span>, dentro del
          repositorio. Se abre acá, se corrige contra el PDF y se descarga: el archivo es
          de donde el ingest saca los fragmentos, así que corregir solo la base no
          serviría de nada.
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-micro font-semibold text-red-800">
            {error}
          </p>
        )}
        <input
          ref={entradaRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => void abrir(event.target.files)}
        />
        <button type="button" onClick={() => entradaRef.current?.click()} className="primary-button compact">
          <FolderOpen size={13}/>
          Elegir el archivo
        </button>
      </div>
    );
  }

  const actual = archivo.paginas[pagina]!;
  const cambios = pendientes;
  const pdf = archivo.archivo ? `/docs/${archivo.archivo}#page=${actual.pagina}` : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {archivo.paginas.map((item, indice) => {
            const activa = indice === pagina;
            const tocada = textos[indice] !== item.texto;
            return (
              <button
                key={item.pagina}
                type="button"
                onClick={() => setPagina(indice)}
                aria-current={activa ? "true" : undefined}
                className={`min-h-8 rounded-lg px-2.5 text-micro font-bold transition duration-fast ${
                  activa ? "bg-municipal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Pág. {item.pagina}
                {tocada && <span aria-label="con cambios"> ·</span>}
              </button>
            );
          })}
        </div>
        <span className="badge-soft">
          <i style={{ background: (actual.confianza ?? 100) < 70 ? "#dc2626" : "#16a34a" }}/>
          confianza del OCR {actual.confianza ?? "—"}
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {pdf ? (
          <iframe
            key={pdf}
            src={pdf}
            title={`Página ${actual.pagina} del PDF`}
            className="h-[26rem] w-full rounded-xl border border-slate-200 bg-slate-50"
          />
        ) : (
          <p className="rounded-xl bg-slate-50 p-3 text-micro text-slate-500">
            El archivo no dice de qué PDF salió, así que no se puede mostrar al lado.
          </p>
        )}

        <div>
          <label className="block">
            <span className="micro-label">Texto de la página {actual.pagina}</span>
            <textarea
              value={textos[pagina] ?? ""}
              onChange={(event) => {
                const copia = [...textos];
                copia[pagina] = event.target.value;
                setTextos(copia);
              }}
              spellCheck
              className="mt-1 h-[23.5rem] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-micro leading-4 text-slate-700 outline-none focus:border-municipal-500"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const copia = [...textos];
              copia[pagina] = actual.texto;
              setTextos(copia);
            }}
            disabled={textos[pagina] === actual.texto}
            className="secondary-button compact mt-1.5 disabled:opacity-40"
          >
            <RotateCcw size={13}/>
            Deshacer esta página
          </button>
        </div>
      </div>

      <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 ${
        cambios > 0 ? "bg-amber-50" : "bg-slate-50"
      }`}>
        <p className={`text-micro leading-4 ${cambios > 0 ? "text-amber-900" : "text-slate-500"}`}>
          {cambios === 0 ? (
            <>
              Todavía no cambiaste nada. La confianza del OCR no se toca: es una medición y
              sigue siendo cierta. Lo que se agrega es la marca de que hubo corrección humana.
            </>
          ) : (
            <>
              <b>
                {cambios} página{cambios === 1 ? "" : "s"} con cambios sin descargar.
              </b>{" "}
              Esto vive en la pantalla: si cerrás sin bajar el archivo, se pierde.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={descargar}
          disabled={cambios === 0}
          title={cambios === 0 ? "No hay correcciones para bajar." : "Descargar el archivo corregido"}
          className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={13}/>
          Descargar OCR corregido
        </button>
      </div>

      <p className="mt-2 text-micro leading-4 text-slate-500">
        Después de descargarlo: reemplazá{" "}
        <span className="font-mono">data/ocr/{documentoId}.json</span> con el archivo nuevo y
        corré <span className="font-mono">npm run ingest:docs</span>. Recién ahí los
        fragmentos de la base quedan con el texto corregido.
      </p>
    </div>
  );
}
