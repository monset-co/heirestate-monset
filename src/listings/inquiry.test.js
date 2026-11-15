// npm test: what the inquiry endpoint accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./inquiry.js";

const good = { intent: "viewing", unit: "Studio", date: "2026-12-01", name: " Juan Dela Cruz ", phone: "+63 917 123 4567", email: "Juan@Example.com", message: "", consent: true, listing: "wave-12f" };

test("a complete form becomes a lead", () => {
  const { lead, listing, error } = validate(good);
  assert.equal(error, undefined);
  assert.equal(listing, "wave-12f");
  assert.deepEqual(lead, { name: "Juan Dela Cruz", mobile: "+63 917 123 4567", email: "juan@example.com", interest: "Book a viewing: Studio", budget: null, viewing_time: "2026-12-01", message: null });
});

test("a viewing date only for viewings; unknown fields are dropped", () => {
  const { lead } = validate({ ...good, intent: "prices", tin: "123-456-789", id_number: "X" });
  assert.equal(lead.viewing_time, null);
  assert.equal(lead.interest, "Price list: Studio");
  assert.ok(!("tin" in lead) && !("id_number" in lead));
});

test("what it refuses", () => {
  assert.match(validate(null).error, /again/);
  assert.match(validate({ ...good, name: "J" }).error, /name/);
  assert.match(validate({ ...good, phone: "12345" }).error, /mobile/);
  assert.match(validate({ ...good, email: "juan@" }).error, /email/);
  assert.match(validate({ ...good, consent: "yes" }).error, /consent/);
  assert.equal(validate({ ...good, listing: "../../etc" }).listing, null);
});
