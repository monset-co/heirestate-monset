import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signed, parse, canReply } from "./whatsapp.js";

test("Meta's signature: right secret and body only", async () => {
  const body = '{"entry":[]}';
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(await signed("s3cret", body, sig), true);
  assert.equal(await signed("other", body, sig), false);
  assert.equal(await signed("s3cret", body + " ", sig), false);
  assert.equal(await signed("s3cret", body, null), false);
  assert.equal(await signed("s3cret", body, "sha256=zz"), false);
});

test("a webhook flattened into messages and statuses", () => {
  const { messages, statuses } = parse({
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: "639171234567", profile: { name: "Ana" } }],
      messages: [
        { from: "639171234567", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Is 12F still available?" } },
        { from: "639171234567", id: "wamid.2", timestamp: "1700000060", type: "image", image: { id: "m1", caption: "This view" } },
        { from: "639171234567", id: "wamid.3", timestamp: "1700000090", type: "document", document: { id: "m2", filename: "ID.pdf" } },
      ],
      statuses: [{ id: "wamid.out", status: "failed", errors: [{ title: "Re-engagement message", error_data: { details: "over 24h" } }] }],
    } }] }],
  });
  assert.deepEqual(messages.map((m) => [m.name, m.type, m.body, m.media_id, m.media_name]), [
    ["Ana", "text", "Is 12F still available?", null, null],
    ["Ana", "image", "This view", "m1", null],
    ["Ana", "document", null, "m2", "ID.pdf"],
  ]);
  assert.equal(messages[0].at, "2023-11-14T22:13:20.000Z");
  assert.deepEqual(statuses, [{ wa_message_id: "wamid.out", status: "failed", error: "Re-engagement message: over 24h" }]);
  assert.deepEqual(parse({}), { messages: [], statuses: [] });
});

test("the 24-hour reply window", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  assert.equal(canReply({ last_inbound_at: "2026-11-15T12:00:01Z" }, now), true);
  assert.equal(canReply({ last_inbound_at: "2026-11-15T11:59:59Z" }, now), false);
  assert.equal(canReply({ last_inbound_at: null }, now), false);
});
