import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, unsign, addMinutes, manilaDays } from "./google.js";

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

test("end time is wall-clock, across midnight", () => {
  assert.equal(addMinutes("2026-11-20T14:00", 90), "2026-11-20T15:30:00");
  assert.equal(addMinutes("2026-12-31T23:30", 60), "2027-01-01T00:30:00");
  assert.equal(addMinutes("nope", 60), null);
});
