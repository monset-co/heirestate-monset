// Mons, the team's assistant (admin/worker/mons.js), as a Messenger-style chat: the team's shared
// chat, where everyone's messages arrive live for everyone, or your private one (?chat=me), where she
// also leaves you reminders and suggestions of her own (admin/worker/nudges.js). The private one is
// also the panel on every desktop page (MonsPanel, in Shell.jsx), which tells her the page. Files can be
// dropped, pasted or attached (screenshots, flyers, PDF price lists): they go to the mons-uploads
// bucket and the Worker hands them to her with the message.
import { Check, Download, FileText, Paperclip, Send, Sparkles, X } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { api } from "../api";
import { useMe } from "../me";
import { SkeletonRows } from "../motion";
import { ErrorNote, Modal, btn, btnGhost, card, input } from "../ui";
import { when } from "../crm";
import MonsUsage from "../MonsUsage";

// what she can read, as the mons-uploads bucket and the Worker allow (admin/worker/mons.js FILE_TYPES)
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "text/plain", "text/csv", DOCX, XLSX];
// a file's type by its ending first: Windows calls a .csv an Excel file, and some phones send none
const BY_END = { csv: "text/csv", txt: "text/plain", pdf: "application/pdf", docx: DOCX, xlsx: XLSX, jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };
const typeOf = (f) => BY_END[f.name.split(".").pop().toLowerCase()] ?? f.type;
const MAX_FILES = 5;
const MAX_MB = 10;
const UPLOADS = "mons-uploads";

async function openFile(f) {
  const { signedUrl } = await run(supabase.storage.from(UPLOADS).createSignedUrl(f.path, 300));
  window.open(signedUrl, "_blank", "noopener");
}
const isWord = (f) => /\.docx$/i.test(f.name);

// A Word draft Mons made, laid out like Word, inside the admin (the file never leaves for an
// outside viewer). docx-preview draws it into a shadow root; its stylesheet is handed over as a
// constructed sheet, because the admin's CSP refuses <style> elements (style-src 'self').
function DocPreview({ file, onClose }) {
  const host = useRef(null);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    let href;
    (async () => {
      try {
        const { signedUrl } = await run(supabase.storage.from(UPLOADS).createSignedUrl(file.path, 300));
        const blob = await (await fetch(signedUrl)).blob();
        if (!alive) return;
        href = URL.createObjectURL(blob);
        setState({ loading: true, href });
        const { renderAsync } = await import("docx-preview");
        if (!alive || !host.current) return;
        const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
        const body = document.createElement("div");
        const styles = document.createElement("div"); // never in the page: only read from
        root.replaceChildren(body);
        await renderAsync(blob, body, styles, { inWrapper: true, ignoreFonts: true, breakPages: true });
        const sheet = new CSSStyleSheet();
        sheet.replaceSync([...styles.querySelectorAll("style")].map((s) => s.textContent).join("\n"));
        root.adoptedStyleSheets = [sheet];
        if (alive) setState({ href });
      } catch (e) {
        if (alive) setState({ href, error: href ? "The preview can't be shown on this device, but you can download the Word file." : e.message || "The draft couldn't be shown" });
      }
    })();
    return () => {
      alive = false;
      if (href) URL.revokeObjectURL(href);
    };
  }, [file.path]);
  return (
    <Modal open onClose={onClose} title={file.name} guard={false}>
      <div className="grid gap-3">
        <ErrorNote error={state.error} />
        {state.loading && <SkeletonRows n={4} />}
        <div ref={host} className="max-h-[65dvh] overflow-auto rounded-lg border border-line bg-sunken" aria-label={`Preview of ${file.name}`} />
        <div className="flex flex-wrap gap-2">
          {state.href && (
            <a href={state.href} download={file.name} className={btn}>
              <Download className="size-4" aria-hidden /> Download Word file
            </a>
          )}
          <button type="button" className={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
        <p className="text-xs text-muted">A preview: Word shows the exact layout. Check every detail before it goes to a client.</p>
      </div>
    </Modal>
  );
}

// a message, new or changed, into the list. A change from realtime (a Confirm pressed) can leave out
// long columns it didn't change (Postgres sends unchanged large values as missing), so it's laid
// over the copy already here, never in place of it.
const merge = (list, row) => {
  const had = list.find((x) => x.id === row.id);
  const next = had ? { ...had, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) } : row;
  return [...list.filter((x) => x.id !== row.id), next].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
};
const STARTERS = ["Brief me on today", "Which hot leads need a follow-up?", "Any 2BR for rent under ₱30,000?", "What's on the calendar this week?"];
// in the panel, what to ask about the page that's open
export function startersFor(page) {
  if (/^\/leads\/\d+/.test(page ?? "")) return ["Brief me on this lead", "Which listings fit them?", "Draft a follow-up message"];
  if (/^\/inventory\?(.*&)?open=\d+/.test(page ?? "")) return ["Who might want this unit?", "Write a post for this listing"];
  if (/^\/inventory/.test(page ?? "")) return ["What did we add this week?", "Any 2BR for rent under ₱30,000?"];
  if (/^\/calendar/.test(page ?? "")) return ["What's on this week?", "When am I free tomorrow?"];
  if (/^\/leads/.test(page ?? "")) return ["Which hot leads need a follow-up?", "Who's reserved and missing papers?"];
  return ["Brief me on today", "What should I do next?"];
}

// Mons writes a little Markdown: [links](/leads/12) to the admin's own pages, **bold** and lists.
// Only links inside the admin become links; anything else stays text.
function Rich({ text = "" }) {
  // the odd heading, divider or "* " bullet she slips in, made plain
  text = String(text ?? "").replace(/^#{1,6}\s+/gm, "").replace(/^\s*(---+|\*\*\*+)\s*$/gm, "").replace(/^(\s*)[*-]\s+/gm, "$1• ").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2").replace(/\n{3,}/g, "\n\n");
  return inline(text);
}
// links only to the admin's own pages: one leading slash, never "//host" or "/\host" (off-site).
// Bold is read again for links inside it (**[Ana](/leads/5)** is common); a full stop she puts
// inside the brackets is left out of the address.
function inline(text) {
  return text.split(/(\[[^\]]+\]\(\/(?![/\\])[^)\s]*\)|\*\*[^*]+\*\*)/g).map((s, i) => {
    const link = s.match(/^\[([^\]]+)\]\((\/(?![/\\])[^)\s]*)\)$/);
    if (link)
      return (
        <Link key={i} to={link[2].replace(/[.,;:!?]+$/, "")} className="font-medium underline decoration-gold/60 underline-offset-2 hover:decoration-gold">
          {link[1]}
        </Link>
      );
    if (/^\*\*[^*]+\*\*$/.test(s)) return <strong key={i}>{inline(s.slice(2, -2))}</strong>;
    return <Fragment key={i}>{s}</Fragment>;
  });
}

// A bigger change she proposed: Confirm runs it as whoever presses it; anyone in the chat can.
const STATE = { done: "Done", declined: "Not done", failed: "Didn't go through" };
function Proposal({ p, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const answer = async (ok) => {
    setBusy(ok ? "confirm" : "no");
    try {
      await onAnswer(ok);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 rounded-lg border border-line bg-bg/60 p-2.5 text-xs">
      <p className="font-medium text-fg">
        <Link to={p.url} className="hover:underline">
          {p.summary}
        </Link>
      </p>
      {p.state === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button type="button" className={`${btn} !px-3 !py-1.5 !text-xs`} disabled={!!busy} onClick={() => answer(true)}>
            {busy === "confirm" ? "Confirming…" : "Confirm"}
          </button>
          <button type="button" className={`${btnGhost} !px-3 !py-1.5 !text-xs`} disabled={!!busy} onClick={() => answer(false)}>
            Not now
          </button>
        </div>
      ) : (
        <p className={`mt-1 ${p.state === "failed" ? "text-danger" : "text-muted"}`}>
          {STATE[p.state] ?? p.state}
          {p.by && ` · ${p.by}`}
          {p.state === "failed" && p.note && `: ${p.note}`}
        </p>
      )}
    </div>
  );
}

// What a reply cost, small after the time; the full split on hover (mons_messages.usage)
const kfmt = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });
function Cost({ u, total }) {
  const cached = u.prompt ? Math.round((u.cached / u.prompt) * 100) : 0;
  const tools = Object.entries(u.tools ?? {}).map(([k, v]) => `${k} ${kfmt.format(v)} chars`);
  const detail = [`Read ${u.prompt.toLocaleString("en-PH")} (${cached}% cached)`, `wrote ${u.output.toLocaleString("en-PH")}`, `thought ${u.thoughts.toLocaleString("en-PH")}`, `${u.rounds} round${u.rounds > 1 ? "s" : ""}`, ...tools].join(" · ");
  return (
    <span className="tabular-nums" title={detail}>
      {" "}
      · {kfmt.format(total)} tokens{cached > 0 && ` · ${cached}% cached`}
    </span>
  );
}

// While she works: three bouncing dots and a line that moves on every couple of seconds
const THINKING = ["Mons is thinking", "Looking it up", "Checking the records", "Putting it together"];
function Typing() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, THINKING.length - 1)), 2500);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="flex items-center gap-2 rounded-xl rounded-bl-sm border border-gold/40 bg-surface px-3 py-2 text-sm text-muted" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-1.5 rounded-full bg-gold motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span key={i} className="motion-safe:animate-[fade-in_300ms_ease-out]">
        {THINKING[i]}…
      </span>
    </p>
  );
}

// alone: your private chat with her; page: the admin page it's asked from (the panel); onClose: the panel's ×
export function MonsChat({ alone = false, page = null, onClose, tabs }) {
  const me = useMe();
  const panel = !!onClose;
  const thread = alone ? (me?.email ?? "") : null;
  const ofThread = (qb) => (alone ? qb.eq("thread", thread) : qb.is("thread", null));
  const [msgs, setMsgs] = useState(null);
  const [people, setPeople] = useState({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null); // a Word draft being looked at
  const end = useRef(null);
  const picker = useRef(null);

  // dropped, pasted or picked: the ones she can read, up to five
  function add(list) {
    const all = [...list];
    const ok = all.filter((f) => FILE_TYPES.includes(typeOf(f)) && f.size <= MAX_MB * 1048576);
    setError(ok.length < all.length ? `Mons reads images, PDFs, Word, Excel (.xlsx), CSV and text files, up to ${MAX_MB} MB each. For an old .xls or .doc, save it in the newer format first.` : "");
    setFiles((fs) => [...fs, ...ok].slice(0, MAX_FILES));
  }

  useEffect(() => {
    if (alone && !thread) return;
    setMsgs(null);
    run(ofThread(supabase.from("mons_messages").select("*")).order("created_at", { ascending: false }).limit(200)).then((l) => setMsgs(l.reverse()), (e) => setError(e.message));
    run(supabase.from("admin_users").select("email,name")).then((l) => setPeople(Object.fromEntries(l.map((p) => [p.email, p.name]))), () => {});
    const ch = supabase
      .channel(`mons-${crypto.randomUUID()}`) // its own name: see Bell.jsx
      // INSERT: a new message; UPDATE: a proposal confirmed or turned down
      .on("postgres_changes", { event: "*", schema: "public", table: "mons_messages" }, ({ new: n }) => n?.id && (n.thread ?? null) === thread && setMsgs((l) => l && merge(l, n)))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [thread]);

  // braces: Chrome's scrollIntoView now returns a Promise, which React would call as the cleanup
  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length, busy]);

  async function send(e, said = text) {
    e?.preventDefault();
    const body = said.trim();
    const sending = said === text ? files : []; // a starter button sends just its words
    if ((!body && !sending.length) || busy) return;
    setBusy(true);
    setError("");
    setText("");
    setFiles([]);
    try {
      const attachments = await Promise.all(
        sending.map(async (f) => {
          const path = `${crypto.randomUUID()}/${f.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file"}`;
          // the storage's own words, not run()'s "sign in again": a refused upload says which file and why
          const { error } = await supabase.storage.from(UPLOADS).upload(path, f, { contentType: typeOf(f) });
          if (error) throw new Error(`${f.name} couldn't be uploaded: ${error.message}${error.statusCode ? ` (${error.statusCode})` : ""}`);
          return { path, name: f.name, type: typeOf(f), size: f.size };
        })
      );
      const { messages } = await api("mons", { text: body, attachments, private: alone, page });
      setMsgs((l) => messages.reduce(merge, l ?? []));
    } catch (err) {
      setError(err.message);
      setText(body);
      setFiles(sending);
    }
    setBusy(false);
  }

  async function decide(id, index, ok) {
    setError("");
    try {
      await api("mons/confirm", { id, index, ok });
      // the change arrives through realtime; fetch it too in case realtime is slow
      const l = await run(ofThread(supabase.from("mons_messages").select("*")).gte("id", id).order("id"));
      setMsgs((m) => l.reduce(merge, m ?? []));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section
      aria-label="Mons"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDrag(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDrag(false);
        add(e.dataTransfer.files);
      }}
      className={`${card} relative flex flex-col overflow-hidden ${panel ? "h-full" : "h-[calc(100dvh-var(--tabbar-h)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-7.5rem)] min-h-[26rem] md:h-[calc(100dvh-5rem)]"}`}
    >
      {preview && <DocPreview file={preview} onClose={() => setPreview(null)} />}
      {drag && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-gold bg-surface/90 text-sm text-fg" aria-hidden>
          <span className="flex items-center gap-2">
            <Paperclip className="size-4 text-gold-ink" /> Drop to send to Mons: screenshots, flyers, PDFs
          </span>
        </div>
      )}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <span className="grid size-10 place-items-center rounded-full bg-navy text-gold" aria-hidden>
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl text-ink">Mons</h1>
          <p className="text-xs text-muted">
            {panel
              ? "Your private chat. She sees the page you're on."
              : alone
                ? "Your private chat with her, where she also leaves you reminders and suggestions. Only you see it."
                : "Your assistant. She looks things up and handles notes, reminders and tasks; bigger changes wait for your Confirm. The whole team shares this chat."}
          </p>
        </div>
        {tabs}
        {panel ? (
          <button type="button" onClick={onClose} className={btnGhost} aria-label="Close Mons">
            <X className="size-4" aria-hidden />
          </button>
        ) : (
          <MonsUsage className="w-full sm:w-64" />
        )}
      </header>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-bg/60 px-3 py-4 sm:px-5" aria-live="polite" aria-relevant="additions">
        {!msgs ? (
          <SkeletonRows n={3} />
        ) : (
          msgs.map((m) => {
            const mine = !m.from_mons && m.author === me?.email;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
                    m.from_mons ? "rounded-bl-sm border border-gold/40 bg-surface text-fg" : mine ? "rounded-br-sm bg-navy text-cream" : "rounded-bl-sm border border-line bg-surface text-fg"
                  }`}
                >
                  <p className="break-words whitespace-pre-wrap">{m.from_mons ? <Rich text={m.body} /> : m.body}</p>
                  {m.attachments?.length > 0 && (
                    <ul className="mt-1.5 space-y-1 text-xs" aria-label="Files">
                      {m.attachments.map((f) => (
                        <li key={f.path}>
                          <button
                            type="button"
                            onClick={() => (isWord(f) ? setPreview(f) : openFile(f).catch((e) => setError(e.message)))}
                            className={
                              isWord(f)
                                ? "press flex max-w-full items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-2 text-left text-sm font-medium text-fg hover:border-muted/50"
                                : "flex max-w-full items-center gap-1.5 text-left underline-offset-2 hover:underline"
                            }
                          >
                            {isWord(f) ? <FileText className="size-4 shrink-0 text-gold-ink" aria-hidden /> : <Paperclip className="size-3 shrink-0" aria-hidden />}
                            <span className="truncate">{f.name}</span>
                            {isWord(f) && <span className="ml-auto shrink-0 text-xs font-normal text-muted">Preview</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.changes?.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs" aria-label="What Mons changed">
                      {m.changes.map((c, i) => (
                        <li key={i} className="flex gap-1.5">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-gold-ink" aria-hidden />
                          <Link to={c.url} className="hover:underline">
                            {c.text}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.proposals?.map((p, i) => (
                    <Proposal key={i} p={p} onAnswer={(ok) => decide(m.id, i, ok)} />
                  ))}
                  <p className={`mt-1 text-right text-[0.7rem] ${mine ? "text-cream/60" : "text-muted"}`}>
                    {m.from_mons ? "Mons" : mine ? "You" : (people[m.author] ?? String(m.author ?? "").split("@")[0])} ·{" "}
                    <time dateTime={m.created_at} title={when(m.created_at)}>
                      {new Date(m.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                    </time>
                    {m.usage?.rounds > 0 && <Cost u={m.usage} total={m.tokens} />}
                  </p>
                </div>
              </li>
            );
          })
        )}
        {msgs?.length === 0 && !busy && (
          <li className="px-2 py-8 text-center text-sm text-muted">
            <p>Hello! I'm Mons. Ask me about your leads, listings, schedule or files.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {(panel ? startersFor(page) : STARTERS).map((s) => (
                <button key={s} type="button" onClick={() => send(null, s)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-fg hover:border-muted/50">
                  {s}
                </button>
              ))}
            </div>
          </li>
        )}
        {busy && (
          <li className="flex justify-start">
            <Typing />
          </li>
        )}
        <li ref={end} aria-hidden />
      </ol>

      <div className="border-t border-line p-3">
        <ErrorNote error={error} />
        {panel && msgs?.length > 0 && !busy && !text && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {startersFor(page).map((s) => (
              <button key={s} type="button" onClick={() => send(null, s)} className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg hover:border-muted/50">
                {s}
              </button>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Files to send">
            {files.map((f, i) => (
              <li key={i} className="flex max-w-[16rem] items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-2.5 text-xs">
                <Paperclip className="size-3 shrink-0 text-muted" aria-hidden />
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} className="-my-1.5 -mr-1 grid size-8 place-items-center rounded-full text-muted hover:text-fg" aria-label={`Remove ${f.name}`}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={send} className="flex items-end gap-2">
          <input ref={picker} type="file" multiple hidden accept={[...FILE_TYPES, ".csv", ".xlsx", ".docx"].join(",")} onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
          <button type="button" className={btnGhost} onClick={() => picker.current.click()} disabled={busy || files.length >= MAX_FILES} aria-label="Attach files">
            <Paperclip className="size-4" aria-hidden />
          </button>
          <label className="flex-1">
            <span className="sr-only">Message Mons</span>
            <textarea
              rows={Math.min(6, text.split("\n").length)}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              // a pasted screenshot becomes an attachment; pasted text stays text
              onPaste={(e) => {
                if (!e.clipboardData.files.length) return;
                e.preventDefault();
                add(e.clipboardData.files);
              }}
              // Enter sends only with a real keyboard: a phone's Enter is the new line
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches && send(e)}
              placeholder={matchMedia("(pointer: fine)").matches ? "Ask Mons… (Shift+Enter for a new line)" : "Ask Mons…"}
              className={`${input} resize-none`}
            />
          </label>
          <button className={btn} disabled={busy || (!text.trim() && !files.length)} aria-label="Send">
            <Send className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </section>
  );
}

// the Mons page: the team's chat, or your own with her
export default function Mons() {
  const [params, setParams] = useSearchParams();
  const alone = params.get("chat") === "me";
  const tab = (on, label, to) => (
    <button type="button" onClick={() => setParams(to, { replace: true })} aria-pressed={on} className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-navy text-cream" : "text-muted hover:text-fg"}`}>
      {label}
    </button>
  );
  const tabs = (
    <div className="flex rounded-full border border-line p-0.5" role="group" aria-label="Which chat">
      {tab(!alone, "Team", {})}
      {tab(alone, "Just me", { chat: "me" })}
    </div>
  );
  return <MonsChat key={alone ? "me" : "team"} alone={alone} tabs={tabs} />;
}
