// npm test: every migration run in PGlite (Postgres in WebAssembly, no Docker), with small
// stand-ins for Supabase's auth and storage schemas and its roles, then a check of who can do what.
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

test("row-level security, publishing rules, the activity log and the sign-up gate", async () => {

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema auth; grant usage on schema auth to anon, authenticated;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  grant execute on function auth.jwt() to anon, authenticated;
  create schema storage; grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id serial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated;
`);
const dir = new URL("./migrations/", import.meta.url);
for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));

// run as a role, signed in as an email in a session (or not)
const SESSION = "00000000-0000-4000-8000-000000000001";
async function as(role, email, sql, params, session = SESSION) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${email ? JSON.stringify({ email, session_id: session }) : ""}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const admin = (sql, p) => as("authenticated", "Heirestates.FH@gmail.com", sql, p);
const stranger = (sql, p) => as("authenticated", "someone@else.com", sql, p);
const anon = (sql, p) => as("anon", null, sql, p);
const fails = async (fn, why) => assert.match(await fn().then(() => "no error", (e) => e.message), why);

// the second step: until this session has passed it, even a listed admin sees nothing
assert.equal((await admin("select count(*)::int n from admin_users"))[0].n, 0, "password alone isn't enough");
await db.exec(`insert into second_factor (session_id, email, verified_at) values ('${SESSION}', 'heirestates.fh@gmail.com', now())`);
assert.equal((await as("authenticated", "heirestates.fh@gmail.com", "select count(*)::int n from second_factor"))[0].n, 0, "nobody signed in reads the codes");
assert.equal((await as("authenticated", "heirestates.fh@gmail.com", "select count(*)::int n from admin_users", [], "00000000-0000-4000-8000-000000000002"))[0].n, 0, "another session must pass on its own");

// admins, and only admins
assert.equal((await admin("select count(*)::int n from admin_users"))[0].n, 1);
assert.equal((await stranger("select count(*)::int n from admin_users"))[0].n, 0);
await fails(() => stranger("insert into listings (slug, title, type) values ('x', 'X', 'lot')"), /row-level security/);
await fails(() => admin("update admin_users set active = false"), /own account/);
await admin("insert into admin_users (email, name) values ('agent@example.com', 'An Agent')");
await fails(() => admin("insert into admin_users (email, name) values ('Upper@Example.com', 'Bad')"), /check constraint/);

// listings: drafts, then the rules for publishing
const [{ id }] = await admin("insert into listings (slug, title, type, project, owner_authority) values ('corner-lot', 'Corner lot', 'lot', 'wave', true) returning id, project");
assert.equal((await admin("select project from listings where id = $1", [id]))[0].project, null, "non-project types lose their project");
await fails(() => admin("update listings set published = true where id = $1", [id]), /broker/);
await admin("insert into settings (key, value) values ('broker_name', 'A. Broker'), ('broker_prc_no', '0001234')");
await admin("update listings set published = true, published_at = '2000-01-01' where id = $1", [id]);
const live = (await admin("select published_at from listings where id = $1", [id]))[0].published_at;
assert.ok(live > new Date("2020-01-01"), "published_at is the server's, not the client's");
await fails(() => admin("update listings set slug = 'other' where id = $1", [id]), /can't change/);
await fails(() => admin("insert into listings (slug, title, type, project, published) values ('u1', 'Unit', 'project_unit', 'wave', true)"), /lts_before_publishing/);
await fails(() => admin("insert into listings (slug, title, type) values ('u2', 'Unit', 'project_unit')"), /project_unit_has_project/);
await fails(() => admin("insert into listings (slug, title, type, published) values ('r1', 'Rental', 'rental', true)"), /authority_before_publishing/);
await fails(() => admin("insert into listings (slug, title, type, price_max) values ('r2', 'Rental', 'rental', 5)"), /range_has_minimum/);
await fails(() => admin("insert into listings (slug, title, type) values ('Bad Slug', 'Bad', 'lot')"), /slug_check/);
await admin("insert into listings (slug, title, type, project, lts_no, published, status) values ('wave-12f', 'Studio 12F', 'project_unit', 'wave', 'LTS-1', true, 'available')");
await admin("insert into listings (slug, title, type, project, lts_no, published, status) values ('wave-hidden', 'Hidden', 'project_unit', 'wave', 'LTS-1', true, 'hidden')");
await admin("insert into listings (slug, title, type) values ('draft', 'Draft', 'resale')");
await admin("insert into listing_photos (listing_id, storage_key, sort) values ($1, $2, 0)", [id, `${id}/a.webp`]);
const draftId = (await admin("select id from listings where slug = 'draft'"))[0].id;
await admin("insert into listing_photos (listing_id, storage_key) values ($1, $2)", [draftId, `${draftId}/b.webp`]);

// what the public sees
assert.equal((await anon("select count(*)::int n from listings"))[0].n, 0, "anon reads no table");
assert.equal((await anon("select count(*)::int n from leads"))[0].n, 0);
const all = await anon("select slug, cover from public_listings()");
assert.deepEqual(all.map((l) => l.slug).sort(), ["corner-lot", "wave-12f"]);
assert.equal(all.find((l) => l.slug === "corner-lot").cover, `${id}/a.webp`);
assert.deepEqual((await anon("select slug from public_listings('wave')")).map((l) => l.slug), ["wave-12f"]);
const one = (await anon("select public_listing('corner-lot') j"))[0].j;
assert.equal(one.broker.prc, "0001234");
assert.equal(one.photos[0].key, `${id}/a.webp`);
assert.equal(one.listing.id, undefined, "no internal ids");
assert.equal((await anon("select public_listing('draft') j"))[0].j, null);
assert.equal((await anon("select public_listing('wave-hidden') j"))[0].j, null);
await fails(() => anon("select is_admin()"), /permission denied/);
await fails(() => anon("select before_user_created('{}')"), /permission denied/);

// photos: public only while their listing is
await db.exec(`insert into storage.objects (bucket_id, name) values ('listing-photos', '${id}/a.webp'), ('listing-photos', '${draftId}/b.webp'), ('other', 'x')`);
assert.deepEqual((await anon("select name from storage.objects")).map((o) => o.name), [`${id}/a.webp`]);
assert.equal((await admin("select count(*)::int n from storage.objects"))[0].n, 2);

// the activity log
const log = await admin("select entity, entity_id, user_email, action, changes from activity order by id");
const pub = log.find((r) => r.entity === "listings" && r.action === "update");
assert.deepEqual(pub.changes.published, [false, true]);
assert.equal(pub.user_email, "Heirestates.FH@gmail.com");
assert.ok(log.some((r) => r.entity === "settings" && r.entity_id === "broker_name"));
await fails(() => admin("delete from activity"), /permission denied/);
await fails(() => admin("update activity set action = 'x'"), /permission denied/);

// leads: who gets them, and deletion on request
const agentId = (await admin("select id from admin_users where email = 'agent@example.com'"))[0].id;
await admin("update listings set agent_id = $1 where id = $2", [agentId, id]);
await admin("insert into settings (key, value) values ('default_agent_id', '1')");
const [viaListing] = await admin("insert into leads (source_site, listing_id, name, mobile, email, consent_at) values ('main', $1, 'Juan', '0917', 'j@x.co', now()) returning id, agent_id", [id]);
assert.equal(viaListing.agent_id, agentId, "a listing's lead goes to its agent");
const [general] = await admin("insert into leads (source_site, name, mobile, email, consent_at) values ('wave', 'Ana', '0918', 'a@x.co', now()) returning id, agent_id");
assert.equal(general.agent_id, 1, "anything else goes to the default agent");
await fails(() => admin("update leads set stage = 'lost' where id = $1", [general.id]), /lost_has_reason/);
await admin("update leads set stage = 'lost', lost_reason = 'Bought elsewhere' where id = $1", [general.id]);
const lead = viaListing.id;
await admin("insert into lead_notes (lead_id, body) values ($1, 'Called, prefers the 12th floor')", [lead]);
await admin("update lead_notes set pinned = true, color = 'pink' where lead_id = $1", [lead]);
await fails(() => admin("update lead_notes set color = 'purple'"), /check constraint/);
await admin("insert into lead_files (lead_id, folder, file_path, file_name) values ($1, 'ids', $2, 'passport.pdf')", [lead, `${lead}/x-passport.pdf`]);
await fails(() => admin("insert into lead_files (lead_id, folder, file_path, file_name) values ($1, 'secret', $2, 'a.pdf')", [lead, `${lead}/y.pdf`]), /check constraint/);
assert.equal((await stranger("select count(*)::int n from lead_files"))[0].n, 0, "only admins see a client's files");

// reserved: the 30-day clock starts, papers are checked off, the follow-up picture adds up
await admin("update leads set stage = 'reserved', temperature = 'hot' where id = $1", [lead]);
assert.ok((await admin("select reserved_at from leads where id = $1", [lead]))[0].reserved_at, "reserving starts the clock");
await admin("insert into lead_checklist (lead_id, item, status) values ($1, 'ids', 'verified')", [lead]);
await fails(() => admin("insert into lead_checklist (lead_id, item, status) values ($1, 'income', 'rejected')", [lead]), /rejected_has_reason/);
await fails(() => admin("update leads set temperature = 'lukewarm' where id = $1", [lead]), /check constraint/);
await admin("insert into reminders (lead_id, due_at, body) values ($1, now() + interval '1 day', 'Collect the payslips')", [lead]);
const [ov] = await admin("select * from lead_overview where id = $1", [lead]);
assert.equal(ov.papers_verified, 1);
assert.equal(ov.next_step, "Collect the payslips");
assert.ok(ov.last_contact_at, "a note and a stage change count as contact");
assert.equal((await stranger("select count(*)::int n from lead_overview"))[0].n, 0, "the view keeps RLS");
await admin("update leads set stage = 'viewing' where id = $1", [lead]);
assert.equal((await admin("select reserved_at from leads where id = $1", [lead]))[0].reserved_at, null, "back a stage stops the clock");
// a lead that started on WhatsApp: no email, no website consent
await admin("insert into leads (source_site, name, mobile) values ('whatsapp', 'Ana', '+639181112222')");
await admin("insert into reminders (lead_id, due_at, body) values ($1, now(), 'Call Juan back')", [lead]);
await admin("update leads set stage = 'contacted' where id = $1", [lead]);
assert.ok((await admin("select count(*)::int n from activity where lead_id = $1", [lead]))[0].n >= 4);
await fails(() => anon("select delete_lead($1)", [lead]), /permission denied/);
// WhatsApp: a chat finds its lead by mobile; only the Worker writes messages; deletion takes the chat
await admin("update leads set mobile = '0917 123 4567' where id = $1", [lead]);
await db.exec("reset role");
const [{ id: chatId, lead_id: chatLead }] = (await db.query("insert into wa_threads (wa_id, name) values ('639171234567', 'Juan') returning id, lead_id")).rows;
assert.equal(chatLead, lead, "0917… on the form is 63917… on WhatsApp");
await db.query("insert into wa_messages (thread_id, direction, body) values ($1, 'in', 'Hi')", [chatId]);
assert.equal((await admin("select count(*)::int n from wa_messages"))[0].n, 1);
assert.equal((await stranger("select count(*)::int n from wa_messages"))[0].n, 0);
assert.equal((await stranger("select count(*)::int n from wa_threads"))[0].n, 0);
await fails(() => admin("insert into wa_messages (thread_id, direction, body) values ($1, 'out', 'forged')", [chatId]), /permission denied/);
await fails(() => admin("update wa_messages set body = 'x'"), /permission denied/);
await fails(() => admin("update wa_threads set wa_id = '639999999999'"), /permission denied/);
await admin("update wa_threads set unread = 0, lead_id = $1 where id = $2", [lead, chatId]);
await admin("select delete_lead($1)", [lead]);
assert.equal((await admin("select count(*)::int n from leads where id = $1", [lead]))[0].n, 0);
assert.equal((await admin("select count(*)::int n from lead_notes"))[0].n, 0, "its notes go with it");
assert.equal((await admin("select count(*)::int n from lead_files"))[0].n, 0, "and its files' rows");
assert.equal((await admin("select count(*)::int n from wa_messages"))[0].n, 0, "and its WhatsApp chat");
assert.equal((await admin("select count(*)::int n from activity where lead_id = $1", [lead]))[0].n, 0, "and its history");
const left = await admin("select action, changes, lead_id from activity where entity = 'leads' and entity_id = $1", [String(lead)]);
assert.deepEqual(left, [{ action: "deleted on request", changes: null, lead_id: null }]);
assert.ok(!JSON.stringify(await admin("select * from activity")).includes("Juan"), "no trace of their name");

// the commission log: a sale, then the commission paid on it
await admin("insert into commissions (sale_date, project, unit_code, via_sites, payment_mode) values ('2026-11-02', 'wave', 'T1-12F-05', true, 'bank_financing')");
await fails(() => admin("insert into commissions (sale_date, project, unit_code, via_sites, payment_mode, received_on) values ('2026-11-02', 'wave', 'T1-12F-06', true, 'full_cash', '2026-11-20')"), /paid_has_amount/);
await admin("update commissions set received_on = '2026-11-20', gross = 120000, release = 'partial' where unit_code = 'T1-12F-05'");
assert.equal((await stranger("select count(*)::int n from commissions"))[0].n, 0);

// sign-up gate
await db.exec("reset role");
const gate = async (email) => (await db.query("select before_user_created($1) r", [{ user: { email } }])).rows[0].r;
assert.deepEqual(await gate("AGENT@example.com"), {});
assert.equal((await gate("nobody@example.com")).error.http_code, 403);

// the broker's licence validity reaches the public pages
await admin("insert into settings (key, value) values ('broker_prc_valid_until', '2028-03-31')");
assert.equal((await anon("select public_listing('corner-lot') j"))[0].j.broker.valid_until, "2028-03-31");

});
