// npm test: filling a Word template's {{blanks}} (drafts.js), the part that has to be exactly right
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillXml, wordsOf, xlsxText, docxText } from "./drafts.js";
import { strToU8, zipSync } from "fflate";

test("an Excel workbook reads as its sheets' rows, text and numbers, gaps kept", () => {
  const book = zipSync({
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="Price list" sheetId="1" r:id="rId1"/><sheet name="Notes &amp; terms" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>Unit</t></si><si><t>Price</t></si><si><r><t>2BR </t></r><r><t>Corner</t></r></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>5500000</v></c><c r="D2" t="b"><v>1</v></c></row><row r="3"/></sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>10% down</t></is></c></row></sheetData></worksheet>`),
  });
  assert.equal(xlsxText(book), "[sheet Price list]\nUnit\t\tPrice\n2BR Corner\t\t5500000\tTRUE\n\n[sheet Notes & terms]\n\t10% down");
});

test("a Word file reads as its paragraphs", () => {
  const doc = zipSync({ "word/document.xml": strToU8(`<w:document><w:body><w:p><w:r><w:t>Sherlyn Royale</w:t></w:r></w:p><w:p><w:r><w:t>2BR, 54 sqm</w:t></w:r></w:p></w:body></w:document>`) });
  assert.equal(docxText(doc), "Sherlyn Royale\n2BR, 54 sqm");
});

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
