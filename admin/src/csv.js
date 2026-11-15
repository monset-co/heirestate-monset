// CSV for exports and the monthly report. A cell that starts like a formula (= + - @) is prefixed
// with ' so a spreadsheet shows it as text instead of running it: data typed into the public forms
// ends up in these files.
const cell = (v) => {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// columns: [header, (row) => value] pairs, or plain keys
export function toCsv(rows, columns) {
  const cols = columns.map((c) => (Array.isArray(c) ? c : [c, (r) => r[c]]));
  return [cols.map(([h]) => cell(h)).join(","), ...rows.map((r) => cols.map(([, get]) => cell(get(r))).join(","))].join("\r\n");
}

// a download, with a byte-order mark so Excel reads ₱ and ñ right
export function download(name, text) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
