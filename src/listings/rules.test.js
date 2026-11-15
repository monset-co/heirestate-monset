// npm test: what a listing needs before it can be saved, and before it can go public.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shape, check, slugify } from "./rules.js";

const PROJECTS = ["alto", "wave", "pristina"];

const broker = { broker_name: "A. Broker", broker_prc_no: "0001234" };

test("addresses come from titles", () => {
  assert.equal(slugify("Studio 12F, Tower 1 — Ñ"), "studio-12f-tower-1-n");
  assert.equal(shape({ title: "Corner Lot, Talamban", type: "lot" }).slug, "corner-lot-talamban");
});

test("a draft saves with little", () => {
  assert.equal(check(shape({ title: "Two-bedroom", type: "resale" }), null, {}, PROJECTS), "");
  // non-project types drop any project; a single price is stored as a minimum
  const l = shape({ title: "Lot", type: "lot", project: "wave", price_min: "1500000", price_max: "1500000" });
  assert.equal(l.project, null);
  assert.equal(l.price_max, null);
});

test("what stops a save", () => {
  const no = (b, before, why) => assert.match(check(shape(b, before ?? {}), before, broker, PROJECTS), why);
  no({ title: "X" , type: "resale" }, null, /title/);
  no({ title: "Unit", type: "condo" }, null, /type/);
  no({ title: "Unit", type: "project_unit" }, null, /needs its project/);
  no({ title: "Unit", type: "rfo_unit", project: "nowhere" }, null, /project from the list/);
  no({ title: "Unit", type: "resale", price_min: "abc" }, null, /numbers/);
  no({ title: "Unit", type: "resale", price_max: "5" }, null, /lowest price/);
  no({ title: "Unit", type: "resale", price_min: "9", price_max: "5" }, null, /below/);
  no({ title: "Unit", type: "resale", slug: "Bad Slug" }, null, /lowercase/);
  const live = { title: "Unit", slug: "unit", type: "resale", owner_authority: true, published: true, published_at: "2026-11-01T00:00:00Z" };
  no({ slug: "unit-2" }, live, /can't change/);
});

test("what publishing needs", () => {
  const pub = (b, s = broker) => check(shape({ title: "Unit", published: true, ...b }), null, s, PROJECTS);
  assert.match(pub({ type: "project_unit", project: "wave" }), /License to Sell/);
  assert.match(pub({ type: "rfo_unit" }), /License to Sell/);
  assert.match(pub({ type: "rental" }), /owner's authority/);
  assert.match(pub({ type: "rental", owner_authority: true }, {}), /broker/);
  assert.equal(pub({ type: "project_unit", project: "wave", lts_no: "LTS-123" }), "");
  assert.equal(pub({ type: "lot", owner_authority: true }), "");
});
