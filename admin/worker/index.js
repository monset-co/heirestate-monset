// The admin's Worker at admin.<domain>. The app itself is static (dist/admin) and talks to Supabase
// directly; this Worker does only what needs a secret:
//   /api/second-factor/send, /verify   the emailed code that is sign-in's second step
//   /api/invite                        an invitation email for a user added on the Users page
//   /api/visits?days=7|30|90           site visits from Cloudflare Web Analytics
//   /api/whatsapp/webhook              Meta's WhatsApp messages and statuses (signed, no sign-in)
//   /api/whatsapp/send, /media/:id     a reply from the admin, a photo or file they sent
//   /api/google/*                      Google Calendar bookings, and its Gmail read-only (google.js, gmail.js)
//   /api/geo?q=…                       where a place is, from OpenStreetMap (for a property's pin)
//   /api/push/key, /push/task          push notifications: the key to sign up with, a task given (push.js)
//   scheduled (every 15 minutes)       emails reminders that have come due
//   PublicApi.inquiry()                saves an inquiry from the public sites and alerts its agent
// Secrets: SUPABASE_SECRET_KEY, RESEND_API_KEY, CF_API_TOKEN, WA_TOKEN, WA_APP_SECRET, WA_VERIFY_TOKEN, GOOGLE_CLIENT_SECRET, VAPID_PRIVATE_KEY (wrangler secret put). The rest is in
// wrangler.admin.jsonc's vars.
import { WorkerEntrypoint } from "cloudflare:workers";
import { db, whoIs } from "./supabase.js";
import { mail } from "./mail.js";
import { newCode, hash, check, canSend, TTL, TRIES } from "./code.js";
import * as whatsapp from "./whatsapp.js";
import * as google from "./google.js";
import * as gmail from "./gmail.js";
import { notify } from "./push.js";

const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const fail = (error, status = 400) => json({ error }, status);
const q = encodeURIComponent;

async function sendCode(env, me) {
  if (me.verified) return json({ verified: true });
  const [row] = await db(env).get(`second_factor?session_id=eq.${q(me.session)}`);
  if (!canSend(row, Date.now())) return fail("A code was sent less than a minute ago. Check your email, or try again shortly.", 429);
  const code = newCode();
  await db(env).upsert("second_factor", {
    session_id: me.session,
    email: me.email,
    code_hash: await hash(me.session, code),
    expires_at: new Date(Date.now() + TTL).toISOString(),
    attempts: 0,
    sent_at: new Date().toISOString(),
  });
  await mail(env, {
    to: me.email,
    subject: `${code} is your Heir Estates admin code`,
    text: `Your code to finish signing in to the Heir Estates admin is ${code}.\n\nIt works once, for the next 10 minutes. If you didn't just sign in, change your password and tell the other admins.`,
  });
  return json({ sent: true });
}

async function verifyCode(req, env, me) {
  if (me.verified) return json({ verified: true });
  const { code } = (await req.json().catch(() => ({}))) ?? {};
  const [row] = await db(env).get(`second_factor?session_id=eq.${q(me.session)}`);
  const result = await check(row, me.session, code ?? "", Date.now());
  const where = `second_factor?session_id=eq.${q(me.session)}`;
  if (result === "ok") {
    await db(env).update(where, { verified_at: new Date().toISOString(), code_hash: null });
    return json({ verified: true });
  }
  if (result === "wrong") {
    await db(env).update(where, { attempts: row.attempts + 1 });
    const left = TRIES - row.attempts - 1;
    return fail(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Send a new one.");
  }
  return fail(result === "locked" ? "Too many tries. Send a new code." : "That code has expired. Send a new one.");
}

async function invite(req, env) {
  const { email } = (await req.json().catch(() => ({}))) ?? {};
  const address = String(email ?? "").trim().toLowerCase();
  const [listed] = await db(env).get(`admin_users?select=id&email=eq.${q(address)}&active=eq.true`);
  if (!listed) return fail("Add them on the Users page first");
  try {
    await db(env).auth("invite", { email: address });
    return json({ invited: true });
  } catch (e) {
    if (e.status === 422) return fail("They already have an account. They can sign in, or use “Forgot password”.", 409);
    throw e;
  }
}

// Visits per site from Cloudflare Web Analytics (GraphQL Analytics API, read-only token)
async function visits(env, days) {
  const to = new Date();
  const from = new Date(to - (days - 1) * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query ($account: string!, $from: Date!, $to: Date!) {
        viewer { accounts(filter: { accountTag: $account }) {
          rumPageloadEventsAdaptiveGroups(limit: 100, filter: { date_geq: $from, date_leq: $to }) {
            count sum { visits } dimensions { requestHost }
          }
        } }
      }`,
      variables: { account: env.CF_ACCOUNT_ID, from: iso(from), to: iso(to) },
    }),
  });
  const body = await r.json();
  if (!r.ok || body.errors?.length) throw new Error(`Cloudflare analytics: ${JSON.stringify(body.errors ?? r.status)}`);
  const rows = body.data.viewer.accounts[0]?.rumPageloadEventsAdaptiveGroups ?? [];
  return rows
    .map((g) => ({ host: g.dimensions.requestHost, visits: g.sum.visits, views: g.count }))
    .filter((s) => s.host.endsWith(env.DOMAIN))
    .sort((a, b) => b.visits - a.visits);
}

// Where a place is in Metro Cebu, from OpenStreetMap's free geocoder (Nominatim): at most five
// answers, each exact (a building or street) or only the neighbourhood. Cached a week: Nominatim
// asks for no more than a request a second, and an admin looks the same place up again.
async function geo(q) {
  const text = String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (text.length < 3) return fail("Type a place to look up");
  const key = `https://cache.internal/geo/${encodeURIComponent(text.toLowerCase())}`;
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const p = new URLSearchParams({ q: /cebu|mandaue|lapu|talisay|minglanilla|consolacion|liloan|naga|cordova/i.test(text) ? text : `${text}, Cebu`, format: "jsonv2", countrycodes: "ph", viewbox: "123.55,10.55,124.15,10.05", bounded: "1", limit: "5" });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { "User-Agent": "realestate-admin-geocoder/1.0", "Accept-Language": "en" } });
  if (!r.ok) return fail("The map service is busy. Try again in a moment.", 503);
  const places = (await r.json()).map((h) => ({ name: h.display_name, lat: Number(h.lat), lng: Number(h.lon), exact: Number(h.place_rank) >= 26 }));
  const res = Response.json({ places }, { headers: { "Cache-Control": "max-age=604800" } });
  await caches.default.put(key, res.clone());
  return res;
}

// Reminders that have come due and not been emailed: one email each to its agent (or every admin)
async function remind(env) {
  const due = await db(env).get(
    `reminders?select=id,body,due_at,lead_id,agent:admin_users(email,name),lead:leads(name,agent:admin_users(email))&done_at=is.null&emailed_at=is.null&due_at=lte.${q(new Date().toISOString())}&limit=50`
  );
  if (!due.length) return;
  const everyone = (await db(env).get("admin_users?select=email&active=eq.true")).map((a) => a.email);
  for (const r of due) {
    const to = r.agent?.email ?? r.lead?.agent?.email ?? everyone;
    await mail(env, {
      to,
      subject: `Follow up: ${r.lead?.name ?? "a lead"}`,
      text: `${r.body}\n\nLead: ${r.lead?.name ?? ""}\n${env.ADMIN_URL}/leads/${r.lead_id}?tab=Reminders`,
    });
    await notify(env, to, { title: `Follow up: ${r.lead?.name ?? "a lead"}`, body: r.body, url: `/leads/${r.lead_id}?tab=Reminders` });
    await db(env).update(`reminders?id=eq.${r.id}`, { emailed_at: new Date().toISOString() });
  }
}

// A note on the Notes board given to someone else: tell them. Private notes never leave.
async function pushTask(req, env, me) {
  const { id } = (await req.json().catch(() => ({}))) ?? {};
  const [t] = Number.isInteger(id) ? await db(env).get(`tasks?select=body,assignee,private,urgent&id=eq.${id}`) : [];
  if (t && !t.private && t.assignee && t.assignee !== me.email)
    await notify(env, t.assignee, { title: `${t.urgent ? "Urgent: " : ""}${me.admin.name} gave you a task`, body: t.body.slice(0, 200), url: "/notes" });
  return json({ ok: true });
}

// What the public Worker (wrangler.jsonc's ADMIN binding) may ask of this one: save one inquiry it
// has already checked (Turnstile, rate limit, fields) and alert the agent.
export class PublicApi extends WorkerEntrypoint {
  async inquiry(lead, listingSlug) {
    const env = this.env;
    const [listing] = listingSlug ? await db(env).get(`listings?select=id,title&slug=eq.${q(listingSlug)}&published=eq.true`) : [];
    const [row] = await db(env).insert("leads", { ...lead, listing_id: listing?.id ?? null, consent_at: new Date().toISOString() });
    // the alert is sent after the visitor has their answer; a failed email never loses the lead
    this.ctx.waitUntil(
      (async () => {
        const [agent] = row.agent_id ? await db(env).get(`admin_users?select=email&id=eq.${row.agent_id}&active=eq.true`) : [];
        const to = agent?.email ?? (await db(env).get("admin_users?select=email&active=eq.true")).map((a) => a.email);
        await mail(env, {
          to,
          replyTo: lead.email,
          subject: `New inquiry: ${lead.name}${listing ? `, ${listing.title}` : ""}`,
          text: [
            `${lead.interest ?? "Inquiry"} from ${lead.source_site === "main" ? "heirestates.com" : `${lead.source_site}.heirestates.com`}`,
            listing && `Listing: ${listing.title}`,
            "",
            `Name: ${lead.name}`,
            `Mobile: ${lead.mobile}`,
            `Email: ${lead.email}`,
            lead.budget && `Budget: ${lead.budget}`,
            lead.viewing_time && `Preferred viewing: ${lead.viewing_time}`,
            lead.message && `\n${lead.message}`,
            "",
            `Open it in the admin: ${env.ADMIN_URL}/leads/${row.id}`,
          ]
            .filter((l) => l !== undefined && l !== null && l !== false)
            .join("\n"),
        });
        await notify(env, agent?.email ?? null, { title: `New inquiry: ${lead.name}`, body: listing?.title ?? lead.interest ?? "From the website", url: `/leads/${row.id}` });
      })().catch((e) => console.error("inquiry alert", e))
    );
    return { id: row.id };
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    // Meta, not an admin: checked by its signature instead
    if (url.pathname === "/api/whatsapp/webhook") {
      try {
        return await whatsapp.webhook(req, env);
      } catch (e) {
        console.error("whatsapp webhook", e);
        return new Response("error", { status: 500 }); // Meta tries again later
      }
    }
    // an email's HTML for its iframe: checked by its signed ticket instead
    const mailView = req.method === "GET" && url.pathname.match(/^\/api\/google\/mail\/([^/]+)\/view$/);
    if (mailView) {
      try {
        return await gmail.view(env, mailView[1], url);
      } catch (e) {
        console.error("mail view", e);
        return new Response("This email couldn't be shown.", { status: 502 });
      }
    }
    // Google sending the admin back after consent: checked by its signed state instead
    if (url.pathname === "/api/google/callback" && req.method === "GET") {
      try {
        return await google.callback(req, env);
      } catch (e) {
        console.error("google callback", e);
        return Response.redirect(`${env.ADMIN_URL}/calendar?google=failed`, 302);
      }
    }
    // changes only from the admin's own pages
    if (req.method !== "GET" && req.headers.get("Origin") !== url.origin) return fail("Not allowed", 403);
    try {
      const me = await whoIs(req, env);
      if (!me) return fail("Sign in first", 401);
      if (!me.admin) return fail(`${me.email} isn't on the admin list`, 403);
      const path = url.pathname.slice(5);
      if (path === "second-factor/send" && req.method === "POST") return await sendCode(env, me);
      if (path === "second-factor/verify" && req.method === "POST") return await verifyCode(req, env, me);
      // everything else needs both steps
      if (!me.verified) return fail("Finish signing in with the emailed code", 403);
      if (path === "invite" && req.method === "POST") return await invite(req, env);
      if (path.startsWith("whatsapp/") && !env.WA_TOKEN) return fail("WhatsApp isn't connected yet (WA_TOKEN)", 501);
      if (path === "whatsapp/send" && req.method === "POST") return await whatsapp.send(req, env, me);
      if (path.startsWith("whatsapp/media/") && req.method === "GET") return await whatsapp.media(env, path.slice(15));
      if (path.startsWith("google/")) {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail("Google isn't set up yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)", 501);
        const route = `${req.method} ${path.slice(7)}`;
        try {
          if (route === "POST connect") return await google.connect(env, me);
          if (route === "GET status") return await google.status(env);
          if (route === "POST disconnect") return await google.disconnect(env);
          if (route === "GET events") return await google.events(env, url);
          if (route === "POST book") return await google.book(req, env, me);
          if (route === "POST cancel") return await google.cancel(req, env);
          if (route === "GET mail") return await gmail.list(env, url);
          const m = route.match(/^GET mail\/([^/]+)(?:\/att\/([^/]+))?$/);
          if (m) return m[2] ? await gmail.attachment(env, m[1], m[2], url.searchParams.get("name")) : await gmail.read(env, m[1]);
        } catch (e) {
          if (!e.status) throw e;
          console.error("google", e);
          return fail(e.message, e.status); // "not connected" and Google's own refusals, worded for the admin
        }
      }
      if (path === "push/key" && req.method === "GET") return json({ key: env.VAPID_PUBLIC_KEY ?? null });
      if (path === "push/task" && req.method === "POST") return await pushTask(req, env, me);
      if (path === "geo" && req.method === "GET") return await geo(url.searchParams.get("q"));
      if (path === "visits" && req.method === "GET") {
        const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
        if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return fail("Site visits aren't set up yet (CF_API_TOKEN, CF_ACCOUNT_ID)", 501);
        // an hour's cache: the numbers move slowly and the API has limits
        const key = `https://cache.internal/visits/${days}`;
        const hit = await caches.default.match(key);
        if (hit) return hit;
        const res = Response.json({ days, sites: await visits(env, days) }, { headers: { "Cache-Control": "max-age=3600" } });
        await caches.default.put(key, res.clone());
        return res;
      }
      return fail("Not found", 404);
    } catch (e) {
      console.error(e);
      return fail("Something went wrong", 500);
    }
  },
  async scheduled(_, env, ctx) {
    ctx.waitUntil(remind(env));
    // the bell keeps two months
    ctx.waitUntil(db(env).remove(`notifications?created_at=lt.${new Date(Date.now() - 60 * 864e5).toISOString()}`).catch((e) => console.error("bell", e)));
  },
};
