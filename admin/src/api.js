// The admin's own Worker (admin/worker), for what needs a secret: the emailed sign-in code,
// invitations and site visits. Sent with the signed-in user's token, which the Worker checks.
import { supabase } from "./supabase";

export async function api(path, body) {
  const { data } = await supabase.auth.getSession();
  let r;
  try {
    r = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("You seem to be offline. Try again once you're connected.");
  }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error ?? `Request failed (${r.status})`), { status: r.status });
  return out;
}
