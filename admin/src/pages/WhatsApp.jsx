// WhatsApp: every chat on the business number, live. Chats on the left, the open one on the right (on
// phones, one at a time). Messages arrive through Meta's webhook (admin/worker/whatsapp.js) and show
// here through Supabase Realtime; replies go out through the Worker.
import { AlertCircle, Check, CheckCheck, ChevronLeft, Clock, Download, FolderInput, ImageIcon, Link2, Send, Sparkles, UserPlus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { supabase, run } from "../supabase";
import { api } from "../api";
import { SkeletonRows, toast } from "../motion";
import { saveFile } from "./FilesTab";
import { useSameLead } from "./LeadForm";
import { Empty, ErrorNote, btn, card, input, Select } from "../ui";
import { TEMPLATES, ago, when } from "../crm";

export const THREAD = "id, wa_id, name, lead_id, unread, last_message_at, last_inbound_at, lead:leads(id, name)";
const MSG = "id, thread_id, direction, type, body, media_id, media_name, status, error, sent_by, created_at";
const byRecent = (a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "");
const merge = (list, row) => [...list.filter((x) => x.id !== row.id), row];
const phone = (wa) => `+${wa}`;
const canReply = (t) => t?.last_inbound_at && Date.now() - new Date(t.last_inbound_at) < 864e5;
// hours left to reply freely: WhatsApp's 24-hour customer service window
const hoursLeft = (t) => Math.max(0, Math.ceil((Date.parse(t.last_inbound_at) + 864e5 - Date.now()) / 36e5));

export default function WhatsApp() {
  const { id } = useParams();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    run(supabase.from("wa_threads").select(THREAD).order("last_message_at", { ascending: false, nullsFirst: false }).limit(300)).then(setThreads, (e) => setError(e.message));
    // a changed chat is fetched again, for its lead's name
    const ch = supabase
      .channel(`wa-threads-${crypto.randomUUID()}`) // its own name: see Bell.jsx
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

export function Chat({ thread, onChange }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const open = canReply(thread);

  useEffect(() => {
    run(supabase.from("wa_messages").select(MSG).eq("thread_id", thread.id).order("created_at").limit(500)).then(setMsgs, (e) => setError(e.message));
    const ch = supabase
      .channel(`wa-messages-${thread.id}-${crypto.randomUUID()}`)
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

  // braces: Chrome's scrollIntoView now returns a Promise, which React would call as the cleanup
  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length]);

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
        <Link to="/whatsapp" className="-my-1 -ml-2 grid size-10 place-items-center rounded text-muted hover:text-fg md:hidden" aria-label="All chats">
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl text-ink">{thread.lead?.name ?? thread.name ?? phone(thread.wa_id)}</h2>
          <p className="text-xs text-muted">
            {phone(thread.wa_id)}
            {thread.name && thread.lead && ` · “${thread.name}” on WhatsApp`}
            {" · "}
            <span className={open ? (hoursLeft(thread) <= 3 ? "font-medium text-danger" : "") : "font-medium"}>
              {open ? `Reply window: ${hoursLeft(thread)}h left` : "Reply window closed"}
            </span>
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
        <Copilot />
        {open ? (
          <form onSubmit={send} className="mt-0 flex items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Reply</span>
              <textarea
                rows={Math.min(6, text.split("\n").length)}
                maxLength={4096}
                value={text}
                onChange={(e) => setText(e.target.value)}
                // Enter sends only with a real keyboard: a phone's Enter is the new line
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches && send(e)}
                placeholder="Reply on WhatsApp… (Shift+Enter for a new line)"
                className={`${input} resize-none`}
              />
            </label>
            <button className={btn} disabled={busy || !text.trim()} aria-label="Send">
              <Send className="size-4" aria-hidden />
            </button>
          </form>
        ) : (
          <Templates thread={thread} />
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

// The AI copilot (Claude): drafts a reply or sums the chat up as a sticky note. It never sends on its
// own; an agent reads, edits and presses Send.
// ponytail: buttons only, until WhatsApp is connected and the Worker has an /api/copilot route
function Copilot() {
  const soon = "Coming once WhatsApp is connected";
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 font-semibold text-accent-ink">
        <Sparkles className="size-3.5" aria-hidden /> Copilot
      </span>
      {["Draft a reply", "Sum up as a sticky note"].map((l) => (
        <button key={l} type="button" disabled title={soon} className="rounded-full border border-line px-2.5 py-1 text-muted disabled:cursor-not-allowed">
          {l}
        </button>
      ))}
      <span className="text-muted">· {soon}</span>
    </div>
  );
}

// After 24 hours only an approved template can go out. The picker and its preview work; sending waits
// for templates approved in Meta and a Worker route to send them.
// ponytail: TEMPLATES are placeholders in crm.js; fetch the approved list from Meta once connected
function Templates({ thread }) {
  const [pick, setPick] = useState(TEMPLATES[0]);
  const first = (thread.lead?.name ?? thread.name ?? "").split(" ")[0];
  return (
    <div className="grid gap-2 rounded-md bg-sunken p-3 text-sm">
      <p className="text-muted">More than 24 hours since their last message, so WhatsApp only allows an approved template. Free replies open again as soon as they write.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="label text-ink">Template</span>
          <Select value={pick.name} onChange={(e) => setPick(TEMPLATES.find((t) => t.name === e.target.value))} className={`${input} w-52 py-1.5`}>
            {TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
          </Select>
        </label>
        <button type="button" disabled title="Templates send once they're approved in Meta and WhatsApp is connected" className={btn}>
          <Send className="size-4" aria-hidden /> Send template
        </button>
      </div>
      <p className="rounded-md border border-line bg-surface px-3 py-2 whitespace-pre-wrap">{first ? pick.text.replace("{{1}}", first) : pick.text}</p>
    </div>
  );
}

// the lead this chat is with: found by mobile when it started, or chosen here, or made from the chat
function LeadLink({ thread, onChange }) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // a lead already on this number (written any way): offered first, so it isn't made twice
  const same = useSameLead(thread.lead ? "" : thread.wa_id);
  if (thread.lead) return <Link to={`/leads/${thread.lead.id}`} className="text-sm underline underline-offset-2">Open lead</Link>;

  const optionOf = (l) => `${l.name} · ${l.mobile ?? "no mobile"}`;
  async function link(lead) {
    if (!lead) return;
    const lead_id = lead.id;
    try {
      await run(supabase.from("wa_threads").update({ lead_id }).eq("id", thread.id));
      onChange({ id: thread.id, lead_id, lead: { id: lead.id, name: lead.name } });
    } catch (err) {
      setError(err.message);
    }
  }
  // A new lead from this chat, assigned like a website inquiry, with a reminder to call them back.
  // ponytail: a button for now; making leads automatically waits for WhatsApp to be connected
  async function make() {
    setBusy(true);
    setError("");
    try {
      const name = (thread.name ?? phone(thread.wa_id)).slice(0, 100).padEnd(2, "?");
      const lead = await run(supabase.from("leads").insert({ source_site: "whatsapp", name, mobile: phone(thread.wa_id), interest: "WhatsApp inquiry" }).select("id, name, agent_id").single());
      try {
        await run(supabase.from("wa_threads").update({ lead_id: lead.id }).eq("id", thread.id));
      } catch (err) {
        await supabase.from("leads").delete().eq("id", lead.id); // not left half-made: a retry won't make two
        throw err;
      }
      await run(supabase.from("reminders").insert({ lead_id: lead.id, agent_id: lead.agent_id, due_at: new Date(Date.now() + 36e5).toISOString(), body: "Call them back: they wrote on WhatsApp" }));
      onChange({ id: thread.id, lead_id: lead.id, lead: { id: lead.id, name: lead.name } });
      toast("Lead made, with a reminder to call them within the hour", { action: { label: "Open", run: () => navigate(`/leads/${lead.id}`) } });
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
    {error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
    {same && (
      <button type="button" onClick={() => link(same)} className="press inline-flex items-center gap-1.5 rounded-md border border-gold/50 bg-gold/10 px-2.5 py-1.5 text-sm">
        <Link2 className="size-4" aria-hidden /> Link to {same.name} (same number)
      </button>
    )}
    <button type="button" onClick={make} disabled={busy} className="press inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-muted/50 disabled:opacity-50" title={error || "Make a lead from this chat"}>
      <UserPlus className="size-4" aria-hidden /> {busy ? "Making…" : "Make a lead"}
    </button>
    <label className="min-w-0 flex-1 text-sm sm:flex-none">
      <span className="sr-only">Link to a lead</span>
      {/* type a name or a number; picking one from the list links it */}
      <input
        list={`wa-leads-${thread.id}`}
        value={text}
        placeholder="Link to a lead: name or mobile"
        autoComplete="off"
        onFocus={() => leads || run(supabase.from("leads").select("id, name, mobile").order("created_at", { ascending: false }).limit(2000)).then(setLeads, (e) => setError(e.message))}
        onChange={(e) => {
          setText(e.target.value);
          const hit = leads?.find((l) => optionOf(l) === e.target.value);
          if (hit) link(hit);
        }}
        className={`${input} w-full py-1.5 sm:w-60`}
      />
      <datalist id={`wa-leads-${thread.id}`}>
        {leads?.map((l) => <option key={l.id} value={optionOf(l)} />)}
      </datalist>
    </label>
    </div>
  );
}
