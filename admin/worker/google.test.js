import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, unsign, fields, manilaDays, dueReminders } from "./google.js";

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

test("a booking's notification reminders, each due in one 15-minute window", () => {
  const at = Date.parse("2026-11-20T10:00:00+08:00");
  const ev = (start, reminders) => ({ id: start, start: { dateTime: start }, reminders });
  const items = [
    ev("2026-11-20T10:30:00+08:00", { useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "email", minutes: 30 }] }),
    ev("2026-11-20T10:40:00+08:00", { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] }), // due at 10:10, next window
    ev("2026-11-20T10:50:00+08:00", { useDefault: true }), // the calendar's default: 60 → 9:50, in this window
    { ...ev("2026-11-20T10:30:00+08:00", { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] }), status: "cancelled" },
    { id: "allday", start: { date: "2026-11-21" }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 840 }] } }, // 10:00 the day before
  ];
  const due = dueReminders(items, [{ method: "popup", minutes: 60 }], at - 15 * 60e3, at);
  assert.deepEqual(due.map((d) => [d.event.id, d.minutes]), [["2026-11-20T10:30:00+08:00", 30], ["2026-11-20T10:50:00+08:00", 60], ["allday", 840]]);
  assert.equal(dueReminders(items, [], at, at + 15 * 60e3).length, 1, "the next window has the 10:40 one only");
  const allDayDefault = [{ id: "d", start: { date: "2026-11-21" }, reminders: { useDefault: true } }];
  assert.equal(dueReminders(allDayDefault, [{ method: "popup", minutes: 30 }], Date.parse("2026-11-20T23:15:00+08:00"), Date.parse("2026-11-20T23:30:00+08:00")).length, 0, "no 11:30 PM push for an all-day booking");
});
