// Google Calendar on the business's Google account, connected once by any admin (OAuth, offline
// access). Bookings are Calendar events in Manila time; the guest's invitation, and any change or
// cancellation, is sent by Google from the connected Gmail address. The refresh token stays in
// google_account (Worker only).
//   POST /api/google/connect     → { url } to send the admin to Google's consent screen
//   GET  /api/google/callback    Google sends them back here (no sign-in header; a signed state instead)
//   GET  /api/google/status      → { email } or { email: null }
//   POST /api/google/disconnect
//   GET  /api/google/events      ?from=2026-11-01&to=2026-12-13 (Manila days, up to 100), else the next 60 days
//   POST /api/google/book        { title, start: "2026-11-20T14:00", end, allDay?, location?, guests?, notes?, color?, lead_id? }
//   POST /api/google/update      { id, …the same fields }
//   POST /api/google/cancel      { id }
// Email (read-only) is gmail.js, on the same connection.
// Needs GOOGLE_CLIENT_ID (var) and GOOGLE_CLIENT_SECRET (secret).
import { db } from "./supabase.js";

// Calendar to book; Gmail read-only for the Email page (gmail.js). Gmail is optional at consent.
const SCOPES = "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly";
const TZ = "Asia/Manila";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const redirect = (env) => `${env.ADMIN_URL}/api/google/callback`;

// state = email.expiry.signature, so only a signed-in admin's own request can finish a connection
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hmacKey = (secret, use) => crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [use]);
export async function sign(secret, email, now = Date.now()) {
  const body = `${b64(new TextEncoder().encode(email))}.${now + 10 * 60e3}`;
  return `${body}.${b64(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(body)))}`;
}
export async function unsign(secret, state, now = Date.now()) {
  const [e, exp, sig] = String(state).split(".");
  if (!sig || now > Number(exp)) return null;
  const raw = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), raw, new TextEncoder().encode(`${e}.${exp}`));
  return ok ? new TextDecoder().decode(Uint8Array.from(atob(e.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))) : null;
}

// the event Google keeps, from the form's fields, or { error } in the admin's words. Times are
// Manila wall-clock ("2026-11-20T14:00"); an all-day booking runs from one day to another,
// inclusive (Google's own end day is the day after). The nulls clear the other kind on an edit.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
export function fields(b) {
  const title = String(b.title ?? "").trim().slice(0, 200);
  if (!title) return { error: "Give the booking a title" };
  let start, end;
  if (b.allDay) {
    if (!DAY.test(b.start ?? "") || !DAY.test(b.end ?? "") || b.end < b.start) return { error: "Pick the days it runs, the last on or after the first" };
    start = { date: b.start, dateTime: null, timeZone: null };
    end = { date: nextDay(b.end), dateTime: null, timeZone: null };
  } else {
    if (!TIME.test(b.start ?? "") || !TIME.test(b.end ?? "") || b.end <= b.start) return { error: "Pick a start, and an end after it" };
    start = { dateTime: `${b.start}:00`, timeZone: TZ, date: null };
    end = { dateTime: `${b.end}:00`, timeZone: TZ, date: null };
  }
  const guests = [...new Set((Array.isArray(b.guests) ? b.guests : String(b.guests ?? "").split(/[\s,;]+/)).map((g) => String(g).trim().toLowerCase()).filter(Boolean))];
  const bad = guests.find((g) => !EMAIL.test(g));
  if (bad) return { error: `${bad} doesn't look like an email` };
  if (guests.length > 50) return { error: "50 guests at most" };
  const color = /^(?:[1-9]|1[01])$/.test(b.color ?? "") ? b.color : null; // Google's own 11 event colours; null: the calendar's
  // reminders, as Google sends them to the connected account: "popup" is a notification on its
  // phone and computer (the Google Calendar app), "email" an email. None given: the calendar's own.
  const rs = Array.isArray(b.reminders) ? b.reminders : null;
  if (rs && (rs.length > 5 || rs.some((r) => !["popup", "email"].includes(r?.method) || !(Number.isInteger(r.minutes) && r.minutes >= 0 && r.minutes <= 40320))))
    return { error: "Up to 5 reminders, each a notification or an email, at most 4 weeks before" };
  return {
    event: {
      summary: title,
      location: String(b.location ?? "").trim().slice(0, 500),
      description: String(b.notes ?? "").trim().slice(0, 8000),
      start,
      end,
      attendees: guests.map((email) => ({ email })),
      colorId: color,
      reminders: rs ? { useDefault: false, overrides: rs.map(({ method, minutes }) => ({ method, minutes })) } : { useDefault: true },
    },
    guests,
  };
}

export function connect(env, me) {
  return sign(env.GOOGLE_CLIENT_SECRET, me.email).then((state) => {
    const p = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirect(env),
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent", // always hand back a refresh token
      state,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
  });
}

async function tokens(env, params) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const out = await r.json();
  if (!r.ok) throw Object.assign(new Error(`Google token: ${out.error}`), { google: out.error });
  return out;
}

export async function callback(req, env) {
  const url = new URL(req.url);
  const back = (q) => Response.redirect(`${env.ADMIN_URL}/calendar?${q}`, 302);
  const by = await unsign(env.GOOGLE_CLIENT_SECRET, url.searchParams.get("state"));
  if (!by) return back("google=expired");
  if (!url.searchParams.get("code")) return back("google=declined");
  const t = await tokens(env, { grant_type: "authorization_code", code: url.searchParams.get("code"), redirect_uri: redirect(env) });
  if (!t.refresh_token || !t.scope?.includes("calendar.events")) return back("google=missing");
  // the id_token came straight from Google over TLS, so its claims can be read as they are
  const { email } = JSON.parse(atob(t.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  await db(env).upsert("google_account", { id: 1, email, refresh_token: t.refresh_token, connected_by: by, connected_at: new Date().toISOString() });
  cached = null;
  return back("google=connected");
}

// an access token, kept for this isolate until shortly before it expires
let cached = null;
export async function access(env) {
  if (cached && cached.until > Date.now()) return cached.token;
  const [row] = await db(env).get("google_account?select=refresh_token");
  if (!row) throw Object.assign(new Error("Google isn't connected"), { status: 409 });
  try {
    const t = await tokens(env, { grant_type: "refresh_token", refresh_token: row.refresh_token });
    cached = { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 };
    return cached.token;
  } catch (e) {
    // revoked in their Google account, or the password changed: they need to connect again
    if (e.google === "invalid_grant") {
      await db(env).remove("google_account?id=eq.1");
      throw Object.assign(new Error("Google access was withdrawn. Connect the account again."), { status: 409 });
    }
    throw e;
  }
}

async function google(env, path, init = {}) {
  const r = await fetch(`${CAL}${path}`, { ...init, headers: { Authorization: `Bearer ${await access(env)}`, "Content-Type": "application/json" } });
  if (r.status === 204 || r.status === 410) return null; // 410: already deleted
  const out = await r.json();
  if (!r.ok) throw Object.assign(new Error(`Google Calendar: ${out.error?.message ?? r.status}`), { status: 502 });
  return out;
}

export async function status(env) {
  const [row] = await db(env).get("google_account?select=email,connected_by,connected_at");
  return json(row ?? { email: null });
}

export async function disconnect(env) {
  const [row] = await db(env).get("google_account?select=refresh_token");
  if (row) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.refresh_token)}`, { method: "POST" }).catch(() => {});
  await db(env).remove("google_account?id=eq.1");
  cached = null;
  return json({ ok: true });
}

// a window of Manila days the calendar asks for, if it's a sane one
export function manilaDays(from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from ?? "") || !day.test(to ?? "")) return null;
  const a = Date.parse(`${from}T00:00:00+08:00`);
  const b = Date.parse(`${to}T00:00:00+08:00`) + 864e5;
  return a < b && b - a <= 100 * 864e5 ? { timeMin: new Date(a).toISOString(), timeMax: new Date(b).toISOString() } : null;
}

export async function events(env, url) {
  const range = manilaDays(url.searchParams.get("from"), url.searchParams.get("to"));
  const p = new URLSearchParams({
    timeMin: range?.timeMin ?? new Date().toISOString(),
    timeMax: range?.timeMax ?? new Date(Date.now() + 60 * 864e5).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone: TZ,
  });
  const out = await google(env, `?${p}`);
  return json({
    events: out.items.map((e) => ({
      id: e.id,
      title: e.summary ?? "(no title)",
      start: e.start.dateTime ?? e.start.date,
      end: e.end.dateTime ?? e.end.date,
      allDay: !e.start.dateTime,
      location: e.location ?? "",
      notes: e.description ?? "",
      color: e.colorId ?? null,
      reminders: e.reminders?.useDefault === false ? (e.reminders.overrides ?? []) : null, // null: the calendar's own
      // invitations from other people's calendars can't be changed from here
      editable: !!(e.organizer?.self || e.guestsCanModify),
      recurring: !!e.recurringEventId,
      guests: (e.attendees ?? []).filter((a) => !a.self).map((a) => ({ email: a.email, response: a.responseStatus })),
      lead_id: Number(e.extendedProperties?.private?.lead_id) || null,
      link: e.htmlLink,
    })),
  });
}

export async function book(req, env, me) {
  const b = (await req.json().catch(() => ({}))) ?? {};
  const f = fields(b);
  if (f.error) return json({ error: f.error }, 400);
  const lead = Number(b.lead_id) || null;
  f.event.description = [f.event.description, lead && `Lead: ${env.ADMIN_URL}/leads/${lead}`, `Booked by ${me.admin.name ?? me.email} in the Heir Estates admin`].filter(Boolean).join("\n\n");
  const e = await google(env, `?sendUpdates=${f.guests.length ? "all" : "none"}`, {
    method: "POST",
    body: JSON.stringify({ ...f.event, extendedProperties: lead ? { private: { lead_id: String(lead) } } : undefined}),
  });
  return json({ id: e.id, link: e.htmlLink });
}

const ID = /^[a-v0-9_]{5,1024}$/i;

// an edit: only what the form holds changes (PATCH), so Google keeps the rest (a Meet link, the
// guests' replies); guests hear about it from Google
export async function update(req, env) {
  const b = (await req.json().catch(() => ({}))) ?? {};
  if (!ID.test(b.id ?? "")) return json({ error: "No such booking" }, 400);
  const f = fields(b);
  if (f.error) return json({ error: f.error }, 400);
  // a guest who stays keeps their reply: Google is sent them as they are now
  const was = await google(env, `/${b.id}`);
  const kept = new Map((was.attendees ?? []).map((a) => [a.email.toLowerCase(), a]));
  f.event.attendees = [...(was.attendees ?? []).filter((a) => a.self || a.resource), ...f.guests.map((g) => kept.get(g) ?? { email: g })].filter((a, i, all) => all.findIndex((x) => x.email === a.email) === i);
  const e = await google(env, `/${b.id}?sendUpdates=all`, { method: "PATCH", body: JSON.stringify(f.event) });
  return json({ id: e.id, link: e.htmlLink });
}

export async function cancel(req, env) {
  const { id } = (await req.json().catch(() => ({}))) ?? {};
  if (!ID.test(id ?? "")) return json({ error: "No such booking" }, 400);
  await google(env, `/${id}?sendUpdates=all`, { method: "DELETE" });
  return json({ ok: true });
}
