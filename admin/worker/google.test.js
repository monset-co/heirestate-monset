import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, unsign, fields, manilaDays } from "./google.js";

test("OAuth state: signed, expiring, tamper-proof", async () => {
  const s = await sign("k", "agent@example.com", 0);
  assert.equal(await unsign("k", s, 1000), "agent@example.com");
  assert.equal(await unsign("k", s, 11 * 60e3), null, "expired");
  assert.equal(await unsign("other", s, 1000), null, "wrong key");
  const [, exp, sig] = s.split(".");
  assert.equal(await unsign("k", `${btoa("evil@example.com")}.${exp}.${sig}`, 1000), null, "swapped email");
  assert.equal(await unsign("k", "junk", 1000), null);
});

test("a window of Manila days, at most 100", () => {
  assert.deepEqual(manilaDays("2026-11-01", "2026-11-30"), { timeMin: "2026-10-31T16:00:00.000Z", timeMax: "2026-11-30T16:00:00.000Z" });
  assert.equal(manilaDays("2026-11-01", "2027-06-01"), null);
  assert.equal(manilaDays("2026-11-30", "2026-11-01"), null);
  assert.equal(manilaDays("nov", "dec"), null);
});

test("a booking's fields, as Google keeps them", () => {
  const t = fields({ title: " Viewing ", start: "2026-11-20T14:00", end: "2026-11-20T15:30", guests: "A@x.co, b@y.co a@x.co", color: "5" });
  assert.deepEqual(t.event.start, { dateTime: "2026-11-20T14:00:00", timeZone: "Asia/Manila", date: null });
  assert.equal(t.event.summary, "Viewing");
  assert.deepEqual(t.guests, ["a@x.co", "b@y.co"]);
  assert.equal(t.event.colorId, "5");
  const d = fields({ title: "Open house", allDay: true, start: "2026-12-31", end: "2026-12-31" });
  assert.deepEqual(d.event.end, { date: "2027-01-01", dateTime: null, timeZone: null }, "Google's end day is the day after");
  assert.ok(fields({ title: "x", start: "2026-11-20T14:00", end: "2026-11-20T14:00" }).error, "ends when it starts");
  assert.ok(fields({ title: "x", allDay: true, start: "2026-11-21", end: "2026-11-20" }).error);
  assert.ok(fields({ title: "", start: "2026-11-20T14:00", end: "2026-11-20T15:00" }).error);
  assert.ok(fields({ title: "x", start: "2026-11-20T14:00", end: "2026-11-20T15:00", guests: ["nope"] }).error);
  assert.equal(fields({ title: "x", start: "2026-11-20T14:00", end: "2026-11-20T15:00", color: "12" }).event.colorId, null);
  const base = { title: "x", start: "2026-11-20T14:00", end: "2026-11-20T15:00" };
  assert.deepEqual(fields(base).event.reminders, { useDefault: true });
  assert.deepEqual(fields({ ...base, reminders: [{ method: "email", minutes: 1440 }] }).event.reminders, { useDefault: false, overrides: [{ method: "email", minutes: 1440 }] });
  assert.deepEqual(fields({ ...base, reminders: [] }).event.reminders, { useDefault: false, overrides: [] }, "none at all");
  assert.ok(fields({ ...base, reminders: [{ method: "sms", minutes: 10 }] }).error);
});
