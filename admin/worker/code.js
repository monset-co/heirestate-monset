// The emailed sign-in code: six digits, kept only as a hash tied to the session, good for ten
// minutes and five tries. Pure, so it can be tested without Supabase or email.
export const TTL = 10 * 60e3;
export const TRIES = 5;
export const RESEND_AFTER = 60e3;

export const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, "0");

export async function hash(session, code) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${session}:${code}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// whether a code may be sent now (row: this session's second_factor row, or undefined)
export const canSend = (row, now) => !row?.sent_at || now - Date.parse(row.sent_at) >= RESEND_AFTER;

// what to do with a code someone entered: "ok", or why not
export async function check(row, session, code, now) {
  if (row?.verified_at) return "ok";
  if (!row?.code_hash || now > Date.parse(row.expires_at)) return "expired";
  if (row.attempts >= TRIES) return "locked";
  if (!/^\d{6}$/.test(String(code).trim())) return "wrong";
  return (await hash(session, String(code).trim())) === row.code_hash ? "ok" : "wrong";
}
