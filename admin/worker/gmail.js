// The connected Google account's Gmail, read-only, for the admin's Email page. Nothing is sent,
// moved or marked read from here; replying happens in Gmail.
//   GET /api/google/mail?box=inbox|sent&q=…&page=…   20 at a time: from, to, subject, date, snippet
//   GET /api/google/mail/:id                         one message: headers, its HTML or text, attachments
//   GET /api/google/mail/:id/att/:attId?name=…       an attachment, as a download
//   GET /api/google/mail/:id/view?t=…&images=0|1     its HTML as a page of its own, for an iframe
// The page has its own strict rules (no scripts, nothing sent anywhere, images only when asked),
// which the admin's can't give it: an iframe can't send the sign-in header, so it carries a
// 10-minute ticket that read() signs for that one message.
import { access, sign, unsign } from "./google.js";
import { unb64u } from "./push.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const json = (data) => Response.json(data, { headers: { "Cache-Control": "no-store" } });

async function gmail(env, path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await access(env)}` } });
  const out = await r.json();
  if (r.ok) return out;
  const why = out.error?.message ?? String(r.status);
  // connected before email was added, or the Gmail box left unticked at consent
  if (r.status === 403 && /scope/i.test(why)) throw Object.assign(new Error("Email needs Google connected again with Gmail allowed. Reconnect it on the Calendar page."), { status: 409 });
  if (r.status === 403 && /has not been used|disabled/i.test(why)) throw Object.assign(new Error("Turn on the Gmail API in the Google Cloud project first."), { status: 409 });
  throw Object.assign(new Error(`Gmail: ${why}`), { status: 502 });
}

// base64url (Gmail's encoding) to text
export function decode(data = "") {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// walk a message's parts: the first HTML and plain-text bodies, and every attachment
export function unpack(part, out = { html: "", text: "", attachments: [] }) {
  if (part.filename && part.body?.attachmentId) out.attachments.push({ name: part.filename, size: part.body.size, id: part.body.attachmentId, type: part.mimeType });
  else if (part.mimeType === "text/html" && !out.html && part.body?.data) out.html = decode(part.body.data);
  else if (part.mimeType === "text/plain" && !out.text && part.body?.data) out.text = decode(part.body.data);
  for (const p of part.parts ?? []) unpack(p, out);
  return out;
}

const header = (m, name) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";

export async function list(env, url) {
  const box = url.searchParams.get("box") === "sent" ? "SENT" : "INBOX";
  const p = new URLSearchParams({ maxResults: "20", labelIds: box });
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  if (q) p.set("q", q);
  if (url.searchParams.get("page")) p.set("pageToken", url.searchParams.get("page"));
  const page = await gmail(env, `/messages?${p}`);
  const meta = new URLSearchParams([["format", "metadata"], ...["From", "To", "Subject", "Date"].map((h) => ["metadataHeaders", h])]);
  const messages = await Promise.all(
    (page.messages ?? []).map(async ({ id }) => {
      const m = await gmail(env, `/messages/${id}?${meta}`);
      return { id, thread: m.threadId, from: header(m, "from"), to: header(m, "to"), subject: header(m, "subject"), at: Number(m.internalDate), snippet: m.snippet, unread: m.labelIds?.includes("UNREAD") ?? false };
    })
  );
  return json({ messages, next: page.nextPageToken ?? null });
}

export async function read(env, id) {
  if (!/^[a-f0-9]{8,32}$/i.test(id)) return Response.json({ error: "No such email" }, { status: 400 });
  const m = await gmail(env, `/messages/${id}?format=full`);
  const { html, ...body } = unpack(m.payload);
  const view = html ? await sign(env.GOOGLE_CLIENT_SECRET, `mail:${id}`) : null;
  return json({ id, from: header(m, "from"), to: header(m, "to"), cc: header(m, "cc"), subject: header(m, "subject"), at: Number(m.internalDate), view, images: /<img/i.test(html), ...body });
}

export async function view(env, id, url) {
  const ok = /^[a-f0-9]{8,32}$/i.test(id) && (await unsign(env.GOOGLE_CLIENT_SECRET, url.searchParams.get("t"))) === `mail:${id}`;
  if (!ok) return new Response("This link has expired. Open the email again.", { status: 403 });
  const { html } = unpack((await gmail(env, `/messages/${id}?format=full`)).payload);
  const images = url.searchParams.get("images") === "1" ? "https: data:" : "data:";
  return new Response(
    `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:4px;font:14px/1.55 system-ui,sans-serif;color:#24292f;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>${html}`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; font-src ${images}; img-src ${images}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

export async function attachment(env, id, att, name) {
  if (!/^[a-f0-9]{8,32}$/i.test(id) || !/^[\w-]{10,}$/.test(att)) return Response.json({ error: "No such file" }, { status: 400 });
  const { data } = await gmail(env, `/messages/${id}/attachments/${att}`);
  const bytes = unb64u(data);
  const safe = (name ?? "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
