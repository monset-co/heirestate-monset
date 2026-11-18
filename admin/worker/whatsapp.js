// WhatsApp through Meta's Cloud API. Meta posts every message and delivery status to
// /api/whatsapp/webhook (signed with the app secret); admins reply through /api/whatsapp/send and open
// photos and files through /api/whatsapp/media/:id. Everything lands in wa_threads / wa_messages.
// Secrets: WA_TOKEN (a system user's permanent token), WA_APP_SECRET, WA_VERIFY_TOKEN.
// Vars: WA_PHONE_NUMBER_ID, WA_GRAPH_VERSION.
import { db } from "./supabase.js";
import { notify } from "./push.js";

const q = encodeURIComponent;
const DAY = 864e5;
const graph = (env, path) => `https://graph.facebook.com/${env.WA_GRAPH_VERSION}/${path}`;

// Meta signs the raw body: X-Hub-Signature-256: sha256=<hex hmac>
export async function signed(secret, raw, header) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const hex = String(header ?? "").replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const sig = Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(raw)); // constant-time
}

// What a webhook carries, flattened: messages in, and status changes on messages sent
export function parse(payload) {
  const messages = [];
  const statuses = [];
  for (const entry of payload?.entry ?? [])
    for (const { value } of entry.changes ?? []) {
      const names = Object.fromEntries((value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value?.messages ?? []) {
        const media = m[m.type]?.id ? m[m.type] : null;
        messages.push({
          wa_id: m.from,
          name: names[m.from] ?? null,
          wa_message_id: m.id,
          at: new Date(Number(m.timestamp) * 1000).toISOString(),
          type: m.type,
          body:
            m.text?.body ??
            media?.caption ??
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            (m.location && [m.location.name, m.location.address, `${m.location.latitude},${m.location.longitude}`].filter(Boolean).join("\n")) ??
            null,
          media_id: media?.id ?? null,
          media_name: media?.filename ?? null,
        });
      }
      for (const s of value?.statuses ?? [])
        statuses.push({ wa_message_id: s.id, status: s.status, error: s.errors?.[0] ? `${s.errors[0].title}${s.errors[0].error_data?.details ? `: ${s.errors[0].error_data.details}` : ""}` : null });
    }
  return { messages, statuses };
}

// free-form replies only within 24 hours of their last message (templates after that)
export const canReply = (thread, now = Date.now()) => !!thread?.last_inbound_at && now - new Date(thread.last_inbound_at) < DAY;

const ORDER = { sent: 1, delivered: 2, read: 3, failed: 4 };

export async function webhook(req, env) {
  const url = new URL(req.url);
  // Meta checks the address once, when it's set up
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && env.WA_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === env.WA_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge")) : new Response("Forbidden", { status: 403 });
  }
  const raw = await req.text();
  if (!env.WA_APP_SECRET || !(await signed(env.WA_APP_SECRET, raw, req.headers.get("X-Hub-Signature-256")))) return new Response("Bad signature", { status: 401 });
  const { messages, statuses } = parse(JSON.parse(raw));
  const d = db(env);

  for (const m of messages) {
    const [old] = await d.get(`wa_threads?select=id,unread&wa_id=eq.${q(m.wa_id)}`);
    const [thread] = old
      ? await d.update(`wa_threads?id=eq.${old.id}`, { ...(m.name && { name: m.name }), unread: old.unread + 1, last_message_at: m.at, last_inbound_at: m.at })
      : await d.insert("wa_threads", { wa_id: m.wa_id, name: m.name, unread: 1, last_message_at: m.at, last_inbound_at: m.at });
    // a retried webhook repeats wa_message_id: ignored
    const [saved] = await d.call(`wa_messages?on_conflict=wa_message_id`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ thread_id: thread.id, wa_message_id: m.wa_message_id, direction: "in", type: m.type, body: m.body, media_id: m.media_id, media_name: m.media_name, created_at: m.at }),
    });
    // everyone, once per message (a retried webhook saves nothing, so says nothing)
    if (saved) await notify(env, null, { title: `WhatsApp: ${thread.name ?? `+${m.wa_id}`}`, body: m.body?.slice(0, 200) || "Sent a photo or file", url: `/whatsapp/${thread.id}` });
  }
  for (const s of statuses) {
    if (!ORDER[s.status]) continue;
    // statuses can arrive out of order; never step back from read to delivered
    const behind = Object.keys(ORDER).filter((k) => ORDER[k] < ORDER[s.status]);
    await d.update(`wa_messages?wa_message_id=eq.${q(s.wa_message_id)}&status=in.(${behind.join(",")})`, { status: s.status, error: s.error });
  }
  return new Response("ok"); // Meta retries anything else
}

export async function send(req, env, me) {
  const { thread_id, text } = (await req.json().catch(() => ({}))) ?? {};
  const body = String(text ?? "").trim();
  if (!body || body.length > 4096) return Response.json({ error: "Write a message of up to 4,096 characters" }, { status: 400 });
  const d = db(env);
  const [thread] = await d.get(`wa_threads?select=id,wa_id,last_inbound_at&id=eq.${Number(thread_id)}`);
  if (!thread) return Response.json({ error: "No such chat" }, { status: 404 });
  if (!canReply(thread)) return Response.json({ error: "It's been more than 24 hours since their last message. WhatsApp only allows an approved template until they write again." }, { status: 409 });

  const r = await fetch(graph(env, `${env.WA_PHONE_NUMBER_ID}/messages`), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: thread.wa_id, type: "text", text: { body, preview_url: true } }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("whatsapp send", r.status, JSON.stringify(out));
    return Response.json({ error: `WhatsApp didn't take it: ${out.error?.error_user_msg ?? out.error?.message ?? r.status}` }, { status: 502 });
  }
  const now = new Date().toISOString();
  const [msg] = await d.insert("wa_messages", { thread_id: thread.id, wa_message_id: out.messages?.[0]?.id, direction: "out", body, status: "sent", sent_by: me.email, created_at: now });
  await d.update(`wa_threads?id=eq.${thread.id}`, { last_message_at: now, unread: 0 });
  return Response.json(msg);
}

// A photo or file they sent: Meta gives a short-lived link that needs the token, so it's passed through.
export async function media(env, id) {
  const [known] = await db(env).get(`wa_messages?select=id&media_id=eq.${q(id)}`);
  if (!known) return new Response("Not found", { status: 404 });
  const auth = { Authorization: `Bearer ${env.WA_TOKEN}` };
  const info = await fetch(graph(env, q(id)), { headers: auth }).then((r) => (r.ok ? r.json() : null));
  if (!info?.url) return new Response("WhatsApp no longer has this file", { status: 410 });
  const file = await fetch(info.url, { headers: auth });
  return new Response(file.body, { headers: { "Content-Type": info.mime_type ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
}
