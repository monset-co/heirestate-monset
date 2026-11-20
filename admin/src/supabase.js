// The admin's one connection: Supabase, as the signed-in user. Row-level security decides what they
// can read and change (supabase/migrations), so the publishable key here is safe in the browser.
import { createClient } from "@supabase/supabase-js";

// Arrived from an invitation or a "forgot password" email: they set a password before anything else.
// Read before the client below takes the link's token out of the address.
export const SETTING_PASSWORD = /type=(invite|recovery)/.test(location.hash);

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const PHOTOS = "listing-photos";

// the database's refusals, in words (its own messages already are)
const WORDS = {
  lts_before_publishing: "Add the DHSUD License to Sell no. before publishing",
  authority_before_publishing: "The owner's authority must be on file before publishing",
  project_unit_has_project: "A project unit needs its project",
  range_has_minimum: "Enter the lowest price, or a single price",
  listings_slug_key: "Another listing already uses that address",
  admin_users_email_key: "That email already has an account",
  "row-level security": "You're not on the admin list, or your session has ended. Sign in again.",
  lost_has_reason: "Say why the deal was lost",
  paid_has_amount: "Enter both the date the commission was paid and its amount",
  "Invalid login credentials": "That email and password don't match",
};

// a Supabase reply's data, or an Error in words
export async function run(query) {
  const { data, error } = await query;
  if (error) {
    const hit = Object.keys(WORDS).find((k) => error.message.includes(k));
    throw new Error(hit ? WORDS[hit] : error.message);
  }
  return data;
}

// Every row of a query, a thousand at a time: Supabase sends at most 1,000 rows per request, so a
// plain select quietly stops there. `make` builds the query afresh each time; give it a stable order.
export async function every(make) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await run(make().range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
