// Mons's memory: lead notes, WhatsApp messages, what leads first wrote, and the team chat once it
// has scrolled past what she re-reads each time, indexed by meaning (Workers AI embeddings in
// pgvector, supabase/migrations/20261207000000_mons_memory_pgvector.sql), so "who mentioned pets?"
// finds "may aso kami" too. The 15-minute cron indexes what's new since last time
// (mons_index_state keeps the place); a search reads the matching rows fresh, as the person asking,
// so a deleted note or a row they can't see never comes back.
// ponytail: an edited note keeps its first wording in the index; re-index on edit if that matters.
import { db } from "./supabase.js";

const MODEL = "@cf/baai/bge-m3"; // multilingual, 1024 dimensions
const BATCH = 50;
const RUNS = 4; // batches per kind per cron run: a backlog catches up over a few runs

// what gets indexed: where to read new rows (with the secret key), and the words to embed
const KINDS = {
  note: { path: (after) => `lead_notes?select=id,body&id=gt.${after}`, text: (r) => r.body },
  wa: { path: (after) => `wa_messages?select=id,body&body=not.is.null&id=gt.${after}`, text: (r) => r.body },
  lead: { path: (after) => `leads?select=id,interest,message&or=(interest.not.is.null,message.not.is.null)&id=gt.${after}`, text: (r) => [r.interest, r.message].filter(Boolean).join(". ") },
  chat: { path: (after) => `mons_messages?select=id,body,from_mons,author&id=gt.${after}`, text: (r) => `${r.from_mons ? "Mons" : r.author}: ${r.body}` },
};
// how a hit is read back for her (as the asker), by id
const READ = {
  note: (ids) => `lead_notes?select=id,lead_id,body,author_email,created_at,leads(name)&id=in.(${ids})`,
  wa: (ids) => `wa_messages?select=id,body,direction,created_at,wa_threads(lead_id,name,leads(name))&id=in.(${ids})`,
  lead: (ids) => `leads?select=id,name,interest,message,created_at&id=in.(${ids})`,
  chat: (ids) => `mons_messages?select=id,body,from_mons,author,created_at&id=in.(${ids})`,
};
const shape = {
  note: (r) => ({ what: "note on a lead", lead_id: r.lead_id, lead: r.leads?.name, by: r.author_email, text: r.body }),
  wa: (r) => ({ what: r.direction === "in" ? "WhatsApp from the client" : "WhatsApp to the client", lead_id: r.wa_threads?.lead_id, lead: r.wa_threads?.leads?.name ?? r.wa_threads?.name, text: r.body }),
  lead: (r) => ({ what: "what the lead first wrote", lead_id: r.id, lead: r.name, text: [r.interest, r.message].filter(Boolean).join(". ") }),
  chat: (r) => ({ what: "earlier in this team chat", by: r.from_mons ? "Mons" : r.author, text: r.body.slice(0, 1500) }),
};

export const embed = async (env, texts) => (await env.AI.run(MODEL, { text: texts.map((t) => String(t).slice(0, 2000)) })).data;

// the cron's part: index what's new
export async function index(env) {
  if (!env.AI) return;
  const s = db(env);
  const marks = Object.fromEntries((await s.get("mons_index_state?select=kind,last_id")).map((m) => [m.kind, m.last_id]));
  // one kind failing (an embed or a write) doesn't stop the others
  for (const [kind, k] of Object.entries(KINDS)) await indexKind(s, env, kind, k, marks[kind] ?? 0).catch((e) => console.error("mons memory", kind, e));
}

async function indexKind(s, env, kind, k, after) {
  for (let run = 0; run < RUNS; run++) {
    const all = await s.get(`${k.path(after)}&order=id&limit=${BATCH}`);
    if (!all.length) return;
    const rows = all.filter((r) => k.text(r).trim());
    if (rows.length) {
      const vectors = await embed(env, rows.map(k.text));
      await s.upsert("mons_memory", rows.map((r, i) => ({ kind, ref_id: r.id, embedding: vectors[i] })));
    }
    after = all.at(-1).id;
    await s.upsert("mons_index_state", { kind, last_id: after });
    if (all.length < BATCH) return;
  }
}

// her search: the closest matches, read fresh as the person asking
export async function recall(env, u, question, limit = 10) {
  if (!env.AI) return { error: "Search by meaning isn't switched on yet (the AI binding)" };
  const [query] = await embed(env, [question]);
  const matches = await u.call("rpc/match_memory", { method: "POST", body: JSON.stringify({ query, k: Number(limit) || 10 }) });
  const byKind = {};
  for (const m of matches) if (READ[m.kind]) (byKind[m.kind] ??= []).push(m.ref_id);
  const rows = {};
  await Promise.all(
    Object.entries(byKind).map(async ([kind, ids]) => {
      for (const r of await u.get(READ[kind](ids.join(",")))) rows[`${kind}:${r.id}`] = { ...shape[kind](r), at: r.created_at };
    })
  );
  // best first; a row that's gone or that they can't see drops out
  return matches.filter((m) => rows[`${m.kind}:${m.ref_id}`]).map((m) => ({ ...rows[`${m.kind}:${m.ref_id}`], match: Math.round(m.similarity * 100) / 100 }));
}
