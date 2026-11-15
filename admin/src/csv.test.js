// npm test: CSV that spreadsheets read right and can't be tricked by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "./csv.js";

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
