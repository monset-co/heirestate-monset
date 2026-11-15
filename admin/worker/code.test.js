// npm test: the emailed sign-in code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newCode, hash, check, canSend, TTL, TRIES } from "./code.js";

const S = "00000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-11-15T10:00:00Z");
const row = async (code, extra = {}) => ({ code_hash: await hash(S, code), expires_at: new Date(now + TTL).toISOString(), attempts: 0, ...extra });

test("codes are six digits", () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^\d{6}$/);
});

test("the right code, in time, in the same session", async () => {
  assert.equal(await check(await row("042517"), S, "042517", now), "ok");
  assert.equal(await check(await row("042517"), S, " 042517 ", now), "ok");
});

test("everything else", async () => {
  assert.equal(await check(await row("042517"), S, "042518", now), "wrong");
  assert.equal(await check(await row("042517"), "00000000-0000-4000-8000-000000000002", "042517", now), "wrong", "another session's code");
  assert.equal(await check(await row("042517"), S, "042517", now + TTL + 1), "expired");
  assert.equal(await check(await row("042517", { attempts: TRIES }), S, "042517", now), "locked");
  assert.equal(await check({ code_hash: null }, S, "042517", now), "expired", "a used code");
  assert.equal(await check(undefined, S, "042517", now), "expired", "never sent");
  assert.equal(await check(await row("042517"), S, "4251", now), "wrong");
});

test("one code a minute", () => {
  assert.equal(canSend(undefined, now), true);
  assert.equal(canSend({ sent_at: new Date(now - 30e3).toISOString() }, now), false);
  assert.equal(canSend({ sent_at: new Date(now - 61e3).toISOString() }, now), true);
});
