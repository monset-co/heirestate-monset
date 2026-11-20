import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { supabase, run } from "../supabase";
import { api } from "../api";
import { useMe } from "../me";
import { CountUp, Live, LiveLi, Skeleton, SkeletonRows, toast } from "../motion";
import { Badge, Empty, ErrorNote, Tabs, btn, card, input } from "../ui";
import { ON_THE_CLOCK, OPEN, SITES, SOURCES, STAGES, ago, papersDue, quiet, when } from "../crm";
import { LOOKING_TO, tidyMobile } from "../match";
import { kindFor } from "./LeadForm";

const manila = (opts) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...opts });

export default function Dashboard() {
  const me = useMe();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const hour = Number(manila({ hour: "numeric", hourCycle: "h23" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    Promise.all([
      run(supabase.from("leads").select("id, name, stage, interest, source_site, created_at, reserved_at").order("created_at", { ascending: false })),
      run(supabase.from("lead_overview").select("id, last_contact_at, papers_verified")),
      run(supabase.from("commissions").select("sale_date, project, listing_id, unit_code, cancelled")),
      run(supabase.from("reminders").select("id, body, due_at, lead_id, lead:leads(name)").is("done_at", null).lte("due_at", endOfToday.toISOString()).order("due_at")),
    ]).then(([leads, overview, commissions, reminders]) => {
      const o = new Map(overview.map((r) => [r.id, r]));
      setData({ leads: leads.map((l) => ({ ...l, ...o.get(l.id) })), commissions, reminders });
    }, (e) => setError(e.message));
  }, []);

  const week = Date.now() - 7 * 864e5;
  const year = String(new Date().getFullYear());
  const stats = data && [
    ["New inquiries · 7 days", data.leads.filter((l) => Date.parse(l.created_at) >= week).length, "/leads?list=all"],
    ["Open deals", data.leads.filter((l) => OPEN.includes(l.stage)).length, "/leads"],
    [`Sales in ${year}`, new Set(data.commissions.filter((c) => !c.cancelled && c.sale_date.startsWith(year)).map((c) => `${c.project ?? c.listing_id}:${c.unit_code}`)).size, "/commissions"],
    ["Follow-ups due", data.reminders.length, "/leads"],
  ];

  return (
    <>
      <div>
        <h1 className="font-display text-[1.6rem] leading-tight md:text-[2.1rem] tracking-[-0.01em] text-ink">
          {greeting}, {me.name.split(/[ &]/)[0]}
        </h1>
        <p className="mt-1 text-muted">{manila({ weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
      </div>
      <div className="mt-4">
        <ErrorNote error={error} />
      </div>

      {/* Phones: agents work from here, so notes, today and a new lead come first */}
      <div className="mt-4 grid gap-6 md:hidden">
        <QuickNote />
        <Today reminders={data?.reminders} />
        <QuickLead />
      </div>

      {/* the 1px gaps show the line colour behind: dividers that hold at any column count */}
      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-[0_1px_2px_rgb(20_33_58/0.04),0_6px_20px_-12px_rgb(20_33_58/0.14)] lg:grid-cols-4">
        {(stats ?? [0, 1, 2, 3].map((i) => [i])).map(([label, value, to], i) => (
          <div key={i} className="bg-surface p-5">
            <dt className="label text-muted">{label ?? <Skeleton className="h-3 w-24" />}</dt>
            <dd className="mt-2">
              {to ? (
                <Link to={to} className="font-display text-[2.4rem] leading-none text-ink hover:text-accent-ink">
                  <CountUp value={value} />
                </Link>
              ) : (
                <Skeleton className="h-10 w-16" />
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="stagger grid content-start gap-8">
          <Visits />
          <Pipeline leads={data?.leads} />
        </div>
        <div className="stagger grid content-start gap-8 max-lg:order-first">
          {/* phones see these under Today */}
          <div className="hidden md:block">
          <Section title="Follow-ups due" to="/leads" linkLabel="All leads">
            <div className={card}>
              {!data ? (
                <SkeletonRows n={2} />
              ) : !data.reminders.length ? (
                <Empty>Nothing due today. All caught up.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  <Live>
                    {data.reminders.map((r, i) => (
                      <LiveLi key={r.id} i={i}>
                        <Link to={`/leads/${r.lead_id}?tab=Reminders`} className="block px-4 py-3 text-sm transition-colors hover:bg-bg">
                          <span className="font-medium text-fg">{r.body}</span>
                          <span className={`block text-xs ${Date.parse(r.due_at) < Date.now() ? "text-danger" : "text-muted"}`}>
                            {r.lead?.name} · {when(r.due_at)}
                          </span>
                        </Link>
                      </LiveLi>
                    ))}
                  </Live>
                </ul>
              )}
            </div>
          </Section>
          </div>
          <NeedsYou leads={data?.leads} />
          <Section title="Latest inquiries" to="/leads?list=all" linkLabel="All leads">
            <div className={card}>
              {!data ? (
                <SkeletonRows />
              ) : !data.leads.length ? (
                <Empty>No inquiries yet.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  <Live>
                    {data.leads.slice(0, 6).map((l, i) => (
                      <LiveLi key={l.id} i={i}>
                        <Link to={`/leads/${l.id}`} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-fg">{l.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {l.interest} · {SITES[l.source_site] ?? l.source_site}
                            </span>
                          </span>
                          <span className="text-xs whitespace-nowrap text-muted">{ago(l.created_at)}</span>
                          <Badge value={l.stage}>{STAGES[l.stage]}</Badge>
                        </Link>
                      </LiveLi>
                    ))}
                  </Live>
                </ul>
              )}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, to, linkLabel, children, aside }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl text-ink">{title}</h2>
        {aside}
        {to && (
          <Link to={to} className="ml-auto inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            {linkLabel} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

// A private note in two taps; it lands in "My notes" on the Notes board
function QuickNote() {
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    run(supabase.from("tasks").select("id, body, created_at").eq("private", true).is("done_at", null).order("created_at", { ascending: false }).limit(3)).then(setNotes, (e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const t = await run(supabase.from("tasks").insert({ body: body.trim(), private: true }).select("id, body, created_at").single());
      setNotes((n) => [t, ...(n ?? [])].slice(0, 3));
      setBody("");
      toast("Kept in your notes");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <Section title="Quick note" to="/notes" linkLabel="My notes">
      <form onSubmit={save} className={`${card} grid gap-3 p-3`}>
        <ErrorNote error={error} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} placeholder="A number to call back, a unit seen, what the client said…" aria-label="Note" className={input} />
        <button disabled={busy || !body.trim()} className={btn}>
          {busy ? "Saving…" : "Save note"}
        </button>
        {notes?.length > 0 && (
          <ul className="divide-y divide-line border-t border-line text-sm">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-3 px-1 py-2">
                <span className="line-clamp-2 min-w-0 flex-1 text-fg">{n.body}</span>
                <span className="text-xs whitespace-nowrap text-muted">{ago(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Section>
  );
}

// Today: the Google Calendar bookings, then the follow-ups due
function Today({ reminders }) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const [events, setEvents] = useState(null);
  const [off, setOff] = useState(false); // Google not connected, or unreachable
  useEffect(() => {
    api(`google/events?from=${day}&to=${day}`).then(
      (r) => setEvents(r.events),
      () => (setOff(true), setEvents([]))
    );
  }, [day]);
  const time = (ev) => (ev.allDay ? "All day" : manila({ hour: "numeric", minute: "2-digit" }).format(new Date(ev.start)));
  const loading = !events || !reminders;

  return (
    <Section title="Today" to="/calendar" linkLabel="Calendar">
      <div className={card}>
        {loading ? (
          <SkeletonRows n={2} />
        ) : !events.length && !reminders.length ? (
          <Empty>{off ? <Link to="/calendar" className="underline">Connect Google Calendar</Link> : "Nothing booked and no follow-ups. A clear day."}</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {events.map((ev) => (
              <li key={ev.id}>
                <Link to="/calendar" className="flex gap-3 px-4 py-3 active:bg-sunken">
                  <span className="w-16 shrink-0 tabular-nums text-muted">{time(ev)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{ev.title}</span>
                    {ev.location && <span className="block truncate text-xs text-muted">{ev.location}</span>}
                  </span>
                </Link>
              </li>
            ))}
            {reminders.map((r) => (
              <li key={`r${r.id}`}>
                <Link to={`/leads/${r.lead_id}?tab=Reminders`} className="flex gap-3 px-4 py-3 active:bg-sunken">
                  <span className={`w-16 shrink-0 text-xs ${Date.parse(r.due_at) < Date.now() ? "font-medium text-danger" : "text-muted"}`}>Follow up</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{r.body}</span>
                    <span className="block truncate text-xs text-muted">{r.lead?.name} · {when(r.due_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
            {off && (
              <li className="px-4 py-3 text-xs text-muted">
                Calendar not connected. <Link to="/calendar" className="underline">Connect it</Link>
              </li>
            )}
          </ul>
        )}
      </div>
    </Section>
  );
}

// The fewest fields a lead needs; the rest is filled in on the lead's page later
function QuickLead() {
  const navigate = useNavigate();
  const blank = { name: "", mobile: "", source_site: "whatsapp", looking: "", message: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setError("");
    const mobile = f.mobile.trim() ? tidyMobile(f.mobile) : "";
    if (mobile === null) return setError("That mobile number doesn't look right. Use 0917 123 4567, or + and the country code.");
    const looking_to = f.looking ? [f.looking] : [];
    setBusy(true);
    try {
      const l = await run(
        supabase
          .from("leads")
          .insert({ name: f.name.trim(), mobile, source_site: f.source_site, message: f.message.trim() || null, looking_to, category: kindFor(looking_to, "pre-selling") })
          .select("id, name")
          .single()
      );
      setF(blank);
      toast(`${l.name} added`, { action: { label: "Open", run: () => navigate(`/leads/${l.id}`) } });
    } catch (err) {
      setError(/lead_lengths/.test(err.message) ? "The name needs at least 2 letters." : err.message);
    }
    setBusy(false);
  }

  return (
    <Section title="New lead" to="/leads" linkLabel="All leads">
      <form onSubmit={save} className={`${card} grid gap-3 p-3`}>
        <ErrorNote error={error} />
        <input required value={f.name} onChange={set("name")} placeholder="Name" aria-label="Name" autoComplete="off" className={input} />
        <input value={f.mobile} onChange={set("mobile")} type="tel" inputMode="tel" placeholder="Mobile, 0917 123 4567" aria-label="Mobile" autoComplete="off" className={input} />
        <div className="grid grid-cols-2 gap-3">
          <select value={f.source_site} onChange={set("source_site")} aria-label="Came from" className={input}>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={f.looking} onChange={set("looking")} aria-label="Looking to" className={input}>
            <option value="">Looking to…</option>
            {Object.keys(LOOKING_TO).map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <textarea value={f.message} onChange={set("message")} rows={2} placeholder="What they want, in their words" aria-label="What they want" className={input} />
        <button disabled={busy} className={btn}>
          {busy ? "Adding…" : "Add lead"}
        </button>
      </form>
    </Section>
  );
}

// Visits per site from Cloudflare Web Analytics, through the admin's Worker
function Visits() {
  const [days, setDays] = useState("30");
  const [res, setRes] = useState({});
  useEffect(() => {
    if (res[days]) return;
    api(`visits?days=${days}`).then(
      (r) => setRes((s) => ({ ...s, [days]: { sites: r.sites } })),
      (e) => setRes((s) => ({ ...s, [days]: { error: e.message } }))
    );
  }, [days]);
  const now = res[days];
  const top = Math.max(1, ...(now?.sites ?? []).map((s) => s.visits));
  const name = (host) => SITES[host.split(".")[0]] ?? host;

  return (
    <Section
      title="Site visits"
      aside={<Tabs label="Period" items={[["7", "7 days"], ["30", "30 days"], ["90", "90 days"]].map(([id, title]) => ({ id, title }))} value={days} onChange={setDays} />}
    >
      <div className={card}>
        {!now ? (
          <SkeletonRows n={3} />
        ) : now.error ? (
          <p className="px-4 py-6 text-sm text-muted">{now.error}</p>
        ) : !now.sites.length ? (
          <Empty>No visits recorded in this period yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            <Live key={days}>
              {now.sites.map((s, i) => (
                <LiveLi key={s.host} i={i} className="px-4 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-fg">{name(s.host)}</span>
                    <span className="tabular-nums">
                      <CountUp value={s.visits} /> <span className="text-xs text-muted">visits · {s.views.toLocaleString("en-PH")} page views</span>
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-gold transition-[width] duration-700 ease-out" style={{ width: `${(s.visits / top) * 100}%` }} />
                  </div>
                </LiveLi>
              ))}
            </Live>
          </ul>
        )}
      </div>
    </Section>
  );
}

// open deals by stage, and how many were closed or lost
function Pipeline({ leads }) {
  const counts = Object.fromEntries(Object.keys(STAGES).map((k) => [k, (leads ?? []).filter((l) => l.stage === k).length]));
  const top = Math.max(1, ...Object.values(counts));
  return (
    <Section title="Deals by stage" to="/leads" linkLabel="Open deals">
      <div className={`${card} grid gap-3 p-5`}>
        {!leads
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)
          : Object.entries(STAGES).map(([k, label]) => (
              <Link key={k} to={`/leads?stage=${k}`} className="group grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="text-muted group-hover:text-fg">{label}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-sunken">
                  <span className={`block h-full rounded-full transition-[width] duration-700 ease-out ${OPEN.includes(k) ? "bg-navy" : k === "closed" ? "bg-gold" : "bg-muted/40"}`} style={{ width: `${(counts[k] / top) * 100}%` }} />
                </span>
                <span className="text-right font-medium text-fg tabular-nums">{counts[k]}</span>
              </Link>
            ))}
      </div>
    </Section>
  );
}

// Reserved buyers whose papers aren't all in, soonest deadline first, and open leads gone quiet.
function NeedsYou({ leads }) {
  if (!leads) return null;
  const papers = leads
    .filter((l) => l.stage === "reserved" && l.papers_verified < ON_THE_CLOCK.length)
    .sort((a, b) => papersDue(a.reserved_at) - papersDue(b.reserved_at));
  const gone = leads.filter((l) => OPEN.includes(l.stage) && quiet(l.last_contact_at)).sort((a, b) => a.last_contact_at.localeCompare(b.last_contact_at));
  const row = (l, right, tab, urgent) => (
    <LiveLi key={l.id} i={0}>
      <Link to={`/leads/${l.id}${tab ? `?tab=${tab}` : ""}`} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{l.name}</span>
        <span className={`text-xs whitespace-nowrap ${urgent ? "font-medium text-danger" : "text-muted"}`}>{right}</span>
      </Link>
    </LiveLi>
  );
  return (
    <>
      {papers.length > 0 && (
        <Section title="Papers due" to="/leads?list=papers" linkLabel="All">
          <ul className={`${card} divide-y divide-line`}>
            <Live>
              {papers.slice(0, 5).map((l) => {
                const d = papersDue(l.reserved_at);
                return row(l, `${l.papers_verified}/${ON_THE_CLOCK.length} verified · ${d >= 0 ? `${d} days left` : "overdue"}`, "Files", d <= 7);
              })}
            </Live>
          </ul>
        </Section>
      )}
      {gone.length > 0 && (
        <Section title="Gone quiet" to="/leads?list=quiet" linkLabel="All">
          <ul className={`${card} divide-y divide-line`}>
            <Live>{gone.slice(0, 5).map((l) => row(l, `Last contact ${ago(l.last_contact_at)}`))}</Live>
          </ul>
        </Section>
      )}
    </>
  );
}
