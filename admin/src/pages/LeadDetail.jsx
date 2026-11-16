import { BellRing, ChevronLeft, Mail, MessageCircle, Phone, Pin, PinOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { Live, LiveLi, Skeleton, SkeletonRows, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Tabs, btn, btnDanger, btnGhost, card, input } from "../ui";
import { SITES, STAGES, when } from "../crm";
import Activity from "./Activity";
import FilesTab, { FILES } from "./FilesTab";

const TABS = ["Overview", "Notes", "Files", "Reminders", "Activity"];
const NOTE = "id, body, author_email, created_at, pinned, color";

// One lead, laid out as the dashboard's client pages are: a header, then tabs kept in the address.
export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [lead, setLead] = useState(null);
  const [chat, setChat] = useState(null); // their WhatsApp chat, if they've written
  const [notes, setNotes] = useState(null); // shared by the pinned stickies up top and the Notes tab
  const [error, setError] = useState("");
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "Overview";

  useEffect(() => {
    run(supabase.from("leads").select("*, listing:listings(id, title)").eq("id", id).maybeSingle()).then((row) => (row ? setLead(row) : setError("No such lead. It may have been deleted.")), (e) => setError(e.message));
    run(supabase.from("lead_notes").select(NOTE).eq("lead_id", id).order("created_at", { ascending: false })).then(setNotes, (e) => setError(e.message));
    run(supabase.from("wa_threads").select("id").eq("lead_id", id).limit(1).maybeSingle()).then(setChat, () => {});
  }, [id]);

  // the Data Privacy Act: a person may ask for their details to be deleted
  async function remove() {
    if (!confirm(`Delete ${lead.name} for good, with their notes, files, reminders, WhatsApp chat and history? Do this when they ask for their data to be deleted. It can't be undone.`)) return;
    try {
      // Storage won't let the database delete files, so theirs go first
      const files = await run(supabase.from("lead_files").select("file_path").eq("lead_id", lead.id));
      if (files.length) await run(supabase.storage.from(FILES).remove(files.map((f) => f.file_path)));
      await run(supabase.rpc("delete_lead", { p_id: lead.id }));
      toast("Lead deleted, with its notes, files, reminders and history");
      navigate("/leads");
    } catch (e) {
      setError(e.message);
    }
  }

  if (!lead)
    return error ? (
      <>
        <ErrorNote error={error} />
        <Link to="/leads" className="mt-4 inline-block text-sm underline">Back to leads</Link>
      </>
    ) : (
      <div aria-busy="true" aria-label="Loading" className="grid gap-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-4 h-10 w-full max-w-md" />
        <Skeleton className="h-56 w-full max-w-3xl" />
      </div>
    );

  return (
    <>
      <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden />
        Leads
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[2.1rem] leading-tight tracking-[-0.01em] text-ink">{lead.name}</h1>
        <Badge value={lead.stage}>{STAGES[lead.stage]}</Badge>
        {chat && (
          <Link to={`/whatsapp/${chat.id}`} className={`${btnGhost} ml-auto`}>
            <MessageCircle className="size-4" aria-hidden /> WhatsApp chat
          </Link>
        )}
        <button className={`${btnDanger} ${chat ? "" : "ml-auto"}`} onClick={remove}>
          <Trash2 className="size-4" aria-hidden /> Delete on request
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {lead.interest} · {SITES[lead.source_site] ?? lead.source_site} · {when(lead.created_at)}
      </p>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>

      <Pinned notes={notes} onOpen={() => setParams({ tab: "Notes" }, { replace: true })} />

      <div className="mt-6">
        <Tabs label="Lead sections" items={TABS.map((t) => ({ id: t, title: t }))} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      </div>
      <div className="mt-6">
        {tab === "Overview" && <Overview lead={lead} onSaved={(l) => setLead({ ...lead, ...l })} />}
        {tab === "Notes" && <Notes leadId={lead.id} notes={notes} setNotes={setNotes} />}
        {tab === "Files" && <FilesTab leadId={lead.id} />}
        {tab === "Reminders" && <Reminders lead={lead} />}
        {tab === "Activity" && <Activity lead={lead.id} />}
      </div>
    </>
  );
}

function Overview({ lead, onSaved }) {
  const [deal, setDeal] = useState({ stage: lead.stage, lost_reason: lead.lost_reason ?? "", agent_id: lead.agent_id == null ? "" : String(lead.agent_id) });
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    run(supabase.from("admin_users").select("id, name").eq("active", true).order("name")).then(setUsers, (e) => setError(e.message));
  }, []);
  const dirty = deal.stage !== lead.stage || deal.lost_reason !== (lead.lost_reason ?? "") || deal.agent_id !== (lead.agent_id == null ? "" : String(lead.agent_id));

  async function save(e) {
    e.preventDefault();
    setError("");
    if (deal.stage === "lost" && !deal.lost_reason.trim()) return setError("Say why the deal was lost");
    setBusy(true);
    try {
      const row = await run(
        supabase
          .from("leads")
          .update({ stage: deal.stage, lost_reason: deal.stage === "lost" ? deal.lost_reason.trim() : null, agent_id: deal.agent_id ? Number(deal.agent_id) : null })
          .eq("id", lead.id)
          .select()
          .single()
      );
      onSaved(row);
      toast(row.stage !== lead.stage ? `Moved to ${STAGES[row.stage]}` : "Saved");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const rows = [
    ["Mobile", <a key="tel" href={`tel:${lead.mobile.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 underline underline-offset-2"><Phone className="size-3.5" aria-hidden />{lead.mobile}</a>],
    ["Email", <a key="mail" href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 break-all underline underline-offset-2"><Mail className="size-3.5 shrink-0" aria-hidden />{lead.email}</a>],
    ["Interested in", lead.interest],
    ["Listing", lead.listing && <Link key="l" to={`/listings/${lead.listing.id}`} className="underline underline-offset-2">{lead.listing.title}</Link>],
    ["Budget", lead.budget],
    ["Preferred viewing", lead.viewing_time],
    ["From", SITES[lead.source_site] ?? lead.source_site],
    ["Consent given", when(lead.consent_at)],
  ];
  return (
    <div className="stagger grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className={card}>
        <dl className="divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-3 gap-4 px-4 py-3">
              <dt className="text-muted">{k}</dt>
              <dd className="col-span-2 break-words text-fg">{v || "—"}</dd>
            </div>
          ))}
        </dl>
        {lead.message && <p className="border-t border-line px-4 py-3 text-sm whitespace-pre-wrap">{lead.message}</p>}
      </div>

      <form onSubmit={save} className={`${card} grid h-fit gap-4 p-5`}>
        <h2 className="font-display text-xl text-ink">The deal</h2>
        <ErrorNote error={error} />
        <Field label="Stage">
          <select value={deal.stage} onChange={(e) => setDeal({ ...deal, stage: e.target.value })} className={input}>
            {Object.entries(STAGES).map(([k, s]) => <option key={k} value={k}>{s}</option>)}
          </select>
        </Field>
        {deal.stage === "lost" && (
          <Field label="Why it was lost">
            <input value={deal.lost_reason} onChange={(e) => setDeal({ ...deal, lost_reason: e.target.value })} maxLength={300} required placeholder="Bought elsewhere, budget, timing…" className={input} />
          </Field>
        )}
        <Field label="Agent">
          <select value={deal.agent_id} onChange={(e) => setDeal({ ...deal, agent_id: e.target.value })} className={input}>
            <option value="">No one yet</option>
            {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
        </Field>
        <button className={btn} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</button>
      </form>
    </div>
  );
}

// Notes are sticky notes: a colour each, and the ones that matter pinned above every tab.
const COLORS = ["yellow", "pink", "blue", "green"];
const tilt = (id) => ["-rotate-[1.2deg]", "rotate-[0.8deg]", "-rotate-[0.4deg]", "rotate-[1.4deg]"][id % 4];

function Sticky({ n, children, className = "" }) {
  return (
    <div className={`sticky-note sticky-${n.color} ${tilt(n.id)} rounded-sm p-4 text-sm transition-transform duration-200 ease-out hover:rotate-0 ${className}`}>
      {n.pinned && <span aria-hidden className="sticky-tape" />}
      {children}
    </div>
  );
}

// the pinned notes, above the tabs on every tab: "OFW in Dubai, call after 9pm", "spouse co-borrows"
function Pinned({ notes, onOpen }) {
  const pinned = notes?.filter((n) => n.pinned) ?? [];
  if (!pinned.length) return null;
  return (
    <section aria-label="Pinned notes" className="mt-5 flex gap-4 overflow-x-auto px-1 pt-3 pb-2">
      {pinned.map((n) => (
        <button key={n.id} type="button" onClick={onOpen} className="w-56 shrink-0 text-left">
          <Sticky n={n}>
            <p className="line-clamp-4 whitespace-pre-wrap">{n.body}</p>
            <p className="mt-2 text-[0.7rem] opacity-60">{n.author_email?.split("@")[0]} · {when(n.created_at)}</p>
          </Sticky>
        </button>
      ))}
    </section>
  );
}

function Notes({ leadId, notes, setNotes }) {
  const [draft, setDraft] = useState({ body: "", color: "yellow", pinned: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!draft.body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const n = await run(supabase.from("lead_notes").insert({ lead_id: leadId, ...draft, body: draft.body.trim() }).select(NOTE).single());
      setNotes((ns) => [n, ...ns]);
      setDraft({ body: "", color: draft.color, pinned: false });
      toast(n.pinned ? "Pinned to the top of the lead" : "Note added");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function change(n, patch) {
    setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, ...patch } : x)));
    try {
      await run(supabase.from("lead_notes").update(patch).eq("id", n.id));
    } catch (err) {
      setNotes((ns) => ns.map((x) => (x.id === n.id ? n : x)));
      setError(err.message);
    }
  }

  async function remove(n) {
    if (!confirm("Take this note down for good?")) return;
    try {
      await run(supabase.from("lead_notes").delete().eq("id", n.id));
      setNotes((ns) => ns.filter((x) => x.id !== n.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const sorted = notes && [...notes].sort((a, b) => b.pinned - a.pinned);
  const tool = "press rounded p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100";
  return (
    <div className="grid max-w-5xl gap-6">
      <ErrorNote error={error} />
      <ul className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
        <li>
          <form onSubmit={add} className={`sticky-note sticky-${draft.color} grid gap-3 rounded-sm p-4`}>
            <label>
              <span className="sr-only">New note</span>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={5}
                maxLength={4000}
                placeholder="What matters about them: who decides, when to call, what they're waiting for…"
                className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg/45"
              />
            </label>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setDraft({ ...draft, color: c })} aria-label={`${c} note`} aria-pressed={draft.color === c} className={`sticky-${c} size-5 rounded-full border border-black/15 ${draft.color === c ? "ring-2 ring-navy ring-offset-1" : ""}`} />
              ))}
              <button type="button" onClick={() => setDraft({ ...draft, pinned: !draft.pinned })} aria-pressed={draft.pinned} className={`${tool} ml-auto ${draft.pinned ? "opacity-100" : ""}`} title="Pin to the top of the lead">
                <Pin className={`size-4 ${draft.pinned ? "fill-current" : ""}`} aria-hidden />
                <span className="sr-only">Pin</span>
              </button>
              <button className="press rounded bg-navy px-3 py-1.5 text-xs font-semibold text-cream disabled:opacity-50" disabled={busy || !draft.body.trim()}>
                {busy ? "Sticking…" : "Stick it"}
              </button>
            </div>
          </form>
        </li>
        {!sorted ? (
          <li><SkeletonRows n={2} /></li>
        ) : (
          <Live>
            {sorted.map((n, i) => (
              <LiveLi key={n.id} i={i}>
                <Sticky n={n} className="flex h-full flex-col">
                  <p className="flex-1 whitespace-pre-wrap break-words">{n.body}</p>
                  <p className="mt-3 text-[0.7rem] opacity-60">
                    {n.author_email?.split("@")[0]} · <time dateTime={n.created_at}>{when(n.created_at)}</time>
                  </p>
                  <div className="mt-2 flex items-center gap-1 border-t border-black/10 pt-2">
                    <button type="button" onClick={() => change(n, { color: COLORS[(COLORS.indexOf(n.color) + 1) % COLORS.length] })} className={tool} aria-label="Change colour">
                      <span className={`sticky-${COLORS[(COLORS.indexOf(n.color) + 1) % COLORS.length]} block size-4 rounded-full border border-black/20`} />
                    </button>
                    <button type="button" onClick={() => change(n, { pinned: !n.pinned })} className={tool} aria-label={n.pinned ? "Unpin" : "Pin to the top of the lead"}>
                      {n.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                    </button>
                    <button type="button" onClick={() => remove(n)} className={`${tool} ml-auto`} aria-label="Delete note">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </Sticky>
              </LiveLi>
            ))}
          </Live>
        )}
      </ul>
      {sorted && !sorted.length && <p className="text-sm text-muted">No notes yet. Pin the ones the whole team should see first.</p>}
    </div>
  );
}

// the local date and time an <input type="datetime-local"> wants, a day from now
const tomorrow = () => {
  const d = new Date(Date.now() + 864e5);
  d.setMinutes(0, 0, 0);
  return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
};

function Reminders({ lead }) {
  const [list, setList] = useState(null);
  const [f, setF] = useState({ due: tomorrow(), body: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    run(supabase.from("reminders").select("id, body, due_at, done_at, emailed_at").eq("lead_id", lead.id).order("due_at")).then(setList, (e) => setError(e.message));
  }, [lead.id]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await run(
        supabase.from("reminders").insert({ lead_id: lead.id, agent_id: lead.agent_id, due_at: new Date(f.due).toISOString(), body: f.body.trim() }).select("id, body, due_at, done_at, emailed_at").single()
      );
      setList((l) => [...l, r].sort((a, b) => a.due_at.localeCompare(b.due_at)));
      setF({ due: tomorrow(), body: "" });
      toast("Reminder set. It's emailed to the agent when it's due.");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function toggle(r) {
    const done_at = r.done_at ? null : new Date().toISOString();
    setList((l) => l.map((x) => (x.id === r.id ? { ...x, done_at } : x)));
    try {
      await run(supabase.from("reminders").update({ done_at }).eq("id", r.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const now = new Date().toISOString();
  return (
    <div className="grid max-w-3xl gap-4">
      <form onSubmit={add} className={`${card} grid gap-3 p-4 sm:grid-cols-[13rem_1fr_auto] sm:items-end`}>
        <div className="sm:col-span-3">
          <ErrorNote error={error} />
        </div>
        <Field label="When">
          <input type="datetime-local" required value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className={input} />
        </Field>
        <Field label="Follow up on">
          <input required maxLength={300} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Send the price list, confirm the viewing…" className={input} />
        </Field>
        <button className={btn} disabled={busy}>
          <BellRing className="size-4" aria-hidden /> {busy ? "Setting…" : "Remind"}
        </button>
      </form>
      <div className={card}>
        {!list ? (
          <SkeletonRows n={2} />
        ) : !list.length ? (
          <Empty>No reminders. Set one so this lead isn't forgotten.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            <Live>
              {list.map((r, i) => (
                <LiveLi key={r.id} i={i} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <input type="checkbox" checked={!!r.done_at} onChange={() => toggle(r)} aria-label={`Done: ${r.body}`} className="mt-0.5 size-4 accent-navy" />
                  <div className="min-w-0 flex-1">
                    <p className={r.done_at ? "text-muted line-through" : "text-fg"}>{r.body}</p>
                    <p className={`mt-0.5 text-xs ${!r.done_at && r.due_at < now ? "font-medium text-danger" : "text-muted"}`}>
                      {when(r.due_at)}
                      {!r.done_at && r.due_at < now && " · overdue"}
                      {r.emailed_at && " · emailed"}
                    </p>
                  </div>
                </LiveLi>
              ))}
            </Live>
          </ul>
        )}
      </div>
    </div>
  );
}
