// Supabase from the admin Worker. db() acts with the secret key, which passes row-level security,
// so every use of it here is narrow and checked; whoIs() works out who sent a request from their own
// sign-in token.

function headers(key) {
  // a legacy service_role key is a JWT and goes as the bearer too; a secret key goes alone
  return { apikey: key, ...(key.startsWith("eyJ") && { Authorization: `Bearer ${key}` }) };
}

export function db(env) {
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const call = async (path, init = {}) => {
    const r = await fetch(`${base}/${path}`, {
      ...init,
      headers: { ...headers(env.SUPABASE_SECRET_KEY), "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
    });
    if (!r.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
  return {
    call,
    get: (path) => call(path),
    insert: (table, row) => call(table, { method: "POST", body: JSON.stringify(row) }),
    upsert: (table, row) => call(table, { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }),
    update: (path, row) => call(path, { method: "PATCH", body: JSON.stringify(row) }),
    remove: (path) => call(path, { method: "DELETE" }),
    // Supabase Auth's admin calls (inviting a user)
    auth: async (path, body) => {
      const r = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, {
        method: "POST",
        headers: { ...headers(env.SUPABASE_SECRET_KEY), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Object.assign(new Error(`Supabase auth ${path}: ${r.status} ${await r.text()}`), { status: r.status });
      return r.json();
    },
  };
}

const claims = (token) => JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const q = encodeURIComponent;

// Who sent this request: Supabase Auth checks their token, so a forged one gets nothing. Returns
// their email and session, whether they're an active admin, and whether this session has passed
// the second step; or null.
// a fully signed-in admin is remembered for a minute per token in this isolate, saving two trips
// to Supabase on each request; someone switched off loses the Worker's routes within that minute
// (the database itself refuses them at once)
const seen = new Map();
export async function whoIs(req, env) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if (!token) return null;
  const hit = seen.get(token);
  if (hit && hit.until > Date.now()) return hit.me;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { ...headers(env.SUPABASE_SECRET_KEY), Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const user = await r.json();
  const session = claims(token).session_id;
  const email = user.email?.toLowerCase();
  if (!email || !session) return null;
  const [admins, factors] = await Promise.all([
    db(env).get(`admin_users?select=id,name&email=eq.${q(email)}&active=eq.true`),
    db(env).get(`second_factor?select=verified_at&session_id=eq.${q(session)}`),
  ]);
  const me = { email, session, admin: admins[0] ?? null, verified: !!factors[0]?.verified_at };
  if (me.admin && me.verified) {
    if (seen.size > 500) seen.clear();
    seen.set(token, { me, until: Date.now() + 60e3 });
  }
  return me;
}
