import { BellRing, CalendarPlus, ChevronLeft, Mail, MessageCircle, Pencil, Phone, Trash2 } from "lucide-react";
import Matches, { Chip } from "./Matches";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { Live, LiveLi, Skeleton, SkeletonRows, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Modal, TabPanel, Tabs, btn, btnDanger, btnGhost, card, input, Select, ask } from "../ui";
import LeadForm from "./LeadForm";
import { CATEGORIES, ON_THE_CLOCK, OPEN, SITES, SOURCES, STAGES, TEMPS, ago, papersDue, quiet, when } from "../crm";
import Activity from "./Activity";
import FilesTab, { FILES } from "./FilesTab";
import { NOTE, Notes, Pinned } from "./StickyNotes";
import { Chat, THREAD } from "./WhatsApp";

const TABS = ["Overview", "Notes", "Files", "WhatsApp", "Reminders", "Activity"];

// One lead, laid out as the dashboard's client pages are: a header, then tabs kept in the address.
export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [lead, setLead] = useState(null);
  const [chat, setChat] = useState(null); // their WhatsApp chat, if they've written
  const [overview, setOverview] = useState(null); // last contact, next step, papers verified (lead_overview)
  const [notes, setNotes] = useState(null); // shared by the pinned stickies up top and the Notes tab
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "Overview";

  useEffect(() => {
    run(supabase.from("leads").select("*, listing:listings(id, title)").eq("id", id).maybeSingle()).then((row) => (row ? setLead(row) : setError("No such lead. It may have been deleted.")), (e) => setError(e.message));
    run(supabase.from("lead_notes").select(NOTE).eq("lead_id", id).order("created_at", { ascending: false })).then(setNotes, (e) => setError(e.message));
    run(supabase.from("wa_threads").select(THREAD).eq("lead_id", id).limit(1).maybeSingle()).then(setChat, () => {});
    run(supabase.from("lead_overview").select("*").eq("id", id).maybeSingle()).then(setOverview, () => {});
  }, [id]);

  // the Data Privacy Act: a person may ask for their details to be deleted
  async function remove() {
    if (!(await ask({ title: `Delete ${lead.name} for good?`, body: "Their notes, files, reminders, WhatsApp chat and history go too. Do this when they ask for their data to be deleted. It can't be undone.", yes: "Delete for good", danger: true }))) return;
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
        <Temperature lead={lead} onSaved={(temperature) => setLead({ ...lead, temperature })} />
        <button className={`${btnGhost} ml-auto`} onClick={() => setEditing(true)}>
          <Pencil className="size-4" aria-hidden /> Edit details
        </button>
        <button className={btnDanger} onClick={remove}>
          <Trash2 className="size-4" aria-hidden /> Delete on request
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {[CATEGORIES[lead.category], lead.interest, SITES[lead.source_site] ?? lead.source_site, when(lead.created_at)].filter(Boolean).join(" · ")}
      </p>
      <FollowUp lead={lead} o={overview} onTab={(t) => setParams({ tab: t }, { replace: true })} />
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>

      <Pinned notes={notes} onOpen={() => setParams({ tab: "Notes" }, { replace: true })} />

      <div className="mt-6">
        <Tabs label="Lead sections" items={TABS.map((t) => ({ id: t, title: t }))} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      </div>
      <TabPanel key={tab} className="mt-6">
        {tab === "Overview" && <Overview lead={lead} onSaved={(l) => setLead({ ...lead, ...l })} />}
        {tab === "Notes" && <Notes leadId={lead.id} notes={notes} setNotes={setNotes} />}
        {tab === "Files" && <FilesTab leadId={lead.id} lead={lead} onChecked={(papers_verified) => setOverview((o) => o && { ...o, papers_verified })} />}
        {tab === "WhatsApp" && <LeadChat lead={lead} chat={chat} setChat={setChat} />}
        {tab === "Reminders" && <Reminders lead={lead} />}
        {tab === "Activity" && <Activity lead={lead.id} />}
      </TabPanel>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${lead.name}`}>
        {editing && (
          <LeadForm
            lead={lead}
            onSaved={(row) => {
              setLead({ ...lead, ...row });
              setEditing(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}

// Hot, warm or cold: tap one to set it, tap it again to clear it.
function Temperature({ lead, onSaved }) {
  async function set(t) {
    const temperature = lead.temperature === t ? null : t;
    onSaved(temperature);
    try {
      await run(supabase.from("leads").update({ temperature }).eq("id", lead.id));
    } catch (e) {
      onSaved(lead.temperature);
      toast(e.message);
    }
  }
  return (
    <div role="group" aria-label="How warm is this lead" className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {Object.entries(TEMPS).map(([k, label]) => (
        <button key={k} type="button" aria-pressed={lead.temperature === k} onClick={() => set(k)} className={`press rounded px-2.5 py-1 text-xs font-semibold transition-colors duration-150 ${lead.temperature === k ? { hot: "bg-burgundy text-cream", warm: "bg-gold text-navy", cold: "bg-sky-700 text-white" }[k] : "text-muted hover:text-fg"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// the line every CRM puts under a name: when we last spoke, what happens next, and the papers clock
function FollowUp({ lead, o, onTab }) {
  if (!o) return null;
  const open = OPEN.includes(lead.stage);
  const days = lead.stage === "reserved" && papersDue(lead.reserved_at);
  const link = "underline-offset-2 hover:underline";
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <span className={open && quiet(o.last_contact_at) ? "font-medium text-danger" : "text-muted"}>
        Last contact {ago(o.last_contact_at)}
        {open && quiet(o.last_contact_at) && " · gone quiet"}
      </span>
      {o.next_step ? (
        <button type="button" onClick={() => onTab("Reminders")} className={`${link} ${Date.parse(o.next_step_at) < Date.now() ? "text-danger" : "text-fg"}`}>
          Next: {o.next_step} · {ago(o.next_step_at)}
        </button>
      ) : (
        open && <button type="button" onClick={() => onTab("Reminders")} className={`${link} text-accent-ink`}>No next step. Set a reminder</button>
      )}
      {days !== false && days != null && (
        <button type="button" onClick={() => onTab("Files")} className={`${link} ${o.papers_verified < ON_THE_CLOCK.length && days <= 7 ? "font-medium text-danger" : "text-fg"}`}>
          Papers {o.papers_verified} of {ON_THE_CLOCK.length} verified
          {o.papers_verified < ON_THE_CLOCK.length && ` · ${days >= 0 ? `${days} days left` : "past the 30 days"}`}
        </button>
      )}
    </p>
  );
}

// Their WhatsApp chat, the same as in the inbox. No chat yet: open one from a phone with click-to-chat.
function LeadChat({ lead, chat, setChat }) {
  if (chat)
    return (
      <div className={`${card} flex h-[min(42rem,calc(100dvh-14rem))] max-w-4xl flex-col overflow-hidden`}>
        <Chat thread={chat} onChange={(row) => setChat({ ...chat, ...row })} />
      </div>
    );
  const digits = lead.mobile.replace(/\D/g, "").replace(/^0/, "63");
  return (
    <div className={`${card} grid max-w-xl justify-items-start gap-3 p-5 text-sm`}>
      <h2 className="font-display text-xl text-ink">No WhatsApp chat yet</h2>
      <p className="text-muted">
        Their chat shows here once they write to the business number, or once a chat on that number is linked to them. To start one now, message them from a phone; WhatsApp only lets a business open a chat with an approved template.
      </p>
      <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className={btnGhost}>
        <MessageCircle className="size-4" aria-hidden /> Open in WhatsApp
      </a>
    </div>
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

  const peso = (n) => `₱${n.toLocaleString("en-PH")}`;
  // what they want, each kind of wish in its own colour (the same colours as the matches below)
  const wants = [
    ["Looking to", lead.looking_to, "navy"],
    ["Type", lead.property_types, "violet"],
    ["Where", lead.areas, "sky"],
    ["Furnishing", lead.furnishings, "emerald"],
    ["Budget", lead.budget_max ? [`up to ${peso(lead.budget_max)}${lead.looking_to?.includes("Rent") ? "/mo" : ""}`] : lead.budget ? [lead.budget] : [], "gold"],
    ["Needed by", lead.needed_by ? [new Date(`${lead.needed_by}T00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })] : [], "burgundy"],
  ];
  const site = [
    ["Asked about", lead.interest],
    ["Listing", lead.listing && <Link key="l" to={`/listings/${lead.listing.id}`} className="underline underline-offset-2">{lead.listing.title}</Link>],
    ["Preferred viewing", lead.viewing_time],
  ].filter(([, v]) => v);
  return (
    <>
    <div className="stagger grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid h-fit gap-4">
        <section className={`${card} grid gap-3 p-4 text-sm`} aria-label="Contact">
          <div className="flex flex-wrap gap-2">
            {lead.mobile && (
              <a href={`tel:${lead.mobile.replace(/[^\d+]/g, "")}`} className={`${btnGhost} tabular-nums`}>
                <Phone className="size-4" aria-hidden /> {lead.mobile}
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className={`${btnGhost} min-w-0`}>
                <Mail className="size-4 shrink-0" aria-hidden /> <span className="truncate">{lead.email}</span>
              </a>
            )}
            <Link to={`/calendar?lead=${lead.id}`} className={btnGhost}>
              <CalendarPlus className="size-4" aria-hidden /> Book a viewing
            </Link>
          </div>
          <p className="text-xs text-muted">
            Came through {SITES[lead.source_site] ?? lead.source_site}
            {lead.consent_at ? ` · consent given ${when(lead.consent_at)}` : " · no website consent form"}
          </p>
        </section>

        <section className={`${card} p-4`} aria-labelledby="wants-title">
          <h2 id="wants-title" className="label mb-3 text-ink">What they want</h2>
          <dl className="grid gap-2.5 text-sm">
            {wants.map(([k, v, tone]) => (
              <div key={k} className="grid grid-cols-[6.5rem_1fr] items-start gap-3">
                <dt className="pt-0.5 text-muted">{k}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {v?.length ? v.map((x) => <Chip key={x} tone={tone}>{x}</Chip>) : <span className="text-muted/70">Any</span>}
                </dd>
              </div>
            ))}
          </dl>
          {site.length > 0 && (
            <dl className="mt-4 grid gap-1.5 border-t border-line pt-3 text-sm">
              {site.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {lead.message && <p className="mt-4 border-t border-line pt-3 text-sm whitespace-pre-wrap text-charcoal">{lead.message}</p>}
        </section>
      </div>

      <form onSubmit={save} className={`${card} grid h-fit gap-4 p-5`}>
        <h2 className="font-display text-xl text-ink">The deal</h2>
        <ErrorNote error={error} />
        <Field label="Stage">
          <Select value={deal.stage} onChange={(e) => setDeal({ ...deal, stage: e.target.value })} className={input}>
            {Object.entries(STAGES).map(([k, s]) => <option key={k} value={k}>{s}</option>)}
          </Select>
        </Field>
        {deal.stage === "lost" && (
          <Field label="Why it was lost">
            <input value={deal.lost_reason} onChange={(e) => setDeal({ ...deal, lost_reason: e.target.value })} maxLength={300} required placeholder="Bought elsewhere, budget, timing…" className={input} />
          </Field>
        )}
        <Field label="Agent">
          <Select value={deal.agent_id} onChange={(e) => setDeal({ ...deal, agent_id: e.target.value })} className={input}>
            <option value="">No one yet</option>
            {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </Select>
        </Field>
        <button className={btn} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</button>
      </form>
    </div>
    <Matches lead={lead} />
    </>
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
