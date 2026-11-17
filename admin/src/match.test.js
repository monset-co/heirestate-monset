import { test } from "node:test";
import assert from "node:assert/strict";
import { fit, matches, tidyMobile, pesos } from "./match.js";

const p = (o) => ({ status: ["For Rent"], type: "", location: "", furnishing: null, price: null, available: true, available_from: null, ...o });

test("a 3BR house to rent in Guadalupe under ₱60,000", () => {
  const lead = { looking_to: ["Rent"], property_types: ["House & Lot", "3BR+"], areas: ["Guadalupe"], budget_max: 60000, furnishings: ["Fully furnished"] };
  const best = p({ type: "House & Lot, 2-Storey H&L, 3BR", location: "Guadalupe, Cebu City", price: 55000, furnishing: "Fully furnished" });
  const condo = p({ type: "2BR Condo", location: "Lahug, Cebu City", price: 40000 });
  const sale = p({ status: ["For Sale"], type: "House & Lot, 3BR", location: "Guadalupe", price: 5e6 });
  const gone = p({ status: ["Rented"], type: "House & Lot, 3BR", location: "Guadalupe", price: 50000 });
  const f = fit(lead, best, "2026-11-17");
  assert.deepEqual([f.kind, f.size, f.area, f.budget, f.furnishing, f.ok], [true, true, true, true, true, true]);
  assert.deepEqual([fit(lead, condo).kind, fit(lead, condo).size], [false, false]);
  assert.equal(fit(lead, sale).ok, false, "for sale isn't for rent");
  assert.equal(fit(lead, gone).ok, false, "rented and no date it frees up");
  assert.equal(fit(lead, { ...gone, available_from: "2026-12-01" }, "2026-11-17").ok, true, "rented now, free soon");
  assert.deepEqual(matches(lead, [condo, best]).map((x) => x.p), [best, condo]);
});

test("priorities come first, and can be the only ones", () => {
  const lead = { looking_to: ["Rent"], areas: ["Lahug"], budget_max: 30000, priorities: ["area"] };
  const cheapFar = p({ location: "Talisay", price: 20000 });
  const pricyNear = p({ location: "Lahug, Cebu City", price: 45000 });
  assert.deepEqual(matches(lead, [cheapFar, pricyNear]).map((x) => x.p), [pricyNear, cheapFar], "where beats budget");
  assert.deepEqual(matches({ ...lead, priorities: [] }, [pricyNear, cheapFar]).map((x) => x.p), [cheapFar, pricyNear], "without it, budget counts the same");
  assert.deepEqual(matches(lead, [cheapFar, pricyNear], 12, true).map((x) => x.p), [pricyNear]);
});

test("lots aren't houses and lots", () => {
  const lead = { property_types: ["Lot"] };
  assert.equal(fit(lead, p({ type: "Lot" })).kind, true);
  assert.equal(fit(lead, p({ type: "Corner Lot, Subdivision" })).kind, true);
  assert.equal(fit(lead, p({ type: "House & Lot, 3BR" })).kind, false);
});

test("needed by a date", () => {
  const lead = { needed_by: "2027-02-01" };
  assert.equal(fit(lead, p({ available_from: "2027-01-15" })).when, true);
  assert.equal(fit(lead, p({ available_from: "2027-03-01" })).when, false);
});

test("mobiles", () => {
  assert.equal(tidyMobile("0917 123 4567"), "+63 917 123 4567");
  assert.equal(tidyMobile("9171234567"), "+63 917 123 4567");
  assert.equal(tidyMobile("+63 (917) 123-4567"), "+63 917 123 4567");
  assert.equal(tidyMobile("639171234567"), "+63 917 123 4567");
  assert.equal(tidyMobile("(+1)7023717935"), "+17023717935");
  assert.equal(tidyMobile("12345"), null);
  assert.equal(tidyMobile(""), null);
});

test("pesos", () => {
  assert.equal(pesos("₱45,000"), 45000);
  assert.equal(pesos("120k"), 120000);
  assert.equal(pesos("1.5M"), 1500000);
  assert.equal(pesos("about 5"), null);
});
