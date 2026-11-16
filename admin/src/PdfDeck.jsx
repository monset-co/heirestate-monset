// The dashboard's PDF reader and presenter (dashboard-monset/src/pages/present/PdfDeck.tsx), loaded
// lazily so pdf.js only downloads when someone opens a PDF.
// Keys: → / Space / PageDown next, ← / PageUp back, Home / End, F full screen, Esc close.
// Touch: swipe, or tap the right / left half.
import { ChevronLeft, ChevronRight, Maximize, Minimize, X } from "lucide-react";
// Legacy build: the modern one needs brand-new JS and fails on many phones.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** `reading`: pages of a document; otherwise slides, presented to a client. `extra` sits by the controls. */
export default function PdfDeck({ url, title, onClose, reading = false, extra }) {
  const noun = reading ? "page" : "slide";
  const stage = useRef(null);
  const canvas = useRef(null);
  const [doc, setDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const swipe = useRef(null);
  const total = doc?.numPages ?? 0;
  const go = (n) => setPage((p) => Math.min(Math.max(n === Infinity ? total : n === -Infinity ? 1 : p + n, 1), Math.max(total, 1)));

  useEffect(() => {
    // a file a client sent is still a stranger's file: no script in it ever runs
    const task = pdfjs.getDocument({ url, isEvalSupported: false, enableScripting: false });
    task.promise.then(setDoc, (e) => setError(e.message));
    return () => task.destroy();
  }, [url]);

  // the page as large as the screen allows, sharp on high-DPI displays; redrawn on resize
  useEffect(() => {
    if (!doc || !stage.current) return;
    let task = null;
    let alive = true;
    const draw = async () => {
      const p = await doc.getPage(page);
      if (!alive || !stage.current || !canvas.current) return;
      const box = stage.current.getBoundingClientRect();
      const base = p.getViewport({ scale: 1 });
      const fit = Math.min(box.width / base.width, box.height / base.height);
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: fit * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / dpr)}px`;
      c.style.height = `${Math.floor(vp.height / dpr)}px`;
      task?.cancel();
      task = p.render({ canvas: c, viewport: vp });
      await task.promise.catch(() => undefined); // a cancelled render rejects; that's expected
    };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(stage.current);
    if (page < doc.numPages) doc.getPage(page + 1).catch(() => undefined); // the next page, warmed
    return () => {
      alive = false;
      task?.cancel();
      ro.disconnect();
    };
  }, [doc, page]);

  useEffect(() => {
    const onKey = (e) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) go(1);
      else if (["ArrowLeft", "PageUp"].includes(e.key)) go(-1);
      else if (e.key === "Home") go(-Infinity);
      else if (e.key === "End") go(Infinity);
      else if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "Escape" && !document.fullscreenElement) close();
      else return;
      e.preventDefault();
    };
    const onFs = () => setFull(!!document.fullscreenElement);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  });

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen().catch(() => undefined);
  }
  function close() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    onClose();
  }

  const ctrl = "press grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label={`${reading ? "Viewing" : "Presenting"} ${title}`}>
      <div
        ref={stage}
        className="relative grid min-h-0 flex-1 cursor-pointer place-items-center select-none"
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          const start = swipe.current;
          swipe.current = null;
          if (start === null) return;
          const dx = e.clientX - start;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          else go(e.clientX > window.innerWidth / 2 ? 1 : -1);
        }}
      >
        {error ? (
          <p className="max-w-md text-center text-sm text-white/70">Couldn't open this PDF: {error}</p>
        ) : !doc ? (
          <p className="text-sm text-white/60">Loading {noun}s…</p>
        ) : (
          <canvas ref={canvas} className="bg-white shadow-2xl" aria-label={`${reading ? "Page" : "Slide"} ${page} of ${total}`} />
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] opacity-60 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100">
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
        <button onClick={() => go(-1)} disabled={page <= 1} className={ctrl} aria-label={`Previous ${noun}`}>
          <ChevronLeft className="size-5" />
        </button>
        <span className="w-16 text-center text-sm tabular-nums">{total ? `${page} / ${total}` : "–"}</span>
        <button onClick={() => go(1)} disabled={page >= total} className={ctrl} aria-label={`Next ${noun}`}>
          <ChevronRight className="size-5" />
        </button>
        <span className="flex flex-1 justify-end gap-1">
          {extra}
          <button onClick={toggleFull} className={ctrl} aria-label={full ? "Exit full screen" : "Full screen"}>
            {full ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </button>
          <button onClick={close} className={ctrl} aria-label={reading ? "Close" : "Stop presenting"}>
            <X className="size-5" />
          </button>
        </span>
      </div>
    </div>
  );
}
