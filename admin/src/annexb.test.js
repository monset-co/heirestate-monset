// npm test: which commission-log rows go in a month's Annex B report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { annexB } from "./annexb.js";

const rows = [
  { id: 1, sale_date: "2026-10-28", received_on: "2026-11-20", gross: 120000, cancelled: false }, // sold before, paid this month
  { id: 2, sale_date: "2026-11-03", received_on: null, gross: null, cancelled: false }, // sold this month, not paid yet
  { id: 3, sale_date: "2026-11-10", received_on: "2026-12-02", gross: 90000, cancelled: false }, // sold this month, paid next
  { id: 4, sale_date: "2026-11-12", received_on: null, gross: null, cancelled: true }, // cancelled: never counts
  { id: 5, sale_date: "2026-09-01", received_on: "2026-10-15", gross: 50000, cancelled: false }, // nothing to do with November
];

test("November: its sales and the commission received in it", () => {
  const nov = annexB(rows, "2026-11");
  assert.deepEqual(nov.map((r) => [r.id, r.paid]), [[1, true], [2, false], [3, false]]);
});

test("a month with nothing", () => {
  assert.deepEqual(annexB(rows, "2026-08"), []);
});
