// npm test: filling a Word template's {{blanks}} (drafts.js), the part that has to be exactly right
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillXml, wordsOf } from "./drafts.js";
import { strToU8 } from "fflate";

const words = (xml) => wordsOf({ "word/document.xml": strToU8(xml) });

test("a blank split over runs is filled; the text around it keeps its runs", () => {
  const p = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Buyer: </w:t></w:r><w:r><w:t>{{Client</w:t></w:r><w:r><w:t xml:space="preserve"> name}}</w:t></w:r><w:r><w:t>, of legal age.</w:t></w:r></w:p>`;
  const out = fillXml(p, { "client name": "Ana Reyes" });
  assert.deepEqual(words(out), ["Buyer: Ana Reyes, of legal age."]);
  assert.match(out, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Buyer: <\/w:t>/, "the bold label is still its own run");
});

test("blanks match loosely, values are escaped, line breaks become Word breaks, unknown blanks stay", () => {
  const out = fillXml(`<w:p><w:r><w:t>{{ UNIT }} at {{Building}}: {{Price}} &amp; {{Address}}</w:t></w:r></w:p>`, { unit: "12F", building: "A <B>", address: "Lot 1\nCebu" });
  assert.match(out, /12F at A &lt;B&gt;: \{\{Price\}\} &amp; Lot 1<\/w:t><w:br\/><w:t xml:space="preserve">Cebu/);
});

test("paragraphs without blanks are left exactly as they were", () => {
  const p = `<w:p><w:r><w:t>No blanks here</w:t></w:r></w:p>`;
  assert.equal(fillXml(p, { x: "y" }), p);
});
