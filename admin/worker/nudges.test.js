// npm test: Mons's own reminders and suggestions fire on the rows they should, and only those (nudges.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { nudges } from "./nudges.js";

const now = Date.parse("2026-11-26T03:00:00Z");
const ago = (days) => new Date(now - days * 864e5).toISOString();
const agent = { email: "ana@heir.ph", active: true };
const base = { stage: "contacted", temperature: null, reserved_at: null, agent, looking_to: [], priorities: [] };

test("each rule fires once on its row, and not on the rows beside it", () => {
  const leads = [
    { ...base, id: 1, name: "Hot quiet", temperature: "hot" },
    { ...base, id: 2, name: "Hot but followed", temperature: "hot" },
    { ...base, id: 3, name: "Hot, talked yesterday", temperature: "hot" },
    { ...base, id: 4, name: "Reserved late", stage: "reserved", reserved_at: ago(25) },
    { ...base, id: 5, name: "Reserved early", stage: "reserved", reserved_at: ago(5) },
    { ...base, id: 6, name: "Gone agent", temperature: "hot", agent: { email: "x@heir.ph", active: false } },
  ];
  const overview = [
    { id: 1, last_contact_at: ago(4), next_step_at: null, papers_verified: 0 },
    { id: 2, last_contact_at: ago(4), next_step_at: ago(-1), papers_verified: 0 },
    { id: 3, last_contact_at: ago(1), next_step_at: null, papers_verified: 0 },
    { id: 4, last_contact_at: ago(1), next_step_at: null, papers_verified: 2 },
    { id: 5, last_contact_at: ago(1), next_step_at: null, papers_verified: 0 },
    { id: 6, last_contact_at: ago(9), next_step_at: null, papers_verified: 0 },
  ];
  const reminders = [{ id: 9, body: "Call back", due_at: ago(2), lead_id: 3, agent: null, lead: { name: "Hot, talked yesterday", agent } }];
  const out = nudges({ leads, overview, reminders, fresh: [] }, now);
  assert.deepEqual(
    out.map((n) => n.key),
    [`cold:1:${ago(4).slice(0, 10)}`, `papers:4:${ago(25).slice(0, 10)}`, "overdue:9"]
  );
  assert.ok(out.every((n) => n.to === "ana@heir.ph"));
  assert.match(out[1].text, /5 days left .* 2 of 4 papers/);
  assert.match(out[0].text, /\[Hot quiet\]\(\/leads\/1\)/);
});

test("a new property that fits a lead's wishes is suggested to its agent", () => {
  const leads = [{ ...base, id: 7, name: "Renter", looking_to: ["Rent"], property_types: [], areas: [], buildings: [], near: null, furnishings: [], budget_max: null }];
  const fresh = [
    { id: 30, status: ["For Rent"], type: "Condo, 2BR", building: "Avida Riala", location: "IT Park", available: true },
    { id: 31, status: ["For Sale"], type: "Condo, 2BR", building: "Avida Riala", location: "IT Park", available: true },
  ];
  const out = nudges({ leads, overview: [{ id: 7, last_contact_at: ago(1) }], reminders: [], fresh }, now);
  assert.deepEqual(out.map((n) => n.key), ["match:7:30"]);
});
