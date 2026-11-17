import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, unpack } from "./gmail.js";

const enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("a multipart email: its HTML, its text and its attachments", () => {
  const msg = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "multipart/alternative", parts: [
        { mimeType: "text/plain", body: { data: enc("Hello, ₱45,000 is fine") } },
        { mimeType: "text/html", body: { data: enc("<p>Hello, ₱45,000 is fine</p>") } },
      ] },
      { mimeType: "application/pdf", filename: "ID.pdf", body: { attachmentId: "abc123def456", size: 2048 } },
    ],
  };
  const out = unpack(msg);
  assert.equal(out.text, "Hello, ₱45,000 is fine");
  assert.equal(out.html, "<p>Hello, ₱45,000 is fine</p>");
  assert.deepEqual(out.attachments, [{ name: "ID.pdf", size: 2048, id: "abc123def456", type: "application/pdf" }]);
  assert.equal(decode(enc("ñ")), "ñ");
});
