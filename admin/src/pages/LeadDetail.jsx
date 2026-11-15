import { BellRing, ChevronLeft, Mail, Phone, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { Live, LiveLi, Skeleton, SkeletonRows, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Tabs, btn, btnDanger, card, input } from "../ui";
import { SITES, STAGES, when } from "../crm";
import Activity from "./Activity";

const TABS = ["Overview", "Notes", "Reminders", "Activity"];

// One lead, laid out as the dashboard's client pages are: a header, then tabs kept in the address.
export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [lead, setLead] = useState(null);
  const [error, setError] = useState("");
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "Overview";

  useEffect(() => {
    run(supabase.from("leads").select("*, listing:listings(id, title)").eq("id", id).maybeSingle()).then((row) => (row ? setLead(row) : setError("No such lead. It may have been deleted.")), (e) => setError(e.message));
  }, [id]);

  // the Data Privacy Act: a person may ask for their details to be deleted
  async function remove() {
    if (!confirm(`Delete ${lead.name} for good, with their notes, reminders and history? Do this when they ask for their data to be deleted. It can't be undone.`)) return;
    try {
      await run(supabase.rpc("delete_lead", { p_id: lead.id }));
      toast("Lead deleted, with its notes, reminders and history");
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
        <button className={`${btnDanger} ml-auto`} onClick={remove}>
          <Trash2 className="size-4" aria-hidden /> Delete on request
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {lead.interest} · {SITES[lead.source_site] ?? lead.source_site} · {when(lead.created_at)}
      </p>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>

      <div className="mt-6">
        <Tabs label="Lead sections" items={TABS.map((t) => ({ id: t, title: t }))} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      </div>
      <div className="mt-6">
        {tab === "Overview" && <Overview lead={lead} onSaved={(l) => setLead({ ...lead, ...l })} />}
        {tab === "Notes" && <Notes leadId={lead.id} />}
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

function Notes({ leadId }) {
  const [notes, setNotes] = useState(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    run(supabase.from("lead_notes").select("id, body, author_email, created_at").eq("lead_id", leadId).order("created_at", { ascending: false })).then(setNotes, (e) => setError(e.message));
  }, [leadId]);

  async function add(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const n = await run(supabase.from("lead_notes").insert({ lead_id: leadId, body: body.trim() }).select("id, body, author_email, created_at").single());
      setNotes((ns) => [n, ...ns]);
      setBody("");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <form onSubmit={add} className={`${card} grid gap-3 p-4`}>
        <ErrorNote error={error} />
        <label>
          <span className="sr-only">New note</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} placeholder="What was said, what they want, what comes next…" className={input} />
        </label>
        <button className={`${btn} justify-self-end`} disabled={busy || !body.trim()}>{busy ? "Adding…" : "Add note"}</button>
      </form>
      <div className={card}>
        {!notes ? (
          <SkeletonRows n={2} />
        ) : !notes.length ? (
          <Empty>No notes yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            <Live>
              {notes.map((n, i) => (
                <LiveLi key={n.id} i={i} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-fg">{n.author_email}</span>
                    <time dateTime={n.created_at} className="text-xs text-muted">{when(n.created_at)}</time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                </LiveLi>
              ))}
            </Live>
          </ul>
        )}
      </div>
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
