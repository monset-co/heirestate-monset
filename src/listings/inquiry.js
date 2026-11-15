// POST /api/inquiries on every site: the enquiry and viewing form (src/sections/Enquiry.jsx). Checked
// here (same site, size, five a minute per address, Turnstile, every field), then saved by the
// admin's Worker through the ADMIN service binding, which alerts the agent. This Worker never holds
// a database key.

// what the visitor wants, as the form's intents name it
export const INTERESTS = { viewing: "Book a viewing", prices: "Price list", plans: "Floor plans", invest: "Investing" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// The posted form, as a lead, or the reason it can't be one. Never asks for or keeps IDs, TINs
// or income documents.
export function validate(b) {
  if (!b || typeof b !== "object") return { error: "Send the form again" };
  const lead = {
    name: text(b.name, 100),
    mobile: text(b.phone, 40),
    email: text(b.email, 254).toLowerCase(),
    interest: [INTERESTS[b.intent] ?? "Inquiry", text(b.unit, 80)].filter(Boolean).join(": "),
    budget: text(b.budget, 80) || null,
    viewing_time: (b.intent === "viewing" && text(b.date, 40)) || null,
    message: text(b.message, 2000) || null,
  };
  if (lead.name.length < 2) return { error: "Enter your full name" };
  if (lead.mobile.replace(/\D/g, "").length < 10) return { error: "Enter a mobile number with at least 10 digits" };
  if (!EMAIL.test(lead.email)) return { error: "Enter a valid email address" };
  if (b.consent !== true) return { error: "Tick the consent box so the agents may reply" };
  const listing = typeof b.listing === "string" && /^[a-z0-9-]{1,80}$/.test(b.listing) ? b.listing : null;
  return { lead, listing };
}

const answer = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function inquiry(req, env, { url, site }) {
  if (req.method !== "POST") return answer({ error: "Not found" }, 404);
  if (req.headers.get("Origin") !== url.origin) return answer({ error: "Not allowed" }, 403);
  if (Number(req.headers.get("Content-Length") ?? 0) > 16384) return answer({ error: "That's too long" }, 413);
  if (!env.ADMIN || !env.TURNSTILE_SECRET) return answer({ error: "The form isn't available right now" }, 503);

  const ip = req.headers.get("CF-Connecting-IP") ?? "";
  if (env.INQUIRY_LIMIT && !(await env.INQUIRY_LIMIT.limit({ key: ip })).success)
    return answer({ error: "Too many tries. Wait a minute and send again." }, 429);

  const b = await req.json().catch(() => null);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", typeof b?.token === "string" ? b.token : "");
  form.append("remoteip", ip);
  const human = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })).json();
  if (!human.success) return answer({ error: "We couldn't confirm you're not a bot. Reload the page and try again." }, 400);

  const { lead, listing, error } = validate(b);
  if (error) return answer({ error }, 400);
  await env.ADMIN.inquiry({ ...lead, source_site: site ?? "main" }, listing);
  return answer({ ok: true });
}
