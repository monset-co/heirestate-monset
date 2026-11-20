// Bookings on the business's Google Calendar (admin/worker/google.js), laid out as Google lays
// them out: a month grid, a week of hours, or a list. Connect the account once. Click a day to open
// its half-hour slots in a side panel; click a slot (or an hour in the week) to book it, a booking
// to see, edit or cancel it, and drag a booking to another slot or day to move it. Everything is
// Google's own event: edits, colours and all-day bookings show the same in Google Calendar, and
// guests get Google's invitations and updates from the connected Gmail. Opened from a lead
// (?lead=id), the booking is filled in from them.
import { Bell, CalendarPlus, ChevronLeft, ChevronRight, ExternalLink, MapPin, Pencil, Plus, Repeat, Users, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import { supabase, run } from "../supabase";
import { Skeleton, spring, toast } from "../motion";
import { Badge, Drawer, Empty, ErrorNote, Field, Modal, PageHeader, btn, btnDanger, btnGhost, card, input, Select, ask } from "../ui";

const TZ = "Asia/Manila";
const fmt = (o) => new Intl.DateTimeFormat("en-PH", { timeZone: TZ, ...o });
const time = (iso) => fmt({ hour: "numeric", minute: "2-digit" }).format(new Date(iso));
// Manila calendar days as "YYYY-MM-DD" keys, counted in UTC so no device clock shifts them
const keyOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
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
  return { key: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
// the form's Manila wall-clock times, "2026-11-20T14:30"
const pad = (n) => String(n).padStart(2, "0");
const slot = (key, min) => `${key}T${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const local = (iso) => slot(at(iso).key, at(iso).min);
const minutesBetween = (a, b) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60e3;
const shift = (t, m) => new Date(Date.parse(`${t}:00Z`) + m * 60e3).toISOString().slice(0, 16);
const clock = (min) => `${Math.floor(min / 60) % 12 || 12}:${pad(min % 60)} ${min % 1440 < 720 ? "AM" : "PM"}`;
const hourName = (h) => `${h % 12 || 12} ${h % 24 < 12 ? "AM" : "PM"}`;

const VIEWS = { month: "Month", week: "Week", list: "List" };
const HOURS = [7, 21]; // the working day shown, 7am to 9pm, stretched to fit anything outside it
const HOUR_PX = 48;
// Google Calendar's own event colours (colorId 1–11), so a colour set here shows the same there
const GCOLOR = {
  1: ["Lavender", "#7986cb"], 2: ["Sage", "#33b679"], 3: ["Grape", "#8e24aa"], 4: ["Flamingo", "#e67c73"], 5: ["Banana", "#f6bf26"], 6: ["Tangerine", "#f4511e"],
  7: ["Peacock", "#039be5"], 8: ["Graphite", "#616161"], 9: ["Blueberry", "#3f51b5"], 10: ["Basil", "#0b8043"], 11: ["Tomato", "#d50000"],
};
// what a booking's colour says (the legend repeats it); a colour picked in Google wins
const toneOf = (ev) => (ev.allDay ? "bg-gold/25 text-gold-ink border-gold" : ev.lead_id ? "bg-navy text-cream border-navy" : "bg-sky-600/12 text-sky-900 border-sky-600");
const look = (ev) => (GCOLOR[ev.color] ? { className: "text-fg", style: { background: `${GCOLOR[ev.color][1]}2e`, borderColor: GCOLOR[ev.color][1] } } : { className: toneOf(ev), style: {} });

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
  const [day, setDay] = useState(null); // the day open in the side panel
  const [dayEvents, setDayEvents] = useState(null); // its bookings, when it's outside the view's window
  const [from, to] = range(view, cursor);

  const load = () => api(`google/events?from=${from}&to=${to}`).then((r) => setEvents(r.events), (e) => setError(e.message));
  useEffect(() => {
    if (google?.email) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google?.email, from, to]);

  // the side panel's day, fetched on its own when the view doesn't hold it
  const inView = day && day >= from && day <= to;
  const loadDay = () => (day && !inView ? api(`google/events?from=${day}&to=${day}`).then((r) => setDayEvents(r.events), (e) => setError(e.message)) : setDayEvents(null));
  useEffect(() => {
    loadDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, inView]);
  const refresh = () => (load(), loadDay());

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
            guests: l.email ? [l.email] : [],
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
      setDayEvents((all) => all?.filter((x) => x.id !== ev.id) ?? null);
      setSeeing(null);
      toast("Booking cancelled");
    } catch (e) {
      setError(e.message);
    }
  }

  // a booking dragged onto another day (min: null keeps its time) or another slot; it keeps its length
  async function move(id, key, min) {
    const ev = [...(events ?? []), ...(dayEvents ?? [])].find((x) => x.id === id);
    if (!ev?.editable) return;
    const f = formOf(ev);
    if (f.allDay) {
      const days = daysBetween(f.start, f.end);
      f.start = key;
      f.end = addDays(key, days);
    } else {
      const len = minutesBetween(f.start, f.end);
      f.start = slot(key, min ?? at(ev.start).min);
      f.end = shift(f.start, len);
    }
    if (f.start === formOf(ev).start) return;
    if (ev.guests.length && !(await ask({ title: `Move “${ev.title}”?`, body: "Google emails the guests the new time.", yes: "Move it" }))) return;
    try {
      await api("google/update", f);
      toast("Moved");
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  // each day's bookings, in order
  const byDay = useMemo(() => {
    const m = new Map();
    for (const ev of [...(events ?? []), ...(dayEvents ?? [])]) {
      const { key } = at(ev.start, ev.allDay);
      if (!(m.get(key) ?? []).some((x) => x.id === ev.id)) m.set(key, [...(m.get(key) ?? []), ev]);
    }
    return m;
  }, [events, dayEvents]);

  // back or forward a month, a week, or 60 days
  const step = (n) =>
    setCursor((c) => (view === "month" ? `${addDays(`${c.slice(0, 8)}01`, n > 0 ? 32 : -1).slice(0, 8)}01` : addDays(c, n * (view === "week" ? 7 : 60))));
  const title =
    view === "month"
      ? label(cursor, { month: "long", year: "numeric" })
      : `${label(from, { month: "short", day: "numeric" })} – ${label(to, { month: "short", day: "numeric", year: "numeric" })}`;
  const bookAt = (key, min = 600) => setBooking(blank(key, min));
  const arrow = "press rounded-md p-2 text-muted hover:bg-sunken hover:text-fg";

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
                <button className={arrow} onClick={() => step(-1)} aria-label="Earlier">
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <button className={arrow} onClick={() => step(1)} aria-label="Later">
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
              <span className="hidden md:inline">Click a day for its time slots. Drag a booking to move it.</span>
            </p>

            {events === null ? (
              <Skeleton className="h-96 w-full" />
            ) : view === "month" ? (
              <Month from={from} cursor={cursor} today={today} byDay={byDay} onDay={setDay} onEvent={setSeeing} onMove={move} />
            ) : view === "week" ? (
              <Week from={from} today={today} byDay={byDay} onDay={setDay} onSlot={bookAt} onEvent={setSeeing} onMove={move} />
            ) : (
              <List from={from} byDay={byDay} onDay={setDay} onEvent={setSeeing} />
            )}

            <p className="text-sm text-muted">
              Connected by {google.connected_by}.{" "}
              <button className="underline underline-offset-2 hover:text-fg" onClick={disconnect}>Disconnect</button>
            </p>
          </>
        )}
      </div>

      <Drawer
        open={!!day}
        onClose={() => setDay(null)}
        title={day ? label(day, { weekday: "long", month: "long", day: "numeric" }) : ""}
        head={
          day && (
            <span className="flex">
              <button className={arrow} onClick={() => setDay(addDays(day, -1))} aria-label="The day before">
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <button className={arrow} onClick={() => setDay(addDays(day, 1))} aria-label="The day after">
                <ChevronRight className="size-5" aria-hidden />
              </button>
            </span>
          )
        }
      >
        {day && (!inView && !dayEvents ? <Skeleton className="m-5 h-96" /> : <DayPanel day={day} today={today} evs={byDay.get(day) ?? []} onSlot={bookAt} onEvent={setSeeing} onMove={move} />)}
      </Drawer>

      <Modal open={!!seeing} onClose={() => setSeeing(null)} title={seeing?.title ?? ""}>
        {seeing && (
          <Booking
            ev={seeing}
            onCancel={() => cancel(seeing)}
            onEdit={() => {
              setBooking(formOf(seeing));
              setSeeing(null);
            }}
          />
        )}
      </Modal>

      <Modal open={!!booking} onClose={() => setBooking(null)} title={booking?.id ? "Edit booking" : "New booking"}>
        {booking && (
          <BookingForm
            value={booking}
            onChange={setBooking}
            seen={events}
            disabled={!google?.email}
            onDone={() => {
              setBooking(null);
              refresh();
            }}
          />
        )}
      </Modal>
    </>
  );
}

// drag and drop: a booking carries its id; a day or a slot takes it
const dragFrom = (ev) =>
  ev.editable ? { draggable: true, onDragStart: (e) => (e.dataTransfer.setData("text/x-booking", ev.id), (e.dataTransfer.effectAllowed = "move")) } : {};
const dropOn = (onDrop) => ({
  onDragOver: (e) => e.dataTransfer.types.includes("text/x-booking") && (e.preventDefault(), e.currentTarget.setAttribute("data-over", "")),
  onDragLeave: (e) => e.currentTarget.removeAttribute("data-over"),
  onDrop: (e) => {
    e.preventDefault();
    e.currentTarget.removeAttribute("data-over");
    const id = e.dataTransfer.getData("text/x-booking");
    if (id) onDrop(id);
  },
});

// six weeks from the Sunday on or before the 1st; days outside the month are dimmed
function Month({ from, cursor, today, byDay, onDay, onEvent, onMove }) {
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
              {...dropOn((id) => onMove(id, d, null))}
              className={`relative min-h-24 min-w-0 cursor-pointer border-line p-1 transition-colors hover:bg-bg data-over:bg-gold/15 sm:min-h-28 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-sunken/40"}`}
            >
              <button
                type="button"
                onClick={() => onDay(d)}
                aria-label={`Open ${label(d, { weekday: "long", month: "long", day: "numeric" })}`}
                className={`mx-auto mb-1 flex size-7 items-center justify-center rounded-full text-xs tabular-nums ${d === today ? "bg-gold font-semibold text-ink" : inMonth ? "text-fg hover:bg-sunken" : "text-muted/60 hover:bg-sunken"}`}
              >
                {Number(d.slice(8))}
              </button>
              <ul className="grid gap-0.5">
                {evs.slice(0, 3).map((ev) => (
                  <li key={ev.id}>
                    <button type="button" onClick={() => onEvent(ev)} {...dragFrom(ev)} style={look(ev).style} className={`block w-full truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[0.7rem] leading-tight ${look(ev).className}`}>
                      {!ev.allDay && <span className="hidden tabular-nums opacity-75 sm:inline">{time(ev.start)} </span>}
                      {ev.title}
                    </button>
                  </li>
                ))}
              </ul>
              {evs.length > 3 && (
                <button type="button" onClick={() => onDay(d)} className="mt-0.5 px-1.5 text-[0.7rem] font-medium text-muted hover:text-fg">
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

// a day's timed bookings, each in the first lane free at its start, cut to the day
function laid(evs, day) {
  const xs = evs
    .filter((e) => !e.allDay)
    .map((ev) => {
      const a = at(ev.start);
      const b = at(ev.end);
      const s = a.key < day ? 0 : a.min;
      return { ev, s, e: Math.max(b.key > day ? 1440 : b.min, s + 20) };
    });
  const lanes = [];
  for (const x of xs) {
    x.lane = lanes.findIndex((end) => end <= x.s);
    if (x.lane < 0) x.lane = lanes.push(0) - 1;
    lanes[x.lane] = x.e;
  }
  return { xs, n: lanes.length };
}
// the hours to show: the working day, stretched to anything booked outside it
const hoursFor = (all) => {
  let [a, b] = HOURS;
  for (const { xs } of all)
    for (const { s, e } of xs) {
      a = Math.min(a, Math.floor(s / 60));
      b = Math.max(b, Math.ceil(e / 60));
    }
  return [a, Math.min(b, 24)];
};

function useNow() {
  const [now, setNow] = useState(() => at(new Date().toISOString()));
  useEffect(() => {
    const t = setInterval(() => setNow(at(new Date().toISOString())), 60e3);
    return () => clearInterval(t);
  }, []);
  return now;
}

// one day of half-hour slots: click one to book it, drop a booking on one to move it there; the
// day's bookings sit at their time, as tall as they last, side by side when they overlap
function DayColumn({ day, today, now, plan, hours, px, onSlot, onEvent, onMove, times }) {
  const top = (min) => ((Math.min(Math.max(min, hours[0] * 60), hours[1] * 60) - hours[0] * 60) / 60) * px;
  const slots = Array.from({ length: (hours[1] - hours[0]) * 2 }, (_, i) => hours[0] * 60 + i * 30);
  const busy = (m) => plan.xs.some(({ s, e }) => s < m + 30 && e > m);
  return (
    <div className="relative" style={{ height: slots.length * (px / 2) }}>
      {slots.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onSlot(day, m)}
          {...dropOn((id) => onMove(id, day, m))}
          aria-label={`Book ${label(day, { weekday: "long", month: "short", day: "numeric" })} at ${clock(m)}`}
          style={{ height: px / 2 }}
          className={`group flex w-full items-start border-line/70 px-2 text-left transition-colors hover:bg-gold/10 data-over:bg-gold/25 ${m % 60 ? "border-t border-dashed border-line/40" : "border-t"}`}
        >
          {times && !busy(m) && <span className="mt-1 hidden items-center gap-1 text-xs text-muted group-hover:flex group-focus-visible:flex"><Plus className="size-3.5" aria-hidden /> Book {clock(m)}</span>}
        </button>
      ))}
      {plan.xs.map(({ ev, s, e, lane }) => (
        <button
          key={ev.id}
          type="button"
          onClick={() => onEvent(ev)}
          {...dragFrom(ev)}
          style={{ ...look(ev).style, top: top(s), height: Math.max(top(e) - top(s), 20), left: `calc(${(lane / plan.n) * 100}% + ${times ? 4 : 0}px)`, width: `calc(${100 / plan.n}% - ${times ? 8 : 2}px)` }}
          className={`absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[0.7rem] leading-tight shadow-sm ${look(ev).className} ${ev.editable ? "cursor-grab active:cursor-grabbing" : ""}`}
        >
          <span className="block truncate font-medium">{ev.title}</span>
          <span className="block truncate tabular-nums opacity-80">{time(ev.start)} – {time(ev.end)}</span>
          {times && ev.location && <span className="block truncate opacity-80">{ev.location}</span>}
        </button>
      ))}
      {day === today && now.min >= hours[0] * 60 && now.min <= hours[1] * 60 && (
        <span aria-hidden style={{ top: top(now.min) }} className="pointer-events-none absolute inset-x-0 h-0.5 bg-danger">
          <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
        </span>
      )}
    </div>
  );
}

// the hour labels down the left of a day or a week
function Hours({ hours, px, half }) {
  return (
    <div>
      {Array.from({ length: (hours[1] - hours[0]) * (half ? 2 : 1) }, (_, i) => {
        const m = hours[0] * 60 + i * (half ? 30 : 60);
        return (
          <p key={m} style={{ height: half ? px / 2 : px }} className={`-translate-y-2 pr-2 text-right text-[0.7rem] tabular-nums ${m % 60 ? "text-muted/60" : "text-muted"}`}>
            {m === hours[0] * 60 ? "" : half ? clock(m) : hourName(m / 60)}
          </p>
        );
      })}
    </div>
  );
}

// all-day bookings, above a day's hours
const AllDay = ({ evs, onEvent, className = "" }) =>
  evs
    .filter((e) => e.allDay)
    .map((ev) => (
      <button key={ev.id} type="button" onClick={() => onEvent(ev)} {...dragFrom(ev)} style={look(ev).style} className={`block truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[0.7rem] ${look(ev).className} ${className}`}>
        {ev.title}
      </button>
    ));

// seven columns of half-hour slots
function Week({ from, today, byDay, onDay, onSlot, onEvent, onMove }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const now = useNow();
  const plans = days.map((d) => laid(byDay.get(d) ?? [], d));
  const hours = hoursFor(plans);
  return (
    <div className={`${card} overflow-x-auto`}>
      <div className="min-w-[46rem]">
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-line">
          <span />
          {days.map((d) => (
            <div key={d} {...dropOn((id) => onMove(id, d, null))} className="min-w-0 border-l border-line py-2 text-center data-over:bg-gold/15">
              <button type="button" onClick={() => onDay(d)} className="group mx-auto block rounded-md px-2" aria-label={`Open ${label(d, { weekday: "long", month: "long", day: "numeric" })}`}>
                <span className="label block text-muted">{label(d, { weekday: "short" })}</span>
                <span className={`mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full font-display text-lg tabular-nums group-hover:ring-2 group-hover:ring-gold/50 ${d === today ? "bg-gold text-ink" : "text-fg"}`}>{Number(d.slice(8))}</span>
              </button>
              <AllDay evs={byDay.get(d) ?? []} onEvent={onEvent} className="mx-1 mt-1 w-[calc(100%-0.5rem)]" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]">
          <Hours hours={hours} px={HOUR_PX} />
          {days.map((d, i) => (
            <div key={d} className="min-w-0 border-l border-line">
              <DayColumn day={d} today={today} now={now} plan={plans[i]} hours={hours} px={HOUR_PX} onSlot={onSlot} onEvent={onEvent} onMove={onMove} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// the side panel: one day's half-hour slots, with what's booked and what's free
function DayPanel({ day, today, evs, onSlot, onEvent, onMove }) {
  const now = useNow();
  const plan = laid(evs, day);
  const hours = hoursFor([plan]);
  const px = 72;
  const booked = plan.xs.reduce((n, { s, e }) => n + Math.max(0, Math.min(e, hours[1] * 60) - Math.max(s, hours[0] * 60)), 0);
  const free = (hours[1] - hours[0]) * 60 - booked;
  return (
    <div className="grid gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">
          {plan.xs.length ? `${plan.xs.length} booking${plan.xs.length > 1 ? "s" : ""}` : "Nothing booked"} · about {Math.max(0, Math.round(free / 60))} hours free
        </span>
        <button type="button" className={`${btnGhost} ml-auto`} onClick={() => onSlot(day, day === today ? Math.ceil((now.min + 1) / 30) * 30 : 600)}>
          <Plus className="size-4" aria-hidden /> Book
        </button>
      </div>
      {evs.some((e) => e.allDay) && (
        <div className="grid gap-1">
          <p className="label text-muted">All day</p>
          <AllDay evs={evs} onEvent={onEvent} className="w-full py-1 text-xs" />
        </div>
      )}
      <div className="grid grid-cols-[4.5rem_1fr] pt-2">
        <Hours hours={hours} px={px} half />
        <div className="border-l border-line">
          <DayColumn day={day} today={today} now={now} plan={plan} hours={hours} px={px} onSlot={onSlot} onEvent={onEvent} onMove={onMove} times />
        </div>
      </div>
    </div>
  );
}

// 60 days, a heading per day with something on it
function List({ from, byDay, onDay, onEvent }) {
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
          <h3 className="mb-2">
            <button type="button" onClick={() => onDay(d)} className="label text-muted hover:text-fg">{label(d, { weekday: "long", month: "long", day: "numeric" })}</button>
          </h3>
          <ul className={`${card} divide-y divide-line`}>
            {byDay.get(d).map((ev) => (
              <li key={ev.id}>
                <button type="button" onClick={() => onEvent(ev)} className="grid w-full gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-bg sm:grid-cols-[7rem_1fr]">
                  <span className="flex items-center gap-2 tabular-nums text-muted">
                    <span style={look(ev).style} className={`size-2.5 shrink-0 rounded-sm border ${look(ev).className}`} aria-hidden />
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
function Booking({ ev, onCancel, onEdit }) {
  const first = at(ev.start, ev.allDay).key;
  const last = ev.allDay ? addDays(ev.end.slice(0, 10), -1) : first;
  return (
    <div className="grid gap-4 text-sm">
      <p className="text-charcoal">
        {label(first, { weekday: "long", month: "long", day: "numeric" })}
        {last !== first && ` – ${label(last, { weekday: "long", month: "long", day: "numeric" })}`}
        {!ev.allDay && <span className="tabular-nums"> · {time(ev.start)} – {time(ev.end)}</span>}
      </p>
      {ev.recurring && (
        <p className="flex items-center gap-1.5 text-muted">
          <Repeat className="size-4" aria-hidden /> One of a repeating series. Changes here apply to this one only.
        </p>
      )}
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
      <p className="flex items-start gap-1.5 text-muted">
        <Bell className="mt-0.5 size-4 shrink-0" aria-hidden />
        {ev.reminders === null
          ? "The calendar's default reminders"
          : ev.reminders.length
            ? ev.reminders.map((r) => `${r.method === "email" ? "Email" : "Notification"} ${(BEFORE.find(([m]) => m === r.minutes)?.[1] ?? `${r.minutes} minutes before`).toLowerCase()}`).join(" · ")
            : "No reminders"}
      </p>
      {ev.notes && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-muted">{ev.notes}</p>}
      {!ev.editable && <p className="text-xs text-muted">Someone else's invitation: only its organiser can change it.</p>}
      <div className="flex flex-wrap gap-2">
        {ev.editable && (
          <button type="button" className={btn} onClick={onEdit}>
            <Pencil className="size-4" aria-hidden /> Edit
          </button>
        )}
        {ev.lead_id && <Link to={`/leads/${ev.lead_id}`} className={btnGhost}>Open the lead</Link>}
        <a href={ev.link} target="_blank" rel="noopener noreferrer" className={btnGhost}>
          <ExternalLink className="size-4" aria-hidden /> Open in Google Calendar
        </a>
        {ev.editable && <button type="button" className={`${btnDanger} ml-auto`} onClick={onCancel}>Cancel booking</button>}
      </div>
    </div>
  );
}

// a day (tomorrow, unless given) at a minute of the day (10:00), an hour long, Manila time
function blank(key = addDays(keyOf(new Date()), 1), min = 600) {
  const start = slot(key, Math.min(min, 23 * 60));
  return { title: "", allDay: false, start, end: shift(start, 60), location: "", guests: [], notes: "", color: "", reminders: [...NEW_REMINDERS], lead_id: null, lead_name: "" };
}
// a new booking's reminders: a phone notification half an hour before, an email the day before
const NEW_REMINDERS = [{ method: "popup", minutes: 30 }, { method: "email", minutes: 1440 }];
const BEFORE = [[0, "At the start"], [5, "5 minutes before"], [10, "10 minutes before"], [15, "15 minutes before"], [30, "30 minutes before"], [60, "1 hour before"], [120, "2 hours before"], [180, "3 hours before"], [1440, "1 day before"], [2880, "2 days before"], [10080, "1 week before"]];

// a booking as the form holds it; an all-day one's end is its last day, not Google's day after
function formOf(ev) {
  return {
    id: ev.id,
    title: ev.title === "(no title)" ? "" : ev.title,
    allDay: ev.allDay,
    start: ev.allDay ? ev.start.slice(0, 10) : local(ev.start),
    end: ev.allDay ? addDays(ev.end.slice(0, 10), -1) : local(ev.end),
    location: ev.location,
    guests: ev.guests.map((g) => g.email),
    notes: ev.notes ?? "",
    color: ev.color ?? "",
    reminders: ev.reminders, // null: the calendar's own
    recurring: ev.recurring,
  };
}

const LENGTHS = [[30, "30 min"], [60, "1 hr"], [90, "1½ hr"], [120, "2 hr"], [180, "3 hr"]];

function BookingForm({ value: b, onChange, onDone, disabled, seen }) {
  const known = useKnown(seen);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => onChange({ ...b, [k]: e.target.value });
  const len = b.allDay ? null : minutesBetween(b.start, b.end);

  // a new start keeps the booking's length, as Google does
  function setStart(e) {
    const v = e.target.value;
    if (!v) return onChange({ ...b, start: v });
    onChange({ ...b, start: v, end: b.allDay ? addDays(v, Math.max(0, daysBetween(b.start, b.end))) : shift(v, len > 0 ? len : 60) });
  }
  function setAllDay(e) {
    const on = e.target.checked;
    const d = b.start.slice(0, 10);
    onChange({ ...b, allDay: on, start: on ? d : `${d}T10:00`, end: on ? b.end.slice(0, 10) || d : `${d}T11:00` });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(b.id ? "google/update" : "google/book", b);
      const invited = b.guests.length ? " Google emails the guests." : "";
      toast(b.id ? `Saved.${invited}` : `Booked.${invited}`);
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
      {b.recurring && <p className="flex items-center gap-1.5 text-sm text-muted"><Repeat className="size-4" aria-hidden /> Changes apply to this one in the series only.</p>}
      <Field label="Title">
        <input value={b.title} onChange={set("title")} required maxLength={200} placeholder="Viewing: name, property" list="cal-titles" autoComplete="off" className={input} />
        <datalist id="cal-titles">{TITLES.map((t) => <option key={t} value={`${t}${b.lead_name ? ` ${b.lead_name}` : " "}`} />)}</datalist>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={b.allDay} onChange={setAllDay} className="size-4 accent-navy" /> All day
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" hint="Manila time">
          <input type={b.allDay ? "date" : "datetime-local"} value={b.start} onChange={setStart} required step={900} className={input} />
        </Field>
        <Field label="Ends">
          <input type={b.allDay ? "date" : "datetime-local"} value={b.end} onChange={set("end")} required min={b.start} step={900} className={input} />
        </Field>
      </div>
      {!b.allDay && (
        <div className="-mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Length">
          {LENGTHS.map(([m, l]) => (
            <button key={m} type="button" onClick={() => onChange({ ...b, end: shift(b.start, m) })} aria-pressed={len === m} className={`rounded-full border px-3 py-1 text-xs transition-colors ${len === m ? "border-navy bg-navy text-cream" : "border-line text-muted hover:text-fg"}`}>
              {l}
            </button>
          ))}
        </div>
      )}
      <Field label="Where">
        <input value={b.location} onChange={set("location")} maxLength={500} placeholder="The property, the office, or a meeting link" list="cal-places" autoComplete="off" className={input} />
        <datalist id="cal-places">{known.places.map((x) => <option key={x} value={x} />)}</datalist>
      </Field>
      <Field label="Guests" hint="Type a name or an email: leads, the team and past guests come up. Google emails each one an invitation they can accept, and any change. Leave empty for a booking only you see.">
        <Guests
          value={b.guests}
          people={known.people}
          onChange={(guests) => onChange({ ...b, guests })}
          // a lead picked when the booking isn't for anyone yet: it becomes theirs
          onPick={(x) => onChange({ ...b, guests: [...b.guests, x.email], ...(x.lead_id && !b.lead_id ? { lead_id: x.lead_id, lead_name: x.name, title: b.title || `Viewing: ${x.name}` } : {}) })}
        />
      </Field>
      <Field label="Colour" hint="Google Calendar's own colours, so it looks the same there.">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
          <button type="button" role="radio" aria-checked={!b.color} onClick={() => onChange({ ...b, color: "" })} className={`h-7 rounded-full border px-2.5 text-xs ${!b.color ? "border-navy text-fg ring-2 ring-navy/30" : "border-line text-muted"}`}>
            Default
          </button>
          {Object.entries(GCOLOR).map(([id, [name, hex]]) => (
            <button key={id} type="button" role="radio" aria-checked={b.color === id} aria-label={name} title={name} onClick={() => onChange({ ...b, color: id })} style={{ background: hex }} className={`size-7 rounded-full ${b.color === id ? "ring-2 ring-navy ring-offset-2 ring-offset-surface" : ""}`} />
          ))}
        </div>
      </Field>
      <Reminders value={b.reminders} onChange={(reminders) => onChange({ ...b, reminders })} />
      <Field label="Notes">
        <textarea value={b.notes} onChange={set("notes")} maxLength={8000} rows={3} className={input} />
      </Field>
      <button className={btn} disabled={busy || disabled}>{busy ? "Saving…" : b.id ? "Save changes" : "Book it"}</button>
    </form>
  );
}

// when Google reminds the connected account, a notification or an email, up to five (null: the
// calendar's own default); the notifications are also pushed to the agents (worker pushReminders)
function Reminders({ value, onChange }) {
  const set = (i, k) => (e) => onChange(value.map((r, j) => (j === i ? { ...r, [k]: k === "minutes" ? Number(e.target.value) : e.target.value } : r)));
  return (
    <Field label="Reminders" hint="A notification reminder also reaches the agents on their phones and computers: whoever booked it, the lead's agent and any team member invited. Email reminders go to the business Gmail. Clients get reminders from their own calendar.">
      {value === null ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          The calendar's default reminders.
          <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={() => onChange([...NEW_REMINDERS])}>Set them for this booking</button>
        </p>
      ) : (
        <div className="grid gap-2">
          {value.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select aria-label="How" value={r.method} onChange={set(i, "method")} className={`${input} w-40`}>
                <option value="popup">Notification</option>
                <option value="email">Email</option>
              </Select>
              <Select aria-label="When" value={String(r.minutes)} onChange={set(i, "minutes")} className={`${input} min-w-0 flex-1`}>
                {(BEFORE.some(([m]) => m === r.minutes) ? BEFORE : [...BEFORE, [r.minutes, `${r.minutes} minutes before`]]).map(([m, l]) => (
                  <option key={m} value={String(m)}>{l}</option>
                ))}
              </Select>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove this reminder" className="press rounded-md p-2 text-muted hover:bg-sunken hover:text-fg">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-3 text-sm">
            {value.length < 5 && (
              <button type="button" className="flex items-center gap-1 text-muted hover:text-fg" onClick={() => onChange([...value, { method: "popup", minutes: 10 }])}>
                <Plus className="size-4" aria-hidden /> Add a reminder
              </button>
            )}
            {!value.length && <span className="text-muted">No reminders.</span>}
            <button type="button" className="text-muted underline underline-offset-2 hover:text-fg" onClick={() => onChange(null)}>Use the calendar's default</button>
          </div>
        </div>
      )}
    </Field>
  );
}

const TITLES = ["Viewing:", "Tripping:", "Meeting:", "Call:", "Contract signing:", "Turnover:", "Follow-up:"];

// what the form can suggest: people (leads with an email, the team, guests already on the
// calendar) and places (listings, inventory buildings and locations), loaded once per form
function useKnown(seen) {
  const [known, setKnown] = useState({ people: [], places: [] });
  useEffect(() => {
    Promise.all([
      run(supabase.from("leads").select("id, name, email").not("email", "is", null).order("created_at", { ascending: false }).limit(2000)),
      run(supabase.from("admin_users").select("name, email").eq("active", true)),
      run(supabase.from("listings").select("title, location")),
      run(supabase.from("inventory").select("building, location").limit(3000)),
    ]).then(
      ([leads, team, listings, inventory]) => {
        const people = new Map();
        for (const l of leads) people.set(l.email.toLowerCase(), { email: l.email.toLowerCase(), name: l.name, kind: "Lead", lead_id: l.id });
        for (const t of team) people.set(t.email, { email: t.email, name: t.name, kind: "Team" });
        for (const ev of seen ?? []) for (const g of ev.guests) if (!people.has(g.email)) people.set(g.email, { email: g.email, name: "", kind: "Guest before" });
        const places = new Set([...listings.flatMap((x) => [x.title, x.location]), ...inventory.flatMap((x) => [x.building, x.location])].filter(Boolean).map((x) => x.trim()));
        setKnown({ people: [...people.values()], places: [...places].sort().slice(0, 1500) });
      },
      () => {} // suggestions are a nicety: the form works without them
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return known;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// guests as chips: type a name or an email, pick a suggestion (arrows and Enter), or finish an
// email with Enter, a comma or a space; Backspace on an empty box takes the last one off
function Guests({ value, people, onChange, onPick }) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [focus, setFocus] = useState(false);
  const q = text.trim().toLowerCase();
  const matches = q ? people.filter((p) => !value.includes(p.email) && (p.email.includes(q) || p.name.toLowerCase().includes(q))).slice(0, 6) : [];
  const clear = () => {
    setText("");
    setActive(0);
  };
  const add = (email) => {
    const e = email.trim().toLowerCase().replace(/[,;]$/, "");
    if (EMAIL.test(e) && !value.includes(e)) onChange([...value, e]);
    clear();
  };
  const pick = (p) => {
    onPick(p);
    clear();
  };
  function key(e) {
    const stop = () => e.preventDefault();
    if (e.key === "ArrowDown" && matches.length) {
      stop();
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === "ArrowUp" && matches.length) {
      stop();
      setActive((a) => (a - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" && q) {
      stop();
      if (matches[active]) pick(matches[active]);
      else add(text);
    } else if ((e.key === "," || e.key === " " || e.key === ";") && EMAIL.test(q)) {
      stop();
      add(text);
    } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
    else if (e.key === "Escape" && text) {
      stop();
      e.stopPropagation(); // clears the box, not the whole form
      clear();
    }
  }
  const nameOf = (email) => people.find((p) => p.email === email)?.name;
  return (
    <div className="relative">
      <div className={`${input} flex min-h-10 flex-wrap items-center gap-1.5 py-1.5`}>
        {value.map((g) => (
          <span key={g} className="flex max-w-full items-center gap-1 rounded-full bg-sunken py-0.5 pr-1 pl-2.5 text-xs text-fg">
            <span className="truncate">{nameOf(g) ? `${nameOf(g)} · ${g}` : g}</span>
            <button type="button" onClick={() => onChange(value.filter((x) => x !== g))} aria-label={`Remove ${g}`} className="rounded-full p-0.5 text-muted hover:bg-line hover:text-fg">
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={key}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false);
            if (EMAIL.test(q)) add(text); // a whole email typed and left: keep it
          }}
          type="email"
          inputMode="email"
          autoComplete="off"
          aria-label="Add a guest"
          role="combobox"
          aria-expanded={focus && matches.length > 0}
          aria-controls="guest-matches"
          aria-activedescendant={focus && matches[active] ? `guest-${active}` : undefined}
          placeholder={value.length ? "Add another" : "Name or email"}
          className="min-w-40 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {focus && matches.length > 0 && (
        <ul id="guest-matches" role="listbox" className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
          {matches.map((p, i) => (
            <li
              key={p.email}
              id={`guest-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, so the pick lands before the box loses focus
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-sunken" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">
                {p.name && <span className="font-medium text-fg">{p.name} </span>}
                <span className="text-muted">{p.email}</span>
              </span>
              <Badge value={p.kind === "Lead" ? "new" : p.kind === "Team" ? "closed" : "draft"}>{p.kind}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
