// The business Gmail, read-only, beside everything else (admin/worker/gmail.js): Inbox or Sent,
// Gmail's own search, a chip on anyone who's a lead, and the message beside the list. A message's
// HTML shows in a sandbox with no scripts, and its remote images (which tell the sender it was
// opened) stay blocked until asked for. Replying happens in Gmail.
import { ArrowLeft, ExternalLink, Image, Inbox, Paperclip, Search, Send, UserPlus } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { supabase, run } from "../supabase";
import { SkeletonRows, spring, toast } from "../motion";
import { Empty, ErrorNote, PageHeader, TabPanel, btnGhost, card, input } from "../ui";
import { Chip } from "./Matches";

const BOXES = { inbox: ["Inbox", Inbox], sent: ["Sent", Send] };
const addressOf = (h) => (h.match(/<([^>]+)>/)?.[1] ?? h).trim().toLowerCase();
const nameOf = (h) => h.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || addressOf(h);
const when = (ms) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("en-PH", today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
};

// an attachment comes through the Worker with the sign-in token, so it's fetched, then saved
async function save(id, att) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(`/api/google/mail/${id}/att/${att.id}?name=${encodeURIComponent(att.name)}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't download it");
  const url = URL.createObjectURL(await r.blob());
  Object.assign(document.createElement("a"), { href: url, download: att.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Email() {
  const [box, setBox] = useState("inbox");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState(null);
  const [next, setNext] = useState(null);
  const [leads, setLeads] = useState({}); // email → lead
  const [error, setError] = useState("");
  const [account, setAccount] = useState("");
  const [open, setOpen] = useState(null); // the message being read
  // on phones the message replaces the list: start it at the top, and come back to where the list was
  const listAt = useRef(0);
  const read = (m) => {
    if (!open) listAt.current = scrollY;
    setOpen(m);
    if (!matchMedia("(min-width: 1024px)").matches) scrollTo(0, 0);
  };
  const back = () => {
    setOpen(null);
    requestAnimationFrame(() => scrollTo(0, listAt.current));
  };

  async function load(page) {
    setError("");
    if (!page) setList(null);
    try {
      const r = await api(`google/mail?box=${box}&q=${encodeURIComponent(search)}${page ? `&page=${encodeURIComponent(page)}` : ""}`);
      setList((l) => (page ? [...(l ?? []), ...r.messages] : r.messages));
      setNext(r.next);
      // who among these is a lead: for a sent email, whom it went to
      const emails = [...new Set(r.messages.map((m) => addressOf(box === "sent" ? m.to : m.from)))];
      if (emails.length) {
        const rows = await run(supabase.from("leads").select("id, name, email").in("email", emails));
        setLeads((all) => ({ ...all, ...Object.fromEntries(rows.map((l) => [l.email, l])) }));
      }
    } catch (e) {
      setError(e.message);
      if (!page) setList([]);
    }
  }

  useEffect(() => {
    api("google/status").then((s) => setAccount(s.email ?? ""), () => {});
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, search]);

  return (
    <>
      <PageHeader title="Email" sub={account ? `${account}, read-only. Reply from Gmail.` : "The business Gmail, read-only."} />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="radiogroup" aria-label="Mailbox" className="flex w-fit rounded-full border border-line bg-surface p-0.5">
          {Object.entries(BOXES).map(([k, [label, Icon]]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={box === k}
              onClick={() => (setBox(k), setOpen(null))}
              className={`relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${box === k ? "text-cream" : "text-muted hover:text-fg"}`}
            >
              {box === k && <motion.span layoutId="mail-box" transition={spring} className="absolute inset-0 rounded-full bg-navy" />}
              <Icon className="relative size-4" aria-hidden />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
        <form
          className="relative sm:max-w-sm sm:flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <label className="sr-only" htmlFor="mail-search">Search email</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id="mail-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, as in Gmail: a name, from:, has:attachment" className={`${input} pl-9`} />
        </form>
      </div>

      <div className="mt-4">
        <ErrorNote error={error} />
        {/scope|Reconnect/i.test(error) && (
          <Link to="/calendar" className={`${btnGhost} mt-2`}>Go to Calendar to reconnect Google</Link>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {/* the list; on phones it gives way to the open message */}
        <div className={open ? "hidden lg:block" : ""}>
          <TabPanel key={`${box}:${search}`} className={`${card} overflow-hidden`}>
            {!list ? (
              <SkeletonRows n={6} />
            ) : !list.length ? (
              <Empty>{search ? "No email matches that search." : "Nothing here."}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((m) => {
                  const who = box === "sent" ? m.to : m.from;
                  const lead = leads[addressOf(who)];
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => read(m)}
                        aria-current={open?.id === m.id || undefined}
                        className={`grid w-full gap-0.5 px-4 py-3 text-left text-sm transition-colors hover:bg-bg ${open?.id === m.id ? "bg-sunken/70" : ""}`}
                      >
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={`size-2 shrink-0 rounded-full ${m.unread ? "bg-gold" : "bg-transparent"}`} />
                          {m.unread && <span className="sr-only">Unread:</span>}
                          <span className={`min-w-0 flex-1 truncate ${m.unread ? "font-semibold text-ink" : "text-fg"}`}>{box === "sent" ? `To ${nameOf(who)}` : nameOf(who)}</span>
                          <span className="shrink-0 text-xs text-muted tabular-nums">{when(m.at)}</span>
                        </span>
                        <span className={`truncate pl-4 ${m.unread ? "font-medium text-fg" : "text-charcoal"}`}>{m.subject || "(no subject)"}</span>
                        <span className="flex items-center gap-1.5 pl-4">
                          {lead && <Chip tone="navy">Lead</Chip>}
                          <span className="truncate text-xs text-muted">{m.snippet}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {next && (
              <div className="border-t border-line p-3 text-center">
                <button type="button" className={btnGhost} onClick={() => load(next)}>Load more</button>
              </div>
            )}
          </TabPanel>
        </div>

        <div className={open ? "" : "hidden lg:block"}>
          {open ? (
            <TabPanel key={open.id}>
              <Message
                summary={open}
                who={box === "sent" ? open.to : open.from}
                lead={leads[addressOf(box === "sent" ? open.to : open.from)]}
                onLead={(l) => setLeads((all) => ({ ...all, [l.email]: l }))}
                account={account}
                onBack={back}
              />
            </TabPanel>
          ) : (
            <div className={`${card} flex min-h-64 items-center justify-center`}>
              <p className="text-sm text-muted">Pick an email to read it here.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Message({ summary, who, lead, onLead, account, onBack }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  // someone who isn't a lead yet: one click makes them one, from their name and address
  async function makeLead() {
    setBusy(true);
    setError("");
    try {
      const email = addressOf(who);
      const name = nameOf(who).slice(0, 100).padEnd(2, "?");
      const l = await run(supabase.from("leads").insert({ source_site: "email", name, email, interest: summary.subject?.slice(0, 200) || "Email inquiry" }).select("id, name, email").single());
      onLead(l);
      toast(`${l.name} is now a lead`, { action: { label: "Open", run: () => navigate(`/leads/${l.id}`) } });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }
  const [images, setImages] = useState(false);
  useEffect(() => {
    api(`google/mail/${summary.id}`).then(setM, (e) => setError(e.message));
  }, [summary.id]);

  // the message's own HTML, as a page the Worker serves with its own strict rules (gmail.js view),
  // sandboxed here too: no scripts, no reaching the admin, links open in a new tab
  const src = m?.view && `/api/google/mail/${summary.id}/view?t=${encodeURIComponent(m.view)}&images=${images ? 1 : 0}`;

  return (
    <article className={`${card} grid gap-4 p-5`}>
      <button type="button" onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted hover:text-fg lg:hidden">
        <ArrowLeft className="size-4" aria-hidden /> All email
      </button>
      <header className="grid gap-2">
        <h2 className="font-display text-2xl leading-tight text-ink">{summary.subject || "(no subject)"}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-fg">{nameOf(summary.from)}</span>
          <span className="text-muted">{addressOf(summary.from)}</span>
          {lead ? (
            <Link to={`/leads/${lead.id}`}>
              <Chip tone="navy">Lead: {lead.name}</Chip>
            </Link>
          ) : (
            addressOf(who) !== account && (
              <button type="button" onClick={makeLead} disabled={busy} className="press inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-fg disabled:opacity-50">
                <UserPlus className="size-3.5" aria-hidden /> {busy ? "Making…" : "Make a lead"}
              </button>
            )
          )}
          <span className="ml-auto text-xs text-muted tabular-nums">{new Date(summary.at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span>
        </div>
        <p className="text-xs text-muted">
          To {summary.to}
          {m?.cc && <> · Cc {m.cc}</>}
        </p>
      </header>

      <ErrorNote error={error} />
      {!m && !error && <SkeletonRows n={4} />}
      {m && (
        <>
          {src ? (
            <>
              {!images && m.images && (
                <button type="button" onClick={() => setImages(true)} className="flex w-fit items-center gap-1.5 rounded-md bg-sunken/70 px-3 py-1.5 text-xs text-muted hover:text-fg">
                  <Image className="size-3.5" aria-hidden /> Images are hidden so the sender can't tell it was opened. Show images
                </button>
              )}
              <iframe title="Email" sandbox="allow-popups allow-popups-to-escape-sandbox" src={src} className="h-[60vh] w-full rounded-md border border-line bg-white" />
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-charcoal">{m.text || "(empty)"}</p>
          )}
          {m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <button key={a.id} type="button" className={btnGhost} onClick={() => save(summary.id, a).catch((e) => setError(e.message))}>
                  <Paperclip className="size-4" aria-hidden /> {a.name} <span className="text-xs text-muted">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div>
        <a href={`https://mail.google.com/mail/u/${account ? encodeURIComponent(account) : 0}/#all/${summary.thread}`} target="_blank" rel="noopener noreferrer" className={btnGhost}>
          <ExternalLink className="size-4" aria-hidden /> Open in Gmail to reply
        </a>
      </div>
    </article>
  );
}
