// WhatsApp: every chat on the business number, live. Chats on the left, the open one on the right (on
// phones, one at a time). Messages arrive through Meta's webhook (admin/worker/whatsapp.js) and show
// here through Supabase Realtime; replies go out through the Worker.
import { AlertCircle, Check, CheckCheck, ChevronLeft, Clock, Download, FolderInput, ImageIcon, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { supabase, run } from "../supabase";
import { api } from "../api";
import { SkeletonRows, toast } from "../motion";
import { saveFile } from "./FilesTab";
import { Empty, ErrorNote, btn, card, input } from "../ui";
import { ago, when } from "../crm";

const THREAD = "id, wa_id, name, lead_id, unread, last_message_at, last_inbound_at, lead:leads(id, name)";
const MSG = "id, thread_id, direction, type, body, media_id, media_name, status, error, sent_by, created_at";
const byRecent = (a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "");
const merge = (list, row) => [...list.filter((x) => x.id !== row.id), row];
const phone = (wa) => `+${wa}`;
const canReply = (t) => t?.last_inbound_at && Date.now() - new Date(t.last_inbound_at) < 864e5;

export default function WhatsApp() {
  const { id } = useParams();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    run(supabase.from("wa_threads").select(THREAD).order("last_message_at", { ascending: false, nullsFirst: false }).limit(300)).then(setThreads, (e) => setError(e.message));
    // a changed chat is fetched again, for its lead's name
    const ch = supabase
      .channel("wa-threads")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_threads" }, async ({ eventType, new: n, old }) => {
        if (eventType === "DELETE") return setThreads((l) => l?.filter((t) => t.id !== old.id));
        const row = await run(supabase.from("wa_threads").select(THREAD).eq("id", n.id).maybeSingle()).catch(() => null);
        if (row) setThreads((l) => l && merge(l, row).sort(byRecent));
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const open = threads?.find((t) => String(t.id) === id);
  const update = (row) => setThreads((l) => l.map((t) => (t.id === row.id ? { ...t, ...row } : t)));

  return (
    <div className="grid h-[calc(100dvh-var(--tabbar-h)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-7.5rem)] min-h-[26rem] gap-4 md:h-[calc(100dvh-5rem)] md:grid-cols-[20rem_1fr]">
      <section aria-label="Chats" className={`${card} flex min-h-0 flex-col overflow-hidden ${id ? "hidden md:flex" : ""}`}>
        <h1 className="border-b border-line px-4 py-3 font-display text-2xl text-ink">WhatsApp</h1>
        <ErrorNote error={error} />
        {!threads ? (
          <SkeletonRows n={5} />
        ) : !threads.length ? (
          <Empty>No chats yet. Messages to the business number appear here as they arrive.</Empty>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {threads.map((t) => (
              <li key={t.id}>
                <NavLink to={`/whatsapp/${t.id}`} className={({ isActive }) => `flex items-center gap-3 px-4 py-3 text-sm ${isActive ? "bg-sunken" : "hover:bg-sunken/50"}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate ${t.unread ? "font-semibold text-fg" : "text-fg"}`}>{t.lead?.name ?? t.name ?? phone(t.wa_id)}</p>
                    <p className="truncate text-xs text-muted">{t.lead ? `Lead · ${phone(t.wa_id)}` : phone(t.wa_id)}</p>
                  </div>
                  <div className="grid justify-items-end gap-1">
                    {t.last_message_at && <time dateTime={t.last_message_at} className="text-xs text-muted">{ago(t.last_message_at)}</time>}
                    {t.unread > 0 && <span className="min-w-5 rounded-full bg-gold px-1.5 text-center text-xs font-semibold text-navy tabular-nums" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                  </div>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Conversation" className={`${card} min-h-0 flex-col overflow-hidden ${id ? "flex" : "hidden md:flex"}`}>
        {open ? <Chat key={open.id} thread={open} onChange={update} /> : <Empty>{id && threads ? "No such chat." : "Pick a chat."}</Empty>}
      </section>
    </div>
  );
}

function Chat({ thread, onChange }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const open = canReply(thread);

  useEffect(() => {
    run(supabase.from("wa_messages").select(MSG).eq("thread_id", thread.id).order("created_at").limit(500)).then(setMsgs, (e) => setError(e.message));
    const ch = supabase
      .channel(`wa-messages-${thread.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_messages", filter: `thread_id=eq.${thread.id}` }, ({ new: n }) =>
        setMsgs((l) => l && merge(l, n).sort((a, b) => a.created_at.localeCompare(b.created_at)))
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [thread.id]);

  // seen: clear the unread count while it's open
  useEffect(() => {
    if (thread.unread > 0) run(supabase.from("wa_threads").update({ unread: 0 }).eq("id", thread.id)).then(() => onChange({ id: thread.id, unread: 0 }), () => {});
  }, [thread.unread]);

  useLayoutEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs?.length]);

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      const m = await api("whatsapp/send", { thread_id: thread.id, text: body });
      setMsgs((l) => merge(l ?? [], m));
      setText("");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <Link to="/whatsapp" className="-ml-1 rounded p-1 text-muted hover:text-fg md:hidden" aria-label="All chats">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl text-ink">{thread.lead?.name ?? thread.name ?? phone(thread.wa_id)}</h2>
          <p className="text-xs text-muted">
            {phone(thread.wa_id)}
            {thread.name && thread.lead && ` · “${thread.name}” on WhatsApp`}
          </p>
        </div>
        <LeadLink thread={thread} onChange={onChange} />
      </header>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-bg/60 px-3 py-4 sm:px-5" aria-live="polite">
        {!msgs ? <SkeletonRows n={3} /> : msgs.map((m) => <Bubble key={m.id} m={m} leadId={thread.lead_id} />)}
        <li ref={end} aria-hidden />
      </ol>

      <div className="border-t border-line p-3">
        <ErrorNote error={error} />
        {open ? (
          <form onSubmit={send} className="mt-0 flex items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Reply</span>
              <textarea
                rows={Math.min(6, text.split("\n").length)}
                maxLength={4096}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && send(e)}
                placeholder="Reply on WhatsApp… (Shift+Enter for a new line)"
                className={`${input} resize-none`}
              />
            </label>
            <button className={btn} disabled={busy || !text.trim()} aria-label="Send">
              <Send className="size-4" aria-hidden />
            </button>
          </form>
        ) : (
          <p className="rounded-md bg-sunken px-3 py-2.5 text-sm text-muted">
            It's been more than 24 hours since their last message, so WhatsApp only allows an approved template message. You can reply here again as soon as they write.
          </p>
        )}
      </div>
    </>
  );
}

const TICK = {
  sent: [Check, "Sent"],
  delivered: [CheckCheck, "Delivered"],
  read: [CheckCheck, "Read"],
  failed: [AlertCircle, "Not delivered"],
};

function Bubble({ m, leadId }) {
  const out = m.direction === "out";
  const [Icon, label] = TICK[m.status] ?? [Clock, ""];
  return (
    <li className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${out ? "rounded-br-sm bg-navy text-cream" : "rounded-bl-sm border border-line bg-surface text-fg"}`}>
        {m.media_id && <Media m={m} leadId={leadId} />}
        {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
        {!m.body && !m.media_id && <p className="italic opacity-70">A {m.type} message. Open WhatsApp on the business phone to see it.</p>}
        <p className={`mt-1 flex items-center justify-end gap-1 text-[0.7rem] ${out ? "text-cream/60" : "text-muted"}`}>
          {out && m.sent_by && <span className="truncate">{m.sent_by.split("@")[0]} ·</span>}
          <time dateTime={m.created_at} title={when(m.created_at)}>{new Date(m.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</time>
          {out && <Icon className={`size-3.5 ${m.status === "read" ? "text-gold" : m.status === "failed" ? "text-red-300" : ""}`} aria-label={label} />}
        </p>
        {m.status === "failed" && m.error && <p className="mt-1 text-xs text-red-200">{m.error}</p>}
      </div>
    </li>
  );
}

// Fetched with the admin's token through the Worker. Photos show here; any other file is downloaded,
// never opened in the admin, since a stranger chose its contents.
function Media({ m, leadId }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");
  const image = m.type === "image" || m.type === "sticker";
  const [saved, setSaved] = useState(false);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);

  async function fetchMedia() {
    const { data } = await supabase.auth.getSession();
    const r = await fetch(`/api/whatsapp/media/${encodeURIComponent(m.media_id)}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
    if (!r.ok) throw new Error(r.status === 410 ? "WhatsApp no longer keeps this file (about 30 days)." : "Couldn't load it. Try again.");
    return r.blob();
  }

  // into the lead's From WhatsApp folder, where it can be read, presented and sorted like any file
  async function keep() {
    setError("");
    try {
      const blob = await fetchMedia();
      const name = m.media_name ?? `whatsapp-${m.id}.${{ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[blob.type] ?? "bin"}`;
      await saveFile(leadId, "whatsapp", blob, name);
      setSaved(true);
      toast("Saved to their files, in From WhatsApp");
    } catch (e) {
      setError(e.message);
    }
  }

  async function load() {
    setError("");
    try {
      const u = URL.createObjectURL(await fetchMedia());
      if (image) return setUrl(u);
      Object.assign(document.createElement("a"), { href: u, download: m.media_name ?? `whatsapp-${m.type}` }).click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch (e) {
      setError(e.message);
    }
  }

  const Icon = image ? ImageIcon : Download;
  const canKeep = leadId && ["image", "document"].includes(m.type);
  return (
    <div className="mb-1">
      {url ? (
        <img src={url} alt={m.body ?? "Photo from WhatsApp"} className="max-h-80 rounded-lg" />
      ) : (
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 underline underline-offset-2">
          <Icon className="size-4" aria-hidden />
          {image ? "Show photo" : `Download ${m.media_name ?? m.type}`}
        </button>
      )}
      {canKeep && (
        <button type="button" onClick={keep} disabled={saved} className="mt-1 flex items-center gap-1.5 text-xs underline underline-offset-2 disabled:no-underline disabled:opacity-70">
          <FolderInput className="size-3.5" aria-hidden />
          {saved ? "Saved to their files" : "Save to their files"}
        </button>
      )}
      {error && <p className="mt-1 text-xs opacity-80">{error}</p>}
    </div>
  );
}

// the lead this chat is with: found by mobile when it started, or chosen here
function LeadLink({ thread, onChange }) {
  const [leads, setLeads] = useState(null);
  const [error, setError] = useState("");
  if (thread.lead) return <Link to={`/leads/${thread.lead.id}`} className="text-sm underline underline-offset-2">Open lead</Link>;

  async function link(e) {
    const lead_id = Number(e.target.value);
    if (!lead_id) return;
    try {
      await run(supabase.from("wa_threads").update({ lead_id }).eq("id", thread.id));
      onChange({ id: thread.id, lead_id, lead: leads.find((l) => l.id === lead_id) });
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <label className="text-sm">
      <span className="sr-only">Link to a lead</span>
      <select
        defaultValue=""
        onFocus={() => leads || run(supabase.from("leads").select("id, name, mobile").order("created_at", { ascending: false }).limit(500)).then(setLeads, (e) => setError(e.message))}
        onChange={link}
        className={`${input} w-48 py-1.5`}
        title={error || undefined}
      >
        <option value="">Link to a lead…</option>
        {leads?.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.mobile}</option>)}
      </select>
    </label>
  );
}
