// The team's own files, after dashboard-monset's Documents and Presentations: one page for each
// shelf. Drop files anywhere on the page, or on the bin (which also opens the file picker when
// clicked or tapped), and open them here: PDFs in the reader, or
// presented full screen; CSVs as a table; Excel, Word and PowerPoint in Microsoft's viewer.
import { ArrowDownToLine, Download, Pencil, Play, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { Live, LiveLi, SkeletonRows, toast } from "../motion";
import { Empty, ErrorNote, PageHeader, Select, ask, btnGhost, card, input } from "../ui";
import { ago } from "../crm";
import { ICON, Viewer, kindOf, size } from "./FilesTab";

const BUCKET = "library";
const MAX_MB = 50;
const SHELVES = {
  documents: {
    title: "Documents",
    sub: "The team's own files: forms, price lists, spreadsheets, CSV exports.",
    types: ["pdf", "xlsx", "xls", "csv", "docx", "pptx", "jpg", "jpeg", "png", "webp"],
    say: "PDF, Excel, CSV, Word, PowerPoint and photos",
  },
  presentations: {
    title: "Presentations",
    sub: "Decks to show a client. Present plays one full screen: arrow keys or swipe to move, F for full screen, Esc to stop.",
    types: ["pdf", "pptx"],
    say: "PDF and PowerPoint",
  },
};
// the bucket's types (supabase/migrations), by extension: Windows sends a CSV as an Excel file
const MIME = {
  pdf: "application/pdf",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const ext = (name) => name.split(".").pop().toLowerCase();

// the kinds a shelf can be filtered by, each by its file endings
const KINDS = [
  ["PDF", ["pdf"]],
  ["Spreadsheets", ["xlsx", "xls", "csv"]],
  ["Word", ["docx"]],
  ["PowerPoint", ["pptx"]],
  ["Photos", ["jpg", "jpeg", "png", "webp"]],
];
const kindName = (name) => KINDS.find(([, es]) => es.includes(ext(name)))?.[0] ?? "Other";
const SORTS = {
  new: ["Newest first", (a, b) => b.created_at.localeCompare(a.created_at)],
  old: ["Oldest first", (a, b) => a.created_at.localeCompare(b.created_at)],
  name: ["Name, A to Z", (a, b) => a.file_name.localeCompare(b.file_name, "en", { numeric: true, sensitivity: "base" })],
  size: ["Largest first", (a, b) => (b.size ?? 0) - (a.size ?? 0)],
};
// a name as it's searched: "Price_List-2026.pdf" finds "price list 2026"
const words = (s) => s.toLowerCase().replace(/[_\-.]+/g, " ");
const signed = async (f, secs = 300) => (await run(supabase.storage.from(BUCKET).createSignedUrl(f.file_path, secs))).signedUrl;

export default function Library({ shelf }) {
  const s = SHELVES[shelf];
  const [files, setFiles] = useState(null);
  const current = useRef(null); // the list as it is now, for the upload's same-name check
  current.current = files;
  // search, kind, who added it and the order live in the address: kept on coming back, and shareable
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const kind = params.get("kind") ?? "";
  const by = params.get("by") ?? "";
  const sort = SORTS[params.get("sort")] ? params.get("sort") : "new";
  const setParam = (k, v) => setParams((p) => (v ? p.set(k, v) : p.delete(k), p), { replace: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null); // { at, of } while uploading
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(null); // { file, url, present }
  const picker = useRef(null);

  useEffect(() => {
    setFiles(null);
    let live = true; // switching shelves fast: the old shelf's answer is dropped
    run(supabase.from("library_files").select("*").eq("shelf", shelf).order("created_at", { ascending: false })).then((r) => live && setFiles(r), (e) => live && setError(e.message));
    return () => (live = false);
  }, [shelf]);

  async function upload(list) {
    let files = [...list]; // a copy: the picker's list empties as soon as it's reset
    setError("");
    // a name already on the shelf is asked about once, so a file isn't added twice by mistake
    const have = new Set((current.current ?? []).map((f) => f.file_name.toLowerCase()));
    const again = files.filter((f) => have.has(f.name.toLowerCase()));
    if (again.length) {
      const one = again.length === 1;
      const yes = await ask({
        title: one ? `“${again[0].name}” is already here` : `${again.length} of these are already here`,
        body: one ? "Add it again as a second copy, or skip it?" : `${again.map((f) => f.name).slice(0, 4).join(", ")}${again.length > 4 ? "…" : ""}. Add them again as second copies, or skip them?`,
        yes: one ? "Add a copy" : "Add copies",
        no: "Skip",
      });
      if (!yes) files = files.filter((f) => !have.has(f.name.toLowerCase()));
      if (!files.length) return;
    }
    const failed = [];
    let done = 0;
    for (const [i, file] of files.entries()) {
      setBusy({ at: i, of: files.length });
      try {
        const e = ext(file.name);
        if (!s.types.includes(e)) throw new Error(`${file.name}: ${s.title} takes ${s.say} files`);
        if (file.size > MAX_MB * 1048576) throw new Error(`${file.name}: files must be ${MAX_MB} MB or smaller`);
        const path = `${shelf}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_").slice(-120)}`;
        await run(supabase.storage.from(BUCKET).upload(path, file, { contentType: MIME[e] }));
        try {
          const row = await run(supabase.from("library_files").insert({ shelf, file_path: path, file_name: file.name.slice(0, 200), size: file.size }).select().single());
          setFiles((fs) => [row, ...(fs ?? [])]);
          done++;
        } catch (err) {
          await supabase.storage.from(BUCKET).remove([path]); // no file without its row
          throw err;
        }
      } catch (err) {
        failed.push(err.message);
      }
    }
    setBusy(null);
    if (failed.length) setError(failed.join(" · "));
    if (done) toast(`${done === 1 ? "File" : `${done} files`} added`);
  }

  async function view(f, present = false) {
    const kind = kindOf(f.file_name);
    if (kind === "office" && !(await ask({ title: "Open in Microsoft's viewer?", body: "Word, Excel and PowerPoint files open in Microsoft's Office viewer, which fetches the file through a link that lasts 10 minutes.", yes: "Open it" }))) return;
    try {
      const url = await signed(f, kind === "office" ? 600 : 300);
      if (kind) setOpen({ file: f, url, present });
      else location.href = `${url}&download=${encodeURIComponent(f.file_name)}`;
    } catch (err) {
      setError(err.message);
    }
  }

  async function download(f) {
    try {
      // cross-origin, so the download attribute is ignored; Supabase's ?download= sets the header
      location.href = `${await signed(f)}&download=${encodeURIComponent(f.file_name)}`;
    } catch (err) {
      setError(err.message);
    }
  }

  // a clearer name for the team; the file itself stays where it is
  async function rename(f) {
    const dot = f.file_name.lastIndexOf(".");
    const end = dot > 0 ? f.file_name.slice(dot) : "";
    const typed = await ask({ title: "Rename", body: `Now: ${f.file_name}`, input: { placeholder: f.file_name.slice(0, dot > 0 ? dot : undefined) }, yes: "Rename" });
    if (!typed) return;
    const name = (typed.toLowerCase().endsWith(end.toLowerCase()) ? typed : `${typed}${end}`).slice(0, 200);
    try {
      const row = await run(supabase.from("library_files").update({ file_name: name }).eq("id", f.id).select().single());
      setFiles((fs) => fs.map((x) => (x.id === f.id ? row : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(f) {
    if (!(await ask({ title: `Delete “${f.file_name}”?`, body: "It's gone for the whole team. It can't be undone.", yes: "Delete", danger: true }))) return;
    try {
      // the row first: if the file then can't go, it's only an unseen leftover, not a broken entry
      await run(supabase.from("library_files").delete().eq("id", f.id));
      await run(supabase.storage.from(BUCKET).remove([f.file_path]));
      setFiles((fs) => fs.filter((x) => x.id !== f.id));
      toast("File deleted");
    } catch (err) {
      setError(err.message);
    }
  }

  const typed = useDeferredValue(q);
  const kinds = useMemo(() => KINDS.map(([k]) => [k, (files ?? []).filter((f) => kindName(f.file_name) === k).length]).filter(([, n]) => n), [files]);
  const people = useMemo(() => [...new Set((files ?? []).map((f) => f.uploaded_by).filter(Boolean))].sort(), [files]);
  const shown = useMemo(() => {
    if (!files) return null;
    const want = words(typed).split(/\s+/).filter(Boolean);
    return files
      .filter((f) => (!kind || kindName(f.file_name) === kind) && (!by || f.uploaded_by === by) && want.every((w) => words(f.file_name).includes(w)))
      .sort(SORTS[sort][1]);
  }, [files, typed, kind, by, sort]);
  const filtering = !!(q || kind || by);
  const small = "press grid size-9 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg";

  return (
    <div
      className="relative min-h-[60vh]"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
      }}
    >
      <PageHeader title={s.title} sub={s.sub} />

      <div className="mt-6 grid max-w-5xl gap-4">
        {/* the bin: files dropped here (or anywhere on the page) are added; a click or tap picks them */}
        <button
          type="button"
          onClick={() => picker.current.click()}
          disabled={!!busy}
          data-over={over || undefined}
          className="group relative grid place-items-center gap-1 overflow-hidden rounded-xl border-[1.5px] border-dashed border-line bg-surface/60 px-6 py-7 text-center transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out)] hover:border-muted/60 hover:bg-surface active:scale-[0.99] disabled:cursor-progress data-over:scale-[1.01] data-over:border-gold data-over:bg-gold/10"
        >
          <span className="grid size-10 place-items-center rounded-full bg-sunken text-muted transition-[transform,background-color,color] duration-200 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:text-fg group-data-over:-translate-y-1 group-data-over:bg-gold group-data-over:text-navy-deep">
            <ArrowDownToLine className="size-5" aria-hidden />
          </span>
          <span className="mt-1 text-sm font-medium text-fg">{busy ? `Adding ${busy.at + 1} of ${busy.of}…` : over ? `Let go to add to ${s.title}` : "Drop files here, or choose them"}</span>
          <span className="text-xs text-muted">{s.say} · up to {MAX_MB} MB each</span>
          {busy && (
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-gold/20">
              <span className="block h-full bg-gold transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${((busy.at + 0.5) / busy.of) * 100}%` }} />
            </span>
          )}
        </button>
        <input ref={picker} type="file" multiple hidden accept={s.types.map((t) => `.${t}`).join(",")} onChange={(e) => (upload(e.target.files), (e.target.value = ""))} />
        <ErrorNote error={error} />
        {/* find: by name, then narrow by kind and who added it, in the order wanted */}
        <div className="flex flex-wrap gap-3">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">Search {s.title.toLowerCase()}</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="search" placeholder="Search by name…" value={q} onChange={(e) => setParam("q", e.target.value)} className={`${input} pl-9`} />
          </label>
          {people.length > 1 && (
            <Select aria-label="Added by" value={by} onChange={(e) => setParam("by", e.target.value)} className={`${input} w-auto min-w-40 flex-1 sm:flex-none`}>
              <option value="">Anyone</option>
              {people.map((p) => <option key={p} value={p}>{`Added by ${p.split("@")[0]}`}</option>)}
            </Select>
          )}
          <Select aria-label="Order" value={sort} onChange={(e) => setParam("sort", e.target.value === "new" ? "" : e.target.value)} className={`${input} w-auto min-w-40 flex-1 sm:flex-none`}>
            {Object.entries(SORTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        {kinds.length > 1 && (
          <div role="group" aria-label="Kind of file" className="-mt-1 flex flex-wrap gap-2">
            {[["", files.length], ...kinds].map(([k, n]) => (
              <button
                key={k || "all"}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setParam("kind", k)}
                className={`press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${kind === k ? "border-navy bg-navy text-cream" : "border-line bg-surface text-fg hover:border-muted/50"}`}
              >
                {k || "All"} <span className={`text-xs tabular-nums ${kind === k ? "text-cream/70" : "text-muted"}`}>{n}</span>
              </button>
            ))}
          </div>
        )}

        <div className={card}>
          {!shown ? (
            <div className="p-4"><SkeletonRows n={4} /></div>
          ) : !shown.length ? (
            <Empty>
              {files.length ? (
                <>
                  Nothing matches.{" "}
                  <button type="button" className="font-medium text-fg underline underline-offset-2" onClick={() => setParams({}, { replace: true })}>Clear the search and filters</button>
                </>
              ) : (
                `No ${s.title.toLowerCase()} yet. Drop the first ones in the bin above.`
              )}
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              <Live>
                {shown.map((f, i) => {
                  const kind = kindOf(f.file_name);
                  const Icon = ICON[kind] ?? ICON.pdf;
                  return (
                    <LiveLi key={f.id} i={i} className="flex items-center gap-3 px-4 py-3">
                      <Icon className="size-5 shrink-0 text-muted" aria-hidden />
                      <button type="button" onClick={() => view(f)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate font-medium text-fg hover:underline">{f.file_name}</span>
                        <span className="block text-xs text-muted">
                          {size(f.size)} · {f.uploaded_by?.split("@")[0]} · {ago(f.created_at)}
                        </span>
                      </button>
                      {shelf === "presentations" && kind === "pdf" && (
                        <button type="button" onClick={() => view(f, true)} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                          <Play className="size-3.5" aria-hidden /> Present
                        </button>
                      )}
                      <button type="button" onClick={() => rename(f)} className={small} aria-label={`Rename ${f.file_name}`}>
                        <Pencil className="size-4" />
                      </button>
                      <button type="button" onClick={() => download(f)} className={small} aria-label={`Download ${f.file_name}`}>
                        <Download className="size-4" />
                      </button>
                      <button type="button" onClick={() => remove(f)} className={`${small} hover:text-danger`} aria-label={`Delete ${f.file_name}`}>
                        <Trash2 className="size-4" />
                      </button>
                    </LiveLi>
                  );
                })}
              </Live>
            </ul>
          )}
        </div>
        {shown?.length > 0 && filtering && (
          <p className="-mt-2 flex items-center gap-3 text-xs text-muted">
            {shown.length} of {files.length}
            <button type="button" className="font-medium text-fg underline underline-offset-2" onClick={() => setParams(sort === "new" ? {} : { sort }, { replace: true })}>Clear filters</button>
          </p>
        )}
      </div>

      {over && <div aria-hidden className="pointer-events-none absolute -inset-3 z-20 rounded-2xl ring-2 ring-gold/40" />}
      {open && <Viewer {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}
