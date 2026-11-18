// npm test: CSV that spreadsheets read right and can't be tricked by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "./csv.js";

test("quoting and formulas", () => {
  const rows = [
    { name: 'Juan "JD" Cruz', note: "a, b\nc", n: 5, empty: null },
    { name: "=HYPERLINK(\"http://x\")", note: "+63 917", n: -2, empty: undefined },
  ];
  assert.equal(
    toCsv(rows, ["name", "note", ["Number", (r) => r.n], "empty"]),
    'name,note,Number,empty\r\n"Juan ""JD"" Cruz","a, b\nc",5,\r\n"\'=HYPERLINK(""http://x"")",\'+63 917,\'-2,'
  );
});

test("reading a CSV back: quotes, commas, line breaks, Excel's BOM and CRLF", () => {
  assert.deepEqual(parseCsv("﻿" + 'name,notes\r\n"Tan, Cy","said ""yes""\nthen left"\r\nBen,\r\n'), [["name", "notes"], ["Tan, Cy", 'said "yes"\nthen left'], ["Ben", ""]]);
  const rows = [{ a: "x,y", b: 'q"q' }];
  assert.deepEqual(parseCsv(toCsv(rows, ["a", "b"])), [["a", "b"], ["x,y", 'q"q']]);
});
