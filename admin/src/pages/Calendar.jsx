// Bookings on the business's Google Calendar (admin/worker/google.js): connect the account once,
// then see what's coming and book viewings and meetings. The guest gets Google's own invitation from
// the connected Gmail. Opened from a lead (?lead=id), the booking is filled in from them.
import { CalendarPlus, ExternalLink, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import { supabase, run } from "../supabase";
import { Skeleton, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, btn, btnDanger, btnGhost, card, input, Select } from "../ui";

const TZ = "Asia/Manila";
const day = (iso) => new Intl.DateTimeFormat("en-PH", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date(iso));
const time = (iso) => new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
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
  const [google, setGoogle] = useState(undefined); // undefined: not known yet
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(null); // the form's values while it's open

  const load = () => api("google/events").then((r) => setEvents(r.events), (e) => setError(e.message));

  useEffect(() => {
    const back = RETURNS[params.get("google")];
    if (back?.[0]) toast(back[0]);
    if (back?.[1]) setError(back[1]);
    api("google/status").then(
      (s) => {
        setGoogle(s);
        if (s.email) load();
      },
      (e) => {
        setGoogle({ email: null });
        setError(e.message);
      }
    );
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
    if (!confirm(`Disconnect ${google.email}? Bookings already made stay in its calendar.`)) return;
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
    if (!confirm(`Cancel “${ev.title}”?${ev.guests.length ? " Google emails the guests that it's off." : ""}`)) return;
    try {
      await api("google/cancel", { id: ev.id });
      setEvents((all) => all.filter((x) => x.id !== ev.id));
      toast("Booking cancelled");
    } catch (e) {
      setError(e.message);
    }
  }

  // the events, a heading per day
  const days = [];
  for (const ev of events ?? []) {
    const d = day(ev.start);
    if (days.at(-1)?.[0] !== d) days.push([d, []]);
    days.at(-1)[1].push(ev);
  }

  return (
    <>
      <PageHeader title="Calendar" sub={google?.email ? `The next 60 days on ${google.email}, in Manila time.` : "Bookings and schedules on the business's Google Calendar."}>
        {google?.email && (
          <button className={btn} onClick={() => setBooking(blank())}>
            <CalendarPlus className="size-4" aria-hidden /> New booking
          </button>
        )}
      </PageHeader>

      <div className="stagger mt-6 grid max-w-3xl gap-4">
        <ErrorNote error={error} />
        {google === undefined && <Skeleton className="h-40 w-full" />}

        {google && !google.email && (
          <section className={`${card} grid gap-3 p-5`}>
            <h2 className="font-display text-xl text-ink">Connect Google</h2>
            <p className="max-w-prose text-sm text-muted">
              Sign in with the business's Google account (the Gmail bookings go to). Its calendar shows here, bookings made here land in it, and guests get the invitation from that Gmail address. One connection serves every admin.
            </p>
            <div>
              <button className={btn} onClick={connect}>Connect Google account</button>
            </div>
          </section>
        )}

        {google?.email && events === null && !error && <Skeleton className="h-60 w-full" />}
        {google?.email && events?.length === 0 && (
          <div className={card}>
            <Empty>Nothing booked in the next 60 days.</Empty>
          </div>
        )}
        {days.map(([d, evs]) => (
          <section key={d} aria-label={d}>
            <h2 className="label mb-2 text-muted">{d}</h2>
            <ul className={`${card} divide-y divide-line`}>
              {evs.map((ev) => (
                <li key={ev.id} className="grid gap-1.5 px-4 py-3 text-sm sm:grid-cols-[7rem_1fr_auto] sm:gap-4">
                  <span className="tabular-nums text-muted">{ev.allDay ? "All day" : `${time(ev.start)} – ${time(ev.end)}`}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{ev.title}</p>
                    {ev.location && (
                      <p className="mt-0.5 flex items-center gap-1 text-muted">
                        <MapPin className="size-3.5 shrink-0" aria-hidden /> {ev.location}
                      </p>
                    )}
                    {ev.guests.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {ev.guests.map((g) => (
                          <li key={g.email} className="flex items-center gap-1.5 break-all">
                            {g.email} <Badge value={RESPONSE[g.response] ?? "draft"}>{RESPONSE_LABEL[g.response] ?? g.response}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    {ev.lead_id && (
                      <Link to={`/leads/${ev.lead_id}`} className="mt-1 inline-block underline underline-offset-2">
                        Open the lead
                      </Link>
                    )}
                  </div>
                  <div className="flex items-start gap-1">
                    <a href={ev.link} target="_blank" rel="noopener noreferrer" className={btnGhost} aria-label={`Open “${ev.title}” in Google Calendar`}>
                      <ExternalLink className="size-4" aria-hidden />
                    </a>
                    <button className={btnDanger} onClick={() => cancel(ev)}>Cancel</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {google?.email && (
          <p className="text-sm text-muted">
            Connected by {google.connected_by}.{" "}
            <button className="underline underline-offset-2 hover:text-fg" onClick={disconnect}>Disconnect</button>
          </p>
        )}
      </div>

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

// tomorrow at 10:00, Manila time, as a datetime-local value
function blank() {
  const d = new Date(Date.now() + 8 * 3600e3 + 864e5).toISOString().slice(0, 10);
  return { title: "", start: `${d}T10:00`, minutes: "60", location: "", guest: "", notes: "", lead_id: null, lead_name: "" };
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
