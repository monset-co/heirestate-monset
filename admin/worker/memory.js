// Mons's memory: lead notes, WhatsApp messages and what leads first wrote, indexed by meaning
// (Workers AI embeddings in a Vectorize index), so "who mentioned pets?" finds "may aso kami" too.
// The 15-minute cron indexes what's new since last time (mons_index_state keeps the place); a
// search looks up the matching rows fresh, as the person asking, so a deleted note or a row they
// can't see never comes back. Set up once:
//   npx wrangler vectorize create heirestates-mons --dimensions=1024 --metric=cosine
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
};
// how a hit is read back for her (as the asker), by id
const READ = {
  note: (ids) => `lead_notes?select=id,lead_id,body,author_email,created_at,leads(name)&id=in.(${ids})`,
  wa: (ids) => `wa_messages?select=id,body,direction,created_at,wa_threads(lead_id,name,leads(name))&id=in.(${ids})`,
  lead: (ids) => `leads?select=id,name,interest,message,created_at&id=in.(${ids})`,
};
const shape = {
  note: (r) => ({ what: "note on a lead", lead_id: r.lead_id, lead: r.leads?.name, by: r.author_email, text: r.body }),
  wa: (r) => ({ what: r.direction === "in" ? "WhatsApp from the client" : "WhatsApp to the client", lead_id: r.wa_threads?.lead_id, lead: r.wa_threads?.leads?.name ?? r.wa_threads?.name, text: r.body }),
  lead: (r) => ({ what: "what the lead first wrote", lead_id: r.id, lead: r.name, text: [r.interest, r.message].filter(Boolean).join(". ") }),
};

const embed = async (env, texts) => (await env.AI.run(MODEL, { text: texts.map((t) => String(t).slice(0, 2000)) })).data;

// the cron's part: index what's new
export async function index(env) {
  if (!env.AI || !env.MEMORY) return;
  const s = db(env);
  const marks = Object.fromEntries((await s.get("mons_index_state?select=kind,last_id")).map((m) => [m.kind, m.last_id]));
  for (const [kind, k] of Object.entries(KINDS)) {
    let after = marks[kind] ?? 0;
    for (let run = 0; run < RUNS; run++) {
      const rows = (await s.get(`${k.path(after)}&order=id&limit=${BATCH}`)).filter((r) => k.text(r).trim());
      if (!rows.length) break;
      const vectors = await embed(env, rows.map(k.text));
      await env.MEMORY.upsert(rows.map((r, i) => ({ id: `${kind}:${r.id}`, values: vectors[i], metadata: { kind } })));
      after = rows.at(-1).id;
      await s.upsert("mons_index_state", { kind, last_id: after });
      if (rows.length < BATCH) break;
    }
  }
}

// her search: the closest matches, read fresh as the person asking
export async function recall(env, u, question, limit = 10) {
  if (!env.AI || !env.MEMORY) return { error: "Search by meaning isn't set up yet (the AI and MEMORY bindings)" };
  const [vector] = await embed(env, [question]);
  const { matches } = await env.MEMORY.query(vector, { topK: Math.min(Math.max(Number(limit) || 10, 1), 20) });
  const byKind = {};
  for (const m of matches) {
    const [kind, id] = m.id.split(":");
    if (READ[kind]) (byKind[kind] ??= []).push(Number(id));
  }
  const rows = {};
  await Promise.all(
    Object.entries(byKind).map(async ([kind, ids]) => {
      for (const r of await u.get(READ[kind](ids.join(",")))) rows[`${kind}:${r.id}`] = { ...shape[kind](r), at: r.created_at };
    })
  );
  // best first; a row that's gone or that they can't see drops out
  return matches.filter((m) => rows[m.id]).map((m) => ({ ...rows[m.id], match: Math.round(m.score * 100) / 100 }));
}
