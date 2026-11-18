// A lead's files: drop them anywhere on the tab, sort them into the buyer's folders (drag a file onto
// a folder, or choose one), and open them here: PDFs in the dashboard's reader or as a presentation,
// photos as they are, Word, Excel and PowerPoint in Microsoft's viewer.
import { CircleCheck, CircleDot, CircleX, Circle, Download, FileText, FileImage, FileSpreadsheet, Presentation, Trash2, Upload, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabase, run } from "../supabase";
import { Live, LiveLi, SkeletonRows, toast } from "../motion";
import { Empty, ErrorNote, btnGhost, card, input, Select, ask } from "../ui";
import { CHECKLIST, FOLDERS, ON_THE_CLOCK, PAPERS_DAYS, ago, papersDue } from "../crm";
import { parseCsv } from "../csv";

const PdfDeck = lazy(() => import("../PdfDeck"));
export const FILES = "client-files";

// what the bucket takes (supabase/migrations), by extension: some systems send HEIC with no type
const TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const MAX_MB = 25;
const ext = (name) => name.split(".").pop().toLowerCase();
// how a file opens; HEIC isn't shown by most browsers, so it downloads
export function kindOf(name) {
  const e = ext(name);
  if (e === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp"].includes(e)) return "image";
  if (["docx", "xlsx", "xls", "pptx"].includes(e)) return "office";
  if (e === "csv") return "csv";
  return null;
}
export const ICON = { pdf: FileText, image: FileImage, office: FileSpreadsheet, csv: FileSpreadsheet };
export const size =(b) => (b == null ? "" : b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** Stores one file in a lead's folder; the row comes back. Used here and by the WhatsApp inbox. */
export async function saveFile(leadId, folder, file, name = file.name) {
  const type = TYPES[ext(name)];
  if (!type) throw new Error(`${name}: only PDF, photos, Word, Excel and PowerPoint files`);
  if (file.size > MAX_MB * 1048576) throw new Error(`${name}: files must be ${MAX_MB} MB or smaller`);
  const path = `${leadId}/${crypto.randomUUID()}-${name.replace(/[^\w.-]+/g, "_").slice(-120)}`;
  await run(supabase.storage.from(FILES).upload(path, file, { contentType: type }));
  try {
    return await run(supabase.from("lead_files").insert({ lead_id: leadId, folder, file_path: path, file_name: name.slice(0, 200), size: file.size }).select().single());
  } catch (err) {
    await supabase.storage.from(FILES).remove([path]); // no file without its row
    throw err;
  }
}

const signed = async (f, secs = 300) => (await run(supabase.storage.from(FILES).createSignedUrl(f.file_path, secs))).signedUrl;

// a checklist folder's state: no files, files not yet looked at, or checked by someone
const STATUS = {
  missing: [Circle, "Missing", "opacity-40"],
  uploaded: [CircleDot, "Uploaded, not checked", "text-gold-ink"],
  verified: [CircleCheck, "Verified", "text-emerald-600"],
  rejected: [CircleX, "Rejected", "text-danger"],
};

export default function FilesTab({ leadId, lead, onChecked }) {
  const [files, setFiles] = useState(null);
  const [folder, setFolder] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState(null); // the folder (or "tab") something is being dragged over
  const [open, setOpen] = useState(null); // { file, url, present }
  const picker = useRef(null);

  const [checks, setChecks] = useState({}); // item -> { status, reason, checked_by, checked_at }

  useEffect(() => {
    run(supabase.from("lead_checklist").select("item, status, reason, checked_by, checked_at").eq("lead_id", leadId)).then(
      (rows) => setChecks(Object.fromEntries(rows.map((r) => [r.item, r]))),
      (e) => setError(e.message)
    );
    run(supabase.from("lead_files").select("*").eq("lead_id", leadId).order("created_at", { ascending: false })).then(setFiles, (e) => setError(e.message));
  }, [leadId]);

  async function upload(list, into) {
    const target = into ?? (folder === "all" ? "other" : folder);
    setError("");
    let done = 0;
    for (const [i, file] of [...list].entries()) {
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const row = await saveFile(leadId, target, file);
        setFiles((fs) => [row, ...fs]);
        done++;
      } catch (err) {
        setError(err.message);
      }
    }
    setBusy("");
    if (done) toast(`${done === 1 ? "File" : `${done} files`} added to ${FOLDERS[target]}`);
  }

  async function move(f, to) {
    if (f.folder === to) return;
    setFiles((fs) => fs.map((x) => (x.id === f.id ? { ...x, folder: to } : x)));
    try {
      await run(supabase.from("lead_files").update({ folder: to }).eq("id", f.id));
      toast(`Moved to ${FOLDERS[to]}`);
    } catch (err) {
      setFiles((fs) => fs.map((x) => (x.id === f.id ? f : x)));
      setError(err.message);
    }
  }

  async function remove(f) {
    if (!(await ask({ title: `Delete “${f.file_name}”?`, body: "It can't be undone.", yes: "Delete", danger: true }))) return;
    try {
      await run(supabase.storage.from(FILES).remove([f.file_path]));
      await run(supabase.from("lead_files").delete().eq("id", f.id));
      setFiles((fs) => fs.filter((x) => x.id !== f.id));
      toast("File deleted");
    } catch (err) {
      setError(err.message);
    }
  }

  async function view(f, present = false) {
    const kind = kindOf(f.file_name);
    // a client's papers are personal data: say so before one leaves for Microsoft's servers
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

  // a file from the computer, or one of the rows below, dropped on a folder (or anywhere on the tab)
  const dropOn = (to) => ({
    onDragOver: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(to ?? "tab");
    },
    onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && setOver(null),
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      const id = e.dataTransfer.getData("text/x-lead-file");
      if (id && to) return move(files.find((f) => String(f.id) === id), to);
      if (e.dataTransfer.files.length) upload(e.dataTransfer.files, to);
    },
  });

  const count = (k) => files?.filter((f) => f.folder === k).length ?? 0;
  const statusOf = (k) => checks[k]?.status ?? (count(k) ? "uploaded" : "missing");

  // verify, reject (with a reason the buyer can act on), or clear back to unchecked
  async function check(item, status) {
    let reason = null;
    if (status === "rejected") {
      reason = await ask({ title: `Why is ${FOLDERS[item]} rejected?`, input: { placeholder: "Blurry ID, expired, wrong month's payslip…" }, yes: "Reject", danger: true });
      if (!reason) return;
    }
    let next;
    try {
      if (status) {
        const row = await run(supabase.from("lead_checklist").upsert({ lead_id: leadId, item, status, reason }).select("item, status, reason, checked_by, checked_at").single());
        next = { ...checks, [item]: row };
      } else {
        await run(supabase.from("lead_checklist").delete().eq("lead_id", leadId).eq("item", item));
        next = { ...checks };
        delete next[item];
      }
      setChecks(next);
      onChecked?.(ON_THE_CLOCK.filter((k) => next[k]?.status === "verified").length);
      toast(status ? `${FOLDERS[item]}: ${STATUS[status][1].toLowerCase()}` : `${FOLDERS[item]}: back to unchecked`);
    } catch (err) {
      setError(err.message);
    }
  }
  const shown = files?.filter((f) => folder === "all" || f.folder === folder);
  const done = CHECKLIST.filter((k) => statusOf(k) === "verified").length;
  const days = lead?.stage === "reserved" && papersDue(lead.reserved_at);
  const folderBtn = (k, label, n, check) => (
    <li key={k}>
      <button
        type="button"
        onClick={() => setFolder(k)}
        {...(k !== "all" && dropOn(k))}
        aria-current={folder === k}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ${
          over === k ? "bg-gold/25 ring-2 ring-gold" : folder === k ? "bg-navy text-cream" : "hover:bg-sunken"
        }`}
      >
        {check && (() => {
          const [Icon, label, tone] = STATUS[check];
          return <Icon className={`size-4 shrink-0 ${folder === k ? "" : tone}`} aria-label={label} />;
        })()}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={`text-xs tabular-nums ${folder === k ? "text-cream/70" : "text-muted"}`}>{n || ""}</span>
      </button>
    </li>
  );

  return (
    <div {...dropOn(null)} className="grid max-w-5xl gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Folders" className="h-fit">
        <p className="label mb-2 px-3 text-muted">
          Checklist · <span className="tabular-nums">{done} of {CHECKLIST.length} verified</span>
        </p>
        {days != null && days !== false && ON_THE_CLOCK.some((k) => statusOf(k) !== "verified") && (
          <p className={`mb-2 px-3 text-xs ${days <= 7 ? "font-medium text-danger" : "text-muted"}`}>
            {days >= 0 ? `${days} of ${PAPERS_DAYS} days left to hand in papers` : `${-days} days past the ${PAPERS_DAYS}-day deadline`}
          </p>
        )}
        <ul className="grid gap-0.5">
          {folderBtn("all", "All files", files?.length)}
          {CHECKLIST.map((k) => folderBtn(k, FOLDERS[k], count(k), statusOf(k)))}
        </ul>
        <ul className="mt-3 grid gap-0.5 border-t border-line pt-3">{Object.keys(FOLDERS).filter((k) => !CHECKLIST.includes(k)).map((k) => folderBtn(k, FOLDERS[k], count(k)))}</ul>
      </nav>

      <div className="grid h-fit gap-4">
        <ErrorNote error={error} />
        {CHECKLIST.includes(folder) && <CheckBar item={folder} status={statusOf(folder)} row={checks[folder]} onCheck={check} />}
        <button
          type="button"
          onClick={() => picker.current.click()}
          disabled={!!busy}
          className={`grid place-items-center gap-1 rounded-xl border-2 border-dashed px-4 py-7 text-center text-sm transition-colors duration-150 ${
            over === "tab" ? "border-gold bg-gold/10" : "border-line hover:border-muted/50"
          }`}
        >
          <Upload className="size-5 text-muted" aria-hidden />
          <span className="font-medium text-fg">{busy || `Drop files here, or choose them`}</span>
          <span className="text-xs text-muted">
            Into {FOLDERS[folder === "all" ? "other" : folder]} · PDF, photos, Word, Excel, PowerPoint · up to {MAX_MB} MB each
          </span>
        </button>
        <input ref={picker} type="file" multiple hidden accept={Object.keys(TYPES).map((e) => `.${e}`).join(",")} onChange={(e) => upload(e.target.files).then(() => (e.target.value = ""))} />

        <div className={card}>
          {!shown ? (
            <SkeletonRows n={3} />
          ) : !shown.length ? (
            <Empty>{folder === "all" ? "No files yet. Drop their IDs, payslips or the reservation agreement here." : `Nothing in ${FOLDERS[folder]} yet.`}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              <Live>
                {shown.map((f, i) => {
                  const kind = kindOf(f.file_name);
                  const Icon = ICON[kind] ?? FileText;
                  const canPresent = ext(f.file_name) === "pdf" || ext(f.file_name) === "pptx";
                  return (
                    <LiveLi key={f.id} i={i}>
                      {/* a plain div: motion keeps onDragStart for its own gestures */}
                      <div draggable onDragStart={(e) => e.dataTransfer.setData("text/x-lead-file", String(f.id))} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
                      <Icon className="size-5 shrink-0 text-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => view(f)} className="block max-w-full truncate text-left font-medium underline-offset-2 hover:underline">
                          {f.file_name}
                        </button>
                        <p className="text-xs text-muted">
                          {[folder === "all" && FOLDERS[f.folder], size(f.size), ago(f.created_at), f.uploaded_by?.split("@")[0]].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {canPresent && (
                          <button type="button" onClick={() => view(f, true)} className={`${btnGhost} min-h-9 px-2.5`} title="Present to the client">
                            <Presentation className="size-4" aria-hidden /> Present
                          </button>
                        )}
                        <label>
                          <span className="sr-only">Folder for {f.file_name}</span>
                          <Select value={f.folder} onChange={(e) => move(f, e.target.value)} className={`${input} w-auto py-1.5`}>
                            {Object.entries(FOLDERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </Select>
                        </label>
                        <button type="button" onClick={() => download(f)} className="press rounded-md p-2 text-muted hover:bg-sunken hover:text-fg" aria-label={`Download ${f.file_name}`}>
                          <Download className="size-4" />
                        </button>
                        <button type="button" onClick={() => remove(f)} className="press rounded-md p-2 text-muted hover:bg-danger/10 hover:text-danger" aria-label={`Delete ${f.file_name}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      </div>
                    </LiveLi>
                  );
                })}
              </Live>
            </ul>
          )}
        </div>
        <p className="text-xs text-muted">Drag a file onto a folder to move it. Drop new files on a folder to upload straight into it.</p>
      </div>

      {open && <Viewer {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Above a checklist folder: where it stands, and the buttons to check it off.
function CheckBar({ item, status, row, onCheck }) {
  const [Icon, label, tone] = STATUS[status];
  const small = "press rounded-md px-2.5 py-1.5 text-xs font-semibold";
  return (
    <div className={`${card} flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm`}>
      <Icon className={`size-5 ${tone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">
          {FOLDERS[item]}: {label}
        </p>
        {row && (
          <p className="text-xs text-muted">
            {row.reason && <span className="text-danger">{row.reason} · </span>}
            {row.checked_by?.split("@")[0]} · {ago(row.checked_at)}
          </p>
        )}
        {status === "missing" && <p className="text-xs text-muted">Nothing here yet. Drop the files in, then verify them.</p>}
      </div>
      <div className="flex gap-1.5">
        {status !== "verified" && status !== "missing" && (
          <button type="button" onClick={() => onCheck(item, "verified")} className={`${small} bg-emerald-700 text-white hover:bg-emerald-800`}>
            Verify
          </button>
        )}
        {status !== "rejected" && status !== "missing" && (
          <button type="button" onClick={() => onCheck(item, "rejected")} className={`${small} border border-line text-danger hover:bg-danger/10`}>
            Reject…
          </button>
        )}
        {row && (
          <button type="button" onClick={() => onCheck(item, null)} className={`${small} text-muted hover:bg-sunken`}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/** A CSV read here, as a table (first row as the headings), so it never leaves for another site. */
function CsvTable({ url }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Couldn't open it (${r.status})`)))).then((t) => setRows(parseCsv(t)), (e) => setError(e.message));
  }, [url]);
  if (error) return <p className="p-6 text-sm text-white/70">{error}</p>;
  if (!rows) return <p className="p-6 text-sm text-white/60">Opening…</p>;
  const [head = [], ...body] = rows;
  // ponytail: every row drawn at once; page or virtualise it if someone opens a 50,000-row export
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white text-sm text-fg">
      <table className="min-w-full border-collapse tabular-nums">
        <thead className="sticky top-0 bg-sunken">
          <tr>{head.map((h, i) => <th key={i} className="border border-line px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="even:bg-sunken/40">
              {head.map((_, j) => <td key={j} className="border border-line px-3 py-1.5 align-top whitespace-pre-wrap">{r[j]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-3 text-xs text-muted">{body.length} rows</p>
    </div>
  );
}

/** Full-screen native dialog: top layer, Esc closes it. PDFs read or present; photos; Office through Microsoft. */
export function Viewer({ file, url, present, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const kind = kindOf(file.file_name);
  const ctrl = "press grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white";
  const dl = (
    <a href={`${url}&download=${encodeURIComponent(file.file_name)}`} className={ctrl} aria-label={`Download ${file.file_name}`}>
      <Download className="size-4" />
    </a>
  );
  return (
    <dialog ref={ref} onClose={onClose} aria-label={`Viewing ${file.file_name}`} className="m-0 size-full max-h-none max-w-none bg-black p-0 text-white">
      {kind === "pdf" ? (
        <Suspense fallback={<div className="grid size-full place-items-center text-sm text-white/60">Opening…</div>}>
          <PdfDeck url={url} title={file.file_name} onClose={onClose} reading={!present} extra={dl} />
        </Suspense>
      ) : (
        <div className="flex size-full flex-col">
          <div className="flex items-center gap-1 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm opacity-70">{file.file_name}</span>
            {dl}
            <button onClick={onClose} autoFocus className={ctrl} aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          {kind === "image" ? (
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
              <img src={url} alt={file.file_name} className="max-h-full max-w-full object-contain" />
            </div>
          ) : kind === "csv" ? (
            <CsvTable url={url} />
          ) : (
            // PowerPoint plays as a slideshow here; Word and Excel read
            <iframe
              src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
              title={file.file_name}
              className="min-h-0 w-full flex-1 border-0 bg-white"
            />
          )}
        </div>
      )}
    </dialog>
  );
}
