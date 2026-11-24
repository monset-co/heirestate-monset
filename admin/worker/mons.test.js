// npm test: Mons's searches stay inside their filters, and what she sends is checked before it
// reaches a card or the database (mons.js term, clean)
import { test } from "node:test";
import assert from "node:assert/strict";
import { actions, term } from "./mons.js";

test("term keeps a search inside its PostgREST filter", () => {
  assert.equal(term("Ana Cruz"), "Ana Cruz");
  assert.equal(term("x),stage.eq.lost,(name.ilike.*"), "x  stage.eq.lost  name.ilike.");
  assert.equal(term(null), "");
  assert.equal(term("a".repeat(200)).length, 80);
});

// a database that records writes and returns what it was given
function fake() {
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = decodeURIComponent(String(url).split("/rest/v1/")[1] ?? "");
    if (init.method === "POST" || init.method === "PATCH") {
      writes.push({ path, body: JSON.parse(init.body) });
      return Response.json([{ id: 9, ...JSON.parse(init.body) }]);
    }
    if (path.startsWith("inventory?select=id,type")) return Response.json([{ id: 7, type: "Studio", building: "Avida" }]);
    if (path.startsWith("leads?select=id,name,agent_id,stage")) return Response.json([{ id: 3, name: "Ana", agent_id: 1, stage: "new" }]);
    return Response.json([]);
  };
  return { writes, act: actions({ SUPABASE_URL: "x", SUPABASE_PUBLISHABLE_KEY: "k" }, "t", { email: "a@b", admin: { name: "A" } }, []) };
}
const refused = (p, why) => p.then(() => assert.fail("not refused"), (e) => assert.match(e.message, why));

test("prices are whole pesos: ₱ and commas are fine, '5.5M' and negatives are refused", async () => {
  const { writes, act } = fake();
  await act.update_inventory({ id: 7, changes: { price: "₱5,500,000" } });
  assert.equal(writes[0].body.price, 5500000);
  await refused(act.update_inventory({ id: 7, changes: { price: "5.5M" } }), /whole number of pesos/);
});

test("dates must be real, links full, choices from the list", async () => {
  const { act } = fake();
  await refused(act.update_inventory({ id: 7, changes: { available_from: "2026-02-30" } }), /date like/);
  await refused(act.update_inventory({ id: 7, changes: { source_url: "rent.ph/x" } }), /https:\/\//);
  await refused(act.update_inventory({ id: 7, changes: { status: ["Leased"] } }), /isn't a status choice/);
  await refused(act.update_lead({ lead_id: 3, changes: { category: "luxury" } }), /isn't a category choice/);
});

test("a single value where a list goes becomes a list", async () => {
  const { writes, act } = fake();
  await act.add_lead({ name: "Ben Cruz", looking_to: "Rent", areas: "IT Park" });
  const lead = writes.find((w) => w.path === "leads").body;
  assert.deepEqual([lead.looking_to, lead.areas, lead.category], [["Rent"], ["IT Park"], "rentals"]);
});

test("one bad listing in a batch is reported; the rest still go in", async () => {
  const { writes, act } = fake();
  const out = await act.add_inventory({ items: [{ type: "2BR", building: "Sherlyn Royale", price: 35000 }, { type: "Studio", price: "cheap" }] });
  assert.equal(writes.filter((w) => w.path === "inventory").length, 1);
  assert.match(out.at(-1).text, /Not added: Studio: The price should be a whole number/);
});

test("an id that isn't a number is asked about, not sent to the database", async () => {
  const { act } = fake();
  await refused(act.add_note({ lead_id: "Ana", text: "hi" }), /Which lead\?/);
  await refused(act.update_inventory({ id: "the studio", changes: { price: 1 } }), /Which property\?/);
});
