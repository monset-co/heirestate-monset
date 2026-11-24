// The knowledge base (supabase/migrations/20261206000000_knowledge.sql): real estate know-how Mons
// looks up by meaning, so a question pulls in the two or three passages it needs instead of the
// whole of it riding on every prompt. Passages are written in knowledge/*.md and loaded by
// scripts/load-knowledge.js without embeddings; the cron embeds them here.
import { db } from "./supabase.js";
import { embed } from "./memory.js";

// whose know-how this admin may read: the shared base and its own
export const SCOPES = ["shared", "heirestates"];

// the cron's part: embed passages that are new or were rewritten (the loader clears them)
export async function embedPending(env) {
  if (!env.AI) return;
  const s = db(env);
  for (let run = 0; run < 4; run++) {
    const rows = await s.get("knowledge_chunks?select=id,heading,body&embedding=is.null&order=id&limit=50");
    if (!rows.length) return;
    const vectors = await embed(env, rows.map((r) => `${r.heading}\n${r.body}`));
    await Promise.all(rows.map((r, i) => s.update(`knowledge_chunks?id=eq.${r.id}`, { embedding: vectors[i] })));
  }
}

// her search: the closest passages, with where they come from and how far to trust them
export async function search(env, u, question, k = 4) {
  if (!env.AI) return { error: "The knowledge base isn't switched on yet (the AI binding)" };
  const [query] = await embed(env, [String(question ?? "").slice(0, 500)]);
  const rows = await u.call("rpc/match_knowledge", { method: "POST", body: JSON.stringify({ query, scopes: SCOPES, k: Number(k) || 4 }) });
  if (!rows.length) return { found: [], note: "Nothing in the knowledge base on that yet." };
  return {
    found: rows.map((r) => ({
      heading: r.heading,
      text: r.body,
      step: r.step,
      from: `${r.title}${r.source ? ` (${r.source})` : ""}`,
      ...(r.source_url && { link: r.source_url }),
      checked: r.valid_as_of,
      reviewed: r.status === "reviewed",
      match: Math.round(r.similarity * 100) / 100,
      ...(r.related.length && { leads_on_to: r.related }),
    })),
  };
}
