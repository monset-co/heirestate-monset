// Bookings on the business's Google Calendar (admin/worker/google.js), laid out as Google lays
// them out: a month grid, a week of hours, or a list. Connect the account once; click a day or an
// hour to book it, a booking to see or cancel it. The guest gets Google's own invitation from the
// connected Gmail. Opened from a lead (?lead=id), the booking is filled in from them.
import { CalendarPlus, ChevronLeft, ChevronRight, ExternalLink, MapPin, Users } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import { supabase, run } from "../supabase";
import { Skeleton, spring, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, btn, btnDanger, btnGhost, card, input, Select, ask } from "../ui";

const TZ = "Asia/Manila";
const fmt = (o) => new Intl.DateTimeFormat("en-PH", { timeZone: TZ, ...o });
const time = (iso) => fmt({ hour: "numeric", minute: "2-digit" }).format(new Date(iso));
// Manila calendar days as "YYYY-MM-DD" keys, counted in UTC so no device clock shifts them
const keyOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();
const label = (key, o) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", ...o });
// an event's Manila day and minute of the day
function at(iso, allDay) {
  if (allDay) return { key: iso.slice(0, 10), min: 0 };
  const p = Object.fromEntries(
    fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return { key: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

const VIEWS = { month: "Month", week: "Week", list: "List" };
const HOURS = [7, 21]; // the week view's working day, 7am to 9pm
const HOUR_PX = 48;
// what a booking's colour says (the legend repeats it)
const toneOf = (ev) => (ev.allDay ? "bg-gold/25 text-gold-ink border-gold" : ev.lead_id ? "bg-navy text-cream border-navy" : "bg-sky-600/12 text-sky-900 border-sky-600");

// the Manila days a view shows: a month's six weeks from a Sunday, a week, or 60 days
function range(view, cursor) {
  if (view === "list") return [cursor, addDays(cursor, 59)];
  if (view === "week") {
    const from = addDays(cursor, -weekday(cursor));
    return [from, addDays(from, 6)];
  }
  const first = `${cursor.slice(0, 8)}01`;
  const from = addDays(first, -weekday(first));
  return [from, addDays(from, 41)];
}

const RETURNS = {
  connected: ["Google account connected", ""],
  declined: ["", "Google wasn't connected: the permission screen was closed or declined."],
  missing: ["", "Google didn't grant calendar access. Connect again and leave the calendar box ticked."],
  expired: ["", "That took too long. Click Connect again."],
  failed: ["", "Google couldn't be connected. Try again."],
};
const RESPONSE = { accepted: "closed", declined: "lost", tentative: "warm", needsAction: "draft" };
const RESPONSE_LABEL = { accepted: "Coming", declined: "Declined", tentative: "Maybe", needsAction: "Not replied" };

export default function Calendar() {
  const [params, setParams] = useSearchParams();
  const today = keyOf(new Date());
  const [google, setGoogle] = useState(undefined); // undefined: not known yet
  // phones start on the list: a month grid is too small to read there
  const [view, setView] = useState(() => (matchMedia("(max-width: 640px)").matches ? "list" : "month"));
  const [cursor, setCursor] = useState(today);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(null); // the form's values while it's open
  const [seeing, setSeeing] = useState(null); // the booking open in its card
  const [from, to] = range(view, cursor);

  const load = () => api(`google/events?from=${from}&to=${to}`).then((r) => setEvents(r.events), (e) => setError(e.message));
  useEffect(() => {
    if (google?.email) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google?.email, from, to]);

  useEffect(() => {
    const back = RETURNS[params.get("google")];
    if (back?.[0]) toast(back[0]);
    if (back?.[1]) setError(back[1]);
    api("google/status").then(setGoogle, (e) => {
      setGoogle({ email: null });
      setError(e.message);
    });
    // opened from a lead: start a viewing for them
    const lead = Number(params.get("lead"));
    if (lead)
      run(supabase.from("leads").select("id, name, email, viewing_time, listing:listings(title)").eq("id", lead).single()).then(
        (l) =>
          setBooking({
            ...blank(),
            title: `Viewing: ${l.name}${l.listing ? `, ${l.listing.title}` : ""}`,
            guest: l.email ?? "",
            notes: l.viewing_time ? `They asked for: ${l.viewing_time}` : "",
            lead_id: l.id,
            lead_name: l.name,
          }),
        (e) => setError(e.message)
      );
    if (params.has("google") || params.has("lead")) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    try {
      location.href = (await api("google/connect", {})).url;
    } catch (e) {
      setError(e.message);
    }
  }

  async function disconnect() {
    if (!(await ask({ title: `Disconnect ${google.email}?`, body: "Bookings already made stay in its calendar. You can connect again any time.", yes: "Disconnect", danger: true }))) return;
    try {
      await api("google/disconnect", {});
      setGoogle({ email: null });
      setEvents(null);
      toast("Google disconnected");
    } catch (e) {
      setError(e.message);
    }
  }

  async function cancel(ev) {
    if (!(await ask({ title: `Cancel “${ev.title}”?`, body: ev.guests.length ? "Google emails the guests that it's off." : "It's removed from the calendar.", yes: "Cancel booking", no: "Keep it", danger: true }))) return;
    try {
      await api("google/cancel", { id: ev.id });
      setEvents((all) => all.filter((x) => x.id !== ev.id));
      setSeeing(null);
      toast("Booking cancelled");
    } catch (e) {
      setError(e.message);
    }
  }

  // each day's bookings, in order
  const byDay = useMemo(() => {
    const m = new Map();
    for (const ev of events ?? []) {
      const { key } = at(ev.start, ev.allDay);
      m.set(key, [...(m.get(key) ?? []), ev]);
    }
    return m;
  }, [events]);

  // back or forward a month, a week, or 60 days
  const step = (n) =>
    setCursor((c) => (view === "month" ? `${addDays(`${c.slice(0, 8)}01`, n > 0 ? 32 : -1).slice(0, 8)}01` : addDays(c, n * (view === "week" ? 7 : 60))));
  const title =
    view === "month"
      ? label(cursor, { month: "long", year: "numeric" })
      : `${label(from, { month: "short", day: "numeric" })} – ${label(to, { month: "short", day: "numeric", year: "numeric" })}`;
  const bookAt = (key, hour = 10) => setBooking(blank(key, hour));

  return (
    <>
      <PageHeader title="Calendar" sub={google?.email ? `${google.email}, in Manila time.` : "Bookings and schedules on the business's Google Calendar."}>
        {google?.email && (
          <button className={btn} onClick={() => setBooking(blank())}>
            <CalendarPlus className="size-4" aria-hidden /> New booking
          </button>
        )}
      </PageHeader>

      <div className="mt-6 grid gap-4">
        <ErrorNote error={error} />
        {google === undefined && <Skeleton className="h-96 w-full" />}

        {google && !google.email && (
          <section className={`${card} grid max-w-3xl gap-3 p-5`}>
            <h2 className="font-display text-xl text-ink">Connect Google</h2>
            <p className="max-w-prose text-sm text-muted">
              Sign in with the business's Google account (the Gmail bookings go to). Its calendar shows here, bookings made here land in it, and guests get the invitation from that Gmail address. One connection serves every admin.
            </p>
            <div>
              <button className={btn} onClick={connect}>Connect Google account</button>
            </div>
          </section>
        )}

        {google?.email && (
          <>
            {/* the toolbar, as Google has it: Today, back and forward, the period, then the view */}
            <div className="flex flex-wrap items-center gap-2">
              <button className={btnGhost} onClick={() => setCursor(today)}>Today</button>
              <span className="flex">
                <button className="press rounded-md p-2 text-muted hover:bg-sunken hover:text-fg" onClick={() => step(-1)} aria-label="Earlier">
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <button className="press rounded-md p-2 text-muted hover:bg-sunken hover:text-fg" onClick={() => step(1)} aria-label="Later">
                  <ChevronRight className="size-5" aria-hidden />
                </button>
              </span>
              <h2 className="mr-auto font-display text-xl text-ink" aria-live="polite">{title}</h2>
              <div role="radiogroup" aria-label="View" className="flex rounded-full border border-line bg-surface p-0.5">
                {Object.entries(VIEWS).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={view === k}
                    onClick={() => setView(k)}
                    className={`relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${view === k ? "text-cream" : "text-muted hover:text-fg"}`}
                  >
                    {view === k && <motion.span layoutId="cal-view" transition={spring} className="absolute inset-0 rounded-full bg-navy" />}
                    <span className="relative">{l}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="-mt-2 flex flex-wrap items-center gap-3 text-xs text-muted" aria-label="Legend">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-navy" /> For a lead</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-sky-600 bg-sky-600/12" /> Other bookings</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-gold/60" /> All day</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-gold" /> Today</span>
            </p>

            {events === null ? (
              <Skeleton className="h-96 w-full" />
            ) : view === "month" ? (
              <Month from={from} cursor={cursor} today={today} byDay={byDay} onDay={bookAt} onEvent={setSeeing} onMore={(key) => (setCursor(key), setView("week"))} />
            ) : view === "week" ? (
              <Week from={from} today={today} byDay={byDay} onHour={bookAt} onEvent={setSeeing} />
            ) : (
              <List from={from} byDay={byDay} onEvent={setSeeing} />
            )}

            <p className="text-sm text-muted">
              Connected by {google.connected_by}.{" "}
              <button className="underline underline-offset-2 hover:text-fg" onClick={disconnect}>Disconnect</button>
            </p>
          </>
        )}
      </div>

      <Modal open={!!seeing} onClose={() => setSeeing(null)} title={seeing?.title ?? ""}>
        {seeing && <Booking ev={seeing} onCancel={() => cancel(seeing)} />}
      </Modal>

      <Modal open={!!booking} onClose={() => setBooking(null)} title="New booking">
        {booking && (
          <BookingForm
            value={booking}
            onChange={setBooking}
            disabled={!google?.email}
            onDone={() => {
              setBooking(null);
              load();
            }}
          />
        )}
      </Modal>
    </>
  );
}

// six weeks from the Sunday on or before the 1st; days outside the month are dimmed
function Month({ from, cursor, today, byDay, onDay, onEvent, onMore }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <p key={d} className="label py-2 text-center text-muted">{label(d, { weekday: "short" })}</p>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const evs = byDay.get(d) ?? [];
          const inMonth = d.slice(0, 7) === cursor.slice(0, 7);
          return (
            <div
              key={d}
              onClick={(e) => e.target === e.currentTarget && onDay(d)}
              className={`relative min-h-24 cursor-pointer border-line p-1 transition-colors hover:bg-bg sm:min-h-28 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-sunken/40"}`}
            >
              <button
                type="button"
                onClick={() => onDay(d)}
                aria-label={`Book ${label(d, { weekday: "long", month: "long", day: "numeric" })}`}
                className={`mx-auto mb-1 flex size-7 items-center justify-center rounded-full text-xs tabular-nums ${d === today ? "bg-gold font-semibold text-ink" : inMonth ? "text-fg hover:bg-sunken" : "text-muted/60 hover:bg-sunken"}`}
              >
                {Number(d.slice(8))}
              </button>
              <ul className="grid gap-0.5">
                {evs.slice(0, 3).map((ev) => (
                  <li key={ev.id}>
                    <button type="button" onClick={() => onEvent(ev)} className={`block w-full truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[0.7rem] leading-tight ${toneOf(ev)}`}>
                      {!ev.allDay && <span className="hidden tabular-nums opacity-75 sm:inline">{time(ev.start)} </span>}
                      {ev.title}
                    </button>
                  </li>
                ))}
              </ul>
              {evs.length > 3 && (
                <button type="button" onClick={() => onMore(d)} className="mt-0.5 px-1.5 text-[0.7rem] font-medium text-muted hover:text-fg">
                  {evs.length - 3} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// seven columns of hours; a booking sits at its time, as tall as it lasts, side by side when they overlap
function Week({ from, today, byDay, onHour, onEvent }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const hours = Array.from({ length: HOURS[1] - HOURS[0] }, (_, i) => HOURS[0] + i);
  const [now, setNow] = useState(() => at(new Date().toISOString()));
  useEffect(() => {
    const t = setInterval(() => setNow(at(new Date().toISOString())), 60e3);
    return () => clearInterval(t);
  }, []);
  const top = (min) => ((Math.min(Math.max(min, HOURS[0] * 60), HOURS[1] * 60) - HOURS[0] * 60) / 60) * HOUR_PX;
  const hourName = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  return (
    <div className={`${card} overflow-x-auto`}>
      <div className="min-w-[46rem]">
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-line">
          <span />
          {days.map((d) => (
            <div key={d} className="border-l border-line py-2 text-center">
              <p className="label text-muted">{label(d, { weekday: "short" })}</p>
              <p className={`mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full font-display text-lg tabular-nums ${d === today ? "bg-gold text-ink" : "text-fg"}`}>{Number(d.slice(8))}</p>
              {/* all-day bookings sit above the hours */}
              {(byDay.get(d) ?? [])
                .filter((e) => e.allDay)
                .map((ev) => (
                  <button key={ev.id} type="button" onClick={() => onEvent(ev)} className={`mx-1 mt-1 block w-[calc(100%-0.5rem)] truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[0.7rem] ${toneOf(ev)}`}>
                    {ev.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
          <div>
            {hours.map((h) => (
              <p key={h} style={{ height: HOUR_PX }} className="-translate-y-2 pr-2 text-right text-[0.7rem] text-muted tabular-nums">
                {h === HOURS[0] ? "" : hourName(h)}
              </p>
            ))}
          </div>
          {days.map((d) => {
            const evs = (byDay.get(d) ?? [])
              .filter((e) => !e.allDay)
              .map((ev) => {
                const s = at(ev.start).min;
                const end = at(ev.end);
                return { ev, s, e: Math.max(end.key === d ? end.min : 24 * 60, s + 20) };
              });
            // lanes: each booking takes the first lane free at its start
            const lanes = [];
            for (const x of evs) {
              x.lane = lanes.findIndex((end) => end <= x.s);
              if (x.lane < 0) x.lane = lanes.push(0) - 1;
              lanes[x.lane] = x.e;
            }
            return (
              <div key={d} className="relative border-l border-line" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onHour(d, h)}
                    aria-label={`Book ${label(d, { weekday: "long", month: "short", day: "numeric" })} at ${hourName(h)}`}
                    style={{ height: HOUR_PX }}
                    className="block w-full border-t border-line/70 transition-colors hover:bg-bg"
                  />
                ))}
                {evs.map(({ ev, s, e, lane }) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onEvent(ev)}
                    style={{ top: top(s), height: Math.max(top(e) - top(s), 20), left: `${(lane / lanes.length) * 100}%`, width: `${100 / lanes.length}%` }}
                    className={`absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[0.7rem] leading-tight shadow-sm ${toneOf(ev)}`}
                  >
                    <span className="block truncate font-medium">{ev.title}</span>
                    <span className="block truncate tabular-nums opacity-80">{time(ev.start)} – {time(ev.end)}</span>
                  </button>
                ))}
                {d === today && now.min >= HOURS[0] * 60 && now.min <= HOURS[1] * 60 && (
                  <span aria-hidden style={{ top: top(now.min) }} className="pointer-events-none absolute inset-x-0 h-0.5 bg-danger">
                    <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 60 days, a heading per day with something on it
function List({ from, byDay, onEvent }) {
  const days = Array.from({ length: 60 }, (_, i) => addDays(from, i)).filter((d) => byDay.has(d));
  if (!days.length)
    return (
      <div className={card}>
        <Empty>Nothing booked in these 60 days.</Empty>
      </div>
    );
  return (
    <div className="grid gap-4">
      {days.map((d) => (
        <section key={d} aria-label={label(d, { weekday: "long", month: "long", day: "numeric" })}>
          <h3 className="label mb-2 text-muted">{label(d, { weekday: "long", month: "long", day: "numeric" })}</h3>
          <ul className={`${card} divide-y divide-line`}>
            {byDay.get(d).map((ev) => (
              <li key={ev.id}>
                <button type="button" onClick={() => onEvent(ev)} className="grid w-full gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-bg sm:grid-cols-[7rem_1fr]">
                  <span className="flex items-center gap-2 tabular-nums text-muted">
                    <span className={`size-2.5 shrink-0 rounded-sm border ${toneOf(ev)}`} aria-hidden />
                    {ev.allDay ? "All day" : time(ev.start)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{ev.title}</span>
                    {ev.location && <span className="block truncate text-xs text-muted">{ev.location}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// one booking, opened from any view
function Booking({ ev, onCancel }) {
  return (
    <div className="grid gap-4 text-sm">
      <p className="text-charcoal">
        {label(at(ev.start, ev.allDay).key, { weekday: "long", month: "long", day: "numeric" })}
        {!ev.allDay && <span className="tabular-nums"> · {time(ev.start)} – {time(ev.end)}</span>}
      </p>
      {ev.location && (
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> {ev.location}
        </p>
      )}
      {ev.guests.length > 0 && (
        <div className="flex items-start gap-1.5">
          <Users className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <ul className="grid gap-1">
            {ev.guests.map((g) => (
              <li key={g.email} className="flex flex-wrap items-center gap-1.5 break-all">
                {g.email} <Badge value={RESPONSE[g.response] ?? "draft"}>{RESPONSE_LABEL[g.response] ?? g.response}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {ev.lead_id && <Link to={`/leads/${ev.lead_id}`} className={btnGhost}>Open the lead</Link>}
        <a href={ev.link} target="_blank" rel="noopener noreferrer" className={btnGhost}>
          <ExternalLink className="size-4" aria-hidden /> Open in Google Calendar
        </a>
        <button type="button" className={`${btnDanger} ml-auto`} onClick={onCancel}>Cancel booking</button>
      </div>
    </div>
  );
}

// a day (tomorrow, unless given) at an hour (10:00), Manila time, as a datetime-local value
function blank(key = addDays(keyOf(new Date()), 1), hour = 10) {
  return { title: "", start: `${key}T${String(hour).padStart(2, "0")}:00`, minutes: "60", location: "", guest: "", notes: "", lead_id: null, lead_name: "" };
}

function BookingForm({ value: b, onChange, onDone, disabled }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => onChange({ ...b, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("google/book", { ...b, minutes: Number(b.minutes) });
      toast(b.guest ? `Booked, and ${b.guest} has been invited` : "Booked");
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {disabled && <ErrorNote error="Connect Google on this page first." />}
      <ErrorNote error={error} />
      {b.lead_name && <p className="text-sm text-muted">For {b.lead_name}</p>}
      <Field label="Title">
        <input value={b.title} onChange={set("title")} required maxLength={200} placeholder="Viewing: name, property" className={input} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" hint="Manila time">
          <input type="datetime-local" value={b.start} onChange={set("start")} required step={900} className={input} />
        </Field>
        <Field label="Length">
          <Select value={b.minutes} onChange={set("minutes")} className={input}>
            {[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Where">
        <input value={b.location} onChange={set("location")} maxLength={500} placeholder="The property, the office, or a meeting link" className={input} />
      </Field>
      <Field label="Guest's email" hint="Google emails them an invitation they can accept. Leave empty for a booking only you see.">
        <input type="email" value={b.guest} onChange={set("guest")} maxLength={320} className={input} />
      </Field>
      <Field label="Notes">
        <textarea value={b.notes} onChange={set("notes")} maxLength={4000} rows={3} className={input} />
      </Field>
      <button className={btn} disabled={busy || disabled}>{busy ? "Booking…" : "Book it"}</button>
    </form>
  );
}
