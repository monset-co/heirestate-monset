// Google Calendar on the business's Google account, connected once by any admin (OAuth, offline
// access). Bookings are Calendar events in Manila time; the guest's invitation, and any change or
// cancellation, is sent by Google from the connected Gmail address. The refresh token stays in
// google_account (Worker only).
//   POST /api/google/connect     → { url } to send the admin to Google's consent screen
//   GET  /api/google/callback    Google sends them back here (no sign-in header; a signed state instead)
//   GET  /api/google/status      → { email } or { email: null }
//   POST /api/google/disconnect
//   GET  /api/google/events      ?from=2026-11-01&to=2026-12-13 (Manila days, up to 100), else the next 60 days
//   POST /api/google/book        { title, start: "2026-11-20T14:00", minutes, location?, guest?, notes?, lead_id? }
//   POST /api/google/cancel      { id }
// Needs GOOGLE_CLIENT_ID (var) and GOOGLE_CLIENT_SECRET (secret).
import { db } from "./supabase.js";

const SCOPES = "openid email https://www.googleapis.com/auth/calendar.events";
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

// "2026-11-20T14:00" plus 90 minutes → "2026-11-20T15:30:00" (wall-clock; Google applies the zone)
export function addMinutes(local, minutes) {
  const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local ?? "") && new Date(`${local}:00Z`);
  if (!d || isNaN(d)) return null;
  return new Date(d.getTime() + minutes * 60e3).toISOString().slice(0, 19);
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
async function access(env) {
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
      guests: (e.attendees ?? []).filter((a) => !a.self).map((a) => ({ email: a.email, response: a.responseStatus })),
      lead_id: Number(e.extendedProperties?.private?.lead_id) || null,
      link: e.htmlLink,
    })),
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function book(req, env, me) {
  const b = (await req.json().catch(() => ({}))) ?? {};
  const title = String(b.title ?? "").trim().slice(0, 200);
  const minutes = Number(b.minutes);
  const end = addMinutes(b.start, minutes);
  const guest = String(b.guest ?? "").trim().toLowerCase();
  if (!title) return json({ error: "Give the booking a title" }, 400);
  if (!end || !(minutes >= 15 && minutes <= 720)) return json({ error: "Pick a start time and a length between 15 minutes and 12 hours" }, 400);
  if (guest && !EMAIL.test(guest)) return json({ error: "That guest email doesn't look right" }, 400);
  const lead = Number(b.lead_id) || null;
  const notes = [String(b.notes ?? "").trim().slice(0, 4000), lead && `Lead: ${env.ADMIN_URL}/leads/${lead}`, `Booked by ${me.admin.name ?? me.email} in the Heir Estates admin`]
    .filter(Boolean)
    .join("\n\n");
  const e = await google(env, `?sendUpdates=${guest ? "all" : "none"}`, {
    method: "POST",
    body: JSON.stringify({
      summary: title,
      location: String(b.location ?? "").trim().slice(0, 500) || undefined,
      description: notes,
      start: { dateTime: `${b.start}:00`, timeZone: TZ },
      end: { dateTime: end, timeZone: TZ },
      attendees: guest ? [{ email: guest }] : undefined,
      extendedProperties: lead ? { private: { lead_id: String(lead) } } : undefined,
      reminders: { useDefault: true },
    }),
  });
  return json({ id: e.id, link: e.htmlLink });
}

export async function cancel(req, env) {
  const { id } = (await req.json().catch(() => ({}))) ?? {};
  if (!/^[a-v0-9_]{5,1024}$/i.test(id ?? "")) return json({ error: "No such booking" }, 400);
  await google(env, `/${id}?sendUpdates=all`, { method: "DELETE" });
  return json({ ok: true });
}
